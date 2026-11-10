import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_list_row.dart';
import '../../design/app_section_label.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'plan_controller.dart';
import 'plus_sheet.dart';

/// The `mcp` Edge Function on the project's custom domain, which Claude and
/// ChatGPT connect to.
const mcpServerUrl = 'https://api.knowno.app/functions/v1/mcp';

/// 설정's "AI 연결": the MCP server's address and how to add it in Claude and
/// in ChatGPT, and what a connection may do. It needs no server, so it is
/// drawn whatever the account's state. On the free plan it is locked, each row
/// opens the purchase sheet and the address is not shown; a paid plan, an
/// admin and a 무제한 holder see it whole, and so does an account whose plan
/// is not known.
class AiConnectionGroup extends ConsumerWidget {
  const AiConnectionGroup({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final plan = ref.watch(planProvider);
    final locked = plan is PlanKnown && plan.standing.canBuy;
    final lock = Icon(LucideIcons.lock, color: colors.muted);
    VoidCallback? unlock() => locked ? () => showPlusSheet(context) : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        AppSectionLabel(l10n.aiSection),
        AppGroup(
          children: [
            AppListRow(
              title: l10n.aiServerAddress,
              subtitle: locked ? l10n.aiLocked : mcpServerUrl,
              trailing: locked ? lock : null,
              onTap: locked ? unlock() : () => _copy(context, l10n),
            ),
            AppListRow(
              title: 'Claude',
              subtitle: l10n.aiClaudeHow,
              trailing: locked ? lock : null,
              onTap: unlock(),
            ),
            AppListRow(
              title: 'ChatGPT',
              subtitle: l10n.aiChatGptHow,
              trailing: locked ? lock : null,
              onTap: unlock(),
            ),
          ],
        ),
        const SizedBox(height: AppSpace.s8),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s4),
          child: Text(
            keepWords(l10n.aiNote),
            semanticsLabel: l10n.aiNote,
            style: AppType.caption.copyWith(color: colors.muted),
          ),
        ),
        const SizedBox(height: AppSpace.sectionGap),
      ],
    );
  }

  Future<void> _copy(BuildContext context, AppLocalizations l10n) async {
    final messenger = ScaffoldMessenger.of(context);
    await Clipboard.setData(ClipboardData(text: mcpServerUrl));
    messenger.showSnackBar(SnackBar(content: Text(l10n.aiServerCopied)));
  }
}
