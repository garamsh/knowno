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
          trailing: Text(l10n.retry),
          onTap: ref.read(planProvider.notifier).refresh,
        ),
      ],
      PlanKnown(:final standing) => [
        AppListRow(
          title: planName(l10n, standing.plan),
          subtitle: _detail(l10n, standing),
        ),
        if (standing.canBuy)
          AppChoiceRow(
            title: l10n.planLearnPlus,
            value: null,
            onTap: () => showPlusSheet(context),
          ),
        if (standing.fromStore) ...[
          AppListRow(title: l10n.planManage, onTap: _manage),
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

  String? _detail(AppLocalizations l10n, PlanStanding standing) {
    if (standing.fromStore && standing.renewsOn != null) {
      return l10n.planRenews(standing.renewsOn!);
    }
    return switch ((standing.photosUsed, standing.photoLimit)) {
      (final used?, final limit?) => l10n.planPhotosUsed(used, limit),
      (_, null) => l10n.planNoLimit,
      _ => null,
    };
  }

  /// Opens the store's page that manages the subscription.
  Future<void> _manage() async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context);
    final url = await ref.read(purchaseStoreProvider).managementUrl();
    if (!mounted) return;
    if (url == null || !await ref.read(linkOpenerProvider)(url)) {
      messenger.showSnackBar(SnackBar(content: Text(l10n.linkNotOpened)));
    }
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
