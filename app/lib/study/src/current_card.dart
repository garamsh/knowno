import 'package:flutter/gestures.dart' show DragStartBehavior;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import 'study_coach.dart';
import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'rust/api/engine.dart';
import 'stop_sound.dart';
import 'study_style.dart';

/// The card under study, filling the height it is given less the guide's
/// row under it: what shows before the reveal alone, centred; the rest shows
/// once answered, on the previous card. Swiped right it answers "Know", left "Don't know"; a
/// screen reader has both as actions. "안내 다시 보기", alone in the row,
/// calls [onGuide].
///
/// A front holding a sound draws its play control, and a screen reader has
/// "소리 듣기" among the card's actions; with [autoplay], the front's first
/// sound plays once as the card appears (ADR 0112).
///
/// While the coach demonstrates an answer, [demo], the card moves toward it
/// over the answer's tint under a touch, [demoProgress] through one
/// [coachCycle], and [coach] takes the guide's row's place.
class CurrentCard extends StatefulWidget {
  const CurrentCard({
    super.key,
    required this.card,
    required this.onAnswer,
    required this.onGuide,
    this.autoplay = false,
    this.onDragStart,
    this.demo,
    this.demoProgress = 0,
    this.coach,
  });

  final Card card;
  final void Function(Answer answer) onAnswer;
  final VoidCallback onGuide;

  /// Whether the front's first sound plays as the card appears.
  final bool autoplay;

  /// Called as a drag on the card begins.
  final VoidCallback? onDragStart;

  final Answer? demo;
  final double demoProgress;
  final Widget? coach;

  @override
  State<CurrentCard> createState() => _CurrentCardState();
}

class _CurrentCardState extends State<CurrentCard>
    with SingleTickerProviderStateMixin {
  /// The card's horizontal offset from its place.
  late final _drag = AnimationController.unbounded(vsync: this);
  var _committed = false;

  /// The front's first sound, which the screen reader's action and
  /// [CurrentCard.autoplay] play; null when it holds none.
  AudioContent? get _sound => audioOf(widget.card.front).firstOrNull;

  @override
  void initState() {
    super.initState();
    // Once per card shown: each card gets a state of its own.
    if (widget.autoplay && _sound != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        if (_sound case final sound?) playAudio(context, sound);
      });
    }
  }

  /// The providers, kept to stop the sound when the card goes; null for a
  /// card with no sound, which needs none.
  ProviderContainer? _providers;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_sound != null) {
      _providers = ProviderScope.containerOf(context, listen: false);
    }
  }

  @override
  void dispose() {
    // The sound goes with the card that showed it.
    if (_providers case final providers?) stopSound(providers);
    _drag.dispose();
    super.dispose();
  }

  void _onDragUpdate(DragUpdateDetails details) {
    if (_committed) return;
    _drag.value += details.delta.dx;
  }

  void _onDragEnd(DragEndDetails details) {
    if (_committed) return;
    final velocity = details.velocity.pixelsPerSecond.dx;
    final distance = _drag.value;
    final direction = velocity.abs() >= StudyStyle.commitVelocity
        ? velocity
        : distance.abs() >= StudyStyle.commitDistance
        ? distance
        : 0.0;
    if (direction == 0) {
      _springBack();
    } else {
      _commit(direction > 0 ? Answer.know : Answer.dontKnow);
    }
  }

  void _springBack() {
    if (_committed) return;
    _drag.animateTo(
      0,
      duration: StudyStyle.springBackDuration,
      curve: Curves.easeOutBack,
    );
  }

  Future<void> _commit(Answer answer) async {
    if (_committed) return;
    _committed = true;
    HapticFeedback.lightImpact();
    if (!MediaQuery.disableAnimationsOf(context)) {
      final width = MediaQuery.sizeOf(context).width;
      await _drag.animateTo(
        switch (answer) {
          Answer.know => width,
          Answer.dontKnow => -width,
        },
        duration: StudyStyle.flyDuration,
        curve: Curves.easeIn,
      );
    }
    if (mounted) widget.onAnswer(answer);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: Semantics(
            container: true,
            label: l10n.currentCardSemantics(
              spokenCells(l10n, drawnCellsOf(widget.card), revealed: false),
            ),
            customSemanticsActions: {
              CustomSemanticsAction(label: l10n.know): () =>
                  _commit(Answer.know),
              CustomSemanticsAction(label: l10n.dontKnow): () =>
                  _commit(Answer.dontKnow),
              if (_sound case final sound?)
                CustomSemanticsAction(label: l10n.playAudio): () =>
                    playAudio(context, sound),
            },
            excludeSemantics: true,
            child: GestureDetector(
              // The card follows the finger from where it touched down.
              dragStartBehavior: DragStartBehavior.down,
              onHorizontalDragStart: (_) => widget.onDragStart?.call(),
              onHorizontalDragUpdate: _onDragUpdate,
              onHorizontalDragEnd: _onDragEnd,
              onHorizontalDragCancel: _springBack,
              child: AnimatedBuilder(
                animation: _drag,
                builder: (context, child) => Transform.translate(
                  offset: Offset(_drag.value, 0),
                  child: Transform.rotate(
                    angle: _drag.value * StudyStyle.tiltPerPixel,
                    child: _DragFeedback(offset: _drag.value, child: child!),
                  ),
                ),
                child: switch (widget.demo) {
                  final answer? => _Demo(
                    answer: answer,
                    progress: widget.demoProgress,
                    child: CardFace.of(widget.card),
                  ),
                  null => CardFace.of(widget.card),
                },
              ),
            ),
          ),
        ),
        const SizedBox(height: StudyStyle.guideGap),
        widget.coach ?? _GuideButton(onGuide: widget.onGuide),
      ],
    );
  }
}

/// The coach's demonstration of [answer] on [child], the card's face:
/// [progress] through one [coachCycle], it moves toward the answer and back
/// over the answer's tint and name, under a touch that moves with it.
class _Demo extends StatelessWidget {
  const _Demo({
    required this.answer,
    required this.progress,
    required this.child,
  });

  final Answer answer;
  final double progress;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final (sign, fill, text, icon, label, alignment) = switch (answer) {
      Answer.know => (
        1.0,
        colors.tintGreen,
        colors.onKnowTint,
        LucideIcons.check,
        l10n.know,
        Alignment.centerLeft,
      ),
      Answer.dontKnow => (
        -1.0,
        colors.tintRed,
        colors.onDontKnowTint,
        LucideIcons.x,
        l10n.dontKnow,
        Alignment.centerRight,
      ),
    };
    final offset = sign * StudyStyle.coachCurrentPeek * coachPeek(progress);
    return Stack(
      clipBehavior: Clip.none,
      children: [
        if (offset != 0)
          Positioned.fill(
            child: ExcludeSemantics(
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: fill,
                  borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
                ),
                child: Align(
                  alignment: alignment,
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpace.s20,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      spacing: AppSpace.s8,
                      children: [
                        Icon(icon, size: AppSize.smallIcon, color: text),
                        Text(
                          label,
                          style: AppType.secondary.copyWith(
                            color: text,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        Positioned.fill(
          child: Transform.translate(
            offset: Offset(offset, 0),
            child: Transform.rotate(
              angle: offset * StudyStyle.tiltPerPixel,
              child: child,
            ),
          ),
        ),
        Positioned.fill(
          child: Transform.translate(
            offset: Offset(offset, StudyStyle.coachTouchDrop),
            child: Center(
              child: StudyCoachTouch(
                shown: coachTouchShown(progress),
                travel: offset,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// "안내 다시 보기", alone and centred under the card: the coach again.
class _GuideButton extends StatelessWidget {
  const _GuideButton({required this.onGuide});

  final VoidCallback onGuide;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: AppButton(
        label: l10n.studyCoachReplay,
        variant: AppButtonVariant.faint,
        onPressed: onGuide,
      ),
    );
  }
}

/// The answer chip and tint a drag past [StudyStyle.dragFeedbackDistance]
/// shows over [child].
class _DragFeedback extends StatelessWidget {
  const _DragFeedback({required this.offset, required this.child});

  final double offset;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (offset.abs() < StudyStyle.dragFeedbackDistance) return child;
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final (label, tint, tone, alignment) = offset > 0
        ? (l10n.know, colors.know, AppChipTone.know, Alignment.topLeft)
        : (
            l10n.dontKnow,
            colors.dontKnow,
            AppChipTone.dontKnow,
            Alignment.topRight,
          );
    final strength =
        ((offset.abs() - StudyStyle.dragFeedbackDistance) /
                (StudyStyle.commitDistance - StudyStyle.dragFeedbackDistance))
            .clamp(0.0, 1.0);
    return Stack(
      children: [
        child,
        Positioned.fill(
          child: IgnorePointer(
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: tint.withValues(
                  alpha: StudyStyle.tintOpacity * strength,
                ),
                borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
              ),
            ),
          ),
        ),
        Positioned.fill(
          child: Align(
            alignment: alignment,
            child: Padding(
              padding: const EdgeInsets.all(StudyStyle.cardPadding),
              child: AppChip(label: label, tone: tone),
            ),
          ),
        ),
      ],
    );
  }
}

/// The card itself: its front alone, centred, in the largest of the card's
/// sizes at which it fits, from the one its length starts at
/// ([StudyStyle.frontStart]), scrolling inside where it is taller than the
/// card at the last (ADR 0123, #635); a whole card's 칸, [cells], in place,
/// unrevealed, each blank a box on the hatch. The card editor's preview
/// draws it too (ADR 0168).
class CardFace extends StatelessWidget {
  const CardFace({super.key, required this.cells, required this.front});

  /// The face of [card] as study draws it.
  CardFace.of(Card card, {Key? key})
    : this(key: key, cells: drawnCellsOf(card), front: card.front);

  final List<Cell> cells;
  final List<Content> front;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final start = StudyStyle.frontStart(faceLength(cells));
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
        boxShadow: StudyStyle.currentShadow(colors),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
        child: SizedBox.expand(
          child: CardScroll(
            padding: StudyStyle.cardPadding,
            builder: (context, width, height) => isDrawnWhole(cells)
                ? SteppedWholeCardView(
                    cells,
                    revealed: false,
                    style: start,
                    width: width,
                    height: height,
                  )
                : ContentView(
                    front,
                    style: start,
                    fit: StepFit(width: width, height: height),
                  ),
          ),
        ),
      ),
    );
  }
}
