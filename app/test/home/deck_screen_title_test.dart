import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/home/src/deck_screen.dart';

import '../app_fonts.dart';
import 'deck_screens.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  setUpAll(loadAppFonts);

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale, in the bundled fonts, a long '
      'name keeps two lines under the bar, its end elided, and + 카드 추가 '
      'keeps its words',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final screens = await DeckScreens.open(
          tester,
          cards: {'Chat': 'cat'},
          locale: const Locale('ko'),
        );
        const long = '공무원 영단어 3000: 하루 50개씩 외우는 기출 필수 어휘와 숙어 모음';
        await tester.runAsync(
          () => screens.repository.renameDeck(screens.deck.id, long),
        );
        await screens.push((deck) => DeckScreen(deck: deck));

        final name = tester.renderObject<RenderParagraph>(find.text(long));
        // The setup: the name is longer than two lines at this width.
        expect(name.didExceedMaxLines, isTrue);
        final line = TextPainter(
          text: TextSpan(text: '공', style: name.text.style),
          textDirection: TextDirection.ltr,
          textScaler: name.textScaler,
        )..layout();
        addTearDown(line.dispose);
        expect(name.size.height, moreOrLessEquals(line.height * 2));
        expect(
          tester.getRect(find.text(long)).top,
          greaterThanOrEqualTo(tester.getRect(find.byType(AppBar)).bottom),
        );
        final add = find.descendant(
          of: find.byType(AppBar),
          matching: find.text('카드 추가'),
        );
        expect(add, findsOneWidget);
        // Its label whole, on one line.
        final label = tester.renderObject<RenderParagraph>(add);
        final whole = TextPainter(
          text: label.text,
          textDirection: TextDirection.ltr,
          textScaler: label.textScaler,
        )..layout();
        addTearDown(whole.dispose);
        expect(label.size, whole.size);
        await screens.close();
      },
    );
  }
}
