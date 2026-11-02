import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/study/src/current_card.dart';
import 'package:knowno/study/src/previous_card.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/session.dart';

import '../media/fakes.dart';

final _fixtures =
    (jsonDecode(
      File('../supabase/fixtures/card-frame/conversion.json')
          .readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>().where(
      (fixture) => fixture['cells'] != null,
    );

List<Content> _blocks(Object? blocks) => decodeContent(jsonEncode(blocks));

/// Whether a fixture's stored 칸 hold a blank, read from their JSON alone so
/// the test's choice of case is not the code under test.
bool _holdsBlank(Map<String, Object?> fixture) =>
    (fixture['cells'] as List<Object?>).cast<Map<String, Object?>>().any(
      (cell) => switch (cell) {
        {'type': 'cloze' || 'table'} => true,
        {'type': 'image', 'payload': {'boxes': final List<Object?> boxes}} =>
          boxes.isNotEmpty,
        _ => false,
      },
    );

/// The card a fixture stores in the frame.
Card _framed(Map<String, Object?> fixture) {
  final cells = decodeCells(jsonEncode(fixture['cells']));
  final sides = sidesOf(cells);
  return _card(sides.front, sides.back, cells: cells);
}

/// The card a fixture stores in two sides, as no migrated device has it yet.
Card _earlier(Map<String, Object?> fixture) =>
    _card(_blocks(fixture['front']), _blocks(fixture['back']));

Card _card(List<Content> front, List<Content> back, {List<Cell>? cells}) =>
    Card(
      id: const CardId('card'),
      deckId: const DeckId('deck'),
      front: front,
      back: back,
      cardKey: CardKey.fromFront(plainText(front)),
      source: CardSource.manual,
      createdAt: DateTime.utc(2026),
      updatedAt: DateTime.utc(2026),
      cells: cells,
    );

Future<void> _pump(
  WidgetTester tester,
  Widget card, {
  AudioPlayback? playback,
}) async {
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        mediaStoreProvider.overrideWithValue(
          MediaStore(
            db,
            FakeMediaServer(),
            directory: unusedMediaDirectory,
            clock: DateTime.now,
            newId: () => 'media',
          ),
        ),
        if (playback != null) audioPlaybackProvider.overrideWithValue(playback),
      ],
      child: MaterialApp(
        theme: lightTheme,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        locale: const Locale('en'),
        home: Scaffold(body: SizedBox(height: 400, child: card)),
      ),
    ),
  );
  await tester.pump();
}

Widget _current(Card card, {bool autoplay = false}) => CurrentCard(
  card: card,
  autoplay: autoplay,
  onAnswer: (_) {},
  onGuide: () {},
);

Widget _previous(Card card) => PreviousCardView(
  card: PreviousCard(
    position: 0,
    card: card,
    answer: Answer.know,
    changed: false,
  ),
  onRedecide: (_) {},
);

/// The texts of [blocks].
Iterable<String> _texts(List<Content> blocks) =>
    blocks.whereType<TextContent>().map((block) => block.text);

/// The label on the card's semantics node.
String _label(WidgetTester tester, Type card) => tester
    .getSemantics(
      find
          .descendant(
            of: find.byType(card),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is Semantics && widget.properties.label != null,
            ),
          )
          .first,
    )
    .label;

void main() {
  testWidgets('a card\'s text is Pretendard, never Jua', (tester) async {
    await _pump(tester, _current(_framed(_fixtures.first)));

    final drawn = tester.widgetList<RichText>(
      find.descendant(
        of: find.byType(CurrentCard),
        matching: find.byType(RichText),
      ),
    );
    // Control: the card's text was found, so the checks below read it.
    expect(
      drawn.where((text) => text.text.toPlainText().trim().isNotEmpty),
      isNotEmpty,
    );
    for (final text in drawn) {
      final style = (text.text as TextSpan).style!;
      expect(style.fontFamily, appFontFamily);
      expect(style.fontFamilyFallback, isNull);
    }
  });

  for (final fixture in _fixtures) {
    final name = fixture['name'] as String;
    final framed = _framed(fixture);
    final cells = framed.cells!;

    testWidgets('study draws a framed card: $name', (tester) async {
      await _pump(tester, _current(framed));
      expect(find.byType(CurrentCard), findsOneWidget);
      expect(find.textContaining('cannot show'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    if (_holdsBlank(fixture)) {
      for (final (kind, card) in [
        ('framed', framed),
        ('in two sides', _earlier(fixture)),
      ]) {
        testWidgets('whole and in place, the added parts after the answer '
            'alone, $kind: $name', (tester) async {
          final added = _texts(sidesOf(cells).back);

          await _pump(tester, _current(card));
          expect(find.byType(WholeCardView), findsOneWidget);
          expect(find.byType(SplitCard), findsNothing);
          for (final text in added) {
            expect(find.text(text), findsNothing, reason: 'at the prompt');
          }
          for (final text in _texts(sidesOf(cells).front)) {
            expect(find.text(text), findsOneWidget, reason: 'its front');
          }

          await _pump(tester, _previous(card));
          expect(find.byType(WholeCardView), findsOneWidget);
          expect(find.byType(SplitCard), findsNothing);
          for (final text in added) {
            expect(find.text(text), findsOneWidget, reason: 'its back');
          }
        });
      }
    } else {
      for (final (kind, card) in [
        ('framed', framed),
        ('in two sides', _earlier(fixture)),
      ]) {
        testWidgets('split, the same blocks on each side, $kind: $name', (
          tester,
        ) async {
          List<List<Content>> drawn() => [
            for (final view in tester.widgetList<ContentView>(
              find.byType(ContentView),
            ))
              view.blocks,
          ];

          await _pump(tester, _current(card));
          expect(find.byType(WholeCardView), findsNothing);
          expect(drawn(), [card.front]);

          // The previous card draws the front over the back (ADR 0151).
          await _pump(tester, _previous(card));
          expect(find.byType(WholeCardView), findsNothing);
          expect(drawn(), [card.front, card.back]);
        });
      }
    }
  }

  test('the fixtures hold a whole card and a split card', () {
    expect(_fixtures.map(_holdsBlank), containsAll([true, false]));
  });

  group('a card of a 글 and a blank', () {
    const cloze = ClozeContent('___ is red.', ['Rose']);
    const cells = [
      BlankCell(cloze),
      TextCell(front: 'Colour', back: 'A flower.'),
    ];
    final card = _card(sidesOf(cells).front, sidesOf(cells).back, cells: cells);

    testWidgets('a screen reader reads each blank as blank before the answer '
        'and filled after, the added part after its first', (tester) async {
      final semantics = tester.ensureSemantics();

      await _pump(tester, _current(card));
      expect(_label(tester, CurrentCard), contains('blank is red.. Colour'));
      expect(_label(tester, CurrentCard), isNot(contains('Rose')));
      expect(_label(tester, CurrentCard), isNot(contains('A flower.')));

      await _pump(tester, _previous(card));
      expect(
        _label(tester, PreviousCardView),
        contains('Rose is red.. Colour. A flower.'),
      );
      semantics.dispose();
    });

    testWidgets('the sheet shows every 칸 revealed and names no side', (
      tester,
    ) async {
      await _pump(tester, _previous(card));
      await tester.tap(find.byType(PreviousCardView));
      await tester.pumpAndSettle();

      final sheet = find.byType(BottomSheet);
      expect(
        find.descendant(of: sheet, matching: find.text('A flower.')),
        findsOneWidget,
      );
      expect(find.text('Front'), findsNothing);
      expect(find.text('Back'), findsNothing);
    });
  });

  group('a card of two sounds', () {
    const front = AudioContent(
      media: MediaId('front-sound'),
      duration: Duration(seconds: 1),
    );
    const back = AudioContent(
      media: MediaId('back-sound'),
      duration: Duration(seconds: 1),
    );

    for (final (name, cells) in [
      (
        'split',
        const <Cell>[
          PlacedCell(back, CellSide.back),
          PlacedCell(front, CellSide.front),
        ],
      ),
      (
        'whole',
        const <Cell>[
          BlankCell(ClozeContent('___ is red.', ['Rose'])),
          PlacedCell(back, CellSide.back),
          PlacedCell(front, CellSide.front),
        ],
      ),
    ]) {
      testWidgets('autoplay plays the first sound placed on the front, $name', (
        tester,
      ) async {
        final played = FakeAudioPlayback();
        final sides = sidesOf(cells);
        await _pump(
          tester,
          _current(
            _card(sides.front, sides.back, cells: cells),
            autoplay: true,
          ),
          playback: played,
        );
        await tester.pump();
        expect(played.plays, [front.media]);
      });
    }

    testWidgets('a sound on the back alone neither plays nor shows at the '
        'prompt', (tester) async {
      final played = FakeAudioPlayback();
      const cells = <Cell>[
        BlankCell(ClozeContent('___ is red.', ['Rose'])),
        PlacedCell(back, CellSide.back),
      ];
      final sides = sidesOf(cells);
      await _pump(
        tester,
        _current(_card(sides.front, sides.back, cells: cells), autoplay: true),
        playback: played,
      );
      await tester.pump();
      expect(played.plays, isEmpty);
      expect(find.byTooltip('Play sound'), findsNothing);

      // Control: the same card shows it once answered.
      await _pump(
        tester,
        _previous(_card(sides.front, sides.back, cells: cells)),
        playback: played,
      );
      expect(find.byTooltip('Play sound'), findsOneWidget);
    });
  });
}
