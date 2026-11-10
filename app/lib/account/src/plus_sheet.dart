import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'legal.dart';
import 'plan_controller.dart';
import 'purchase_store.dart';

/// Opens the purchase sheet for 플러스 over [context]. Resolves when it
/// closes.
Future<void> showPlusSheet(BuildContext context) =>
    showAppSheet<void>(context, builder: (_) => const PlusSheet());

/// The purchase sheet: the default offering's package with the store's price,
/// and the button that buys it. Cancelling says nothing; a payment on hold and
/// a failure say so and keep the sheet.
class PlusSheet extends ConsumerStatefulWidget {
  const PlusSheet({super.key});

  @override
  ConsumerState<PlusSheet> createState() => _PlusSheetState();
}

enum _Notice { pending, failed }

class _PlusSheetState extends ConsumerState<PlusSheet> {
  late final Future<PlusPackage?> _offer;
  var _buying = false;
  var _restoring = false;
  _Notice? _notice;

  @override
  void initState() {
    super.initState();
    final store = ref.read(purchaseStoreProvider);
    _offer = store.ready ? store.offer() : Future.value();
  }

  Future<void> _buy(PlusPackage package) async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final l10n = AppLocalizations.of(context);
    final controller = ref.read(planProvider.notifier);
    setState(() {
      _buying = true;
      _notice = null;
    });
    final outcome = await controller.buy(package);
    if (!mounted) return;
    switch (outcome) {
      case Purchased():
        final plan = ref.read(planProvider);
        final shown = plan is PlanKnown && !plan.standing.canBuy;
        navigator.pop();
        messenger.showSnackBar(
          SnackBar(
            content: Text(shown ? l10n.plusStarted : l10n.plusStartedSlow),
          ),
        );
        return;
      case PurchaseCancelled():
        setState(() => _buying = false);
      case PurchasePending():
        setState(() {
          _buying = false;
          _notice = _Notice.pending;
        });
      case PurchaseFailed():
        setState(() {
          _buying = false;
          _notice = _Notice.failed;
        });
    }
  }

  Future<void> _restore() async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() {
      _restoring = true;
      _notice = null;
    });
    final outcome = await ref.read(planProvider.notifier).restore();
    if (!mounted) return;
    setState(() => _restoring = false);
    final plan = ref.read(planProvider);
    if (outcome == RestoreOutcome.restored &&
        plan is PlanKnown &&
        !plan.standing.canBuy) {
      navigator.pop();
    }
    final message = outcome == RestoreOutcome.restored
        ? restoreMessage(l10n, plan)
        : l10n.planRestoreFailed;
    if (message != null) {
      messenger.showSnackBar(SnackBar(content: Text(message)));
    }
  }

  String _price(AppLocalizations l10n, PlusPackage package) =>
      switch (package.period) {
        PlusPeriod.week => l10n.plusPricePerWeek(package.price),
        PlusPeriod.month => l10n.plusPricePerMonth(package.price),
        PlusPeriod.year => l10n.plusPricePerYear(package.price),
        null => package.price,
      };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final ready = ref.read(purchaseStoreProvider).ready;
    return FutureBuilder<PlusPackage?>(
      future: _offer,
      builder: (context, snapshot) {
        final package = snapshot.data;
        final waiting =
            ready && snapshot.connectionState != ConnectionState.done;
        final notice = switch (_notice) {
          _ when !ready => l10n.plusNotReady,
          _ when !waiting && package == null => l10n.plusUnavailable,
          _Notice.pending => l10n.plusPending,
          _Notice.failed => l10n.plusFailed,
          null => null,
        };
        return AppSheet(
          title: l10n.plusSheetTitle,
          body: l10n.plusSheetBody,
          content: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s8,
            children: [
              if (waiting)
                const Center(child: CircularProgressIndicator())
              else if (package != null)
                Text(_price(l10n, package), style: AppType.title),
              if (package != null)
                Text(
                  l10n.plusAutoRenew,
                  style: AppType.secondary.copyWith(color: colors.muted),
                ),
              if (package != null)
                Text(
                  l10n.plusWithdrawal,
                  style: AppType.secondary.copyWith(color: colors.muted),
                ),
              if (notice != null)
                Semantics(
                  liveRegion: true,
                  child: Text(
                    notice,
                    style: AppType.secondary.copyWith(color: colors.muted),
                  ),
                ),
            ],
          ),
          actions: [
            if (package != null)
              AppButton(
                label: l10n.plusSheetStart,
                size: AppButtonSize.cta,
                loading: _buying,
                onPressed: _buying || _restoring ? null : () => _buy(package),
              ),
            if (ready)
              AppButton(
                label: l10n.planRestore,
                variant: AppButtonVariant.link,
                loading: _restoring,
                onPressed: _buying || _restoring ? null : _restore,
              ),
            Wrap(
              alignment: WrapAlignment.center,
              children: [
                AppButton(
                  label: l10n.termsOfService,
                  variant: AppButtonVariant.link,
                  onPressed: () =>
                      openLegalLink(context, ref, termsOfServiceUrl),
                ),
                AppButton(
                  label: l10n.privacyPolicy,
                  variant: AppButtonVariant.link,
                  onPressed: () =>
                      openLegalLink(context, ref, privacyPolicyUrl),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}
