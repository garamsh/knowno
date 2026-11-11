import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/src/card_preview_screen.dart';
import 'package:knowno/study/src/study_style.dart';
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

/// The paragraphs that draw [text], the joiners left out.
Finder _text(String text) => find.byWidgetPredicate(
  (widget) =>
      widget is RichText &&
      widget.text.toPlainText().replaceAll('\u2060', '') == text,
);

/// The card's face: the surface the preview turns.
Rect _face(WidgetTester tester) =>
    tester.getRect(find.byType(CardScroll).first);

/// The preview of [cells] on a 390 by 844 screen.
Widget _preview(List<Cell> cells, {Locale locale = const Locale('en')}) =>
    MaterialApp(
      theme: lightTheme,
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: CardPreviewScreen(key: UniqueKey(), cells: cells),
    );

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 844) * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets(
    'the preview steps a long front down to the body size, start-aligned and '
    'scrolling with a fading edge to its last line (ADR 0123), and turned '
    'draws the back under it in the previous card\'s back type',
    (tester) async {
      _phone(tester);
      final front = _korean(60);
      await tester.pumpWidget(
        _preview([
          TextCell(front: front, back: '광합성'),
        ], locale: const Locale('ko')),
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

      await tester.tap(find.byType(CardScroll));
      await tester.pumpAndSettle();
      final back = _drawn(tester, '광합성');
      expect(back.text.style!.fontSize, StudyStyle.previousBack.fontSize);
      expect(
        back.localToGlobal(Offset.zero).dy,
        greaterThan(_drawn(tester, front).localToGlobal(Offset.zero).dy),
        reason: 'under the front',
      );
    },
  );

  testWidgets(
    'a whole card keeps its back from the prompt and shows it after a tap, '
    'and neither a whole card nor a split one names a side',
    (tester) async {
      await tester.pumpWidget(
        _preview(const [
          BlankCell(ClozeContent('{{c1::Rose}} is red.')),
          TextCell(back: 'A flower.'),
        ]),
      );
      await tester.pumpAndSettle();
      expect(_text('A flower.'), findsNothing);
      expect(find.text('Front'), findsNothing);

      await tester.tap(find.byType(CardScroll));
      await tester.pumpAndSettle();
      expect(_text('A flower.'), findsOneWidget);
      expect(find.text('Back'), findsNothing);

      await tester.pumpWidget(
        _preview(const [TextCell(front: 'Rose', back: 'A flower.')]),
      );
      await tester.pumpAndSettle();
      expect(_text('Rose'), findsOneWidget, reason: 'the setup: drawn');
      expect(find.text('Front'), findsNothing);
      await tester.tap(find.byType(CardScroll));
      await tester.pumpAndSettle();
      expect(_text('A flower.'), findsOneWidget, reason: 'the setup');
      expect(find.text('Back'), findsNothing);
    },
  );

  testWidgets('the preview centres the card under its top bar, its hint below '
      'it', (tester) async {
    _phone(tester);
    await tester.pumpWidget(
      _preview(const [TextCell(front: 'Chat', back: 'cat')]),
    );
    await tester.pumpAndSettle();
    final card = _face(tester);
    final hint = tester.getRect(
      find.byWidgetPredicate(
        (widget) =>
            widget is Text &&
            widget.data?.replaceAll('⁠', '') ==
                'Tap the card to see the answer',
      ),
    );
    expect(hint.top, greaterThan(card.bottom));
    final top = tester.getRect(find.byType(AppBar)).bottom;
    expect(
      card.top - top,
      closeTo(844 - hint.bottom, 1),
      reason: 'centred on the screen',
    );
  });

  testWidgets(
    'the preview turns the card over in 3D, part way through after 100 ms, and at once when the system asks to reduce motion',
    (tester) async {
      const cells = [TextCell(front: 'Chat', back: 'cat')];
      await tester.pumpWidget(_preview(cells));
      await tester.pumpAndSettle();
      // The card's turn about its vertical axis, from its transform.
      double turn() {
        final transform = tester
            .widgetList<Transform>(
              find.descendant(
                of: find.byType(CardPreviewScreen),
                matching: find.byType(Transform),
              ),
            )
            .first
            .transform;
        return transform.entry(0, 0);
      }

      expect(turn(), closeTo(1, 1e-9), reason: 'the setup: the card faces up');
      await tester.tap(find.byType(CardScroll));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(turn(), lessThan(0.9), reason: 'turning');
      await tester.pumpAndSettle();
      expect(turn(), closeTo(1, 1e-9), reason: 'turned over, answered');

      // Reduce motion: the next frame already shows the other side, unturned.
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      await tester.pumpWidget(_preview(cells));
      await tester.pumpAndSettle();
      expect(_text('cat'), findsNothing, reason: 'the setup: the front');
      await tester.tap(find.byType(CardScroll));
      await tester.pump();
      expect(turn(), closeTo(1, 1e-9));
      expect(_text('cat'), findsOneWidget);
    },
  );
}
