import 'account_state.dart';

/// The one package the purchase sheet sells, with the price the store shows.
final class PlusPackage {
  const PlusPackage({required this.id, required this.price});

  /// The package's identifier in the default offering.
  final String id;

  /// The store's own price text, in the user's currency.
  final String price;
}

/// How a purchase ended.
sealed class PurchaseOutcome {
  const PurchaseOutcome();
}

/// The store took the payment.
final class Purchased extends PurchaseOutcome {
  const Purchased();
}

/// The user closed the store's sheet.
final class PurchaseCancelled extends PurchaseOutcome {
  const PurchaseCancelled();
}

/// The store holds the payment for approval, as a family's or a bank's.
final class PurchasePending extends PurchaseOutcome {
  const PurchasePending();
}

/// The purchase failed.
final class PurchaseFailed extends PurchaseOutcome {
  const PurchaseFailed();
}

/// How a restore ended.
enum RestoreOutcome { restored, failed }

/// The store the app buys through, behind the app's own interface so no test
/// meets the real SDK.
abstract interface class PurchaseStore {
  /// Whether this build can sell anything: the SDK has its key.
  bool get ready;

  /// Names the store's customer as [user], configuring the SDK on the first
  /// call. Never throws.
  Future<void> signIn(UserId user);

  /// Forgets the customer. Never throws.
  Future<void> signOut();

  /// The default offering's package, or null when the store has none to sell
  /// or cannot be reached.
  Future<PlusPackage?> offer();

  /// Buys [package].
  Future<PurchaseOutcome> buy(PlusPackage package);

  /// Asks the store for the purchases this store account made.
  Future<RestoreOutcome> restore();

  /// Where the store manages the subscription, or null when it names none.
  Future<Uri?> managementUrl();
}

/// The store of a build without a RevenueCat key: it sells nothing, and the
/// purchase entry points say so.
final class UnavailablePurchaseStore implements PurchaseStore {
  const UnavailablePurchaseStore();

  @override
  bool get ready => false;

  @override
  Future<void> signIn(UserId user) async {}

  @override
  Future<void> signOut() async {}

  @override
  Future<PlusPackage?> offer() async => null;

  @override
  Future<PurchaseOutcome> buy(PlusPackage package) async =>
      const PurchaseFailed();

  @override
  Future<RestoreOutcome> restore() async => RestoreOutcome.failed;

  @override
  Future<Uri?> managementUrl() async => null;
}
