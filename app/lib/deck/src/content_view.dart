import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'audio_block.dart';
import 'card_text.dart';
import 'content.dart';
import 'image_block.dart';
import 'markup.dart';
import 'markup_span.dart';
import 'whole_card_view.dart';

/// How a card side's text is fitted to the box [width] wide and [height]
/// high it is drawn in.
sealed class CardFit {
  const CardFit({required this.width, required this.height});

  final double width;
  final double height;
}

/// Scaled down from the style's size as far as [minFontSize] until it fits,
/// and cut with an ellipsis past the lines that fit: the previous card.
final class ShrinkFit extends CardFit {
  const ShrinkFit({
    required this.minFontSize,
    required super.width,
    required super.height,
  });

  final double minFontSize;
}

/// The largest of [cardSteps] at which it fits whole, past which it scrolls:
/// the current card and the card preview (ADR 0123).
final class StepFit extends CardFit {
  const StepFit({required super.width, required super.height});
}

/// A card side's content blocks, in order, each through its block widget.
///
/// With [fit], the blocks run together as one paragraph, centred, their
/// lines broken only between words: with a [ShrinkFit] scaled down from
/// [style]'s size as far as its floor until it fits the box, and cut with an
/// ellipsis past the lines that fit there ([fittedToBox]); with a [StepFit]
/// in the largest of [cardSteps] at which it fits whole, start-aligned at
/// the last ([steppedStyle]). A side that holds a photo, a sound or a block
/// this version cannot show is laid out block by block instead, each text
/// block centred and scaled down until its widest word fits ([CardText]),
/// its photo inside the fit, its sound as its play control and the block it
/// cannot show as its placeholder, and with a [ShrinkFit] scaled down as a
/// whole to fit the box (ADR 0109, ADR 0112).
class ContentView extends StatelessWidget {
  const ContentView(this.blocks, {super.key, this.style, this.fit});

  final List<Content> blocks;
  final TextStyle? style;
  final CardFit? fit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final fit = this.fit;
    final style = this.style;
    final byBlock = blocks.any(
      (block) =>
          block is ImageContent ||
          block is AudioContent ||
          block is UnsupportedContent,
    );
    if (fit != null && !byBlock) {
      // Korean breaks only between words (#454); a screen reader reads the
      // words without the joiners.
      final span = contentSpan(l10n, blocks, wrap: keepWords);
      final plain = [for (final block in blocks) _plain(l10n, block)];
      final paragraph = DefaultTextStyle.of(context).style.merge(style);
      final textScaler = MediaQuery.textScalerOf(context);
      final textDirection = Directionality.of(context);
      switch (fit) {
        case ShrinkFit(:final minFontSize, :final width, :final height):
          final fitted = fittedToBox(
            span,
            plain.join(' '),
            style: paragraph,
            minFontSize: minFontSize,
            width: width,
            height: height,
            textScaler: textScaler,
            textDirection: textDirection,
          );
          return Text.rich(
            span,
            style: fitted.style,
            maxLines: fitted.maxLines,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            semanticsLabel: plain.join('\n'),
          );
        case StepFit(:final width, :final height):
          final stepped = steppedStyle(
            span,
            plain.join(' '),
            steps: cardSteps(paragraph),
            width: width,
            height: height,
            textScaler: textScaler,
            textDirection: textDirection,
          );
          return Text.rich(
            span,
            style: stepped,
            textAlign: cardAlign(stepped),
            semanticsLabel: plain.join('\n'),
          );
      }
    }
    final minFontSize = switch (fit) {
      ShrinkFit(:final minFontSize) => minFontSize,
      StepFit() => cardSteps(style ?? AppType.front).last.fontSize!,
      null => null,
    };
    final column = Column(
      crossAxisAlignment: fit == null
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.center,
      spacing: _blockGap,
      children: [
        for (final block in blocks)
          switch (block) {
            final TextContent text
                when fit != null && style != null && minFontSize != null =>
              CardText(
                text.plain,
                span: textSpan(text, wrap: keepWords),
                style: style,
                minFontSize: minFontSize,
                width: fit.width,
              ),
            final TextContent text when text.markup => Text.rich(
              textSpan(text, wrap: keepWords),
              style: style,
            ),
            TextContent(:final text) => Text(text, style: style),
            SensesContent(:final lines)
                when fit != null && style != null && minFontSize != null =>
              CardText(
                lines,
                span: sensesSpan(block, wrap: keepWords),
                style: style,
                minFontSize: minFontSize,
                width: fit.width,
              ),
            SensesContent() => Text.rich(sensesSpan(block), style: style),
            ClozeContent() || TableContent() => WholeCardView(
              [block],
              revealed: true,
              style: style ?? AppType.body,
            ),
            ImageContent() => ImageBlockView(
              block,
              revealed: true,
              width: fit?.width,
              maxHeight: fit?.height,
            ),
            AudioContent() => Center(child: AudioBlockView(block)),
            UnsupportedContent(:final type) => _UnsupportedBlock(
              label: l10n.unsupportedContent(type),
            ),
          },
      ],
    );
    return switch (fit) {
      ShrinkFit(:final width) => FittedBox(
        fit: BoxFit.scaleDown,
        child: SizedBox(width: width, child: column),
      ),
      _ => column,
    };
  }

  String _plain(AppLocalizations l10n, Content block) => switch (block) {
    TextContent(:final plain) => plain,
    ClozeContent(:final filled) || TableContent(:final filled) => filled,
    SensesContent(:final lines) => lines,
    ImageContent() => l10n.blockImage,
    AudioContent() => l10n.blockAudio,
    UnsupportedContent(:final type) => l10n.unsupportedContent(type),
  };
}

String _same(String text) => text;

/// A text block as a span: its words as written, or, for markup, its marks
/// drawn, as [markupSpan] has them.
InlineSpan textSpan(
  TextContent block, {
  String Function(String text) wrap = _same,
}) => block.markup
    ? markupSpan(markupEngine.parse(block.text), wrap: wrap)
    : TextSpan(text: wrap(block.text));

/// [blocks] run together as one paragraph, a line apart: a text block as
/// written, a cloze or a table filled, a senses block as [sensesSpan] draws
/// it, a photo as "사진", a sound as "소리", and a block this version cannot
/// show named by its type. [wrap] is
/// applied to each piece of text, such as a list's line-breaking rule.
InlineSpan contentSpan(
  AppLocalizations l10n,
  List<Content> blocks, {
  String Function(String text) wrap = _same,
}) => TextSpan(
  children: [
    for (final (index, block) in blocks.indexed) ...[
      if (index > 0) const TextSpan(text: '\n'),
      switch (block) {
        final TextContent text => textSpan(text, wrap: wrap),
        ClozeContent(:final text) => markupSpan(
          markupEngine.parse(text),
          wrap: wrap,
        ),
        TableContent(:final filled) => TextSpan(text: wrap(filled)),
        SensesContent() => sensesSpan(block, wrap: wrap),
        ImageContent() => TextSpan(text: wrap(l10n.blockImage)),
        AudioContent() => TextSpan(text: wrap(l10n.blockAudio)),
        UnsupportedContent(:final type) => TextSpan(
          text: l10n.unsupportedContent(type),
          style: const TextStyle(fontStyle: FontStyle.italic),
        ),
      },
    ],
  ],
);

/// [senses] one per line, each label in its brackets as its own span with a
/// gap of [AppSpace.s4] after it, narrower than a word space, then the
/// meaning: `[명]` 사과 (ADR 0075). The gap is the closing bracket's letter
/// spacing, so the line stays one paragraph that fits and wraps as text.
InlineSpan sensesSpan(
  SensesContent senses, {
  String Function(String text) wrap = _same,
}) => TextSpan(
  children: [
    for (final (index, sense) in senses.senses.indexed) ...[
      if (index > 0) const TextSpan(text: '\n'),
      for (final label in sense.labels) ...[
        TextSpan(text: '[${label.shown}'),
        const TextSpan(
          text: ']',
          style: TextStyle(letterSpacing: AppSpace.s4),
        ),
      ],
      TextSpan(text: wrap(sense.meaning)),
    ],
  ],
);

/// Space between two content blocks, and inside a block's placeholder.
const _blockGap = AppSpace.s8;

/// The labelled placeholder for a block this version cannot show.
class _UnsupportedBlock extends StatelessWidget {
  const _UnsupportedBlock({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        border: Border.all(color: theme.colorScheme.outline),
        borderRadius: BorderRadius.circular(_blockGap),
      ),
      child: Padding(
        padding: const EdgeInsets.all(_blockGap),
        child: Row(
          spacing: _blockGap,
          children: [
            Icon(
              LucideIcons.circleQuestionMark,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            Expanded(
              child: Text(
                label,
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontStyle: FontStyle.italic,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
