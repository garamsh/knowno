import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'session.dart';
import 'study_style.dart';

/// The completion panel in the current card's place once no card is left
/// today, on the hero surface: the happy mascot beside the heading and the
/// streak in large white text, three tiles of today's answers and time, then
/// the choice to go on with the new cards past today's, through [onStudyOn],
/// or to stop. With none left, a line says so and stopping is the panel's
/// one primary action (ADR 0151).
class CompletionCard extends StatelessWidget {
  const CompletionCard({
    super.key,
    required this.completion,
    required this.onStudyOn,
  });

  final Completion completion;

  /// Goes on with the new cards past today's; null when none is left.
  final VoidCallback? onStudyOn;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final minutes = (completion.timeSpent.inSeconds / 60).ceil();
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.hero,
        borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: StudyStyle.completionMinHeight,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpace.s20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s16,
            children: [
              Row(
                spacing: AppSpace.s12,
                children: [
                  const Mascot(
                    expression: MascotExpression.happy,
                    size: AppSize.mascotGuide,
                  ),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            l10n.studyComplete,
                            style: AppType.display.copyWith(
                              color: colors.onHero,
                            ),
                          ),
                        ),
                        ExcludeSemantics(
                          child: Text(
                            l10n.completionStreak(completion.streak),
                            style: AppType.label.copyWith(color: colors.onHero),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              Semantics(
                label: l10n.completionSemantics(
                  completion.knowCount,
                  completion.dontKnowCount,
                  minutes,
                  completion.streak,
                ),
                child: ExcludeSemantics(
                  child: IntrinsicHeight(
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      spacing: AppSpace.s8,
                      children: [
                        _Tile(
                          count: '${completion.knowCount}',
                          colour: colors.know,
                          name: l10n.know,
                        ),
                        _Tile(
                          count: '${completion.dontKnowCount}',
                          colour: colors.dontKnowText,
                          name: l10n.dontKnow,
                        ),
                        _Tile(
                          count: l10n.completionMinutes(minutes),
                          colour: colors.ink,
                          name: l10n.completionTimeLabel,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              if (onStudyOn case final onStudyOn?)
                AppButton(
                  label: l10n.studyOn,
                  variant: AppButtonVariant.onHero,
                  size: AppButtonSize.cta,
                  onPressed: onStudyOn,
                )
              else
                Text(
                  l10n.noCardsLeft,
                  textAlign: TextAlign.center,
                  style: AppType.body.copyWith(color: colors.onHero),
                ),
              AppButton(
                label: l10n.stopStudying,
                // The one thing left to do once no card is.
                variant: onStudyOn == null
                    ? AppButtonVariant.onHero
                    : AppButtonVariant.onHeroText,
                size: onStudyOn == null
                    ? AppButtonSize.cta
                    : AppButtonSize.regular,
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One of the panel's tiles: [count] in [colour] over its [name], on the
/// surface on its edge.
class _Tile extends StatelessWidget {
  const _Tile({required this.count, required this.colour, required this.name});

  final String count;
  final Color colour;
  final String name;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Expanded(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(AppRadius.row),
          boxShadow: AppShadow.card(colors),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpace.s8,
            vertical: AppSpace.s12,
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              // One line, shrunk to the tile where wider.
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(
                  count,
                  textAlign: TextAlign.center,
                  style: AppType.display.copyWith(color: colour),
                ),
              ),
              Text(
                name,
                textAlign: TextAlign.center,
                style: AppType.secondary.copyWith(
                  color: colors.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
