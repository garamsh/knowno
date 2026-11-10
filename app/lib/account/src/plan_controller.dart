import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'account_state.dart';
import 'plan.dart';
import 'plus_sheet.dart';
import 'providers.dart';
import 'purchase_store.dart';

/// The server that answers the account's plan. The composition site
/// overrides it; unoverridden, the plan is unknown and nothing is offered.
final planServerProvider = Provider<PlanServer>(
  (ref) => const UnavailablePlanServer(),
);

/// The store the app buys through. The composition site overrides it;
/// unoverridden, purchases are not ready.
final purchaseStoreProvider = Provider<PurchaseStore>(
  (ref) => const UnavailablePurchaseStore(),
);

/// What the app knows of the account's plan.
sealed class PlanView {
  const PlanView();
}

/// The server has not answered yet.
final class PlanLoading extends PlanView {
  const PlanLoading();
}

/// The server's answer.
final class PlanKnown extends PlanView {
  const PlanKnown(this.standing);

  final PlanStanding standing;
}

/// The server could not answer. Nothing is offered or locked on a plan that
/// is not known.
final class PlanUnknown extends PlanView {
  const PlanUnknown();
}

/// The account's plan, kept as the server answers it: read when an account
/// signs in and again after a purchase or a restore. It names the store's
/// customer as the signed-in user and forgets it at sign-out.
final planProvider = NotifierProvider<PlanController, PlanView>(
  PlanController.new,
);

class PlanController extends Notifier<PlanView> {
  UserId? _user;
  var _epoch = 0;

  @override
  PlanView build() {
    ref.onDispose(() => _epoch++);
    ref.listen(accountStateProvider, (_, next) => _follow(next));
    // The first state is followed after build returns, which cannot set the
    // state it returns itself.
    final first = ref.read(accountStateProvider);
    Future.microtask(() => _follow(first));
    return const PlanLoading();
  }

  Future<void> _follow(AccountState account) async {
    final store = ref.read(purchaseStoreProvider);
    switch (account) {
      case SignedIn(:final userId):
        if (userId == _user) return;
        _user = userId;
        final epoch = ++_epoch;
        state = const PlanLoading();
        await store.signIn(userId);
        if (epoch == _epoch) await _read(userId, epoch);
      case SignedOut() || AccountUnavailable():
        if (_user == null) return;
        _user = null;
        _epoch++;
        state = const PlanLoading();
        await store.signOut();
    }
  }

  Future<void> _read(UserId user, int epoch) async {
    PlanView next;
    try {
      next = PlanKnown(await ref.read(planServerProvider).read(user));
    } on PlanUnavailable {
      next = const PlanUnknown();
    }
    if (epoch == _epoch) state = next;
  }

  /// Asks the server for the plan again, from the answer it gives now.
  Future<void> refresh() async {
    final user = _user;
    if (user == null) return;
    await _read(user, _epoch);
  }

  /// Buys [package], then refreshes the plan after a purchase.
  Future<PurchaseOutcome> buy(PlusPackage package) async {
    final outcome = await ref.read(purchaseStoreProvider).buy(package);
    if (outcome is Purchased) await _syncThenRefresh();
    return outcome;
  }

  /// Restores the store account's purchases, then refreshes the plan.
  Future<RestoreOutcome> restore() async {
    final outcome = await ref.read(purchaseStoreProvider).restore();
    if (outcome == RestoreOutcome.restored) await _syncThenRefresh();
    return outcome;
  }

  /// Has the server read the store now, then reads the plan: whatever the
  /// sync answered, the plan is read after it.
  Future<void> _syncThenRefresh() async {
    await ref.read(planServerProvider).sync();
    await refresh();
  }
}

/// Opens the purchase sheet for the photo import's limit, or null while the
/// plan is not the free one: an admin, a 무제한 holder, a paid plan and an
/// unknown plan are never offered a purchase.
final purchaseOfferProvider = Provider<Future<void> Function(BuildContext)?>((
  ref,
) {
  final plan = ref.watch(planProvider);
  return plan is PlanKnown && plan.standing.canBuy ? showPlusSheet : null;
});
