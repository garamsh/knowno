import 'dart:io';
import 'dart:typed_data';

import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart' show FontLoader;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/word_break.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/src/current_card.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/previous_card.dart';
import 'package:knowno/study/src/providers.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/study_repository.dart';
import 'package:knowno/study/src/study_screen.dart';
import 'package:knowno/study/src/study_style.dart';

import '../deck/whole_cards.dart';
import 'fixtures.dart';
import 'study_storage.dart';

// Pretendard is loaded here, in a file of its own: a loaded font stays
// registered for the rest of the file, and the other study tests measure
// contrast with the test font's solid glyphs.

/// A phone's width, as the study screen's tests use.
const _phoneWidth = 390.0;

/// About the height the study screen gives the current card, with its
/// guide's row, on a 390 by 844 phone.
const _cardHeight = 380.0;

Card _card(String front) => Card(
  id: const CardId('c'),
  deckId: const DeckId('d'),
  front: [TextContent(front)],
  back: const [TextContent('back')],
  cardKey: CardKey.fromFront(front),
  source: CardSource.manual,
  createdAt: DateTime.utc(2026, 10, 16),
  updatedAt: DateTime.utc(2026, 10, 16),
);

/// The widest word of [text] in [style].
double _widest(String text, TextStyle style) => text
    .split(' ')
    .map(
      (word) => (TextPainter(
        text: TextSpan(text: word, style: style),
        textDirection: TextDirection.ltr,
      )..layout()).width,
    )
    .reduce((a, b) => a > b ? a : b);

/// Whether [text] fits whole a box [width] wide and [height] high in
/// [style], its widest word inside [width] and its lines broken only between
/// words.
bool _fits(String text, TextStyle style, double width, double height) {
  final painter = TextPainter(
    text: TextSpan(text: keepWords(text), style: style),
    textDirection: TextDirection.ltr,
  )..layout(maxWidth: width);
  final fits = _widest(text, style) <= width && painter.height <= height;
  painter.dispose();
  return fits;
}

/// A Korean paragraph of at least [length] characters, ending at a word.
String _korean(int length) {
  const text =
      '광합성은 식물이 빛 에너지를 이용해 이산화탄소와 물로부터 포도당을 만드는 과정이다. '
      '엽록체의 틸라코이드 막에서 일어나는 명반응은 빛을 흡수해 물을 분해하고 산소를 내보내며 '
      'ATP와 NADPH를 만든다. 스트로마에서 일어나는 캘빈 회로는 이 에너지를 써서 이산화탄소를 '
      '고정하고 포도당을 합성한다. 빛의 세기, 이산화탄소 농도, 온도는 광합성 속도를 결정하는 '
      '주요 요인이며, 이 중 가장 부족한 요인이 전체 속도를 제한한다. 이를 최소량의 법칙이라고 '
      '부른다. 따라서 온실에서 작물을 키울 때는 빛을 충분히 비추는 것만으로는 부족하고, '
      '이산화탄소를 공급하고 온도를 알맞게 유지해야 수확량이 늘어난다. 또한 식물은 낮에 만든 '
      '포도당을 녹말로 바꾸어 저장하고, 밤에는 이를 다시 분해해 호흡에 쓴다. '
      '잎의 기공은 이산화탄소를 들이고 수증기를 내보내는 통로인데, 날이 가물면 기공이 닫혀 '
      '광합성이 줄어든다.';
  final end = text.indexOf(' ', length);
  return end < 0 ? text : text.substring(0, end);
}

/// The paragraph under [of] that draws [text], the joiners `keepWords` sets
/// left out.
RenderParagraph _drawn(WidgetTester tester, Finder of, String text) =>
    tester.renderObject<RenderParagraph>(
      find
          .descendant(
            of: of,
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is RichText &&
                  widget.text.toPlainText().replaceAll('\u2060', '') == text,
            ),
          )
          .last,
    );

/// Where each line of [paragraph] ends, as offsets into its text.
List<int> _lineEnds(RenderParagraph paragraph) {
  final plain = paragraph.text.toPlainText();
  final lines = TextPainter(
    text: paragraph.text,
    textDirection: paragraph.textDirection,
    textScaler: paragraph.textScaler,
  )..layout(maxWidth: paragraph.size.width);
  final ends = <int>[];
  for (var offset = 0; offset < plain.length;) {
    offset = lines.getLineBoundary(TextPosition(offset: offset)).end;
    ends.add(offset);
  }
  lines.dispose();
  return ends;
}

/// Schedules every review one day out, at once.
class _InstantScheduler implements Scheduler {
  @override
  Future<CardState?> fold(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<double> retrievability(CardState state, DateTime at) =>
      throw UnimplementedError('sessions read no recall');

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) async => CardState(
    stability: 1,
    difficulty: 5,
    lastReview: at,
    due: at.add(const Duration(days: 1)),
  );
}

void main() {
  setUpAll(() async {
    // Pretendard's own widths; the test font draws every glyph an em wide.
    final pretendard = FontLoader(appFontFamily);
    for (final weight in [
      'Regular',
      'Medium',
      'SemiBold',
      'Bold',
      'ExtraBold',
    ]) {
      pretendard.addFont(
        Future.value(
          ByteData.sublistView(
            File('assets/fonts/Pretendard-$weight.otf').readAsBytesSync(),
          ),
        ),
      );
    }
    await pretendard.load();
  });

  testWidgets(
    'a front starts at the size its length gives, smaller as it grows, takes '
    'the largest step from there it fits whole and never one below the body '
    'size, centred above the body size and start-aligned at it, scrolling '
    'with a fading edge past it, never cut and broken only between words '
    '(ADR 0123, #635)',
    (tester) async {
      tester.view.physicalSize = const Size(_phoneWidth, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      const steps = [
        AppType.front,
        AppType.deckName,
        AppType.back,
        AppType.cardBody,
      ];
      final seen = <double>{};
      var fitAtFloor = false;
      var scrolled = false;
      // Each front and the size it takes: the longer, the smaller.
      for (final (front, taken) in [
        ('meticulous', AppType.front),
        (_korean(25), AppType.deckName),
        (_korean(60), AppType.back),
        (_korean(110), AppType.cardBody),
        (_korean(300), AppType.cardBody),
      ]) {
        await tester.pumpWidget(
          MaterialApp(
            theme: lightTheme,
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: StudyStyle.cardMargin,
                ),
                // About the height the study screen gives the card.
                child: Center(
                  child: SizedBox(
                    height: _cardHeight,
                    child: CurrentCard(
                      key: ValueKey(front),
                      card: _card(front),
                      onAnswer: (_) {},
                      onGuide: () {},
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        // The scroll's measure lands after the first frame.
        await tester.pumpAndSettle();
        final face = find
            .descendant(
              of: find.byType(CurrentCard),
              matching: find.byType(GestureDetector),
            )
            .first;
        final card = tester.getRect(face);
        final width = card.width - StudyStyle.cardPadding * 2;
        final height = card.height - StudyStyle.cardPadding * 2;
        final paragraph = _drawn(tester, face, front);

        // The first step from its length's start it fits whole, or the last.
        final size = paragraph.text.style!.fontSize!;
        final start = StudyStyle.frontStart(
          faceLength(drawnCellsOf(_card(front))),
        );
        final from = steps.skipWhile((step) => step != start).toList();
        final step = from
            .take(from.length - 1)
            .firstWhere(
              (step) => _fits(front, step, width, height),
              orElse: () => from.last,
            );
        expect(size, step.fontSize, reason: front);
        expect(size, taken.fontSize, reason: front);
        // Control: but the first and the last, each fits whole one step
        // larger, so its length, not the fit, made it smaller.
        final above = steps.indexOf(taken) - 1;
        if (above >= 0 && front != _korean(300)) {
          expect(
            _fits(front, steps[above], width, height),
            isTrue,
            reason: front,
          );
        }
        expect(size, greaterThanOrEqualTo(AppType.body.fontSize!));
        seen.add(size);
        // Every line laid out, broken only at a space.
        expect(paragraph.maxLines, isNull);
        expect(paragraph.didExceedMaxLines, isFalse);
        final plain = paragraph.text.toPlainText();
        final ends = _lineEnds(paragraph);
        for (final end in ends.take(ends.length - 1)) {
          expect(
            plain[end - 1] == ' ' || plain[end] == ' ',
            isTrue,
            reason: 'a break at $end in "$front"',
          );
        }
        final fade = find.byKey(const Key('cardScrollFade'));
        if (size == AppType.cardBody.fontSize &&
            paragraph.size.height <= height) {
          // Start-aligned, whole in the card, with no fade.
          expect(paragraph.textAlign, TextAlign.start, reason: front);
          expect(fade, findsNothing);
          fitAtFloor = true;
        } else if (size == AppType.cardBody.fontSize) {
          // Start-aligned, and taller than the card: it scrolls, its edge
          // fading until its last line is in the card.
          expect(paragraph.textAlign, TextAlign.start, reason: front);
          expect(fade, findsOneWidget);
          scrolled = true;
          await tester.drag(face, const Offset(0, -2000));
          await tester.pumpAndSettle();
          final bottom = paragraph
              .localToGlobal(Offset(0, paragraph.size.height))
              .dy;
          expect(bottom, lessThanOrEqualTo(card.bottom));
          expect(fade, findsNothing);
        } else {
          // Centred on the card, whole inside it, with no fade.
          expect(paragraph.textAlign, TextAlign.center, reason: front);
          expect(paragraph.size.height, lessThanOrEqualTo(height));
          expect(
            paragraph.localToGlobal(paragraph.size.center(Offset.zero)),
            offsetMoreOrLessEquals(card.center, epsilon: 1),
            reason: front,
          );
          expect(fade, findsNothing);
        }
      }
      // Control: the fronts took every step, so each branch above ran.
      expect(seen, {for (final step in steps) step.fontSize});
      expect((fitAtFloor, scrolled), (true, true));
    },
  );

  testWidgets(
    'a 빈칸 card of nine blanks, each counted as its box, starts at the back '
    'size, not the front\'s, each blank a box on the hatch two ems wide, '
    'each 모음 line laid out whole (#635)',
    (tester) async {
      tester.view.physicalSize = const Size(_phoneWidth, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      const b = clozeBlank;
      const cloze = ClozeContent(
        '양성모음: $b, $b, $b, $b\n음성모음: $b, $b, $b, $b\n중성모음: $b',
        ['ㅏ', 'ㅗ', 'ㅑ', 'ㅛ', 'ㅓ', 'ㅜ', 'ㅕ', 'ㅠ', 'ㅣ'],
      );
      final card = Card(
        id: const CardId('c'),
        deckId: const DeckId('d'),
        front: const [cloze],
        back: const [],
        cardKey: CardKey.fromFront('모음'),
        source: CardSource.manual,
        createdAt: DateTime.utc(2026, 11, 3),
        updatedAt: DateTime.utc(2026, 11, 3),
      );
      // Setup: it is drawn whole, and its length counts each blank as its
      // box, which puts it past the front's and the next step's lengths.
      final cells = drawnCellsOf(card);
      expect(isDrawnWhole(cells), isTrue);
      expect(faceLength(cells), 50);
      await tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          locale: const Locale('ko'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: StudyStyle.cardMargin,
              ),
              child: Center(
                child: SizedBox(
                  height: _cardHeight,
                  child: CurrentCard(
                    card: card,
                    onAnswer: (_) {},
                    onGuide: () {},
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final sentence = tester.widget<RichText>(
        find.descendant(
          of: find.byType(CurrentCard),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is RichText && widget.text.toPlainText().contains('양'),
          ),
        ),
      );
      expect(sentence.text.style!.fontSize, AppType.back.fontSize);
      expect(boxedBlanksUnder(find.byType(CurrentCard)), 9);
      final boxes = find.byKey(const Key('hatchedBlank'));
      for (final box in tester.renderObjectList<RenderBox>(boxes)) {
        expect(box.size.width, AppType.back.fontSize! * blankEms);
      }
      // Each 모음 line holds its blanks on one row: four, four, then one.
      final rows = <double, int>{};
      for (final box in tester.renderObjectList<RenderBox>(boxes)) {
        final top = box.localToGlobal(Offset.zero).dy;
        rows.update(top, (count) => count + 1, ifAbsent: () => 1);
      }
      expect(rows.values.toList(), [4, 4, 1]);
    },
  );

  testWidgets(
    'a long back shows whole at the previous card\'s back size, on a 390 by 844 phone at the default text scale',
    (tester) async {
      const longBack = '(결과·수익 등을) 내다, 산출하다; 양도하다';
      // An iPhone of that size: its status bar and home indicator.
      tester.view.physicalSize = const Size(_phoneWidth, 844);
      tester.view.devicePixelRatio = 1;
      tester.view.padding = const FakeViewPadding(top: 47, bottom: 34);
      addTearDown(tester.view.reset);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final decks = DeckRepository(
        db,
        clock: () => DateTime.utc(2026, 9, 1),
        newId: () => 'id${ids++}',
      );
      final deck = (await tester.runAsync(() async {
        final deck = await decks.createDeck('English');
        await decks.addCard(
          deck.id,
          front: const [TextContent('yield')],
          back: const [TextContent(longBack)],
        );
        return deck;
      }))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(decks),
            studyRepositoryProvider.overrideWithValue(
              StudyRepository(db, newId: () => 'review${ids++}'),
            ),
            schedulerProvider.overrideWithValue(_InstantScheduler()),
            studyClockProvider.overrideWithValue(
              () => DateTime.utc(2026, 10, 14, 9),
            ),
            studyZoneProvider.overrideWithValue((_) => Duration.zero),
            studyRandomProvider.overrideWithValue((_) => FirstDraw()),
            studyStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            theme: lightTheme,
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: StudyScreen(decks: DeckSelection(deck.id)),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // Answered "모른다", the card is shown again at once, under itself as
      // the previous card, which shows the back whole, uncut.
      await tester.timedDrag(
        find.byType(CurrentCard),
        const Offset(-200, 0),
        const Duration(seconds: 1),
      );
      await tester.pumpAndSettle();
      final previous = find.byType(PreviousCardView);
      expect(previous, findsOneWidget);
      final kept = _drawn(tester, previous, longBack);
      expect(kept.text.style!.fontSize, StudyStyle.previousBack.fontSize);
      expect(kept.didExceedMaxLines, isFalse);
      // Inside the card's width, at full size: the card gives it the
      // whole width, under the front, rather than a half.
      expect(
        kept.size.width,
        lessThanOrEqualTo(
          tester.getSize(previous).width - 2 * StudyStyle.cardPadding,
        ),
      );
      expect(
        kept.size.width,
        greaterThan((tester.getSize(previous).width) / 2),
      );
      expect(
        tester.getSize(previous),
        tester.getSize(
          find
              .descendant(
                of: find.byType(CurrentCard),
                matching: find.byType(GestureDetector),
              )
              .first,
        ),
      );
    },
  );
  testWidgets(
    'the previous card starts its front at the size its length gives, a '
    'front over its back never above the title size, and steps it down '
    'until the face fits whole (#635)',
    (tester) async {
      tester.view.physicalSize = const Size(_phoneWidth, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      const width = _phoneWidth - 2 * StudyStyle.cardMargin;
      const inner = width - 2 * StudyStyle.cardPadding;
      const innerHeight = _cardHeight - 2 * StudyStyle.cardPadding;
      const b = clozeBlank;
      const owner = ClozeContent(
        '양성모음: $b, $b, $b, $b\n음성모음: $b, $b, $b, $b\n중성모음: $b',
        ['ㅏ', 'ㅗ', 'ㅑ', 'ㅛ', 'ㅓ', 'ㅜ', 'ㅕ', 'ㅠ', 'ㅣ'],
      );
      Future<double> frontSize(
        List<Content> front,
        List<Content> back,
        String drawn,
      ) async {
        await tester.pumpWidget(
          MaterialApp(
            theme: lightTheme,
            locale: const Locale('ko'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: Scaffold(
              body: Center(
                child: SizedBox(
                  width: width,
                  height: _cardHeight,
                  child: GradedCard(
                    cells: cellsToDraw(front, back),
                    front: front,
                    back: back,
                    answer: Answer.dontKnow,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        final paragraph = tester.renderObject<RenderParagraph>(
          find
              .descendant(
                of: find.byType(GradedCard),
                matching: find.byWidgetPredicate(
                  (widget) =>
                      widget is RichText &&
                      widget.text
                          .toPlainText()
                          .replaceAll('\u2060', '')
                          .contains(drawn),
                ),
              )
              .first,
        );
        return paragraph.text.style!.fontSize!;
      }

      // A short front over its back keeps the title size, though the
      // current card's front size starts it and fits.
      expect(StudyStyle.frontStart('광합성'.length), AppType.front);
      expect(
        await frontSize(
          const [TextContent('광합성')],
          const [TextContent('빛')],
          '광합성',
        ),
        AppType.deckName.fontSize,
      );

      // A sentence starts at the back size, though it fits whole at the
      // title size over its back.
      final sentence = _korean(58);
      expect(_fits(sentence, AppType.deckName, inner, innerHeight / 2), isTrue);
      expect(
        await frontSize(
          [TextContent(sentence)],
          const [TextContent('광합성')],
          sentence.substring(0, 4),
        ),
        AppType.back.fontSize,
      );

      // A front that fits alone at its starting size steps down to the body
      // size over a long back, which then scrolls.
      final front = _korean(30);
      expect(StudyStyle.previousFrontStart(front.length), AppType.deckName);
      expect(_fits(front, AppType.deckName, inner, innerHeight / 2), isTrue);
      expect(
        await frontSize(
          [TextContent(front)],
          [TextContent(_korean(300))],
          front.substring(0, 4),
        ),
        AppType.cardBody.fontSize,
      );
      expect(find.byKey(const Key('cardScrollFade')), findsOneWidget);

      // The owner's 빈칸 card, revealed, at the size its length gives, as
      // the current card.
      expect(faceLength(cellsToDraw(const [owner], const [])), 50);
      expect(
        await frontSize(const [owner], const [], '양'),
        AppType.back.fontSize,
      );
    },
  );
}
