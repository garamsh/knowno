import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/src/config.dart';
import 'package:knowno/account/src/revenuecat_store.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

Package _package(String identifier, {String product = 'plus:monthly'}) =>
    Package(
      identifier,
      PackageType.custom,
      StoreProduct(product, '', '', 4900, '₩4,900', 'KRW'),
      const PresentedOfferingContext('default', null, null),
    );

Offering _offering(List<Package> packages) =>
    Offering('default', '', const {}, packages);

void main() {
  group('the package the sheet sells', () {
    test(
      r'is $rc_monthly of the offering, whichever store product backs it',
      () {
        for (final product in ['app.knowno.plus.monthly', 'plus:monthly']) {
          final sold = _package(r'$rc_monthly', product: product);
          final offering = _offering([_package(r'$rc_annual'), sold]);

          expect(plusPackageOf(offering), same(sold), reason: product);
        }
      },
    );

    test(r'is none when the offering holds no $rc_monthly or is missing', () {
      expect(plusPackageOf(_offering([_package(r'$rc_annual')])), isNull);
      expect(plusPackageOf(_offering([])), isNull);
      expect(plusPackageOf(null), isNull);
    });
  });

  group('구독 관리', () {
    test("opens RevenueCat's page when it gives one", () {
      final fallback = playSubscriptionsUrl;

      expect(
        managementPage('https://apps.apple.com/account/subscriptions', null),
        Uri.parse('https://apps.apple.com/account/subscriptions'),
      );
      expect(
        managementPage(
          'https://play.google.com/store/account/subscriptions',
          fallback,
        ),
        Uri.parse('https://play.google.com/store/account/subscriptions'),
      );
    });

    test("falls back to the store's own page when RevenueCat gives none", () {
      expect(managementPage(null, playSubscriptionsUrl), playSubscriptionsUrl);
      expect(managementPage(null, null), isNull);
    });

    test("names Google Play's subscription page for app.knowno", () {
      expect(
        playSubscriptionsUrl.toString(),
        'https://play.google.com/store/account/subscriptions?package=app.knowno',
      );
    });

    test(
      'is the Play page on Android and none on iOS before RevenueCat answers',
      () async {
        const defines = {
          AccountConfigKey.revenueCatAppleKey: 'appl_key',
          AccountConfigKey.revenueCatGoogleKey: 'goog_key',
        };

        expect(
          await connectPurchases(
            defines,
            platform: TargetPlatform.android,
          ).managementUrl(),
          playSubscriptionsUrl,
        );
        expect(
          await connectPurchases(
            defines,
            platform: TargetPlatform.iOS,
          ).managementUrl(),
          isNull,
        );
      },
    );
  });
}
