import 'dart:math';

import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// A card side's text, centred, in [style] scaled down as far as
/// [minFontSize] until its widest word fits [width], so lines break only
/// between words. Only a word wider than [width] at [minFontSize] breaks
/// inside itself. With [maxLines] the text is cut to that many lines with an
/// ellipsis. With [span], that is drawn in place of [text] at the size [text]
/// fits: a whole card's sentence with its blanks. A screen reader reads
/// [text].
///
/// [width] is the width the text is laid out in; the caller passes it, since
/// a card measures its halves' intrinsic heights, which a layout builder here
/// could not answer.
class CardText extends StatelessWidget {
  const CardText(
    this.text, {
    super.key,
    required this.style,
    required this.minFontSize,
    required this.width,
    this.maxLines,
    this.span,
    this.textAlign = TextAlign.center,
  });

  final String text;
  final InlineSpan? span;
  final TextStyle style;
  final double minFontSize;
  final double width;
  final int? maxLines;
  final TextAlign textAlign;

  @override
  Widget build(BuildContext context) {
    final size = fittedFontSize(
      text,
      style: style,
      minFontSize: minFontSize,
      width: width,
      textScaler: MediaQuery.textScalerOf(context),
      textDirection: Directionality.of(context),
    );
    final fitted = style.copyWith(fontSize: size);
    final overflow = maxLines == null ? null : TextOverflow.ellipsis;
    final span = this.span;
    return span == null
        ? Text(
            text,
            style: fitted,
            textAlign: textAlign,
            maxLines: maxLines,
            overflow: overflow,
          )
        : Text.rich(
            span,
            style: fitted,
            textAlign: textAlign,
            maxLines: maxLines,
            overflow: overflow,
            semanticsLabel: text,
          );
  }
}

/// The largest whole size from [style]'s down to [minFontSize] at which the
/// widest word of [text] fits [width]; [minFontSize] when none does.
double fittedFontSize(
  String text, {
  required TextStyle style,
  required double minFontSize,
  required double width,
  required TextScaler textScaler,
  required TextDirection textDirection,
}) {
  final words = text.split(RegExp(r'\s+')).where((word) => word.isNotEmpty);
  final largest = style.fontSize ?? minFontSize;
  for (var size = largest; size > minFontSize; size -= 1) {
    if (_widestWord(
          words,
          style.copyWith(fontSize: size),
          textScaler,
          textDirection,
        ) <=
        width) {
      return size;
    }
  }
  return minFontSize;
}

/// [style] at the size, and the lines, that fit [span] into a box [width]
/// wide and [height] high: the largest whole size from [fittedFontSize]'s down
/// to [minFontSize] at which the whole text fits, with as many lines as it
/// takes; otherwise [minFontSize], with as many lines as fit [height], at
/// least one, past which the text is cut. [plain] is the span's text, whose
/// widest word sets the largest size.
({TextStyle style, int maxLines}) fittedToBox(
  InlineSpan span,
  String plain, {
  required TextStyle style,
  required double minFontSize,
  required double width,
  required double height,
  required TextScaler textScaler,
  required TextDirection textDirection,
}) {
  final largest = fittedFontSize(
    plain,
    style: style,
    minFontSize: minFontSize,
    width: width,
    textScaler: textScaler,
    textDirection: textDirection,
  );
  for (var size = largest; ; size -= 1) {
    final floor = size <= minFontSize;
    final fitted = style.copyWith(fontSize: floor ? minFontSize : size);
    final painter = TextPainter(
      text: TextSpan(style: fitted, children: [span]),
      textAlign: TextAlign.center,
      textDirection: textDirection,
      textScaler: textScaler,
    )..layout(maxWidth: width);
    final fits = painter.height <= height;
    final lines = fits
        ? painter.computeLineMetrics().length
        : max(1, (height / painter.preferredLineHeight).floor());
    painter.dispose();
    if (fits || floor) return (style: fitted, maxLines: max(1, lines));
  }
}

double _widestWord(
  Iterable<String> words,
  TextStyle style,
  TextScaler textScaler,
  TextDirection textDirection,
) {
  var widest = 0.0;
  for (final word in words) {
    final painter = TextPainter(
      text: TextSpan(text: word, style: style),
      textDirection: textDirection,
      textScaler: textScaler,
      maxLines: 1,
    )..layout();
    if (painter.width > widest) widest = painter.width;
    painter.dispose();
  }
  return widest;
}

/// The sizes a card side steps down through, largest first, in [style]'s
/// colour: [AppType.front], [AppType.deckName], [AppType.back] and
/// [AppType.cardBody], from the first no larger than [style], always down to
/// [AppType.cardBody] (ADR 0123, #635).
List<TextStyle> cardSteps(TextStyle style) =>
    [AppType.front, AppType.deckName, AppType.back, AppType.cardBody]
        .where(
          (step) =>
              step == AppType.cardBody ||
              step.fontSize! <= (style.fontSize ?? 0),
        )
        .map((step) => step.copyWith(color: style.color))
        .toList();

/// The largest of [steps] at which [span] fits a box [width] wide and
/// [height] high, its widest word inside [width]; the last when none does,
/// past which the side scrolls (ADR 0123). [plain] is the span's text.
TextStyle steppedStyle(
  InlineSpan span,
  String plain, {
  required List<TextStyle> steps,
  required double width,
  required double height,
  required TextScaler textScaler,
  required TextDirection textDirection,
}) {
  final words = plain.split(RegExp(r'\s+')).where((word) => word.isNotEmpty);
  for (final step in steps.take(steps.length - 1)) {
    if (_widestWord(words, step, textScaler, textDirection) > width) continue;
    final painter = TextPainter(
      text: TextSpan(style: step, children: [span]),
      textDirection: textDirection,
      textScaler: textScaler,
    )..layout(maxWidth: width);
    final fits = painter.height <= height;
    painter.dispose();
    if (fits) return step;
  }
  return steps.last;
}

/// How a side's text in [style] is aligned: start-aligned at
/// [AppType.cardBody], read as a paragraph, and centred above it (ADR 0123).
TextAlign cardAlign(TextStyle style) =>
    style.fontSize == AppType.cardBody.fontSize
    ? TextAlign.start
    : TextAlign.center;

/// A card face's content, centred in the face, given the width and height
/// inside [padding], and scrolling inside the face from the top where it is
/// taller; while more is below, the face's bottom edge fades into its
/// `surface` (ADR 0123).
class CardScroll extends StatefulWidget {
  const CardScroll({super.key, required this.padding, required this.builder});

  final double padding;
  final Widget Function(BuildContext context, double width, double height)
  builder;

  @override
  State<CardScroll> createState() => _CardScrollState();
}

class _CardScrollState extends State<CardScroll> {
  var _more = false;

  bool _measure(ScrollMetricsNotification notification) {
    _update(notification.metrics);
    return false;
  }

  bool _scrolled(ScrollUpdateNotification notification) {
    _update(notification.metrics);
    return false;
  }

  void _update(ScrollMetrics metrics) {
    final more = metrics.extentAfter > 0;
    if (more != _more) setState(() => _more = more);
  }

  @override
  Widget build(BuildContext context) {
    final padding = widget.padding;
    return LayoutBuilder(
      builder: (context, constraints) {
        final scroll = NotificationListener<ScrollUpdateNotification>(
          onNotification: _scrolled,
          child: NotificationListener<ScrollMetricsNotification>(
            onNotification: _measure,
            child: Center(
              child: SingleChildScrollView(
                padding: EdgeInsets.all(padding),
                child: SizedBox(
                  width: double.infinity,
                  child: widget.builder(
                    context,
                    constraints.maxWidth - 2 * padding,
                    constraints.maxHeight - 2 * padding,
                  ),
                ),
              ),
            ),
          ),
        );
        final surface = AppColors.of(context).surface;
        return Stack(
          children: [
            scroll,
            if (_more)
              Positioned(
                key: const Key('cardScrollFade'),
                left: 0,
                right: 0,
                bottom: 0,
                height: _fade,
                child: IgnorePointer(
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [surface.withValues(alpha: 0), surface],
                      ),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// How tall the fade at a scrolling face's bottom edge is.
const _fade = AppSpace.s32;
