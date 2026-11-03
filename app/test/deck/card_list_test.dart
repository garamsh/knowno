import 'package:flutter/material.dart';
import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:uuid/uuid.dart';

import '../design/harness.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';

import 'whole_cards.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    'a row draws a card converted from its sides: a cloze whole, its blanks '
    "on the hatch, and a text card's back in a hatched box",
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('en'),
          home: const Scaffold(
            body: Column(
              children: [
                CardBackRow(
                  key: Key('whole'),
                  front: [
                    ClozeContent('The capital of France is ___', ['Paris']),
                  ],
                  back: [TextContent('The capital of France is Paris')],
                ),
                CardBackRow(
                  key: Key('plain'),
                  front: [TextContent('Chat')],
                  back: [TextContent('cat')],
                ),
              ],
            ),
          ),
        ),
      );

      Iterable<HatchDecoration> hatchOver(Finder of) => tester
          .widgetList<DecoratedBox>(
            find.ancestor(of: of, matching: find.byType(DecoratedBox)),
          )
          .map((box) => box.decoration)
          .whereType<HatchDecoration>();
      final whole = find.byKey(const Key('whole'));
      expect(hatchedBlanksUnder(whole), ['Paris']);
      expect(
        find.descendant(of: whole, matching: shownText('cat')),
        findsNothing,
      );
      // Control: the text card keeps its back, in a box on the hatch.
      final plain = find.byKey(const Key('plain'));
      expect(hatchedBlanksUnder(plain), isEmpty);
      expect(hatchOver(shownText('cat')), hasLength(1));
      expect(hatchOver(shownText('Chat')), isEmpty);
    },
  );

  testWidgets(
    'a row given nothing to open is no button and has no hint, read as its '
    'front then its back, where one given a callback is a button that edits',
    (tester) async {
      final handle = tester.ensureSemantics();
      Future<void> pump(VoidCallback? onOpen) => tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('en'),
          home: Scaffold(
            body: CardBackRow(
              front: const [TextContent('Chat')],
              back: const [TextContent('cat')],
              onOpen: onOpen,
            ),
          ),
        ),
      );
      final row = find.bySemanticsLabel('Chat, back cat');

      await pump(null);
      expect(
        tester.getSemantics(row),
        isSemantics(
          label: 'Chat, back cat',
          isButton: false,
          hasTapAction: false,
        ),
      );
      expect(
        find.descendant(
          of: find.byType(CardBackRow),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );

      // Control: given a callback, the same row is a button that edits.
      var opened = 0;
      await pump(() => opened++);
      expect(
        tester.getSemantics(row),
        isSemantics(
          label: 'Chat, back cat',
          isButton: true,
          hasTapAction: true,
          onTapHint: 'Edit card',
        ),
      );
      await tester.tap(find.byType(CardBackRow));
      expect(opened, 1);
      handle.dispose();
    },
  );

  testWidgets(
    'a deck row draws a long Korean cloze sentence on a 390 wide phone cut at '
    'two lines, inside the row and broken only between words, its blanks on '
    'the hatch (#477, #629)',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844) * 3;
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          theme: lightTheme,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          locale: const Locale('ko'),
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(AppSpace.s16),
              children: [
                CardBackRow(
                  front: const [
                    ClozeContent(
                      '3인칭 재귀칭은 높임에서 $clozeBlank 를 쓰고 예사에서는 '
                      '$clozeBlank 를 쓰며 낮춤에서는 저를 쓰는데 이는 문장의 '
                      '주어를 다시 가리킬 때 쓰인다',
                      ['당신', '자기'],
                    ),
                  ],
                  back: const [],
                  onOpen: () {},
                ),
              ],
            ),
          ),
        ),
      );

      final row = find.byType(CardBackRow);
      final paragraph = tester.renderObject<RenderParagraph>(
        find.descendant(of: row, matching: find.byType(RichText)),
      );
      final plain = paragraph.text.toPlainText();
      // The sentence laid out alone at the paragraph's width: its full
      // height and its lines.
      final whole = TextPainter(
        text: paragraph.text,
        textDirection: paragraph.textDirection,
        textScaler: paragraph.textScaler,
      )..layout(maxWidth: paragraph.size.width);
      addTearDown(whole.dispose);
      final ends = <int>[];
      for (var offset = 0; offset < plain.length;) {
        offset = whole.getLineBoundary(TextPosition(offset: offset)).end;
        ends.add(offset);
      }
      // It wraps past two lines at this width, so the cut is tested.
      expect(ends.length, greaterThan(2));
      // The row shows its first two lines, cut with an ellipsis.
      expect(paragraph.didExceedMaxLines, isTrue);
      expect(paragraph.size.height, lessThan(whole.height));
      expect(hatchedBlanksUnder(row), ['당신', '자기']);
      final text = tester.getRect(
        find.descendant(of: row, matching: find.byType(RichText)),
      );
      final bounds = tester.getRect(row);
      expect(text.top, greaterThanOrEqualTo(bounds.top));
      expect(text.bottom, lessThanOrEqualTo(bounds.bottom));
      bool space(String char) => char == ' ' || char == ' ';
      // The first line, the one the cut leaves whole, breaks between words.
      final end = ends.first;
      expect(
        space(plain[end - 1]) || space(plain[end]),
        isTrue,
        reason: 'a break at $end in "$plain"',
      );
    },
  );

  group('a whole card with a kept back', () {
    const cloze = ClozeContent('The capital is $clozeBlank', ['Paris']);
    const front = [cloze];
    const back = [TextContent('on the Seine')];

    Future<void> pump(WidgetTester tester, Widget row) => tester.pumpWidget(
      MaterialApp(
        theme: lightTheme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('en'),
        home: Scaffold(body: row),
      ),
    );

    testWidgets('its deck row shows the back on the hatch, and reads it after '
        'the answer', (tester) async {
      await pump(tester, CardBackRow(front: front, back: back, onOpen: () {}));
      expect(shownText('on the Seine'), findsOneWidget);
      expect(hatchedBlanksUnder(find.byType(CardBackRow)), ['Paris']);
      expect(
        find.bySemanticsLabel(
          'The capital is blank, back The capital is Paris. on the Seine',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a row draws the 칸 a framed card stores, a back in the 칸 it '
        'was written on', (tester) async {
      const cells = [
        BlankCell(cloze),
        TextCell(front: 'one'),
        TextCell(front: 'two', back: 'of two'),
      ];
      final sides = sidesOf(cells);
      await pump(
        tester,
        CardBackRow(front: sides.front, back: sides.back, cells: cells),
      );
      double top(String text) => tester.getTopLeft(shownText(text)).dy;
      expect(top('one'), lessThan(top('two')));
      expect(top('two'), lessThan(top('of two')));
    });
  });

  group('a card list row shows each kind whole, what study hides on the '
      'hatch (#629)', () {
    Future<void> pumpRow(
      WidgetTester tester,
      List<Cell> cells, {
      ThemeMode themeMode = ThemeMode.light,
      VoidCallback? onOpen,
    }) {
      final sides = sidesOf(cells);
      // A store whose files no test writes: a photo is drawn as its
      // fallback, which has the photo's frame.
      final media = MediaStore(
        AppDatabase(NativeDatabase.memory()),
        FakeMediaServer(),
        directory: unusedMediaDirectory,
        clock: DateTime.now,
        newId: const Uuid().v7,
      );
      return pumpComponent(
        tester,
        ProviderScope(
          overrides: [mediaStoreProvider.overrideWithValue(media)],
          // In a scroll view, as the card list lays its rows out: as tall
          // as their content.
          child: SingleChildScrollView(
            child: CardBackRow(
              front: sides.front,
              back: sides.back,
              cells: cells,
              onOpen: onOpen ?? () {},
            ),
          ),
        ),
        themeMode: themeMode,
      );
    }

    /// The hatched boxes [of] sits in.
    Iterable<HatchDecoration> hatchOver(WidgetTester tester, Finder of) =>
        tester
            .widgetList<DecoratedBox>(
              find.ancestor(of: of, matching: find.byType(DecoratedBox)),
            )
            .map((box) => box.decoration)
            .whereType<HatchDecoration>();

    for (final MapEntry(key: themeMode, value: colors) in themeModes.entries) {
      testWidgets('a 글 shows its front, then its back in a hatched box of '
          "the theme's hatch, in ${themeMode.name}", (tester) async {
        await pumpRow(tester, const [
          TextCell(front: '조선의 최고 법전은?', back: '경국대전'),
        ], themeMode: themeMode);
        final back = shownText('경국대전');
        expect(back, findsOneWidget);
        expect(hatchOver(tester, back).single.colors, colors);
        // Control: the shown part is not on the hatch.
        expect(hatchOver(tester, shownText('조선의 최고 법전은?')), isEmpty);
      });
    }

    testWidgets('a 단어 shows its word, then its meanings on the hatch', (
      tester,
    ) async {
      await pumpRow(tester, const [
        WordCell(
          term: 'ephemeral',
          senses: [CardSense(meaning: '덧없는')],
          ask: WordAsk.term,
        ),
      ]);
      expect(hatchOver(tester, shownText('덧없는')), hasLength(1));
      expect(hatchOver(tester, shownText('ephemeral')), isEmpty);
    });

    testWidgets('a 빈칸 shows its sentence with each blank filled on the '
        'hatch, none empty', (tester) async {
      await pumpRow(tester, const [
        BlankCell(
          ClozeContent('세종대왕은 $clozeBlank년에 $clozeBlank을 창제했다.', [
            '1443',
            '훈민정음',
          ]),
        ),
      ]);
      final row = find.byType(CardBackRow);
      expect(hatchedBlanksUnder(row), ['1443', '훈민정음']);
      expect(blanksUnder(row), isEmpty, reason: 'no blank empty or tinted');
    });

    testWidgets('a 표 shows its first three rows, its hidden cells on the '
        'hatch, and how many rows it leaves', (tester) async {
      await pumpRow(tester, const [
        BlankCell(
          TableContent(
            columns: ['왕', '업적'],
            rows: [
              ['태종', '호패법'],
              ['세종', '훈민정음'],
              ['세조', '직전법'],
              ['성종', '경국대전'],
              ['연산군', '무오사화'],
            ],
            blanks: [
              (row: 0, column: 1),
              (row: 1, column: 1),
              (row: 2, column: 1),
              (row: 3, column: 1),
              (row: 4, column: 1),
            ],
          ),
        ),
      ]);
      expect(hatchedBlanksUnder(find.byType(CardBackRow)), [
        '호패법',
        '훈민정음',
        '직전법',
      ]);
      expect(find.text('2 more rows'), findsOneWidget);
      expect(find.textContaining('성종'), findsNothing);
      // Control: a shown cell is drawn, off the hatch.
      expect(find.textContaining('태종'), findsOneWidget);
    });

    testWidgets('a 사진 draws its photo at the thumbnail height, each box on '
        'the hatch over it, and its answers on the hatch under it, the row no '
        'taller than the two', (tester) async {
      await pumpRow(tester, const [
        BlankCell(
          ImageContent(
            media: MediaId('m'),
            width: 3,
            height: 2,
            boxes: [
              ImageBox(id: 'a', x: 0.1, y: 0.1, w: 0.3, h: 0.2, answer: '한양'),
              ImageBox(id: 'b', x: 0.5, y: 0.6, w: 0.3, h: 0.2, answer: '개성'),
            ],
          ),
        ),
      ]);
      for (final id in ['a', 'b']) {
        final box = tester.widget<DecoratedBox>(
          find.descendant(
            of: find.byKey(ValueKey(('listed box', id))),
            matching: find.byType(DecoratedBox),
          ),
        );
        expect(box.decoration, isA<HatchDecoration>());
      }
      final answers = shownText('한양 · 개성');
      expect(answers, findsOneWidget);
      expect(hatchOver(tester, answers), hasLength(1));
      // The photo's frame: the thumbnail's height at the photo's 3:2.
      final frame = tester.getRect(
        find
            .ancestor(
              of: find.byKey(const ValueKey(('listed box', 'a'))),
              matching: find.byType(Stack),
            )
            .first,
      );
      expect(frame.height, AppSize.listedPhoto);
      expect(frame.width, AppSize.listedPhoto * 3 / 2);
      // The row holds the frame and the answers' box, and nothing taller.
      final box = tester.getRect(
        find.ancestor(of: answers, matching: find.byType(DecoratedBox)).first,
      );
      expect(
        tester.getSize(find.byType(CardBackRow)).height,
        // A row alone keeps the gap after it.
        frame.height +
            AppSpace.s8 +
            box.height +
            2 * AppSpace.s12 +
            AppSpace.rowGap,
      );
    });

    testWidgets('a long card is cut at two lines shown and three on the '
        'hatch, each with an ellipsis, and a tap still opens it', (
      tester,
    ) async {
      var opened = 0;
      final long = List.filled(60, '낱말').join(' ');
      await pumpRow(tester, [
        TextCell(front: '앞 $long', back: '뒤 $long'),
      ], onOpen: () => opened++);
      RenderParagraph paragraph(String start) => tester
          .renderObjectList<RenderParagraph>(
            find.descendant(
              of: find.byType(CardBackRow),
              matching: find.byType(RichText),
            ),
          )
          .firstWhere((text) => text.text.toPlainText().startsWith(start));
      for (final (start, lines) in [('앞', 2), ('뒤', 3)]) {
        final text = paragraph(start);
        expect(text.maxLines, lines, reason: start);
        expect(text.overflow, TextOverflow.ellipsis, reason: start);
        expect(text.didExceedMaxLines, isTrue, reason: start);
      }
      await tester.tap(find.byType(CardBackRow));
      expect(opened, 1);
    });
  });
}
