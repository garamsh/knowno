import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'session.dart';

/// Asks, once the day's cards are done, whether to go on: today's cards,
/// minutes and streak in one line, then, where [more] is true, its question
/// over "이어서 하기" and "그만하기", the one primary; with no new card left
/// past today's, a line saying so over "완료" alone. Pops true to go on and
/// false to stop.
class CompletionSheet extends StatelessWidget {
  const CompletionSheet({
    super.key,
    required this.completion,
    required this.more,
  });

  final Completion completion;

  /// Whether new cards are left past today's to go on with.
  final bool more;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final minutes = (completion.timeSpent.inSeconds / 60).ceil();
    final line = more ? l10n.studyOnQuestion : l10n.noCardsLeft;
    return AppSheet(
      title: l10n.studyComplete,
      body: l10n.completionSummary(
        completion.cards,
        minutes,
        completion.streak,
      ),
      content: Text(keepWords(line), semanticsLabel: line, style: AppType.body),
      actions: [
        if (more)
          AppButton(
            label: l10n.studyOn,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: () => Navigator.of(context).pop(true),
          ),
        AppButton(
          label: more ? l10n.stopStudying : l10n.studyDone,
          size: AppButtonSize.cta,
          onPressed: () => Navigator.of(context).pop(false),
        ),
      ],
    );
  }
}
