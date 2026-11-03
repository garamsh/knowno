import 'package:flutter/material.dart' hide Card;

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'audio_block.dart';
import 'card_frame.dart';
import 'card_list.dart';
import 'card_text.dart';
import 'content.dart';
import 'content_view.dart';
import 'image_block.dart';
import 'model.dart';

/// Whether a card of [cells] is drawn whole, each 칸 in place, rather than
/// split: whether it holds a self-revealing 칸 (ADR 0137).
bool isDrawnWhole(List<Cell> cells) => cells.any((cell) => cell is BlankCell);

/// The 칸 a card of [front] and [back] is drawn from: its blocks converted,
/// and each block this build cannot show kept after them.
List<Cell> cellsToDraw(List<Content> front, List<Content> back) {
  List<Content> known(List<Content> side) =>
      side.where((block) => block is! UnsupportedContent).toList();
  return [
    ...?cellsFromSides(known(front), known(back)),
    for (final block in [...front, ...back])
      if (block case final UnsupportedContent kept) UnknownCell(kept),
  ];
}

/// The 칸 [card] is drawn from.
List<Cell> drawnCellsOf(Card card) =>
    card.cells ?? cellsToDraw(card.front, card.back);

/// The rows of a table a card list's row shows.
const _listedRows = 3;

/// One block of a card drawn whole, [added] when the reveal added it.
typedef CardPart = ({Content block, bool added});

/// What [cells] show in order: each 칸's part before the reveal, followed
/// when [revealed] by the part the reveal adds.
List<CardPart> partsOf(List<Cell> cells, {required bool revealed}) => [
  for (final cell in cells) ...[
    for (final block in sidesOf([cell]).front) (block: block, added: false),
    if (revealed)
      for (final block in sidesOf([cell]).back) (block: block, added: true),
  ],
];

/// A whole card's blocks in order: a text block as its title, a
/// cloze as its sentence, a table as its table, an image as its photo and a
/// sound as its play control (ADR 0112),
/// with each blank empty, or each box hidden, or filled or revealed in place
/// when [revealed] (ADR 0068, ADR 0109), a table's span inside its cell's
/// text (ADR 0110). An empty blank keeps its answer's width, so filling it
/// moves nothing.
///
/// A cloze is in [style], centred, scaled down as far as [minFontSize] until
/// its widest word fits [width]. A table is in the body size, [width] wide.
/// Given [height] too, the whole front is scaled down to fit it. Its text
/// blocks are aligned by [textAlign]. It reads as [spokenContent] says, each
/// empty blank as "빈칸".
///
/// [WholeCardView.cells] draws a card's 칸 so: each 칸's part before the
/// reveal and, when [revealed], the part the reveal adds under it at the
/// back's size in `ink2` (ADR 0137).
///
/// [WholeCardView.listed] draws them as a note's card list does: every 칸
/// revealed, and what study hides until the reveal on [AppHatch], each blank
/// and each photo's box, each added part in a hatched box, a shown part cut
/// at two lines and an added one at three, and a table at its first three
/// rows (#629).
class WholeCardView extends StatelessWidget {
  const WholeCardView(
    this.blocks, {
    super.key,
    required this.revealed,
    required this.style,
    this.minFontSize,
    this.width,
    this.height,
    this.textAlign = TextAlign.center,
  }) : cells = null,
       listed = false;

  const WholeCardView.cells(
    List<Cell> this.cells, {
    super.key,
    required this.revealed,
    required this.style,
    this.minFontSize,
    this.width,
    this.height,
    this.textAlign = TextAlign.center,
  }) : blocks = const [],
       listed = false;

  const WholeCardView.listed(
    List<Cell> this.cells, {
    super.key,
    required this.style,
  }) : blocks = const [],
       revealed = true,
       listed = true,
       minFontSize = null,
       width = null,
       height = null,
       textAlign = TextAlign.start;

  final List<Content> blocks;
  final List<Cell>? cells;
  final bool revealed;
  final TextStyle style;
  final double? minFontSize;
  final double? width;
  final double? height;
  final TextAlign textAlign;

  /// Whether it is drawn as a card list's row draws it.
  final bool listed;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final parts = switch (cells) {
      final cells? => partsOf(cells, revealed: revealed),
      null => <CardPart>[
        for (final block in blocks) (block: block, added: false),
      ],
    };
    final column = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: listed ? AppSpace.s8 : AppSpace.s12,
      children: [
        for (final (:block, :added) in parts)
          switch (block) {
            TextContent(:final text) when listed => _listedText(
              context,
              TextSpan(text: keepWords(text)),
              added: added,
            ),
            SensesContent() when listed => _listedText(
              context,
              sensesSpan(block, wrap: keepWords),
              added: added,
            ),
            ImageContent() when listed => _listedImage(context, block),
            TextContent(:final text) => Text(
              text,
              textAlign: textAlign,
              style: added ? _addedStyle(context) : _titleStyle,
            ),
            ClozeContent() => _cloze(context, block),
            TableContent() => _table(context, block),
            SensesContent() => Text.rich(
              sensesSpan(block),
              textAlign: textAlign,
              style: added ? _addedStyle(context) : style,
            ),
            // Inside [width] and [height] itself, so the photo alone is
            // not scaled down with the face and its boxes' chrome stays
            // its size.
            ImageContent() => ImageBlockView(
              block,
              revealed: revealed,
              width: this.width,
              maxHeight: height,
            ),
            AudioContent() => Center(child: AudioBlockView(block)),
            UnsupportedContent(:final type) => Text(
              l10n.unsupportedContent(type),
              textAlign: TextAlign.center,
              style: AppType.secondary.copyWith(fontStyle: FontStyle.italic),
            ),
          },
      ],
    );
    final width = this.width;
    return Semantics(
      container: true,
      label: spokenContent(l10n, [
        for (final part in parts) part.block,
      ], revealed: revealed),
      excludeSemantics: true,
      child: width == null
          ? column
          : height == null
          ? SizedBox(width: width, child: column)
          : FittedBox(
              fit: BoxFit.scaleDown,
              child: SizedBox(width: width, child: column),
            ),
    );
  }

  /// A text block's style: the headline on a card, or, in a style smaller
  /// than it such as a list row's, that style in bold, so a row keeps its
  /// screen's sizes (#454).
  TextStyle get _titleStyle => _inRow
      ? style.copyWith(fontWeight: FontWeight.w700)
      : AppType.wholeFront.copyWith(color: style.color);

  /// A part the reveal added: the back's size in `ink2` on a card, or, in a
  /// style such as a list row's, that style at regular weight in `ink2`.
  TextStyle _addedStyle(BuildContext context) {
    final ink2 = AppColors.of(context).ink2;
    return _inRow
        ? style.copyWith(color: ink2, fontWeight: FontWeight.w400)
        : AppType.wholeAdded.copyWith(color: ink2);
  }

  /// A part in a card list's row: a shown one in the title's style cut at two
  /// lines, an [added] one in a hatched box cut at three.
  Widget _listedText(
    BuildContext context,
    InlineSpan span, {
    required bool added,
  }) => added
      ? _hatchedBox(
          context,
          Text.rich(
            span,
            maxLines: 3,
            overflow: TextOverflow.ellipsis,
            style: _addedStyle(context),
          ),
        )
      : Text.rich(
          span,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: _titleStyle,
        );

  /// [child] in a box on [AppHatch], as a card list marks a revealed part.
  Widget _hatchedBox(BuildContext context, Widget child) => DecoratedBox(
    decoration: HatchDecoration(
      AppColors.of(context),
      borderRadius: BorderRadius.circular(AppRadius.chip),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s12,
        vertical: AppSpace.s8,
      ),
      child: child,
    ),
  );

  /// A photo in a card list's row: the photo as wide as the row, each box on
  /// [AppHatch] over what it hides, and the boxes' answers after it in a
  /// hatched box, as a revealed part.
  Widget _listedImage(BuildContext context, ImageContent image) {
    final colors = AppColors.of(context);
    final answers = [
      for (final box in image.boxes)
        if (box.answer case final answer? when answer.trim().isNotEmpty)
          keepWords(answer),
    ];
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s8,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final size = imageFrame(
              image,
              Size(constraints.maxWidth, double.infinity),
            );
            return Align(
              alignment: AlignmentDirectional.centerStart,
              child: SizedBox.fromSize(
                size: size,
                child: Stack(
                  children: [
                    Positioned.fill(child: ImagePhoto(image)),
                    for (final box in image.boxes)
                      Positioned.fromRect(
                        key: ValueKey(('listed box', box.id)),
                        rect: box.rectIn(size),
                        child: DecoratedBox(
                          decoration: HatchDecoration(
                            colors,
                            borderRadius: BorderRadius.circular(AppSpace.s4),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
        if (answers.isNotEmpty)
          _hatchedBox(
            context,
            Text(
              answers.join(' · '),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: _addedStyle(context),
            ),
          ),
      ],
    );
  }

  /// Whether [style] is smaller than a card's, as a list row's is.
  bool get _inRow => (style.fontSize ?? 0) < (AppType.headline.fontSize ?? 0);

  Widget _cloze(BuildContext context, ClozeContent cloze) {
    final parts = cloze.text.split(clozeBlank);
    final span = TextSpan(
      children: [
        for (final (index, part) in parts.indexed) ...[
          // Korean breaks only between words (#454).
          TextSpan(text: keepWords(part)),
          if (index < cloze.answers.length)
            _blank(context, cloze.answers[index]),
        ],
      ],
    );
    final width = this.width;
    final minFontSize = this.minFontSize;
    if (listed) {
      return Text.rich(
        span,
        style: style,
        textAlign: textAlign,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
      );
    }
    if (width == null || minFontSize == null) {
      return Text.rich(span, style: style, textAlign: textAlign);
    }
    return CardText(
      cloze.filled,
      span: span,
      style: style,
      minFontSize: minFontSize,
      width: width,
      textAlign: textAlign,
    );
  }

  Widget _table(BuildContext context, TableContent table) {
    final colors = AppColors.of(context);
    final cell = AppType.body.copyWith(color: style.color);
    final header = cell.copyWith(fontWeight: FontWeight.w700);
    Widget padded(Widget child) => Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpace.s8,
        vertical: AppSpace.s4,
      ),
      child: child,
    );
    // A card list's row shows a table's first rows and how many it leaves.
    final shown = listed ? table.rows.take(_listedRows).length : null;
    final grid = Table(
      border: TableBorder.all(color: colors.outline),
      defaultVerticalAlignment: TableCellVerticalAlignment.middle,
      children: [
        TableRow(
          decoration: BoxDecoration(color: colors.ground),
          children: [
            for (final text in table.columns)
              padded(Text(text, style: header, textAlign: TextAlign.center)),
          ],
        ),
        for (final (row, cells)
            in table.rows.take(shown ?? table.rows.length).indexed)
          TableRow(
            children: [
              for (final (column, _) in cells.indexed)
                padded(
                  Text.rich(
                    TextSpan(
                      children: [
                        for (final run in table.cellRuns(row, column))
                          run.blank
                              ? _blank(context, run.text)
                              : TextSpan(text: run.text),
                      ],
                    ),
                    // Each row starts with its header.
                    style: column == 0 ? header : cell,
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
      ],
    );
    final left = table.rows.length - (shown ?? table.rows.length);
    if (left == 0) return grid;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s4,
      children: [
        grid,
        Text(
          AppLocalizations.of(context).moreRows(left),
          style: AppType.caption.copyWith(color: colors.ink2),
        ),
      ],
    );
  }

  /// A blank of [answer]: an empty gap of the answer's width over a muted
  /// underline, so hidden content shows as nothing (#454), or filled on the
  /// brand tint; in a card list's row, filled on [AppHatch].
  TextSpan _blank(BuildContext context, String answer) {
    final colors = AppColors.of(context);
    return TextSpan(
      text: ' ${keepWords(answer)} ',
      style: listed
          ? TextStyle(background: AppHatch.paint(colors))
          : revealed
          ? TextStyle(backgroundColor: colors.brandTint)
          : TextStyle(
              color: colors.muted.withValues(alpha: 0),
              decoration: TextDecoration.underline,
              decorationColor: colors.muted,
            ),
    );
  }
}

/// A whole card's 칸 as the current card and the card preview draw them: in
/// the largest of [cardSteps] from [style] at which its text fits a box
/// [width] wide and [height] high, start-aligned at the last, past which the
/// face scrolls ([CardScroll], ADR 0123).
class SteppedWholeCardView extends StatelessWidget {
  const SteppedWholeCardView(
    this.cells, {
    super.key,
    required this.revealed,
    required this.style,
    required this.width,
    required this.height,
  });

  final List<Cell> cells;
  final bool revealed;
  final TextStyle style;
  final double width;
  final double height;

  @override
  Widget build(BuildContext context) {
    // The face's text with each blank filled, whose width an empty blank's
    // gap keeps.
    final plain = describeContent(AppLocalizations.of(context), [
      for (final part in partsOf(cells, revealed: revealed)) part.block,
    ]);
    final stepped = steppedStyle(
      TextSpan(text: keepWords(plain)),
      plain,
      steps: cardSteps(style),
      width: width,
      height: height,
      textScaler: MediaQuery.textScalerOf(context),
      textDirection: Directionality.of(context),
    );
    return WholeCardView.cells(
      cells,
      revealed: revealed,
      style: stepped,
      minFontSize: stepped.fontSize,
      width: width,
      textAlign: cardAlign(stepped),
    );
  }
}
