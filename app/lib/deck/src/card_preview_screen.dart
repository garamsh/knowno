import 'dart:math' show max, pi;

import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_section_label.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'card_frame.dart';
import 'card_text.dart';
import 'content.dart';
import 'content_view.dart';
import 'whole_card_view.dart';

/// How long the card takes to turn over (#454).
const previewFlipDuration = Duration(milliseconds: 220);

/// What study's screen keeps of its body's height besides its two cards,
/// each of which takes half the rest: the gaps above, between and under them
/// and the guide's row (`StudyStyle`, which `deck` cannot import). The
/// preview's card takes that half too, so it is study's card's size.
const _studyGaps =
    AppSpace.s20 +
    AppSpace.s16 +
    AppSpace.s20 +
    kMinInteractiveDimension +
    AppSpace.s16;

/// The card as study draws it, from the card editor's "미리보기" (ADR 0117):
/// one card of study's current card's size, centred on the screen, its front alone and,
/// after a tap, its back, or, for a card drawn whole, its 칸 in place with
/// each blank empty and, after a tap, revealed. Each tap turns the card
/// over in 3D, or switches it at once when the system asks to reduce
/// motion. "앞면" or "뒷면" names the side over a card of two sides, and a
/// line under the card says what a tap does.
class CardPreviewScreen extends StatefulWidget {
  const CardPreviewScreen({super.key, required this.cells});

  /// The card's 칸, read as a saved card's are, so each part shows where
  /// study shows it.
  final List<Cell> cells;

  @override
  State<CardPreviewScreen> createState() => _CardPreviewScreenState();
}

class _CardPreviewScreenState extends State<CardPreviewScreen>
    with SingleTickerProviderStateMixin {
  /// 0 with the front or the empty blanks up, 1 with the back or the filled
  /// blanks up.
  late final _turn = AnimationController(
    vsync: this,
    duration: previewFlipDuration,
  );

  /// Whether the card shows, or is turning to, its back or its answers.
  bool _turned = false;

  @override
  void dispose() {
    _turn.dispose();
    super.dispose();
  }

  void _flip() {
    setState(() => _turned = !_turned);
    if (MediaQuery.disableAnimationsOf(context)) {
      _turn.value = _turned ? 1 : 0;
    } else if (_turned) {
      _turn.forward();
    } else {
      _turn.reverse();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final cells = widget.cells;
    final whole = isDrawnWhole(cells);
    final sides = sidesOf(cells);
    final hint = switch ((whole, _turned)) {
      (false, false) => l10n.previewTapToBack,
      (false, true) => l10n.previewTapToFront,
      (true, false) => l10n.previewTapToReveal,
      (true, true) => l10n.previewTapToHide,
    };
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: l10n.close,
          icon: const Icon(LucideIcons.x),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text(l10n.previewCard),
      ),
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) => Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!whole)
                  AppSectionLabel(_turned ? l10n.cardBack : l10n.cardFront),
                // Study's card height, kept below what the screen leaves it.
                Flexible(
                  child: SizedBox(
                    height: max(0, (constraints.maxHeight - _studyGaps) / 2),
                    child: Semantics(
                      button: true,
                      onTapHint: hint,
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onTap: _flip,
                        child: AnimatedBuilder(
                          animation: _turn,
                          builder: (context, _) {
                            final angle = _turn.value * pi;
                            final back = _turn.value >= 0.5;
                            return Transform(
                              alignment: Alignment.center,
                              // Perspective, then the turn; the far side is
                              // turned once more so it does not read mirrored.
                              transform: Matrix4.identity()
                                ..setEntry(3, 2, 0.001)
                                ..rotateY(back ? angle - pi : angle),
                              child: _Face(
                                cells: whole ? cells : null,
                                front: sides.front,
                                back: sides.back,
                                turned: back,
                              ),
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: AppSpace.s16),
                ExcludeSemantics(
                  child: Text(
                    keepWords(hint),
                    textAlign: TextAlign.center,
                    style: AppType.caption.copyWith(color: colors.muted),
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

/// One side of the card as study's current card draws it: on the surface
/// with the study card's radius and shadow, its blocks centred, in the
/// largest of the card's three sizes at which they fit, from the front's
/// type or a back's, scrolling inside where they are taller than the card at
/// the last (ADR 0123).
class _Face extends StatelessWidget {
  const _Face({
    required this.cells,
    required this.front,
    required this.back,
    required this.turned,
  });

  /// The 칸 of a card drawn whole, or null for one of two sides.
  final List<Cell>? cells;
  final List<Content> front;
  final List<Content> back;
  final bool turned;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final cells = this.cells;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(AppRadius.card),
        boxShadow: AppShadow.card(colors),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppRadius.card),
        child: SizedBox.expand(
          child: CardScroll(
            padding: AppSpace.s16,
            builder: (context, width, height) => switch ((cells, turned)) {
              (final cells?, _) => SteppedWholeCardView(
                cells,
                revealed: turned,
                style: AppType.front,
                width: width,
                height: height,
              ),
              (null, false) => ContentView(
                front,
                style: AppType.front,
                fit: StepFit(width: width, height: height),
              ),
              (null, true) => ContentView(
                back,
                style: AppType.back.copyWith(color: colors.ink),
                fit: StepFit(width: width, height: height),
              ),
            },
          ),
        ),
      ),
    );
  }
}
