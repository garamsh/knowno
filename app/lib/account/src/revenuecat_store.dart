import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:purchases_flutter/purchases_flutter.dart';

import 'account_state.dart';
import 'config.dart';
import 'purchase_store.dart';

/// [PurchaseStore] over RevenueCat's `purchases_flutter`, keyed by the public
/// SDK key of the platform. The app user id is the Supabase user id.
final class RevenueCatPurchaseStore implements PurchaseStore {
  RevenueCatPurchaseStore(this._apiKey);

  final String _apiKey;
  var _configured = false;
  final _packages = <String, Package>{};

  @override
  bool get ready => true;

  @override
  Future<void> signIn(UserId user) async {
    try {
      if (!_configured) {
        await Purchases.configure(
          PurchasesConfiguration(_apiKey)..appUserID = user.value,
        );
        _configured = true;
      } else {
        await Purchases.logIn(user.value);
      }
    } on PlatformException {
      // The sheet finds the store unready and says so.
    }
  }

  @override
  Future<void> signOut() async {
    if (!_configured) return;
    try {
      if (!await Purchases.isAnonymous) await Purchases.logOut();
    } on PlatformException {
      // A later sign-in names its own user.
    }
  }

  @override
  Future<PlusPackage?> offer() async {
    if (!_configured) return null;
    try {
      final offering = (await Purchases.getOfferings()).current;
      final package = offering?.availablePackages.firstOrNull;
      if (package == null) return null;
      _packages[package.identifier] = package;
      return PlusPackage(
        id: package.identifier,
        price: package.storeProduct.priceString,
        period: switch (package.storeProduct.subscriptionPeriod) {
          'P1W' || 'P7D' => PlusPeriod.week,
          'P1M' => PlusPeriod.month,
          'P1Y' => PlusPeriod.year,
          _ => null,
        },
      );
    } on PlatformException {
      return null;
    }
  }

  @override
  Future<PurchaseOutcome> buy(PlusPackage package) async {
    final bought = _packages[package.id];
    if (bought == null) return const PurchaseFailed();
    try {
      await Purchases.purchase(PurchaseParams.package(bought));
      return const Purchased();
    } on PlatformException catch (error) {
      return switch (PurchasesErrorHelper.getErrorCode(error)) {
        PurchasesErrorCode.purchaseCancelledError => const PurchaseCancelled(),
        PurchasesErrorCode.paymentPendingError => const PurchasePending(),
        _ => const PurchaseFailed(),
      };
    }
  }

  @override
  Future<RestoreOutcome> restore() async {
    if (!_configured) return RestoreOutcome.failed;
    try {
      await Purchases.restorePurchases();
      return RestoreOutcome.restored;
    } on PlatformException {
      return RestoreOutcome.failed;
    }
  }

  @override
  Future<Uri?> managementUrl() async {
    if (!_configured) return null;
    try {
      final url = (await Purchases.getCustomerInfo()).managementURL;
      return url == null ? null : Uri.tryParse(url);
    } on PlatformException {
      return null;
    }
  }
}

/// The store this build buys through: RevenueCat with the public key of the
/// platform in [defines], or one that sells nothing where the key is empty or
/// the platform has no store.
PurchaseStore connectPurchases(
  Map<String, String> defines, {
  TargetPlatform? platform,
}) {
  final key = switch (platform ?? defaultTargetPlatform) {
    TargetPlatform.iOS => defines[AccountConfigKey.revenueCatAppleKey],
    TargetPlatform.android => defines[AccountConfigKey.revenueCatGoogleKey],
    _ => null,
  }?.trim();
  return key == null || key.isEmpty
      ? const UnavailablePurchaseStore()
      : RevenueCatPurchaseStore(key);
}
