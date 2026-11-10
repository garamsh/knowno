import 'dart:async';

import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/plan.dart';
import 'package:knowno/account/src/purchase_store.dart';

/// Stands in for the server's plan answer: [read] resolves to [standing], or
/// throws [PlanUnavailable] while [standing] is null; [reads] lists the users
/// it was asked for.
class FakePlanServer implements PlanServer {
  FakePlanServer([
    this.standing = const PlanStanding(
      plan: Plan.free,
      source: PlanSource.none,
      photosUsed: 2,
      photoLimit: 5,
    ),
  ]);

  PlanStanding? standing;
  final reads = <UserId>[];

  /// The events in order, `sync` and `read`, so a test can see which came
  /// first.
  final calls = <String>[];
  var syncs = 0;

  @override
  Future<void> sync() async {
    syncs++;
    calls.add('sync');
  }

  @override
  Future<PlanStanding> read(UserId user) async {
    reads.add(user);
    calls.add('read');
    return standing ?? (throw const PlanUnavailable());
  }
}

/// Stands in for the store behind [PurchaseStore], counting its calls.
/// [package] is what the offering holds, or nothing; [purchase] is how [buy]
/// ends, and [onBought] runs as the store takes the payment, before [buy]
/// returns, so a test can move the server's answer with it.
class FakePurchaseStore implements PurchaseStore {
  FakePurchaseStore({this.ready = true});

  @override
  bool ready;

  PlusPackage? package = const PlusPackage(
    id: r'$rc_monthly',
    price: '₩4,900',
    period: PlusPeriod.month,
  );
  PurchaseOutcome purchase = const Purchased();
  RestoreOutcome restoreOutcome = RestoreOutcome.restored;
  Uri? management = Uri.parse('https://apps.apple.com/account/subscriptions');
  void Function()? onBought;
  void Function()? onRestored;

  /// The users signed in, in order, and the sign-outs.
  final signedInAs = <UserId>[];
  var signOuts = 0;
  var offers = 0;
  final bought = <PlusPackage>[];
  var restores = 0;

  @override
  Future<void> signIn(UserId user) async => signedInAs.add(user);

  @override
  Future<void> signOut() async => signOuts++;

  @override
  Future<PlusPackage?> offer() async {
    offers++;
    return package;
  }

  @override
  Future<PurchaseOutcome> buy(PlusPackage package) async {
    bought.add(package);
    if (purchase is Purchased) onBought?.call();
    return purchase;
  }

  @override
  Future<RestoreOutcome> restore() async {
    restores++;
    if (restoreOutcome == RestoreOutcome.restored) onRestored?.call();
    return restoreOutcome;
  }

  @override
  Future<Uri?> managementUrl() async => management;
}
