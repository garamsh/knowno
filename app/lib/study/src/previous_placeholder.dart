import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import 'dashed_outline.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'study_style.dart';

/// The previous card's place while it holds no card: a dashed outline with no
/// fill, so it never reads as a card, around an up arrow and a line saying
/// that answered cards stack here.
class PreviousPlaceholder extends StatelessWidget {
  const PreviousPlaceholder({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Semantics(
      container: true,
      label: l10n.previousPlaceholder,
      child: ExcludeSemantics(
        child: DashedOutline(
          color: colors.outline,
          borderRadius: BorderRadius.circular(StudyStyle.previousRadius),
          width: StudyStyle.placeholderOutline,
          dash: StudyStyle.placeholderDash,
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(AppSpace.s20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                spacing: AppSpace.s8,
                children: [
                  Icon(LucideIcons.arrowUp, color: colors.muted),
                  Text(
                    keepWords(l10n.previousPlaceholder),
                    textAlign: TextAlign.center,
                    style: AppType.secondary.copyWith(color: colors.muted),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
