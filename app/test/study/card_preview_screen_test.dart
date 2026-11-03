import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/src/card_preview_screen.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

/// [words] Korean words of four syllables, a space apart.
String _korean(int words) => List.filled(words, '광합성은').join(' ');

/// The paragraph that draws [text], the joiners `keepWords` sets left out.
RenderParagraph _drawn(WidgetTester tester, String text) =>
    tester.renderObject<RenderParagraph>(
      find.byWidgetPredicate(
        (widget) =>
            widget is RichText &&
            widget.text.toPlainText().replaceAll('⁠', '') == text,
      ),
    );

/// The card's face: the surface the preview turns.
Rect _face(WidgetTester tester) =>
    tester.getRect(find.byType(CardScroll).first);

void main() {
  testWidgets(
    'the preview steps a long front down to the body size, start-aligned and '
    'scrolling with a fading edge to its last line, and a short back stays '
    'at the back size, centred (ADR 0123)',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844) * 3;
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final front = _korean(60);
      await tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: CardPreviewScreen(
            cells: [TextCell(front: front, back: '광합성')],
          ),
        ),
      );
      await tester.pumpAndSettle();

      final paragraph = _drawn(tester, front);
      expect(paragraph.text.style!.fontSize, AppType.cardBody.fontSize);
      expect(paragraph.textAlign, TextAlign.start);
      expect(paragraph.didExceedMaxLines, isFalse);
      final face = _face(tester);
      // Taller than the face, so it scrolls; its edge fades until its last
      // line is in the face.
      expect(paragraph.size.height, greaterThan(face.height));
      final fade = find.byKey(const Key('cardScrollFade'));
      expect(fade, findsOneWidget);
      await tester.drag(find.byType(CardScroll), const Offset(0, -4000));
      await tester.pumpAndSettle();
      expect(
        paragraph.localToGlobal(Offset(0, paragraph.size.height)).dy,
        lessThanOrEqualTo(face.bottom),
      );
      expect(fade, findsNothing);

      // Control: the short back keeps the back size, centred, with no fade.
      await tester.tap(find.byType(CardScroll));
      await tester.pumpAndSettle();
      final back = _drawn(tester, '광합성');
      expect(back.text.style!.fontSize, AppType.back.fontSize);
      expect(back.textAlign, TextAlign.center);
      expect(fade, findsNothing);
    },
  );

  testWidgets('a whole card keeps its back from the prompt, shows it after a '
      'tap, and names no side, where a split card names its side', (
    tester,
  ) async {
    Widget preview(List<Cell> cells) => MaterialApp(
      theme: lightTheme,
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: CardPreviewScreen(key: UniqueKey(), cells: cells),
    );
    await tester.pumpWidget(
      preview(const [
        BlankCell(ClozeContent('___ is red.', ['Rose'])),
        TextCell(back: 'A flower.'),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.text('A flower.'), findsNothing);
    expect(find.text('Front'), findsNothing);

    await tester.tap(find.byType(CardScroll));
    await tester.pumpAndSettle();
    expect(find.text('A flower.'), findsOneWidget);
    expect(find.text('Back'), findsNothing);

    // Control: a split card names its side.
    await tester.pumpWidget(
      preview(const [TextCell(front: 'Rose', back: 'A flower.')]),
    );
    await tester.pumpAndSettle();
    expect(find.text('Front'), findsOneWidget);
  });
}
