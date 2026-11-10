import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_choice.dart';
import '../../design/app_list_row.dart';
import '../../design/app_section_label.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'account_state.dart';
import 'legal.dart';
import 'providers.dart';
import 'plan.dart';
import 'plan_controller.dart';
import 'plus_sheet.dart';
import 'purchase_store.dart';

/// The name a user reads for [plan].
String planName(AppLocalizations l10n, Plan plan) => switch (plan) {
  Plan.free => l10n.planFree,
  Plan.plus => l10n.planPlus,
  Plan.pro => l10n.planPro,
};

/// 설정's first group, "내 플랜", as the server answers it: on the free plan
/// the plan, the photos used and the limit, and 플러스 알아보기; on a store
/// subscription the plan, its next renewal, 구독 관리 and 구매 복원; for an
/// admin and a 무제한 holder the plan alone, with nothing to buy.
class PlanGroup extends ConsumerStatefulWidget {
  const PlanGroup({super.key});

  @override
  ConsumerState<PlanGroup> createState() => _PlanGroupState();
}

class _PlanGroupState extends ConsumerState<PlanGroup> {
  var _restoring = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    // The gate leaves the screen once no account is signed in; until it
    // has, no plan is shown for no account.
    if (ref.watch(accountStateProvider) is! SignedIn) {
      return const SizedBox.shrink();
    }
    final view = ref.watch(planProvider);
    final rows = switch (view) {
      PlanLoading() => [
        AppListRow(
          title: l10n.planTitle,
          trailing: SizedBox.square(
            dimension: AppSpace.s24,
            child: CircularProgressIndicator(semanticsLabel: l10n.planTitle),
          ),
        ),
      ],
      PlanUnknown() => [
        AppListRow(
          title: l10n.planLoadFailed,
          onTap: ref.read(planProvider.notifier).refresh,
        ),
      ],
      PlanKnown(:final standing) => [
        AppListRow(
          title: planName(l10n, standing.plan),
          subtitle: _photos(l10n, standing),
        ),
        if (_end(l10n, standing) case final end?) AppListRow(title: end),
        if (standing.canBuy)
          AppChoiceRow(
            title: l10n.planLearnPlus,
            value: null,
            onTap: () => showPlusSheet(context),
          ),
        if (standing.fromStore) ...[
          AppListRow(
            title: l10n.planManage,
            onTap: () => manageSubscription(context, ref),
          ),
          AppListRow(
            title: l10n.planRestore,
            trailing: _restoring
                ? SizedBox.square(
                    dimension: AppSpace.s24,
                    child: CircularProgressIndicator(
                      semanticsLabel: l10n.planRestoring,
                    ),
                  )
                : null,
            onTap: _restoring ? null : _restore,
          ),
        ],
      ],
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppSectionLabel(l10n.planTitle),
        AppGroup(children: rows),
        const SizedBox(height: AppSpace.sectionGap),
      ],
    );
  }

  /// A store subscription's next renewal, or its end once it does not renew.
  String? _end(AppLocalizations l10n, PlanStanding standing) {
    if (!standing.fromStore) return null;
    return switch ((standing.renewsOn, standing.endsOn)) {
      (final renewsOn?, _) => l10n.planRenews(renewsOn),
      (_, final endsOn?) => l10n.planEnds(endsOn),
      _ => null,
    };
  }

  String? _photos(AppLocalizations l10n, PlanStanding standing) {
    return switch ((standing.photosUsed, standing.photoLimit)) {
      (final used?, final limit?) => l10n.planPhotosUsed(used, limit),
      (_, null) => l10n.planNoLimit,
      _ => null,
    };
  }

  Future<void> _restore() async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    setState(() => _restoring = true);
    final outcome = await ref.read(planProvider.notifier).restore();
    if (mounted) setState(() => _restoring = false);
    messenger.showSnackBar(
      SnackBar(
        content: Text(
          outcome == RestoreOutcome.restored
              ? l10n.planRestored
              : l10n.planRestoreFailed,
        ),
      ),
    );
  }
}

/// Opens the store's page that manages the subscription, and says so when
/// none opens.
Future<void> manageSubscription(BuildContext context, WidgetRef ref) async {
  final messenger = ScaffoldMessenger.of(context);
  final l10n = AppLocalizations.of(context);
  final url = await ref.read(purchaseStoreProvider).managementUrl();
  if (!context.mounted) return;
  if (url == null || !await ref.read(linkOpenerProvider)(url)) {
    messenger.showSnackBar(SnackBar(content: Text(l10n.linkNotOpened)));
  }
}
