/// The keys the account configuration is read from, as `app/config/*.json`
/// names them for `--dart-define-from-file`.
abstract final class AccountConfigKey {
  static const supabaseUrl = 'SUPABASE_URL';
  static const supabasePublishableKey = 'SUPABASE_PUBLISHABLE_KEY';
  static const googleWebClientId = 'GOOGLE_WEB_CLIENT_ID';
  static const googleIosClientId = 'GOOGLE_IOS_CLIENT_ID';

  /// RevenueCat's public SDK keys, one per store. Either may be empty: the app
  /// then builds and runs, and says purchases are not ready yet.
  static const revenueCatAppleKey = 'REVENUECAT_APPLE_API_KEY';
  static const revenueCatGoogleKey = 'REVENUECAT_GOOGLE_API_KEY';
}

/// The values the build received through `--dart-define-from-file`; a key
/// the build was not given reads as empty.
Map<String, String> accountDefines() => const {
  AccountConfigKey.supabaseUrl: String.fromEnvironment(
    AccountConfigKey.supabaseUrl,
  ),
  AccountConfigKey.supabasePublishableKey: String.fromEnvironment(
    AccountConfigKey.supabasePublishableKey,
  ),
  AccountConfigKey.googleWebClientId: String.fromEnvironment(
    AccountConfigKey.googleWebClientId,
  ),
  AccountConfigKey.googleIosClientId: String.fromEnvironment(
    AccountConfigKey.googleIosClientId,
  ),
  AccountConfigKey.revenueCatAppleKey: String.fromEnvironment(
    AccountConfigKey.revenueCatAppleKey,
  ),
  AccountConfigKey.revenueCatGoogleKey: String.fromEnvironment(
    AccountConfigKey.revenueCatGoogleKey,
  ),
};

/// A Google OAuth client ID.
extension type const GoogleClientId(String value) {}

/// What the account domain needs to reach Supabase and Google.
final class AccountConfig {
  const AccountConfig({
    required this.supabaseUrl,
    required this.publishableKey,
    required this.googleWebClientId,
    required this.googleIosClientId,
  });

  /// Parses [values], keyed by [AccountConfigKey]. Throws
  /// [InvalidAccountConfig] naming every key that is missing or malformed.
  factory AccountConfig.parse(Map<String, String> values) {
    final problems = <String>[];
    String? read(String key, bool Function(String) valid) {
      final value = values[key]?.trim() ?? '';
      if (value.isEmpty) {
        problems.add('$key is missing');
        return null;
      }
      if (!valid(value)) {
        problems.add('$key is malformed');
        return null;
      }
      return value;
    }

    bool isHttpsUrl(String value) {
      final uri = Uri.tryParse(value);
      return uri != null && uri.scheme == 'https' && uri.host.isNotEmpty;
    }

    bool isClientId(String value) =>
        RegExp(r'^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$')
            .hasMatch(value);

    final url = read(AccountConfigKey.supabaseUrl, isHttpsUrl);
    final key = read(
      AccountConfigKey.supabasePublishableKey,
      (value) => value.startsWith('sb_publishable_'),
    );
    final web = read(AccountConfigKey.googleWebClientId, isClientId);
    final ios = read(AccountConfigKey.googleIosClientId, isClientId);
    if (url == null || key == null || web == null || ios == null) {
      throw InvalidAccountConfig(problems);
    }
    return AccountConfig(
      supabaseUrl: Uri.parse(url),
      publishableKey: key,
      googleWebClientId: GoogleClientId(web),
      googleIosClientId: GoogleClientId(ios),
    );
  }

  final Uri supabaseUrl;

  /// The Supabase publishable key, which is public by design.
  final String publishableKey;

  /// The web client, which Google names as the ID token's audience and
  /// Supabase checks it against.
  final GoogleClientId googleWebClientId;
  final GoogleClientId googleIosClientId;
}

/// The account configuration the build received is missing or malformed.
final class InvalidAccountConfig implements Exception {
  const InvalidAccountConfig(this.problems);

  final List<String> problems;

  @override
  String toString() => 'InvalidAccountConfig: ${problems.join('; ')}';
}
