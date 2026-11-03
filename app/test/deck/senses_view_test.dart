import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

const _senses = SensesContent([
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.noun, 'n.')],
    meaning: '사과',
  ),
  CardSense(
    labels: [PartOfSpeechLabel(PartOfSpeech.noun, '명'), OtherLabel('사물')],
    meaning: '철도 위를 다니는 긴 차',
  ),
  CardSense(meaning: '열매'),
]);

Future<void> _pump(WidgetTester tester, Widget child) => tester.pumpWidget(
  MaterialApp(
    theme: lightTheme,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    locale: const Locale('en'),
    home: Scaffold(body: child),
  ),
);

/// The text [of] draws, and the label pieces in it that carry a gap after
/// them, as letter spacing.
({String text, List<(String, double)> gaps}) _drawn(Finder of) {
  final span =
      (find
                  .descendant(of: of, matching: find.byType(RichText))
                  .evaluate()
                  .first
                  .widget
              as RichText)
          .text;
  final gaps = <(String, double)>[];
  span.visitChildren((child) {
    final spacing = child.style?.letterSpacing;
    if (child is TextSpan && spacing != null) gaps.add((child.text!, spacing));
    return true;
  });
  return (text: span.toPlainText(), gaps: gaps);
}

void main() {
  testWidgets(
    'a senses side shows each sense on its line: a part of speech by its short form and another label as printed, '
    'each in brackets with a narrow gap after it, and a sense with no label its meaning alone',
    (tester) async {
      await _pump(tester, const ContentView([_senses]));

      final drawn = _drawn(find.byType(ContentView));
      expect(drawn.text, '[명]사과\n[명][사물]철도 위를 다니는 긴 차\n열매');
      // One gap after each label's closing bracket, and none elsewhere.
      expect(drawn.gaps, [
        (']', AppSpace.s4),
        (']', AppSpace.s4),
        (']', AppSpace.s4),
      ]);
    },
  );

  testWidgets(
    'a deck row shows a senses back the same way, and is read with one space after each label',
    (tester) async {
      final semantics = tester.ensureSemantics();
      await _pump(
        tester,
        CardBackRow(
          front: const [TextContent('apple')],
          back: const [_senses],
          onOpen: () {},
        ),
      );

      expect(
        _drawn(find.byType(CardBackRow)).text.replaceAll('\u2060', ''),
        'apple',
        reason: 'the front first',
      );
      final back = find
          .descendant(
            of: find.byType(CardBackRow),
            matching: find.byType(RichText),
          )
          .at(1);
      expect(
        (back.evaluate().single.widget as RichText).text
            .toPlainText()
            .replaceAll('\u2060', ''),
        '[명]사과\n[명][사물]철도 위를 다니는 긴 차\n열매',
      );
      expect(
        find.bySemanticsLabel('apple, back [명] 사과\n[명] [사물] 철도 위를 다니는 긴 차\n열매'),
        findsOneWidget,
      );
      semantics.dispose();
    },
  );
}
