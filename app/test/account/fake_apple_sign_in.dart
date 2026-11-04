import 'package:plugin_platform_interface/plugin_platform_interface.dart';
import 'package:sign_in_with_apple_platform_interface/sign_in_with_apple_platform_interface.dart';

/// Stands in for the system's Apple ID sheet: [getAppleIDCredential] answers
/// with [credential], or throws [error] when one is set. [nonces] holds the
/// nonce of each request, and [scopes] the scopes of the last.
class FakeAppleSignIn extends SignInWithApplePlatform
    with MockPlatformInterfaceMixin {
  AuthorizationCredentialAppleID credential = signedIn();
  SignInWithAppleException? error;
  final nonces = <String?>[];
  List<AppleIDAuthorizationScopes> scopes = const [];

  /// A credential as Apple returns it, with the name it shares on an
  /// account's first sign-in alone.
  static AuthorizationCredentialAppleID signedIn({
    String? identityToken = 'apple-id-token',
    String? givenName,
    String? familyName,
  }) => AuthorizationCredentialAppleID(
    userIdentifier: '000001.apple',
    givenName: givenName,
    familyName: familyName,
    email: 'ada@example.com',
    authorizationCode: 'apple-authorization-code',
    identityToken: identityToken,
    state: null,
  );

  @override
  Future<bool> isAvailable() async => true;

  @override
  Future<AuthorizationCredentialAppleID> getAppleIDCredential({
    required List<AppleIDAuthorizationScopes> scopes,
    WebAuthenticationOptions? webAuthenticationOptions,
    String? nonce,
    String? state,
  }) async {
    nonces.add(nonce);
    this.scopes = scopes;
    if (error case final error?) throw error;
    return credential;
  }
}
