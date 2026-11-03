import 'dart:math';

import 'package:flutter/material.dart';

import '../../l10n/app_localizations.dart';
import '../../design/app_button.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import 'coach_hand_drawing.dart';
import 'study_style.dart';

/// One cycle of a coach's demonstration: the card moves out, holds, and
/// springs back.
const coachCycle = Duration(milliseconds: 2800);

/// How far, from 0 to 1, a coach's demonstrated card is out at [t], the
/// progress through one [coachCycle]: out with an ease from a fifth of the
/// way, held, and back with a spring from three fifths.
double coachPeek(double t) {
  final out = Curves.easeOutCubic.transform(((t - 0.2) / 0.26).clamp(0, 1));
  final back = Curves.easeOutBack.transform(((t - 0.62) / 0.18).clamp(0, 1));
  return out - back;
}

/// Whether a coach's touch shows at [t], the progress through one
/// [coachCycle]: from just before the card moves until just after it is
/// back.
bool coachTouchShown(double t) => t > 0.08 && t < 0.68;

/// The coach's touch over the card it demonstrates on: the brand's pointing
/// hand, tilted, its fingertip on a ring in the accent around a solid dot,
/// over a soft fill, on a hard edge below it, and a dashed trail [travel] long
/// back to where the touch began, which moves with the card. Hidden from
/// screen readers, which read the coach's caption instead.
class StudyCoachTouch extends StatelessWidget {
  const StudyCoachTouch({super.key, required this.shown, this.travel = 0});

  final bool shown;

  /// How far, signed, the touch has moved from where it began.
  final double travel;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    const size = StudyStyle.coachTouch;
    return IgnorePointer(
      child: ExcludeSemantics(
        child: Opacity(
          opacity: shown ? 1 : 0,
          child: SizedBox.square(
            dimension: size,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned(
                  left: size / 2 - (travel > 0 ? travel : 0),
                  top: (size - StudyStyle.coachTrail) / 2,
                  width: travel.abs(),
                  height: StudyStyle.coachTrail,
                  child: CustomPaint(
                    painter: _Trail(colors.accent.withValues(alpha: 0.55)),
                  ),
                ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: colors.accent.withValues(alpha: 0.18),
                    border: Border.all(
                      color: colors.accent,
                      width: StudyStyle.coachTouchLine,
                    ),
                    boxShadow: AppShadow.edge(
                      colors.primaryEdge.withValues(alpha: 0.35),
                      StudyStyle.coachTouchEdge,
                    ),
                  ),
                  child: Center(
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: colors.accent,
                      ),
                      child: const SizedBox.square(
                        dimension: StudyStyle.coachTouchDot,
                      ),
                    ),
                  ),
                ),
                // Its fingertip on the ring's centre.
                Positioned(
                  left: size / 2 - CoachHandDrawing.tip.dx * _handScale,
                  top: size / 2 - CoachHandDrawing.tip.dy * _handScale,
                  child: CustomPaint(
                    size: const Size.square(StudyStyle.coachHand),
                    painter: _Hand(colors),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// How much the hand's drawing is scaled to [StudyStyle.coachHand].
const _handScale = StudyStyle.coachHand / CoachHandDrawing.box;

/// The coach's pointing hand, [CoachHandDrawing], in the theme's colours:
/// filled in the surface on a hard edge, its lines in ink, with no blur.
class _Hand extends CustomPainter {
  const _Hand(this.colors);

  final AppColors colors;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(_handScale);
    final outline = CoachHandDrawing.outline();
    final lines = Paint()
      ..color = colors.ink
      ..style = PaintingStyle.stroke
      ..strokeWidth = CoachHandDrawing.line
      ..strokeJoin = StrokeJoin.round
      ..strokeCap = StrokeCap.round;
    canvas
      ..drawPath(
        outline.shift(CoachHandDrawing.edge),
        Paint()..color = colors.edge,
      )
      ..drawPath(outline, Paint()..color = colors.surface)
      ..drawPath(outline, lines)
      ..drawPath(CoachHandDrawing.creases(), lines);
  }

  @override
  bool shouldRepaint(_Hand old) => old.colors != colors;
}

/// A dashed line across its box, its dashes rounded.
class _Trail extends CustomPainter {
  const _Trail(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final radius = Radius.circular(size.height / 2);
    for (
      var x = 0.0;
      x < size.width;
      x += StudyStyle.coachTrailDash + StudyStyle.coachTrailGap
    ) {
      final end = min(x + StudyStyle.coachTrailDash, size.width);
      canvas.drawRRect(RRect.fromLTRBR(x, 0, end, size.height, radius), paint);
    }
  }

  @override
  bool shouldRepaint(_Trail old) => old.color != color;
}

/// A first-use coach, presented by the mascot, in its own face: its caption a speech
/// bubble beside it, on the surface on its edge with a tail toward it, in the
/// place of the screen's main action. The bubble holds the step's [line],
/// then "이전", disabled on the first step, a dot for each of [steps] with
/// [step] (from 0) drawn long, and "다음", the last step's "시작하기". A
/// screen reader hears the step of how many as it changes. The mascot and the
/// bubble rise in as the coach starts, or show at once under reduce motion.
class StudyCoach extends StatelessWidget {
  const StudyCoach({
    super.key,
    required this.line,
    required this.step,
    required this.steps,
    required this.onPrevious,
    required this.onNext,
  });

  final String line;
  final int step;
  final int steps;
  final VoidCallback onPrevious;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    final bubble = DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.row),
        boxShadow: AppShadow.edge(colors.edge, AppSize.edgeRow),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.s12,
          AppSpace.s12,
          AppSpace.s12,
          AppSpace.s8,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(line, style: AppType.bodyStrong.copyWith(color: colors.ink)),
            const SizedBox(height: AppSpace.s8),
            // In one row where they fit; stacked where a large text size
            // leaves them no room, so nothing is cut.
            OverflowBar(
              alignment: MainAxisAlignment.spaceBetween,
              overflowAlignment: OverflowBarAlignment.center,
              children: [
                TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: colors.ink2,
                    disabledForegroundColor: colors.ink2.withValues(
                      alpha: StudyStyle.coachPreviousDisabled,
                    ),
                    minimumSize: const Size(
                      AppSize.tapTarget,
                      AppSize.tapTarget,
                    ),
                    textStyle: AppType.label,
                  ),
                  onPressed: step == 0 ? null : onPrevious,
                  child: Text(l10n.coachPrevious),
                ),
                SizedBox(
                  height: AppSize.tapTarget,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    spacing: AppSpace.s4,
                    children: [
                      for (var dot = 0; dot < steps; dot++)
                        Container(
                          width: dot == step
                              ? AppSize.coachDotCurrent
                              : AppSize.coachDot,
                          height: AppSize.coachDot,
                          decoration: BoxDecoration(
                            color: dot == step ? colors.accent : colors.edge,
                            borderRadius: BorderRadius.circular(
                              AppSize.coachDot / 2,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                AppButton(
                  label: step == steps - 1 ? l10n.coachStart : l10n.coachNext,
                  onPressed: onNext,
                ),
              ],
            ),
          ],
        ),
      ),
    );
    final presented = Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      spacing: StudyStyle.coachTail,
      children: [
        const Mascot(
          expression: MascotExpression.thinking,
          size: StudyStyle.coachMascot,
        ),
        Expanded(
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // The tail toward the mascot, a square turned on its corner.
              Positioned(
                left: -StudyStyle.coachTail,
                bottom: AppSpace.s16,
                child: Transform.rotate(
                  angle: pi / 4,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: colors.surface,
                      borderRadius: BorderRadius.circular(AppSpace.s4 - 1),
                    ),
                    child: const SizedBox.square(
                      dimension: StudyStyle.coachTail * 2,
                    ),
                  ),
                ),
              ),
              bubble,
            ],
          ),
        ),
      ],
    );
    return Semantics(
      container: true,
      liveRegion: true,
      label: l10n.coachStep(step + 1, steps),
      child: TweenAnimationBuilder<double>(
        // Once, as the coach starts: a later step keeps the bubble in place.
        tween: Tween(begin: 0, end: 1),
        duration: reduceMotion ? Duration.zero : StudyStyle.settleDuration,
        curve: Curves.easeOutCubic,
        builder: (context, shown, child) => Opacity(
          opacity: shown,
          child: Transform.translate(
            offset: Offset(0, StudyStyle.coachRise * (1 - shown)),
            child: child,
          ),
        ),
        child: presented,
      ),
    );
  }
}
