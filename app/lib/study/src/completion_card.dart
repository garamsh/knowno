import 'package:flutter/material.dart';

import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/streak_flame.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'session.dart';
import 'study_style.dart';

/// The completion card in the current card's place once no card is left
/// today: the happy mascot, the heading, today's answers, time and streak, then
/// the choice to go on with the new cards past today's, through [onStudyOn],
/// or to stop. With none left, a line says so and stopping is the card's one
/// primary action.
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
    final line = AppType.secondary.copyWith(color: colors.ink2);
    TextSpan count(String value, Color color) => TextSpan(
      text: value,
      style: TextStyle(color: color, fontWeight: FontWeight.w700),
    );
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
        boxShadow: AppShadow.card(colors),
      ),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minHeight: StudyStyle.completionMinHeight,
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s20,
            AppSpace.s28,
            AppSpace.s20,
            AppSpace.s20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            spacing: AppSpace.s12,
            children: [
              const Center(
                child: Mascot(
                  expression: MascotExpression.happy,
                  size: AppSize.mascotMedium,
                ),
              ),
              Semantics(
                header: true,
                child: Text(
                  l10n.studyComplete,
                  textAlign: TextAlign.center,
                  style: AppType.title,
                ),
              ),
              Semantics(
                label: l10n.completionSemantics(
                  completion.knowCount,
                  completion.dontKnowCount,
                  minutes,
                  completion.streak,
                ),
                child: ExcludeSemantics(
                  child: Wrap(
                    alignment: WrapAlignment.center,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: AppSpace.s16,
                    runSpacing: AppSpace.s4,
                    children: [
                      Text.rich(
                        TextSpan(
                          children: [
                            count('${completion.knowCount}', colors.know),
                            TextSpan(text: ' ${l10n.know}'),
                          ],
                        ),
                        style: line,
                      ),
                      Text.rich(
                        TextSpan(
                          children: [
                            count(
                              '${completion.dontKnowCount}',
                              colors.dontKnowText,
                            ),
                            TextSpan(text: ' ${l10n.dontKnow}'),
                          ],
                        ),
                        style: line,
                      ),
                      Text.rich(
                        count(l10n.completionMinutes(minutes), colors.ink),
                        style: line,
                      ),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        spacing: AppSpace.s4,
                        children: [
                          StreakFlame(
                            days: completion.streak,
                            size: AppSize.smallIcon,
                          ),
                          Text.rich(
                            count(
                              l10n.completionStreak(completion.streak),
                              colors.ink,
                            ),
                            style: line,
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              if (onStudyOn case final onStudyOn?)
                AppButton(
                  label: l10n.studyOn,
                  size: AppButtonSize.cta,
                  onPressed: onStudyOn,
                )
              else
                Text(
                  l10n.noCardsLeft,
                  textAlign: TextAlign.center,
                  style: AppType.body.copyWith(color: colors.ink2),
                ),
              AppButton(
                label: l10n.stopStudying,
                // The one thing left to do once no card is.
                variant: onStudyOn == null
                    ? AppButtonVariant.primary
                    : AppButtonVariant.text,
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
