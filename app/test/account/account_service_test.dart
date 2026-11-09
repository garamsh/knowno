import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/account_service.dart';
import 'package:knowno/account/src/failure_message.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:sign_in_with_apple_platform_interface/sign_in_with_apple_platform_interface.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'fake_apple_sign_in.dart';
import 'fake_google_sign_in.dart';

const _url = 'https://example.test/auth/v1';

Map<String, Object?> _session({
  String email = 'ada@example.com',
  List<String> providers = const ['google'],
}) => {
  'access_token': 'supabase-access-token',
  'expires_in': 3600,
  'refresh_token': 'supabase-refresh-token',
  'token_type': 'bearer',
  'user': {
    'id': '00000000-0000-4000-8000-000000000001',
    'aud': 'authenticated',
    'email': email,
    'app_metadata': <String, Object?>{},
    'user_metadata': <String, Object?>{},
    'created_at': '2026-10-14T00:00:00Z',
    'identities': [
      for (final provider in providers)
        {
          'id': '00000000-0000-4000-8000-000000000001',
          'user_id': '00000000-0000-4000-8000-000000000001',
          'identity_id': 'identity-$provider',
          'provider': provider,
          'identity_data': <String, Object?>{},
        },
    ],
  },
};

/// Keeps what the client stores in memory.
class _MemoryStorage extends GotrueAsyncStorage {
  final _items = <String, String>{};

  @override
  Future<String?> getItem({required String key}) async => _items[key];

  @override
  Future<void> removeItem({required String key}) async => _items.remove(key);

  @override
  Future<void> setItem({required String key, required String value}) async =>
      _items[key] = value;
}

void main() {
  late FakeGoogleSignIn google;
  late FakeAppleSignIn apple;
  late List<http.Request> requests;

  setUpAll(() {
    google = FakeGoogleSignIn();
    GoogleSignInPlatform.instance = google;
  });

  setUp(() {
    apple = FakeAppleSignIn();
    SignInWithApplePlatform.instance = apple;
  });

  setUp(() {
    google
      ..result = FakeGoogleSignIn.signedIn()
      ..error = null
      ..signOuts = 0
      ..nonce = null;
    requests = [];
  });

  Future<NativeAccountService> start(
    GoTrueClient auth, {
    http.Client? functionsHttp,
  }) {
    final functions = FunctionsClient(
      'https://example.test/functions/v1',
      const {},
      httpClient: functionsHttp,
    );
    addTearDown(functions.dispose);
    return NativeAccountService.start(
      auth,
      GoogleSignIn.instance,
      functions: functions,
      clientId: null,
      serverClientId: 'web-client-id',
    );
  }

  /// A service over a Supabase Auth client and an Edge Functions client
  /// whose server answers with [respond].
  Future<NativeAccountService> serviceAnswering(
    Future<http.Response> Function(http.Request) respond,
  ) {
    final server = MockClient((request) {
      requests.add(request);
      return respond(request);
    });
    return start(
      GoTrueClient(
        url: _url,
        autoRefreshToken: false,
        httpClient: server,
        // The PKCE flow Supabase.initialize sets keeps its verifier here.
        asyncStorage: _MemoryStorage(),
      ),
      functionsHttp: server,
    );
  }

  Future<http.Response> grant(http.Request request) async =>
      http.Response(jsonEncode(_session()), 200);

  Future<AccountFailure?> failureOf(Future<void> Function() action) async {
    try {
      await action();
    } on AccountFailure catch (failure) {
      return failure;
    }
    return null;
  }

  test('sign-in exchanges the Google ID token for a session', () async {
    final service = await serviceAnswering(grant);
    expect(service.state, isA<SignedOut>());

    await service.signInWithGoogle();

    final request = requests.single;
    expect(request.url.path, '/auth/v1/token');
    expect(request.url.queryParameters['grant_type'], 'id_token');
    expect(
      jsonDecode(request.body),
      allOf(
        containsPair('provider', 'google'),
        containsPair('id_token', 'google-id-token'),
        containsPair('access_token', 'google-access-token'),
      ),
    );
    expect(
      service.state,
      isA<SignedIn>()
          .having((s) => s.email, 'email', 'ada@example.com')
          .having(
            (s) => s.userId,
            'userId',
            const UserId('00000000-0000-4000-8000-000000000001'),
          ),
    );
  });

  test(
    'sign-in sends Supabase the raw nonce whose SHA-256 hex Google got',
    () async {
      final service = await serviceAnswering(grant);

      await service.signInWithGoogle();

      final raw = (jsonDecode(requests.single.body) as Map)['nonce'];
      expect(raw, isA<String>().having((r) => r.length, 'length', 44));
      expect(
        google.nonce,
        sha256.convert(utf8.encode(raw as String)).toString(),
      );
    },
  );

  test('each start draws a new nonce', () async {
    await serviceAnswering(grant);
    final first = google.nonce;
    await serviceAnswering(grant);

    expect(first, isNotNull);
    expect(google.nonce, isNot(first));
  });

  test('a stored session is restored as signed in', () async {
    final auth = GoTrueClient(url: _url, autoRefreshToken: false);
    await auth.recoverSession(jsonEncode(_session(email: 'grace@example.com')));

    final service = await start(auth);

    expect(
      service.state,
      isA<SignedIn>().having((s) => s.email, 'email', 'grace@example.com'),
    );
  });

  test(
    'a cancelled picker returns quietly and asks Supabase nothing',
    () async {
      google.error = const GoogleSignInException(
        code: GoogleSignInExceptionCode.canceled,
      );
      final service = await serviceAnswering(grant);

      expect(await failureOf(service.signInWithGoogle), isNull);
      expect(requests, isEmpty);
      expect(service.state, isA<SignedOut>());
    },
  );

  test('Google refusing the app configuration is a misconfiguration', () async {
    google.error = const GoogleSignInException(
      code: GoogleSignInExceptionCode.clientConfigurationError,
    );

    expect(
      await failureOf((await serviceAnswering(grant)).signInWithGoogle),
      isA<AccountMisconfigured>(),
    );
  });

  test('Google failing the sign-in otherwise is a rejection', () async {
    google.error = const GoogleSignInException(
      code: GoogleSignInExceptionCode.unknownError,
    );

    expect(
      await failureOf((await serviceAnswering(grant)).signInWithGoogle),
      isA<AccountRejected>(),
    );
  });

  test('an account without an ID token is a rejection', () async {
    google.result = FakeGoogleSignIn.signedIn(idToken: null);
    final service = await serviceAnswering(grant);

    expect(await failureOf(service.signInWithGoogle), isA<AccountRejected>());
    expect(requests, isEmpty);
  });

  test('Supabase out of reach is offline', () async {
    final service = await serviceAnswering(
      (_) async => throw http.ClientException('no route to host'),
    );

    expect(await failureOf(service.signInWithGoogle), isA<AccountOffline>());
    expect(service.state, isA<SignedOut>());
  });

  test('Supabase refusing the ID token is a rejection', () async {
    final service = await serviceAnswering(
      (_) async => http.Response(
        jsonEncode({
          'code': 400,
          'error_code': 'bad_jwt',
          'msg': 'Unacceptable audience in id_token',
        }),
        400,
      ),
    );

    expect(await failureOf(service.signInWithGoogle), isA<AccountRejected>());
    expect(service.state, isA<SignedOut>());
  });

  test(
    'Supabase with the Google provider disabled is a misconfiguration',
    () async {
      final service = await serviceAnswering(
        (_) async => http.Response(
          jsonEncode({
            'code': 400,
            'error_code': 'provider_disabled',
            'msg': 'Provider is not enabled',
          }),
          400,
        ),
      );

      expect(
        await failureOf(service.signInWithGoogle),
        isA<AccountMisconfigured>(),
      );
    },
  );

  test('Supabase refusing a banned user is a suspension, which the sign-in screen names', () async {
    final service = await serviceAnswering(
      (_) async => http.Response(
        jsonEncode({
          'code': 400,
          'error_code': 'user_banned',
          'msg': 'User is banned',
        }),
        400,
      ),
    );

    expect(await failureOf(service.signInWithGoogle), isA<AccountSuspended>());
    expect(service.state, isA<SignedOut>());
    final l10n = await AppLocalizations.delegate.load(const Locale('ko'));
    expect(
      describeAccountFailure(l10n, AccountSuspended(Exception('banned'))),
      '이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요.',
    );
  });

  test('sign-out ends the session and the Google sign-in', () async {
    final service = await serviceAnswering(
      (request) async => request.url.path.endsWith('/logout')
          ? http.Response('', 204)
          : grant(request),
    );
    await service.signInWithGoogle();
    expect(service.state, isA<SignedIn>());
    final changes = expectLater(
      service.stateChanges,
      emitsThrough(isA<SignedOut>()),
    );

    await service.signOut();

    expect(service.state, isA<SignedOut>());
    expect(google.signOuts, 1);
    await changes;
  });

  test('sign-out offline signs the device out and reports offline', () async {
    var online = true;
    final service = await serviceAnswering((request) async {
      if (!online) throw http.ClientException('no route to host');
      return grant(request);
    });
    await service.signInWithGoogle();
    online = false;

    expect(await failureOf(service.signOut), isA<AccountOffline>());
    expect(service.state, isA<SignedOut>());
  });

  group('deleting the account', () {
    const deletePath = '/functions/v1/delete-account';

    /// A service signed in with an account holding identities of
    /// [providers], whose `delete-account` answers with [respond].
    Future<NativeAccountService> signedInDeleting(
      Future<http.Response> Function(http.Request) respond, {
      List<String> providers = const ['google'],
    }) async {
      final service = await serviceAnswering(
        (request) async => request.url.path == deletePath
            ? respond(request)
            : http.Response(jsonEncode(_session(providers: providers)), 200),
      );
      await service.signInWithGoogle();
      // The setup signed in.
      expect(service.state, isA<SignedIn>());
      requests.clear();
      apple.nonces.clear();
      return service;
    }

    test('posts to delete-account with no body, so it names no user, and leaves sign-out to the caller', () async {
      final service = await signedInDeleting(
        (_) async => http.Response('', 204),
      );

      expect(await service.deleteAccount(), isTrue);

      final request = requests.single;
      expect(request.method, 'POST');
      expect(request.url.path, deletePath);
      expect(request.body, isEmpty);
      expect(apple.nonces, isEmpty, reason: 'no Apple sheet for Google');
      expect(service.state, isA<SignedIn>());
      expect(google.signOuts, 0);
    });

    test('an email account sends no body and shows no Apple sheet', () async {
      final service = await signedInDeleting(
        (_) async => http.Response('', 204),
        providers: const ['email'],
      );

      expect(await service.deleteAccount(), isTrue);

      expect(requests.single.body, isEmpty);
      expect(apple.nonces, isEmpty);
    });

    group('an account with an Apple identity', () {
      test(
        'shows the sheet with no scopes, then posts its code as the JSON body',
        () async {
          final order = <String>[];
          final service = await signedInDeleting((request) async {
            order.add('request');
            return http.Response('', 204);
          }, providers: const ['apple']);
          apple.onSheet = () => order.add('sheet');

          expect(await service.deleteAccount(), isTrue);

          expect(apple.scopes, isEmpty);
          expect(order, ['sheet', 'request']);
          final request = requests.single;
          expect(request.url.path, deletePath);
          expect(request.headers['Content-Type'], contains('application/json'));
          expect(jsonDecode(request.body), {
            'apple_authorization_code': 'apple-authorization-code',
          });
          expect(service.state, isA<SignedIn>());
        },
      );

      test(
        'does the same for an account that also signed in with Google',
        () async {
          final service = await signedInDeleting(
            (_) async => http.Response('', 204),
            providers: const ['google', 'apple'],
          );

          expect(await service.deleteAccount(), isTrue);

          expect(jsonDecode(requests.single.body), {
            'apple_authorization_code': 'apple-authorization-code',
          });
        },
      );

      test('is not deleted when the sheet is cancelled, and asks the server nothing', () async {
        final service = await signedInDeleting(
          (_) async => http.Response('', 204),
          providers: const ['apple'],
        );
        apple.error = const SignInWithAppleAuthorizationException(
          code: AuthorizationErrorCode.canceled,
          message: 'The user canceled the authorization attempt.',
        );

        expect(await service.deleteAccount(), isFalse);

        expect(requests, isEmpty);
        expect(service.state, isA<SignedIn>());
      });

      test('is not deleted when the sheet fails otherwise, and says it was rejected', () async {
        final service = await signedInDeleting(
          (_) async => http.Response('', 204),
          providers: const ['apple'],
        );
        apple.error = const SignInWithAppleAuthorizationException(
          code: AuthorizationErrorCode.failed,
          message: 'failed',
        );

        expect(await failureOf(service.deleteAccount), isA<AccountRejected>());
        expect(requests, isEmpty);
      });

      test('asks for a new code at each try, since a code is spent once and kept nowhere', () async {
        var status = 502;
        final service = await signedInDeleting(
          (_) async => http.Response('', status),
          providers: const ['apple'],
        );

        expect(await failureOf(service.deleteAccount), isA<AccountOffline>());
        apple.credential = FakeAppleSignIn.signedIn(
          authorizationCode: 'second-code',
        );
        status = 204;
        expect(await service.deleteAccount(), isTrue);

        expect(requests.map((r) => jsonDecode(r.body)), [
          {'apple_authorization_code': 'apple-authorization-code'},
          {'apple_authorization_code': 'second-code'},
        ]);
        expect(apple.nonces, hasLength(2), reason: 'a sheet each time');
      });

      for (final (name, respond, failure) in [
        (
          'a 502 is offline',
          (http.Request _) async => http.Response('', 502),
          isA<AccountOffline>(),
        ),
        (
          'a 401 is a rejection',
          (http.Request _) async => http.Response('', 401),
          isA<AccountRejected>(),
        ),
      ]) {
        test(
          '$name, as for any account, and the account stays signed in',
          () async {
            final service = await signedInDeleting(
              respond,
              providers: const ['apple'],
            );

            expect(await failureOf(service.deleteAccount), failure);
            expect(service.state, isA<SignedIn>());
          },
        );
      }
    });

    for (final (name, respond, failure) in [
      (
        'a request that never arrives is offline',
        (http.Request _) async =>
            throw http.ClientException('no route to host'),
        isA<AccountOffline>(),
      ),
      (
        'the function failing with 502 is offline',
        (http.Request _) async =>
            http.Response('{"error":"delete_failed"}', 502),
        isA<AccountOffline>(),
      ),
      (
        'the function refusing the session with 401 is a rejection',
        (http.Request _) async =>
            http.Response('{"error":"unauthenticated"}', 401),
        isA<AccountRejected>(),
      ),
      (
        'a success other than 204 is a rejection',
        (http.Request _) async => http.Response('', 200),
        isA<AccountRejected>(),
      ),
    ]) {
      test('$name, and the account stays signed in', () async {
        final service = await signedInDeleting(respond);

        expect(await failureOf(service.deleteAccount), failure);
        expect(service.state, isA<SignedIn>());
      });
    }
  });

  group('signing in with Apple', () {
    /// A server that grants the ID token and answers the name's update with
    /// the user.
    Future<http.Response> grantAndUpdate(http.Request request) async =>
        request.url.path.endsWith('/user')
        ? http.Response(jsonEncode(_session()['user']), 200)
        : grant(request);

    test('exchanges the Apple ID token for a session', () async {
      final service = await serviceAnswering(grantAndUpdate);

      await service.signInWithApple();

      expect(apple.scopes, [
        AppleIDAuthorizationScopes.email,
        AppleIDAuthorizationScopes.fullName,
      ]);
      final request = requests.single;
      expect(request.url.path, '/auth/v1/token');
      expect(request.url.queryParameters['grant_type'], 'id_token');
      expect(
        jsonDecode(request.body),
        allOf(
          containsPair('provider', 'apple'),
          containsPair('id_token', 'apple-id-token'),
        ),
      );
      expect(
        service.state,
        isA<SignedIn>().having((s) => s.email, 'email', 'ada@example.com'),
      );
    });

    test(
      'sends Supabase the raw nonce whose SHA-256 hex Apple got, new each time',
      () async {
        final service = await serviceAnswering(grantAndUpdate);

        await service.signInWithApple();
        await service.signInWithApple();

        final raws = [
          for (final request in requests)
            (jsonDecode(request.body) as Map)['nonce'] as String,
        ];
        expect(apple.nonces, [
          for (final raw in raws) sha256.convert(utf8.encode(raw)).toString(),
        ]);
        expect(raws.toSet(), hasLength(2));
      },
    );

    test(
      'stores the name Apple shares on the first sign-in as Supabase guides',
      () async {
        apple.credential = FakeAppleSignIn.signedIn(
          givenName: 'Ada',
          familyName: 'Lovelace',
        );
        final service = await serviceAnswering(grantAndUpdate);

        await service.signInWithApple();

        final update = requests.last;
        expect(update.method, 'PUT');
        expect(update.url.path, '/auth/v1/user');
        expect((jsonDecode(update.body) as Map)['data'], {
          'full_name': 'Ada Lovelace',
          'given_name': 'Ada',
          'family_name': 'Lovelace',
        });
        expect(service.state, isA<SignedIn>());
      },
    );

    test('asks nothing more when Apple shares no name', () async {
      final service = await serviceAnswering(grantAndUpdate);

      await service.signInWithApple();

      expect(requests.map((r) => r.url.path), ['/auth/v1/token']);
    });

    test(
      'a name that cannot be stored is reported and leaves the user signed in',
      () async {
        apple.credential = FakeAppleSignIn.signedIn(givenName: 'Ada');
        final reported = <FlutterErrorDetails>[];
        final previous = FlutterError.onError;
        FlutterError.onError = reported.add;
        addTearDown(() => FlutterError.onError = previous);
        final service = await serviceAnswering(
          (request) async => request.url.path.endsWith('/user')
              ? http.Response('{"msg":"unavailable"}', 503)
              : grant(request),
        );

        expect(await failureOf(service.signInWithApple), isNull);

        expect(service.state, isA<SignedIn>());
        expect(reported, hasLength(1));
      },
    );

    test(
      'a cancelled sheet returns quietly and asks Supabase nothing',
      () async {
        apple.error = const SignInWithAppleAuthorizationException(
          code: AuthorizationErrorCode.canceled,
          message: 'The user canceled the authorization attempt.',
        );
        final service = await serviceAnswering(grantAndUpdate);

        expect(await failureOf(service.signInWithApple), isNull);
        expect(requests, isEmpty);
        expect(service.state, isA<SignedOut>());
      },
    );

    test('Apple failing the sign-in is a rejection', () async {
      apple.error = const SignInWithAppleAuthorizationException(
        code: AuthorizationErrorCode.failed,
        message: 'The authorization attempt failed.',
      );
      final service = await serviceAnswering(grantAndUpdate);

      expect(await failureOf(service.signInWithApple), isA<AccountRejected>());
      expect(requests, isEmpty);
      expect(service.state, isA<SignedOut>());
    });

    test('a device without the sheet is a misconfiguration', () async {
      apple.error = const SignInWithAppleNotSupportedException(
        message: 'Unsupported platform',
      );

      expect(
        await failureOf((await serviceAnswering(grant)).signInWithApple),
        isA<AccountMisconfigured>(),
      );
    });

    test('a credential without an ID token is a rejection', () async {
      apple.credential = FakeAppleSignIn.signedIn(identityToken: null);
      final service = await serviceAnswering(grantAndUpdate);

      expect(await failureOf(service.signInWithApple), isA<AccountRejected>());
      expect(requests, isEmpty);
    });

    test('Supabase refusing the Apple ID token is a rejection', () async {
      final service = await serviceAnswering(
        (_) async => http.Response(
          jsonEncode({
            'code': 400,
            'error_code': 'bad_jwt',
            'msg': 'Unacceptable audience in id_token',
          }),
          400,
        ),
      );

      expect(await failureOf(service.signInWithApple), isA<AccountRejected>());
      expect(service.state, isA<SignedOut>());
    });
  });

  group('signing in with an email code', () {
    http.Response refusal(int status, String code, String message) =>
        http.Response(
          jsonEncode({'code': status, 'error_code': code, 'msg': message}),
          status,
        );

    test(
      'asks Supabase to email a code and to create the account on first use',
      () async {
        final service = await serviceAnswering(
          (_) async => http.Response('{}', 200),
        );

        await service.sendEmailCode('ada@example.com');

        final request = requests.single;
        expect(request.url.path, '/auth/v1/otp');
        expect(
          jsonDecode(request.body),
          allOf(
            containsPair('email', 'ada@example.com'),
            containsPair('create_user', true),
          ),
        );
        expect(service.state, isA<SignedOut>(), reason: 'a code is no session');
      },
    );

    test('verifies the code as an email code and starts the session it answers with', () async {
      final service = await serviceAnswering(grant);
      expect(service.state, isA<SignedOut>());

      await service.verifyEmailCode('ada@example.com', '123456');

      final request = requests.single;
      expect(request.url.path, '/auth/v1/verify');
      expect(
        jsonDecode(request.body),
        allOf(
          containsPair('email', 'ada@example.com'),
          containsPair('token', '123456'),
          containsPair('type', 'email'),
        ),
      );
      expect(
        service.state,
        isA<SignedIn>().having((s) => s.email, 'email', 'ada@example.com'),
      );
    });

    test(
      'sends only the digits of a short code, whatever is around them',
      () async {
        final service = await serviceAnswering(grant);

        await service.verifyEmailCode('ada@example.com', ' 코드 123 456 ');

        expect(requests.single.url.path, '/auth/v1/verify');
        expect(
          jsonDecode(requests.single.body),
          containsPair('token', '123456'),
        );
      },
    );

    group('with the code App Review is given', () {
      const reviewPath = '/functions/v1/review-sign-in';
      const reviewCode = 'f3a91c07d25be84601a9c3d7';

      http.Response tokenHash([String hash = 'hash-1']) => http.Response(
        jsonEncode({'token_hash': hash, 'type': 'email'}),
        200,
        headers: {'content-type': 'application/json'},
      );

      /// The function answers with [onReview]; Auth grants a session.
      Future<NativeAccountService> reviewing(
        http.Response Function() onReview,
      ) => serviceAnswering(
        (request) async =>
            request.url.path == reviewPath ? onReview() : grant(request),
      );

      Future<AccountFailure?> expectRefusedWithNoSession(
        NativeAccountService service,
        Matcher matcher,
      ) async {
        final failure = await failureOf(
          () => service.verifyEmailCode('review@example.com', reviewCode),
        );
        expect(failure, matcher);
        expect(service.state, isA<SignedOut>());
        return failure;
      }

      Future<String> koreanFor(AccountFailure? failure) async =>
          describeAccountFailure(
            await AppLocalizations.delegate.load(const Locale('ko')),
            failure!,
          );

      test(
        'asks review-sign-in, then exchanges its token hash for the session',
        () async {
          final service = await reviewing(tokenHash);

          await service.verifyEmailCode('review@example.com', ' $reviewCode ');

          expect(requests.map((r) => r.url.path), [
            reviewPath,
            '/auth/v1/verify',
          ]);
          expect(jsonDecode(requests.first.body), {
            'email': 'review@example.com',
            'code': reviewCode,
          });
          final verify = jsonDecode(requests.last.body) as Map<String, dynamic>;
          expect(verify, containsPair('token_hash', 'hash-1'));
          expect(verify, containsPair('type', 'email'));
          expect(verify, isNot(contains('token')), reason: 'no code to Auth');
          expect(service.state, isA<SignedIn>());
        },
      );

      test('is chosen from the twelfth character, and an ordinary code never reaches the function', () async {
        final service = await reviewing(tokenHash);

        await service.verifyEmailCode('ada@example.com', '12345678901');
        expect(requests.map((r) => r.url.path), ['/auth/v1/verify']);

        requests.clear();
        await service.verifyEmailCode('ada@example.com', '123456789012');
        expect(requests.map((r) => r.url.path), [
          reviewPath,
          '/auth/v1/verify',
        ]);
      });

      test(
        'a refused pair is a refused code, and no session is asked for',
        () async {
          final service = await reviewing(
            () => http.Response('{"error":"refused"}', 401),
          );

          final failure = await expectRefusedWithNoSession(
            service,
            isA<AccountCodeRefused>(),
          );
          expect(requests.map((r) => r.url.path), [reviewPath]);
          expect(
            await koreanFor(failure),
            '코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요.',
          );
        },
      );

      test('a rate limit is the rate limit with its ten minutes', () async {
        final service = await reviewing(
          () => http.Response(
            '{"error":"rate_limited"}',
            429,
            headers: {'retry-after': '600'},
          ),
        );

        final failure = await expectRefusedWithNoSession(
          service,
          isA<AccountRateLimited>().having(
            (f) => f.retryAfter,
            'retryAfter',
            const Duration(minutes: 10),
          ),
        );
        expect(await koreanFor(failure), '요청이 너무 많아요. 600초 뒤에 다시 시도해 주세요.');
      });

      test(
        'a function that is down is offline, and any other refusal a rejection',
        () async {
          await expectRefusedWithNoSession(
            await reviewing(
              () => http.Response('{"error":"unavailable"}', 502),
            ),
            isA<AccountOffline>(),
          );
          await expectRefusedWithNoSession(
            await reviewing(
              () => http.Response('{"error":"bad_request"}', 400),
            ),
            isA<AccountRejected>(),
          );
        },
      );

      test('an answer without a token hash is a rejection', () async {
        await expectRefusedWithNoSession(
          await reviewing(
            () => http.Response(
              '{}',
              200,
              headers: {'content-type': 'application/json'},
            ),
          ),
          isA<AccountRejected>(),
        );
      });

      test('a token hash Auth refuses is a refused code', () async {
        final service = await serviceAnswering(
          (request) async => request.url.path == reviewPath
              ? tokenHash()
              : refusal(403, 'otp_expired', 'Token has expired or is invalid'),
        );

        await expectRefusedWithNoSession(service, isA<AccountCodeRefused>());
      });
    });

    test(
      'signs out as any account does, though Google was never used',
      () async {
        final service = await serviceAnswering(
          (request) async => request.url.path.endsWith('/logout')
              ? http.Response('', 204)
              : grant(request),
        );
        await service.verifyEmailCode('ada@example.com', '123456');
        expect(service.state, isA<SignedIn>());

        await service.signOut();

        expect(service.state, isA<SignedOut>());
        expect(requests.last.url.path, '/auth/v1/logout');
      },
    );

    final failures =
        <
          (
            String,
            Future<http.Response> Function(http.Request),
            bool,
            Matcher,
            String?,
          )
        >[
          (
            'a server that cannot be reached is offline',
            (_) async => throw http.ClientException('no route to host'),
            true,
            isA<AccountOffline>(),
            '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
          ),
          (
            'a refusal for coming too often names the wait the message gives',
            (_) async => refusal(
              429,
              'over_email_send_rate_limit',
              'For security purposes, you can only request this after 49 seconds.',
            ),
            true,
            isA<AccountRateLimited>().having(
              (f) => f.retryAfter,
              'retryAfter',
              const Duration(seconds: 49),
            ),
            '요청이 너무 많아요. 49초 뒤에 다시 시도해 주세요.',
          ),
          (
            'a refusal for coming too often that names no wait says to try later',
            (_) async =>
                refusal(429, 'over_request_rate_limit', 'Too many requests'),
            true,
            isA<AccountRateLimited>().having(
              (f) => f.retryAfter,
              'retryAfter',
              isNull,
            ),
            '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.',
          ),
          (
            'a refusal with no code but the status 429 is a rate limit too',
            (_) async => http.Response('{"msg": "slow down"}', 429),
            true,
            isA<AccountRateLimited>(),
            null,
          ),
          (
            'an address Auth will not send to is refused',
            (_) async => refusal(
              400,
              'email_address_invalid',
              'Email address is invalid',
            ),
            true,
            isA<AccountAddressRefused>(),
            '이 주소로는 코드를 보낼 수 없어요. 이메일 주소를 확인해 주세요.',
          ),
          (
            'a malformed address is refused as an address',
            (_) async => refusal(
              422,
              'validation_failed',
              'Unable to validate email address',
            ),
            true,
            isA<AccountAddressRefused>(),
            null,
          ),
          (
            'signups switched off is a configuration problem',
            (_) async => refusal(422, 'signup_disabled', 'Signups not allowed'),
            true,
            isA<AccountMisconfigured>(),
            null,
          ),
          (
            'a wrong or an expired code is refused alike',
            (_) async =>
                refusal(403, 'otp_expired', 'Token has expired or is invalid'),
            false,
            isA<AccountCodeRefused>(),
            '코드가 맞지 않거나 만료됐어요. 다시 확인하거나 새 코드를 받아 주세요.',
          ),
          (
            'a banned account is suspended',
            (_) async => refusal(403, 'user_banned', 'User is banned'),
            false,
            isA<AccountSuspended>(),
            null,
          ),
          (
            'any other refusal is a rejection',
            (_) async => refusal(400, 'some_other_error', 'Something else'),
            false,
            isA<AccountRejected>(),
            '로그인이 거부됐어요. 다시 시도해 주세요.',
          ),
        ];
    for (final (name, respond, onSend, matcher, korean) in failures) {
      test(name, () async {
        final service = await serviceAnswering(respond);
        final failure = await failureOf(
          () => onSend
              ? service.sendEmailCode('ada@example.com')
              : service.verifyEmailCode('ada@example.com', '123456'),
        );

        expect(failure, matcher);
        expect(service.state, isA<SignedOut>());
        if (korean != null) {
          final l10n = await AppLocalizations.delegate.load(const Locale('ko'));
          expect(describeAccountFailure(l10n, failure!), korean);
        }
      });
    }
  });

  test('a build without configuration is unavailable, not a crash', () async {
    final (:service, :client) = await connectAccount(const {});

    expect(client, isNull);
    expect(
      service.state,
      isA<AccountUnavailable>().having(
        (s) => s.failure.cause.toString(),
        'cause',
        contains('SUPABASE_URL is missing'),
      ),
    );
    expect(
      await failureOf(service.signInWithGoogle),
      isA<AccountMisconfigured>(),
    );
    expect(
      await failureOf(service.signInWithApple),
      isA<AccountMisconfigured>(),
    );
    expect(await failureOf(service.deleteAccount), isA<AccountMisconfigured>());
    expect(
      await failureOf(() => service.sendEmailCode('ada@example.com')),
      isA<AccountMisconfigured>(),
    );
    expect(
      await failureOf(() => service.verifyEmailCode('ada@example.com', '1')),
      isA<AccountMisconfigured>(),
    );
  });
}
