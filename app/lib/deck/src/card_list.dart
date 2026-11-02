import 'package:flutter/material.dart';

import '../../design/app_list_row.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import 'card_frame.dart';
import 'content.dart';
import 'content_view.dart';
import 'split_card.dart';
import 'whole_card_view.dart';

/// A card as two columns, front and back, split by a thin divider, or a
/// whole card's 칸 in place, revealed; read-only without [onTap]. On
/// its own it is a row on its rounded surface; [grouped] it is one row of a
/// group that draws the surface.
class CardSplitRow extends StatelessWidget {
  const CardSplitRow({
    super.key,
    required this.front,
    required this.back,
    this.cells,
    this.onTap,
    this.grouped = false,
  });

  final List<Content> front;
  final List<Content> back;

  /// The 칸 a framed card stores; null on a card converted from its sides.
  final List<Cell>? cells;
  final VoidCallback? onTap;
  final bool grouped;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final cells = this.cells ?? cellsToDraw(front, back);
    final content = isDrawnWhole(cells)
        ? Padding(
            padding: const EdgeInsets.all(AppSpace.s16),
            child: WholeCardView.cells(
              cells,
              revealed: true,
              style: AppType.bodyStrong,
            ),
          )
        : SplitCard(
            centred: false,
            front: (context, _) =>
                Text.rich(contentSpan(l10n, front), style: AppType.bodyStrong),
            back: (context, _) => Text.rich(
              contentSpan(l10n, back),
              style: AppType.secondary.copyWith(color: colors.ink2),
            ),
          );
    final onTap = this.onTap;
    if (!grouped) return AppRowSurface(onTap: onTap, child: content);
    return onTap == null ? content : InkWell(onTap: onTap, child: content);
  }
}

/// A card's row: its front, and its back muted after it when [shown], or a
/// whole card's 칸 in place, unrevealed unless [shown]. A tap opens the
/// card with [onOpen], and a screen reader hears the row as one button.
/// Inside an [AppGroup] it is one of the group's rows.
class CardBackRow extends StatelessWidget {
  const CardBackRow({
    super.key,
    required this.front,
    required this.back,
    this.cells,
    required this.shown,
    required this.onOpen,
  });

  final List<Content> front;
  final List<Content> back;

  /// The 칸 a framed card stores; null on a card converted from its sides.
  final List<Cell>? cells;
  final bool shown;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final cells = this.cells ?? cellsToDraw(front, back);
    final whole = isDrawnWhole(cells);
    final spokenFront = whole
        ? spokenCells(l10n, cells, revealed: false)
        : spokenContent(l10n, front, revealed: false);
    final spokenBack = whole
        ? spokenCells(l10n, cells, revealed: true)
        : describeContent(l10n, back);
    return Semantics(
      container: true,
      button: true,
      label: shown
          ? l10n.cardBackShown(spokenFront, spokenBack)
          : l10n.cardBackHidden(spokenFront),
      onTapHint: l10n.editCard,
      onTap: onOpen,
      excludeSemantics: true,
      child: AppRowSurface(
        onTap: onOpen,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSize.cta),
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpace.s16,
              vertical: AppSpace.s12,
            ),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: whole
                  ? WholeCardView.cells(
                      cells,
                      revealed: shown,
                      style: AppType.bodyStrong,
                    )
                  : Row(
                      spacing: AppSpace.s12,
                      children: [
                        Expanded(
                          child: Text.rich(
                            contentSpan(l10n, front),
                            style: AppType.bodyStrong,
                          ),
                        ),
                        if (shown)
                          Expanded(
                            child: Text.rich(
                              contentSpan(l10n, back),
                              textAlign: TextAlign.end,
                              style: AppType.secondary.copyWith(
                                color: colors.muted,
                              ),
                            ),
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

/// A whole card as a screen reader reads it: its 칸 in order, as
/// [spokenContent] reads their parts, each added part after its first when
/// [revealed] (ADR 0137).
String spokenCells(
  AppLocalizations l10n,
  List<Cell> cells, {
  required bool revealed,
}) => spokenContent(l10n, [
  for (final part in partsOf(cells, revealed: revealed)) part.block,
], revealed: revealed);

/// One line of text for a card side: a cloze or a table with its blanks
/// filled, a photo as "사진", a sound as "소리", and a block this version
/// cannot show named by its type.
String describeContent(AppLocalizations l10n, List<Content> blocks) => blocks
    .map(
      (block) => switch (block) {
        TextContent(:final text) => text,
        ClozeContent(:final filled) || TableContent(:final filled) => filled,
        SensesContent(:final lines) => lines,
        ImageContent() => l10n.blockImage,
        AudioContent() => l10n.blockAudio,
        UnsupportedContent(:final type) => l10n.unsupportedContent(type),
      },
    )
    .join(' ');

/// A card side as a screen reader reads it: as [describeContent] has it, but
/// each blank as its answer only when [revealed], else as "빈칸", a table row
/// by row, its cells joined by commas, a span in its cell's text, and the
/// blocks as sentences.
String spokenContent(
  AppLocalizations l10n,
  List<Content> blocks, {
  required bool revealed,
}) {
  String blank(String answer) => revealed ? answer : l10n.blank;
  return blocks
      .map(
        (block) => switch (block) {
          ClozeContent(:final text, :final answers) => [
            for (final (index, part) in text.split(clozeBlank).indexed) ...[
              part,
              if (index < answers.length) blank(answers[index]),
            ],
          ].join(),
          TableContent(:final columns, :final rows) => [
            columns.join(', '),
            for (final (row, cells) in rows.indexed)
              [
                for (final (column, _) in cells.indexed)
                  [
                    for (final run in block.cellRuns(row, column))
                      run.blank ? blank(run.text) : run.text,
                  ].join(),
              ].join(', '),
          ].join('. '),
          // A photo, then each box as a blank, or its answer once revealed.
          ImageContent(:final boxes) => [
            l10n.blockImage,
            for (final box in boxes)
              switch (box.answer) {
                final answer? when answer.trim().isNotEmpty => blank(answer),
                _ => l10n.blank,
              },
          ].join(', '),
          _ => describeContent(l10n, [block]),
        },
      )
      .join('. ');
}
