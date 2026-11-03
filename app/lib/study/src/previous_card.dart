import 'package:flutter/gestures.dart' show DragStartBehavior;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/semantics.dart';
import 'package:flutter/services.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import 'study_coach.dart';
import '../../design/app_section_label.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'rust/api/engine.dart';
import 'session.dart';
import 'study_style.dart';

/// The other answer.
Answer _other(Answer answer) => switch (answer) {
  Answer.know => Answer.dontKnow,
  Answer.dontKnow => Answer.know,
};

/// The card answered just before the current one: front and back, both
/// always shown, on its grade's fill and line. It fills the height it is
/// given, as the current card does.
///
/// Dragged left or right, it shows the answer the drag would give behind it,
/// and released past [StudyStyle.commitDistance], or flung, toward the other
/// answer it changes to that answer. A tap opens the whole card in a sheet. A
/// screen reader changes it by its action instead of a drag, and plays its
/// sound by "소리 듣기" when it holds one (ADR 0112).
///
/// A vertical drag scrolls a face taller than the card and changes nothing.
class PreviousCardView extends StatefulWidget {
  const PreviousCardView({
    super.key,
    required this.card,
    required this.onRedecide,
  });

  final PreviousCard card;
  final void Function(Answer answer) onRedecide;

  @override
  State<PreviousCardView> createState() => _PreviousCardViewState();
}

class _PreviousCardViewState extends State<PreviousCardView>
    with SingleTickerProviderStateMixin {
  /// The card's horizontal offset from its place.
  late final _drag = AnimationController.unbounded(vsync: this);

  /// How far the finger has moved since the drag began.
  var _finger = 0.0;

  @override
  void dispose() {
    _drag.dispose();
    super.dispose();
  }

  /// The answer a drag by [offset] points to.
  Answer _target(double offset) => offset > 0 ? Answer.know : Answer.dontKnow;

  void _onDragUpdate(DragUpdateDetails details) {
    _finger += details.delta.dx;
    // A drag toward the answer the card already has follows the finger only
    // a little, and shows nothing behind it.
    _drag.value = _target(_finger) == widget.card.answer
        ? _finger * StudyStyle.sameAnswerResistance
        : _finger;
  }

  void _onDragEnd(DragEndDetails details) {
    final offset = _drag.value;
    final velocity = details.velocity.pixelsPerSecond.dx;
    final target = _target(offset);
    final committed =
        target != widget.card.answer &&
        (offset.abs() >= StudyStyle.commitDistance ||
            (velocity.abs() >= StudyStyle.commitVelocity &&
                velocity.sign == offset.sign));
    if (committed) {
      HapticFeedback.lightImpact();
      widget.onRedecide(target);
    }
    _springBack();
  }

  void _springBack() {
    _finger = 0;
    if (MediaQuery.disableAnimationsOf(context)) {
      _drag.value = 0;
    } else {
      _drag.animateTo(
        0,
        duration: StudyStyle.springBackDuration,
        curve: Curves.easeOutCubic,
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final card = widget.card;
    final other = _other(card.answer);
    final (:front, :back) = _spokenSides(l10n, card.card);
    return Semantics(
      container: true,
      label: l10n.previousCardLabel(
        _answerName(l10n, card.answer),
        front,
        back,
        card.changed ? 'yes' : 'no',
      ),
      customSemanticsActions: {
        CustomSemanticsAction(label: _changeTo(l10n, other)): () =>
            widget.onRedecide(other),
        if (_soundOf(card.card) case final sound?)
          CustomSemanticsAction(label: l10n.playAudio): () =>
              playAudio(context, sound),
      },
      button: true,
      onTapHint: l10n.showWholeCard,
      onTap: () => _showWholeCard(context, card.card),
      excludeSemantics: true,
      child: GestureDetector(
        // The card follows the finger from where it touched down.
        dragStartBehavior: DragStartBehavior.down,
        onTap: () => _showWholeCard(context, card.card),
        onHorizontalDragUpdate: _onDragUpdate,
        onHorizontalDragEnd: _onDragEnd,
        onHorizontalDragCancel: _springBack,
        child: AnimatedBuilder(
          animation: _drag,
          builder: (context, child) {
            final offset = _drag.value;
            final target = _target(offset);
            return Stack(
              clipBehavior: Clip.none,
              children: [
                if (offset != 0 && target != card.answer)
                  Positioned.fill(child: _Reveal(answer: target)),
                Transform.translate(
                  offset: Offset(offset, 0),
                  child: Transform.rotate(
                    angle: offset * StudyStyle.tiltPerPixel,
                    child: child,
                  ),
                ),
              ],
            );
          },
          child: GradedCard(
            cells: drawnCellsOf(card.card),
            front: card.card.front,
            back: card.card.back,
            answer: card.answer,
          ),
        ),
      ),
    );
  }
}

/// [card] as a screen reader reads it where it is drawn as studied: a whole
/// card reads its 칸 with their blanks, then revealed; any other its front,
/// then its back.
({String front, String back}) _spokenSides(AppLocalizations l10n, Card card) {
  final cells = drawnCellsOf(card);
  return isDrawnWhole(cells)
      ? (
          front: spokenCells(l10n, cells, revealed: false),
          back: spokenCells(l10n, cells, revealed: true),
        )
      : (
          front: spokenContent(l10n, card.front, revealed: false),
          back: describeContent(l10n, card.back),
        );
}

/// The sound a screen reader plays from a card shown with its back: the
/// back's first, which the answer just showed, or else the front's.
AudioContent? _soundOf(Card card) =>
    audioOf(card.back).firstOrNull ?? audioOf(card.front).firstOrNull;

/// The day's last answer from an earlier session, in the previous card's
/// place: graded as a previous card is, with "지난번 마지막 카드", and opened
/// whole by a tap. Its answer is not changed from here.
class EarlierCardView extends StatelessWidget {
  const EarlierCardView({super.key, required this.earlier});

  final EarlierAnswer earlier;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final card = earlier.card;
    final (:front, :back) = _spokenSides(l10n, card);
    return Semantics(
      container: true,
      label: [
        l10n.earlierCard,
        l10n.previousCardSemantics(
          front,
          back,
          _answerName(l10n, earlier.answer),
          'no',
        ),
      ].join('. '),
      button: true,
      onTapHint: l10n.showWholeCard,
      onTap: () => _showWholeCard(context, card),
      excludeSemantics: true,
      child: GestureDetector(
        onTap: () => _showWholeCard(context, card),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Positioned.fill(
              child: GradedCard(
                cells: drawnCellsOf(card),
                front: card.front,
                back: card.back,
                answer: earlier.answer,
              ),
            ),
            // At the bottom, clear of the notice that may show over the top.
            Positioned(
              bottom: AppSpace.s12,
              left: StudyStyle.cardPadding,
              child: Text(
                l10n.earlierCard,
                style: AppType.micro.copyWith(color: colors.ink2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The coach's third step in the previous card's place: a sample card,
/// [front] and [back], answered "Know", dragged toward "Don't know" by a
/// touch and sprung back, [progress] through one [coachCycle], over what the
/// drag shows behind it. Hidden from screen readers, which read the coach's
/// caption.
class PreviousCardDemo extends StatelessWidget {
  const PreviousCardDemo({
    super.key,
    required this.front,
    required this.back,
    required this.progress,
  });

  final List<Content> front;
  final List<Content> back;
  final double progress;

  @override
  Widget build(BuildContext context) {
    final offset = -StudyStyle.coachPreviousPeek * coachPeek(progress);
    return ExcludeSemantics(
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          if (offset != 0)
            const Positioned.fill(child: _Reveal(answer: Answer.dontKnow)),
          Positioned.fill(
            child: Transform.translate(
              offset: Offset(offset, 0),
              child: Transform.rotate(
                angle: offset * StudyStyle.tiltPerPixel,
                child: GradedCard(
                  cells: cellsToDraw(front, back),
                  front: front,
                  back: back,
                  answer: Answer.know,
                ),
              ),
            ),
          ),
          Positioned(
            right: StudyStyle.coachTouchInset - offset,
            bottom: StudyStyle.coachTouchLift,
            child: StudyCoachTouch(
              shown: coachTouchShown(progress),
              travel: offset,
            ),
          ),
        ],
      ),
    );
  }
}

String _answerName(AppLocalizations l10n, Answer answer) => switch (answer) {
  Answer.know => l10n.know,
  Answer.dontKnow => l10n.dontKnow,
};

String _changeTo(AppLocalizations l10n, Answer answer) => switch (answer) {
  Answer.know => l10n.changeToKnow,
  Answer.dontKnow => l10n.changeToDontKnow,
};

/// What a drag toward [answer] shows behind the card: the answer's tint and
/// the change it would make.
class _Reveal extends StatelessWidget {
  const _Reveal({required this.answer});

  final Answer answer;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final (fill, text, icon, label, alignment) = switch (answer) {
      Answer.know => (
        colors.tintGreen,
        colors.onKnowTint,
        LucideIcons.check,
        l10n.changingToKnow,
        Alignment.centerLeft,
      ),
      Answer.dontKnow => (
        colors.tintRed,
        colors.onDontKnowTint,
        LucideIcons.x,
        l10n.changingToDontKnow,
        Alignment.centerRight,
      ),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(StudyStyle.cardRadius),
      ),
      child: Align(
        alignment: alignment,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.s20),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            spacing: AppSpace.s8,
            children: [
              Icon(icon, size: AppSize.smallIcon, color: text),
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: AppType.secondary.copyWith(
                    color: text,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A previous card's face: its front over its back, or a whole card's 칸 in
/// place, revealed, in one column centred both ways on the surface, scrolling
/// inside the card from its top where it is taller. The grade shows by the
/// line around it alone, in the grade's colour; the card's semantics label
/// names it (ADR 0151). With no [answer], as the card editor's preview draws
/// it, the line is the theme's edge (ADR 0168).
class GradedCard extends StatelessWidget {
  const GradedCard({
    super.key,
    required this.cells,
    required this.front,
    required this.back,
    required this.answer,
  });

  final List<Cell> cells;
  final List<Content> front;
  final List<Content> back;
  final Answer? answer;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final line = switch (answer) {
      Answer.know => colors.know,
      Answer.dontKnow => colors.dontKnowText,
      null => colors.edge,
    };
    final front = StudyStyle.previousFront.copyWith(color: colors.ink);
    return SizedBox.expand(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(StudyStyle.previousRadius),
          border: Border.all(color: line, width: StudyStyle.previousLine),
          boxShadow: StudyStyle.currentShadow(colors),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(
            StudyStyle.previousRadius - StudyStyle.previousLine,
          ),
          child: CardScroll(
            padding: StudyStyle.cardPadding,
            builder: (context, width, _) => isDrawnWhole(cells)
                ? WholeCardView.cells(
                    cells,
                    revealed: true,
                    style: front,
                    width: width,
                  )
                // Unbounded down, so a long side is never cut: the card
                // scrolls instead.
                : Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    spacing: AppSpace.s8,
                    children: [
                      ContentView(
                        this.front,
                        style: front,
                        fit: ShrinkFit(
                          minFontSize: AppType.frontFloor,
                          width: width,
                          height: double.infinity,
                        ),
                      ),
                      ContentView(
                        back,
                        style: StudyStyle.previousBack.copyWith(
                          color: colors.ink2,
                        ),
                        fit: ShrinkFit(
                          minFontSize: AppType.backFloor,
                          width: width,
                          height: double.infinity,
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

/// Opens [card] whole in a sheet titled as the card: its front and back,
/// each under a label of the same rank, or a whole card's 칸 in place,
/// revealed, naming no side.
void _showWholeCard(BuildContext context, Card card) {
  final l10n = AppLocalizations.of(context);
  final cells = drawnCellsOf(card);
  showAppSheet<void>(
    context,
    builder: (context) => AppSheet(
      title: l10n.wholeCard,
      content: isDrawnWhole(cells)
          ? WholeCardView.cells(cells, revealed: true, style: AppType.body)
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                AppSectionLabel(l10n.cardFront),
                ContentView(card.front, style: AppType.body),
                const Divider(height: AppSpace.s32),
                AppSectionLabel(l10n.cardBack),
                ContentView(card.back, style: AppType.body),
              ],
            ),
    ),
  );
}
