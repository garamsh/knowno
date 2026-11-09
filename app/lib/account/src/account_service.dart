import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'account_state.dart';
import 'config.dart';
import 'failure.dart';

/// Signs the user in and out, and reports whether they are signed in.
abstract interface class AccountService {
  /// The state now.
  AccountState get state;

  /// Every later change of [state].
  Stream<AccountState> get stateChanges;

  /// Opens the platform's Google account picker and starts a session for the
  /// account chosen. Returns normally, signed in or not, when the user cancels
  /// the picker; throws an [AccountFailure] otherwise.
  Future<void> signInWithGoogle();

  /// Opens the system's Apple ID sheet and starts a session for the Apple
  /// account, storing the name Apple shares on its first sign-in. Returns
  /// normally, signed in or not, when the user cancels the sheet; throws an
  /// [AccountFailure] otherwise. Offered on iOS alone.
  Future<void> signInWithApple();

  /// Asks Supabase Auth to email a 6-digit sign-in code to [email], creating
  /// the account on its first use. Throws an [AccountFailure] when no code
  /// was sent.
  Future<void> sendEmailCode(String email);

  /// Starts a session for [email] with the [code] it was sent. Throws an
  /// [AccountFailure] when the code is refused or the session did not start.
  Future<void> verifyEmailCode(String email, String code);

  /// Ends the session on this device, then tells the server. Throws an
  /// [AccountFailure] when the server cannot be told; the device is signed
  /// out either way.
  Future<void> signOut();

  /// Deletes the signed-in account on the server, and with it every row the
  /// account owns there; the device stays signed in until [signOut]. An
  /// account with an Apple identity first shows the Apple sheet once more, for
  /// the authorization code the server revokes Apple's tokens with. Returns
  /// false, with nothing deleted, when the user cancels that sheet. Throws an
  /// [AccountFailure] when the account could not be deleted; it then still
  /// exists.
  Future<bool> deleteAccount();
}

/// What [connectAccount] connects: the account service, and the Supabase
/// client it signs in through, whose session the sync domain reaches the
/// server's tables with. The client is null when the configuration cannot
/// sign anyone in.
typedef AccountConnection = ({AccountService service, SupabaseClient? client});

/// Connects to Supabase and Google with the configuration [defines] holds,
/// restoring the session a previous run stored. With a missing or malformed
/// configuration, the service is [AccountUnavailable] and there is no client.
Future<AccountConnection> connectAccount(Map<String, String> defines) async {
  final AccountConfig config;
  try {
    config = AccountConfig.parse(defines);
  } on InvalidAccountConfig catch (error) {
    return (
      service: UnavailableAccountService(AccountMisconfigured(error)),
      client: null,
    );
  }
  final supabase = await Supabase.initialize(
    url: config.supabaseUrl.toString(),
    publishableKey: config.publishableKey,
    // The browser OAuth flow is not used, so no deep link carries a session.
    authOptions: const FlutterAuthClientOptions(detectSessionInUri: false),
  );
  final service = await NativeAccountService.start(
    supabase.client.auth,
    GoogleSignIn.instance,
    functions: supabase.client.functions,
    // Android takes only the server client ID; iOS also needs its own.
    clientId: defaultTargetPlatform == TargetPlatform.iOS
        ? config.googleIosClientId.value
        : null,
    serverClientId: config.googleWebClientId.value,
  );
  return (service: service, client: supabase.client);
}

/// Signs in with Google's native picker or Apple's system sheet and exchanges
/// the ID token it returns for a Supabase session; deletes the account
/// through the `delete-account` Edge Function.
final class NativeAccountService implements AccountService {
  NativeAccountService._(
    this._auth,
    this._google,
    this._functions,
    this._nonce,
  );

  /// Initializes [google] with a new nonce and returns the service that signs
  /// in through it. Called once per run, since [google] takes one
  /// initialization; every sign-in in that run carries the same nonce.
  static Future<NativeAccountService> start(
    GoTrueClient auth,
    GoogleSignIn google, {
    required FunctionsClient functions,
    required String? clientId,
    required String serverClientId,
  }) async {
    final nonce = Nonce.generate();
    await google.initialize(
      clientId: clientId,
      serverClientId: serverClientId,
      nonce: nonce.hashed,
    );
    return NativeAccountService._(auth, google, functions, nonce);
  }

  final GoTrueClient _auth;
  final GoogleSignIn _google;
  final FunctionsClient _functions;
  final Nonce _nonce;

  static const _scopes = ['email', 'profile'];

  static const _appleScopes = [
    AppleIDAuthorizationScopes.email,
    AppleIDAuthorizationScopes.fullName,
  ];

  @override
  AccountState get state => _stateOf(_auth.currentSession);

  @override
  Stream<AccountState> get stateChanges => _auth.onAuthStateChange
      .map((change) => _stateOf(change.session))
      .handleError(_reportRefreshError);

  /// Reports a failed background refresh, which the stream carries as an
  /// error. One that could not reach the server is left out: the client keeps
  /// the session and retries it, so an offline device stays signed in.
  static void _reportRefreshError(Object error, StackTrace stackTrace) {
    if (error is AuthRetryableFetchException) return;
    FlutterError.reportError(
      FlutterErrorDetails(
        exception: error,
        stack: stackTrace,
        library: 'account',
      ),
    );
  }

  @override
  Future<void> signInWithGoogle() async {
    final GoogleSignInAccount user;
    final GoogleSignInClientAuthorization authorization;
    try {
      user = await _google.authenticate(scopeHint: _scopes);
      authorization =
          await user.authorizationClient.authorizationForScopes(_scopes) ??
          await user.authorizationClient.authorizeScopes(_scopes);
    } on GoogleSignInException catch (error) {
      final failure = classifyGoogleError(error);
      if (failure == null) return;
      throw failure;
    }
    final idToken = user.authentication.idToken;
    if (idToken == null) {
      throw const AccountRejected(MissingIdToken());
    }
    try {
      await _auth.signInWithIdToken(
        provider: OAuthProvider.google,
        idToken: idToken,
        accessToken: authorization.accessToken,
        nonce: _nonce.raw,
      );
    } on Exception catch (error) {
      throw classifyAuthError(error);
    }
  }

  /// Apple takes a nonce per request, so each sign-in draws its own: Apple
  /// puts its SHA-256 in the ID token, and Supabase checks the raw value.
  @override
  Future<void> signInWithApple() async {
    final nonce = Nonce.generate();
    final AuthorizationCredentialAppleID credential;
    try {
      credential = await SignInWithApple.getAppleIDCredential(
        scopes: _appleScopes,
        nonce: nonce.hashed,
      );
    } on SignInWithAppleException catch (error) {
      final failure = classifyAppleError(error);
      if (failure == null) return;
      throw failure;
    }
    final idToken = credential.identityToken;
    if (idToken == null) {
      throw const AccountRejected(MissingIdToken());
    }
    try {
      await _auth.signInWithIdToken(
        provider: OAuthProvider.apple,
        idToken: idToken,
        nonce: nonce.raw,
      );
    } on Exception catch (error) {
      throw classifyAuthError(error);
    }
    await _storeAppleName(credential);
  }

  /// Stores the name Apple shares only on an account's first sign-in, as
  /// Supabase's guide stores it. The session has started by then, so a
  /// failure is reported rather than thrown: the user stays signed in.
  Future<void> _storeAppleName(
    AuthorizationCredentialAppleID credential,
  ) async {
    final givenName = credential.givenName;
    final familyName = credential.familyName;
    final fullName = [
      ?givenName,
      ?familyName,
    ].where((part) => part.isNotEmpty).join(' ');
    if (fullName.isEmpty) return;
    try {
      await _auth.updateUser(
        UserAttributes(
          data: {
            'full_name': fullName,
            'given_name': givenName,
            'family_name': familyName,
          },
        ),
      );
    } on Exception catch (error, stackTrace) {
      FlutterError.reportError(
        FlutterErrorDetails(
          exception: error,
          stack: stackTrace,
          library: 'account',
          context: ErrorDescription("while storing the Apple account's name"),
        ),
      );
    }
  }

  @override
  Future<void> sendEmailCode(String email) async {
    try {
      await _auth.signInWithOtp(email: email, shouldCreateUser: true);
    } on Exception catch (error) {
      throw classifyAuthError(error);
    }
  }

  @override
  Future<void> verifyEmailCode(String email, String code) async {
    try {
      await _auth.verifyOTP(email: email, token: code, type: OtpType.email);
    } on Exception catch (error) {
      throw classifyAuthError(error);
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _auth.signOut();
    } on Exception catch (error) {
      throw classifyAuthError(error);
    } finally {
      // Without this, the next sign-in would reuse the account just left.
      await _google.signOut();
    }
  }

  /// Calls `delete-account`, which deletes the user the session's token
  /// names; the request carries no user id. For an account with an Apple
  /// identity the request's body is the code of a fresh Apple sheet, shown
  /// with no scopes: the code is single-use and short-lived, so it is sent at
  /// once and never kept.
  @override
  Future<bool> deleteAccount() async {
    String? appleCode;
    if (_hasAppleIdentity) {
      try {
        appleCode = (await SignInWithApple.getAppleIDCredential(
          scopes: const [],
        )).authorizationCode;
      } on SignInWithAppleException catch (error) {
        final failure = classifyAppleError(error);
        if (failure == null) return false;
        throw failure;
      }
    }
    final FunctionResponse response;
    try {
      response = await _functions.invoke(
        'delete-account',
        body: appleCode == null
            ? null
            : {'apple_authorization_code': appleCode},
      );
    } on FunctionException catch (error) {
      throw classifyDeletionError(error);
    }
    if (response.status != 204) {
      throw AccountRejected(UnexpectedDeletionAnswer(response.status));
    }
    return true;
  }

  /// Whether the signed-in account holds an Apple identity, as the session's
  /// user lists its identities; a session that lists none holds none.
  bool get _hasAppleIdentity =>
      _auth.currentUser?.identities?.any(
        (identity) => identity.provider == 'apple',
      ) ??
      false;

  static AccountState _stateOf(Session? session) => switch (session) {
    null => const SignedOut(),
    Session(:final user) => SignedIn(
      userId: UserId(user.id),
      email: user.email,
    ),
  };
}

/// The service of a build whose configuration cannot sign anyone in.
final class UnavailableAccountService implements AccountService {
  const UnavailableAccountService(this.failure);

  final AccountMisconfigured failure;

  @override
  AccountState get state => AccountUnavailable(failure);

  @override
  Stream<AccountState> get stateChanges => const Stream.empty();

  @override
  Future<void> signInWithGoogle() async => throw failure;

  @override
  Future<void> signInWithApple() async => throw failure;

  @override
  Future<void> sendEmailCode(String email) async => throw failure;

  @override
  Future<void> verifyEmailCode(String email, String code) async =>
      throw failure;

  @override
  Future<void> signOut() async {}

  @override
  Future<bool> deleteAccount() async => throw failure;
}

/// The nonce that binds a Google or Apple ID token to this app's sign-in: the
/// provider puts [hashed] in the token, and Supabase checks it against the
/// [raw] value.
final class Nonce {
  Nonce._(this.raw) : hashed = sha256.convert(utf8.encode(raw)).toString();

  /// A nonce of 32 bytes from a cryptographically secure source.
  factory Nonce.generate() {
    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    return Nonce._(base64UrlEncode(bytes));
  }

  /// The value sent to Supabase.
  final String raw;

  /// The SHA-256 of [raw] as lowercase hex, the value sent to the provider.
  final String hashed;
}

/// Google or Apple returned an account without an ID token.
final class MissingIdToken implements Exception {
  const MissingIdToken();

  @override
  String toString() => 'MissingIdToken: the provider returned no ID token';
}

/// `delete-account` answered with a success other than its 204.
final class UnexpectedDeletionAnswer implements Exception {
  const UnexpectedDeletionAnswer(this.status);

  final int status;

  @override
  String toString() => 'UnexpectedDeletionAnswer: status $status';
}

/// The failure a `delete-account` [error] means: a request that never
/// arrived, or a server or gateway error, is [AccountOffline]; any other
/// refusal, an expired session's 401 among them, is [AccountRejected].
AccountFailure classifyDeletionError(FunctionException error) =>
    switch (error) {
      FunctionsFetchException() => AccountOffline(error),
      FunctionException(:final status) when status >= 500 => AccountOffline(
        error,
      ),
      _ => AccountRejected(error),
    };

/// The failure a Google sign-in [error] means; null for a user who cancelled.
AccountFailure? classifyGoogleError(GoogleSignInException error) =>
    switch (error.code) {
      GoogleSignInExceptionCode.canceled => null,
      GoogleSignInExceptionCode.clientConfigurationError ||
      GoogleSignInExceptionCode.providerConfigurationError =>
        AccountMisconfigured(error),
      GoogleSignInExceptionCode.interrupted ||
      GoogleSignInExceptionCode.uiUnavailable ||
      GoogleSignInExceptionCode.userMismatch ||
      GoogleSignInExceptionCode.unknownError => AccountRejected(error),
    };

/// The failure an Apple sign-in [error] means; null for a user who cancelled.
/// A device that cannot offer the sheet is [AccountMisconfigured]; any other
/// failure Apple reports is [AccountRejected].
AccountFailure? classifyAppleError(SignInWithAppleException error) =>
    switch (error) {
      SignInWithAppleAuthorizationException(
        code: AuthorizationErrorCode.canceled,
      ) =>
        null,
      SignInWithAppleNotSupportedException() => AccountMisconfigured(error),
      _ => AccountRejected(error),
    };

/// The failure a Supabase Auth [error] means. The client wraps a request that
/// never reached the server, or that it failed with a 5xx, in
/// [AuthRetryableFetchException]. A refusal for coming too often is
/// [AccountRateLimited], with the wait its message names; a code refused,
/// wrong or expired alike, [AccountCodeRefused]; an address Auth will not
/// send to, [AccountAddressRefused].
AccountFailure classifyAuthError(Exception error) => switch (error) {
  AuthRetryableFetchException() => AccountOffline(error),
  AuthApiException(code: 'provider_disabled') ||
  AuthApiException(code: 'email_provider_disabled') ||
  AuthApiException(code: 'signup_disabled') => AccountMisconfigured(error),
  AuthApiException(code: 'user_banned') => AccountSuspended(error),
  AuthApiException(code: 'over_email_send_rate_limit') ||
  AuthApiException(code: 'over_request_rate_limit') ||
  AuthApiException(
    statusCode: '429',
  ) => AccountRateLimited(error, retryAfter: _waitNamedBy(error)),
  AuthApiException(code: 'otp_expired') => AccountCodeRefused(error),
  AuthApiException(code: 'validation_failed') ||
  AuthApiException(code: 'email_address_invalid') ||
  AuthApiException(
    code: 'email_address_not_authorized',
  ) => AccountAddressRefused(error),
  _ => AccountRejected(error),
};

/// The seconds a rate limit's message names, as "after 49 seconds", or null
/// where it names none.
Duration? _waitNamedBy(AuthApiException error) {
  final seconds = RegExp(r'(\d+) seconds?').firstMatch(error.message)?.group(1);
  return seconds == null ? null : Duration(seconds: int.parse(seconds));
}
