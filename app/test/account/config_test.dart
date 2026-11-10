import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/foundation.dart';
import 'package:knowno/account/src/config.dart';
import 'package:knowno/account/src/purchase_store.dart';
import 'package:knowno/account/src/revenuecat_store.dart';

void main() {
  const valid = {
    AccountConfigKey.supabaseUrl: 'https://example.test',
    AccountConfigKey.supabasePublishableKey: 'sb_publishable_abc',
    AccountConfigKey.googleWebClientId: '1-web.apps.googleusercontent.com',
    AccountConfigKey.googleIosClientId: '1-ios.apps.googleusercontent.com',
  };

  List<String> problemsOf(Map<String, String> values) {
    try {
      AccountConfig.parse(values);
    } on InvalidAccountConfig catch (error) {
      return error.problems;
    }
    return const [];
  }

  test('a complete configuration parses into its typed values', () {
    final config = AccountConfig.parse(valid);

    expect(config.supabaseUrl, Uri.parse('https://example.test'));
    expect(config.publishableKey, 'sb_publishable_abc');
    expect(config.googleWebClientId.value, '1-web.apps.googleusercontent.com');
    expect(config.googleIosClientId.value, '1-ios.apps.googleusercontent.com');
  });

  test('a build given no configuration is refused naming every key', () {
    expect(problemsOf(const {}), [
      'SUPABASE_URL is missing',
      'SUPABASE_PUBLISHABLE_KEY is missing',
      'GOOGLE_WEB_CLIENT_ID is missing',
      'GOOGLE_IOS_CLIENT_ID is missing',
    ]);
    expect(problemsOf({...valid, AccountConfigKey.supabaseUrl: ' '}), [
      'SUPABASE_URL is missing',
    ]);
  });

  test('a secret key in place of the publishable key is refused', () {
    expect(
      problemsOf({
        ...valid,
        AccountConfigKey.supabasePublishableKey: 'sb_secret_abc',
      }),
      ['SUPABASE_PUBLISHABLE_KEY is malformed'],
    );
    expect(problemsOf(valid), isEmpty);
  });

  test('a URL that is not https and a malformed client ID are refused', () {
    expect(
      problemsOf({
        ...valid,
        AccountConfigKey.supabaseUrl: 'http://example.test',
        AccountConfigKey.googleIosClientId: 'ios-client',
      }),
      ['SUPABASE_URL is malformed', 'GOOGLE_IOS_CLIENT_ID is malformed'],
    );
  });

  test('the committed dev configuration parses', () {
    final values =
        (jsonDecode(File('config/dev.json').readAsStringSync())
                as Map<String, Object?>)
            .map((key, value) => MapEntry(key, value is String ? value : ''));

    expect(problemsOf(values), isEmpty);
  });

  test('the committed dev configuration holds both RevenueCat keys, empty', () {
    final values = jsonDecode(
      File('config/dev.json').readAsStringSync(),
    ) as Map<String, Object?>;

    expect(values[AccountConfigKey.revenueCatAppleKey], '');
    expect(values[AccountConfigKey.revenueCatGoogleKey], '');
  });

  group('the store a build buys through', () {
    const keys = {
      AccountConfigKey.revenueCatAppleKey: 'appl_key',
      AccountConfigKey.revenueCatGoogleKey: 'goog_key',
    };

    test('is RevenueCat with the key of the platform when one is set', () {
      for (final platform in [TargetPlatform.iOS, TargetPlatform.android]) {
        final store = connectPurchases(keys, platform: platform);

        expect(store, isA<RevenueCatPurchaseStore>(), reason: '$platform');
        expect(store.ready, isTrue);
      }
    });

    test('sells nothing without the key of the platform', () {
      for (final (defines, platform) in [
        (const <String, String>{}, TargetPlatform.iOS),
        (const {AccountConfigKey.revenueCatAppleKey: ' '}, TargetPlatform.iOS),
        (const {AccountConfigKey.revenueCatAppleKey: ''}, TargetPlatform.iOS),
        (
          const {AccountConfigKey.revenueCatAppleKey: 'appl_key'},
          TargetPlatform.android,
        ),
        (keys, TargetPlatform.linux),
      ]) {
        final store = connectPurchases(defines, platform: platform);

        expect(store, isA<UnavailablePurchaseStore>(), reason: '$platform');
        expect(store.ready, isFalse);
      }
    });
  });
}
