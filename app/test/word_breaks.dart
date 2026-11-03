import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// The text on screen that reads [text] once the word joiners `keepWords` sets
/// between a word's characters are left out.
Finder shownText(String text) => find.byWidgetPredicate(
  (widget) =>
      widget is Text &&
      (widget.data ?? widget.textSpan?.toPlainText())?.replaceAll(
            '\u2060',
            '',
          ) ==
          text,
);

/// The text on screen that holds [text] once the word joiners `keepWords` sets
/// are left out.
Finder shownTextContaining(String text) => find.byWidgetPredicate(
  (widget) =>
      widget is Text &&
      ((widget.data ?? widget.textSpan?.toPlainText())
              ?.replaceAll('\u2060', '')
              .contains(text) ??
          false),
);

/// The [type] widgets holding the text on screen that reads [text], as
/// [shownText] finds it.
Finder widgetWithShownText(Type type, String text) =>
    find.ancestor(of: shownText(text), matching: find.byType(type));

/// Where each line of [text]'s paragraph ends, as offsets into its text with
/// the word joiners in, and that text.
(List<int>, String) lineEnds(WidgetTester tester, String text) {
  final paragraph = tester.renderObject<RenderParagraph>(
    find.descendant(of: shownText(text), matching: find.byType(RichText)),
  );
  final plain = paragraph.text.toPlainText();
  // The paragraph's own text laid out at its width, to read its lines.
  final lines = TextPainter(
    text: paragraph.text,
    textDirection: paragraph.textDirection,
    textScaler: paragraph.textScaler,
  )..layout(maxWidth: paragraph.size.width);
  addTearDown(lines.dispose);
  final ends = <int>[];
  for (var offset = 0; offset < plain.length;) {
    offset = lines.getLineBoundary(TextPosition(offset: offset)).end;
    ends.add(offset);
  }
  return (ends, plain);
}

/// Expects [text] on screen to wrap and to break only at a space.
void expectBreaksBetweenWords(WidgetTester tester, String text) {
  final (ends, plain) = lineEnds(tester, text);
  // The text wraps at this width, so where it breaks is tested.
  expect(ends.length, greaterThan(1), reason: text);
  for (final end in ends.take(ends.length - 1)) {
    expect(
      plain[end - 1] == ' ' || plain[end] == ' ',
      isTrue,
      reason: 'a break at $end in "$text"',
    );
  }
}

/// Expects [word], one word wider than its line, to wrap inside itself.
void expectWrapsInsideWord(WidgetTester tester, String word) {
  final (ends, _) = lineEnds(tester, word);
  expect(ends.length, greaterThan(1), reason: 'the control wraps');
}
