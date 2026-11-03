import 'dart:math' show pi;

import 'package:flutter/material.dart' hide Card;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'current_card.dart';
import 'previous_card.dart';
import 'study_style.dart';

/// How long the card takes to turn over (#454).
const previewFlipDuration = Duration(milliseconds: 220);

/// The card as study draws it, from the card editor's "미리보기" (ADR 0117,
/// ADR 0168): one card, [cells], drawn by study's own faces at the size study
/// gives its cards under a top bar of study's height, centred. It shows the
/// current card's face and, after a tap, the face study shows once the card
/// is answered, front over back or the 칸 revealed, on the theme's edge in
/// place of a grade. Each tap turns the card over in 3D, or switches it at
/// once when the system asks to reduce motion. A line under the card says
/// what a tap does.
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
  /// 0 with the current card's face up, 1 with the answered face up.
  late final _turn = AnimationController(
    vsync: this,
    duration: previewFlipDuration,
  );

  /// Whether the card shows, or is turning to, its answered face.
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
    final (:front, :back) = sidesOf(cells);
    final hint = switch ((_turned, isDrawnWhole(cells))) {
      (false, _) => l10n.previewTapToReveal,
      (true, false) => l10n.previewTapToFront,
      (true, true) => l10n.previewTapToHide,
    };
    return Scaffold(
      appBar: AppBar(
        // Study's top bar's height, so the body below is study's.
        toolbarHeight: StudyStyle.topBarHeight,
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
            padding: const EdgeInsets.symmetric(
              horizontal: StudyStyle.cardMargin,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                SizedBox(
                  height: StudyStyle.cardHeight(constraints.maxHeight),
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
                          final answered = _turn.value >= 0.5;
                          return Transform(
                            alignment: Alignment.center,
                            // Perspective, then the turn; the far side is
                            // turned once more so it does not read mirrored.
                            transform: Matrix4.identity()
                              ..setEntry(3, 2, 0.001)
                              ..rotateY(answered ? angle - pi : angle),
                            child: answered
                                ? GradedCard(
                                    cells: cells,
                                    front: front,
                                    back: back,
                                    answer: null,
                                  )
                                : CardFace(cells: cells, front: front),
                          );
                        },
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: StudyStyle.guideGap),
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
