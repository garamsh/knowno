import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_preview.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/word_break.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../word_breaks.dart';

void main() {
  testWidgets('a short side sits vertically centred in its half', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: lightTheme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: Align(
            alignment: Alignment.topCenter,
            child: CardPreview(
              front: [TextContent('cat')],
              back: [
                TextContent(
                  'a small domesticated carnivorous mammal with soft fur, '
                  'a short snout and retractable claws',
                ),
              ],
            ),
          ),
        ),
      ),
    );

    final front = find.text(keepWords('cat'));
    final half = find.ancestor(of: front, matching: find.byType(Expanded));
    expect(
      tester.getRect(half).height,
      greaterThan(CardPreview.minHeight),
      reason: 'the longer back grows the card',
    );
    expect(tester.getCenter(front).dy, closeTo(tester.getCenter(half).dy, 1));
  });

  testWidgets(
    'a side breaks its lines only between words, as Korean otherwise breaks between any two syllables',
    (tester) async {
      tester.view
        ..physicalSize = const Size(390, 844)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const Scaffold(
            body: Padding(
              padding: EdgeInsets.all(20),
              child: CardPreview(
                front: [TextContent('present')],
                // Short words: the test font draws a word joiner as wide as a
                // letter, so a long word would no longer fit the half.
                back: [TextContent('가 나다라 마바사 아자차 카타 파하')],
              ),
            ),
          ),
        ),
      );

      final back = tester.renderObject<RenderParagraph>(
        find.byWidgetPredicate(
          (widget) =>
              widget is RichText &&
              widget.text
                  .toPlainText()
                  .replaceAll('\u2060', '')
                  .contains('나다라'),
        ),
      );
      final text = back.text.toPlainText();
      // Where a character starts a line below the one before it.
      final ends = <int>{};
      double? top;
      for (var offset = 0; offset < text.length; offset++) {
        final boxes = back.getBoxesForSelection(
          TextSelection(baseOffset: offset, extentOffset: offset + 1),
        );
        if (boxes.isEmpty) continue;
        if (top != null && boxes.first.top > top + 1) ends.add(offset);
        top = boxes.first.top;
      }
      expect(ends.length, greaterThan(1), reason: 'the back wraps');
      for (final end in ends) {
        expect(
          [text[end - 1], text[end]].any((char) => char.trim().isEmpty),
          isTrue,
          reason: 'a line ends inside a word at $end of "$text"',
        );
      }
    },
  );

  testWidgets('a whole card shows its kept back revealed', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: lightTheme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(
          body: CardPreview(
            front: [ClozeContent('{{c1::Rose}} is red.')],
            back: [TextContent('A flower.')],
          ),
        ),
      ),
    );
    expect(shownText('A flower.'), findsOneWidget);
    expect(find.byType(VerticalDivider), findsNothing);
  });
}
