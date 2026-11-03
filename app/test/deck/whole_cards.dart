import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';

/// Each blank of a whole card drawn under [of], by its answer: true where it
/// is filled on its fill, false where it is empty, its answer not drawn over
/// its underline.
Map<String, bool> blanksUnder(Finder of) {
  final blanks = <String, bool>{};
  for (final element
      in find.descendant(of: of, matching: find.byType(RichText)).evaluate()) {
    (element.widget as RichText).text.visitChildren((span) {
      final style = span.style;
      if (span is! TextSpan || span.text == null || style == null) return true;
      if (style.backgroundColor != null) {
        blanks[blankAnswer(span.text!)] = style.color != style.backgroundColor;
      } else if (isEmptyBlank(style)) {
        blanks[blankAnswer(span.text!)] = false;
      }
      return true;
    });
  }
  return blanks;
}

/// A blank's answer as written: its padding and the word joiners `keepWords`
/// sets between its characters left out.
String blankAnswer(String text) => text.replaceAll('⁠', '').trim();

/// Whether [style] draws an empty blank: its text invisible over an
/// underline, with no fill.
bool isEmptyBlank(TextStyle style) =>
    style.backgroundColor == null &&
    style.color?.a == 0 &&
    (style.decoration?.contains(TextDecoration.underline) ?? false);

/// Each blank of a card list's row drawn under [of], by its answer, in
/// order: a span filled with the hatch's paint (#629).
List<String> hatchedBlanksUnder(Finder of) {
  final answers = <String>[];
  for (final element
      in find.descendant(of: of, matching: find.byType(RichText)).evaluate()) {
    (element.widget as RichText).text.visitChildren((span) {
      if (span is TextSpan && span.style?.background?.shader != null) {
        answers.add(blankAnswer(span.text ?? ''));
      }
      return true;
    });
  }
  return answers;
}
