import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_preview.dart';
import 'package:knowno/deck/src/card_template.dart';
import 'package:knowno/deck/src/content.dart' show hasBlank, mediaOf;
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/media/media.dart';

import '../media/fakes.dart';
import 'frame_fixtures.dart';

List<Map<String, Object?>> _cases(String file) {
  final path = '../supabase/fixtures/card-frame/$file';
  return migratedCases(
    (jsonDecode(File(path).readAsStringSync()) as List<Object?>)
        .cast<Map<String, Object?>>(),
  );
}

List<Content> _blocks(Object? blocks) => decodeContent(jsonEncode(blocks));

void main() {
  final conversions = _cases('conversion.json');

  test('the fixtures hold each placement, O2, O3 and the unknown blocks', () {
    final names = [for (final c in conversions) c['name'] as String];
    for (final part in [
      for (var n = 1; n <= 7; n++) 'placement $n',
      'O2',
      'O3',
      'back blank beside a front blank',
      'no blank',
      'leaves the card',
    ]) {
      expect(
        names.where((name) => name.contains(part)),
        isNotEmpty,
        reason: part,
      );
    }
  });

  group('cellsFromSides', () {
    for (final fixture in conversions) {
      test(fixture['name'] as String, () {
        final expected = fixture['cells'];
        expect(
          cellsFromSides(_blocks(fixture['front']), _blocks(fixture['back'])),
          expected == null ? isNull : decodeCells(jsonEncode(expected)),
        );
      });
    }

    test('keeps a block id through a conversion', () {
      final cells = cellsFromSides(
        [const TextContent('a', id: 'f')],
        [const TextContent('b', id: 'g')],
      );
      expect(cells!.single.id, 'f');
    });
  });

  group('encodeCells', () {
    for (final fixture in conversions.where((c) => c['cells'] != null)) {
      test('round-trips: ${fixture['name']}', () {
        final cells = decodeCells(jsonEncode(fixture['cells']));
        expect(decodeCells(encodeCells(cells, newId: () => 'new')), cells);
      });
    }

    test('a 칸 keeps its id, and one with none takes a new id', () {
      const cells = [
        TextCell(front: 'a', back: 'b', id: 'kept'),
        BlankCell(ClozeContent('{{c1::x}}')),
        PlacedCell(
          AudioContent(media: MediaId('m'), duration: Duration(seconds: 1)),
          CellSide.back,
        ),
      ];
      var next = 0;
      final stored = (jsonDecode(
        encodeCells(cells, newId: () => 'n${next++}'),
      ) as List<Object?>).cast<Map<String, Object?>>();
      expect([for (final block in stored) block['id']], ['kept', 'n0', 'n1']);
      expect([for (final block in stored) block['v']], [3, 2, 2]);
      expect((stored.last['payload'] as Map)['side'], 'back');
      expect(
        (stored.last['payload'] as Map)['media'],
        'm',
        reason: 'the payload is the block\'s own',
      );
    });

    test('a 사진 with a box stores no side, and one without stores its side', () {
      const boxed = ImageContent(
        media: MediaId('m'),
        width: 1,
        height: 1,
        boxes: [ImageBox(id: 'x', x: 0, y: 0, w: 1, h: 1)],
      );
      const plain = ImageContent(media: MediaId('m'), width: 1, height: 1);
      final stored = (jsonDecode(
        encodeCells(const [
          BlankCell(boxed, id: 'a'),
          PlacedCell(plain, CellSide.front, id: 'b'),
        ], newId: () => 'new'),
      ) as List<Object?>).cast<Map<String, Object?>>();
      expect((stored.first['payload'] as Map).containsKey('side'), isFalse);
      expect((stored.last['payload'] as Map)['side'], 'front');
    });

    test('a 칸 this build does not know is written as it was stored', () {
      final stored = [
        {
          'type': 'video',
          'v': 9,
          'id': 'v',
          'payload': {'media': 'm'},
        },
      ];
      expect(
        jsonDecode(
          encodeCells(decodeCells(jsonEncode(stored)), newId: () => 'new'),
        ),
        stored,
      );
    });
  });

  group('the card key', () {
    for (final fixture in conversions) {
      final front = _blocks(fixture['front']);
      final name = fixture['name'] as String;
      final movedAsTheyWere =
          fixture['cells'] != null &&
          !name.contains('placement 5') &&
          !(name.contains('placement 6') && !front.any(hasBlank));
      if (!movedAsTheyWere) continue;
      test('equals the stored key: $name', () {
        final cells = decodeCells(jsonEncode(fixture['cells']));
        expect(frameKey(cells), CardKey.fromFront(plainText(front)));
      });
    }

    test('holds a back blank that became a question', () {
      expect(
        frameKey(
          cellsFromSides(
            [const TextContent('Fill')],
            [const ClozeContent('{{c1::Rose}} red')],
          )!,
        ),
        CardKey.fromFront('Fill\nRose red'),
      );
    });
  });

  group('validity', () {
    for (final fixture in _cases('validity.json')) {
      test(fixture['name'] as String, () {
        final blocks = jsonEncode(fixture['blocks']);
        final problem = fixture['problem'];
        if (problem == 'shape') {
          expect(() => decodeCells(blocks), throwsFormatException);
          return;
        }
        expect(frameProblem(decodeCells(blocks)), switch (problem) {
          'nothing_before' => FrameProblem.nothingBefore,
          'nothing_added' => FrameProblem.nothingAdded,
          _ => isNull,
        });
      });
    }

    test('a 글 made with both parts empty is an empty text', () {
      expect(
        frameProblem(const [TextCell(), TextCell(front: 'a', back: 'b')]),
        FrameProblem.emptyText,
      );
    });
  });

  group('decodeCells', () {
    test('keeps a 칸 of a later version, and reads as a card holding it', () {
      final cells = decodeCells(
        jsonEncode([
          {
            'type': 'text',
            'v': 4,
            'payload': {'front': 'a'},
          },
        ]),
      );
      expect(cells.single, isA<UnknownCell>());
      expect(frameProblem(cells), isNull);
    });

    test('refuses what is not a list', () {
      expect(() => decodeCells('{}'), throwsFormatException);
    });
  });

  test('mediaOf names a v2 image and sound, and no other later block', () {
    final blocks = decodeContent(
      jsonEncode([
        {
          'type': 'image',
          'v': 2,
          'payload': {
            'media': 'm1',
            'width': 9,
            'height': 9,
            'boxes': <Object>[],
            'side': 'front',
          },
        },
        {
          'type': 'audio',
          'v': 2,
          'payload': {'media': 'm2', 'duration_ms': 9, 'side': 'back'},
        },
        {
          'type': 'chart',
          'payload': {'media': 'm3'},
        },
      ]),
    );
    expect(mediaOf(blocks), {const MediaId('m1'), const MediaId('m2')});
  });

  group('the read path', () {
    late AppDatabase db;
    late DeckRepository repository;
    late Deck deck;
    var cardIds = 0;

    setUp(() async {
      db = AppDatabase(NativeDatabase.memory());
      var ids = 0;
      repository = DeckRepository(
        db,
        clock: () => DateTime.utc(2026),
        newId: () => 'deck-${ids++}',
        newBlockId: () => 'block-${ids++}',
      );
      deck = await repository.createDeck('Frame');
    });

    tearDown(() => db.close());

    Future<Card> stored({
      required Object? front,
      required Object? back,
      String? template,
      int? version,
    }) async {
      final id = 'card-${cardIds++}';
      final now = DateTime.utc(2026);
      await db
          .into(db.cards)
          .insert(
            CardsCompanion.insert(
              id: id,
              deckId: deck.id.value,
              front: jsonEncode(front),
              back: jsonEncode(back),
              cardKey: id,
              source: 'manual',
              createdAt: now,
              updatedAt: now,
              template: Value(template),
              templateVersion: Value(version),
            ),
          );
      final cards = await repository.listCards(deck.id);
      return cards.singleWhere((card) => card.id.value == id);
    }

    Future<void> shows(WidgetTester tester, Card card) async {
      final unsupported = find.textContaining('cannot show');
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
          ],
          child: MaterialApp(
            theme: lightTheme,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            locale: const Locale('en'),
            home: Scaffold(
              body: SingleChildScrollView(
                child: Column(
                  children: [
                    CardBackRow(front: card.front, back: card.back),
                    CardPreview(front: card.front, back: card.back),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();
      expect(unsupported, findsNothing);
      final l10n = lookupAppLocalizations(const Locale('en'));
      expect(
        describeContent(l10n, [...card.front, ...card.back]),
        isNot(contains('cannot show')),
      );
      expect(tester.takeException(), isNull);
    }

    for (final fixture in conversions.where((c) => c['cells'] != null)) {
      final name = fixture['name'] as String;

      test('reads a framed card as its sides: $name', () async {
        final card = await stored(
          front: fixture['cells'],
          back: const <Object>[],
          template: freeTemplate,
          version: cardFrameVersion,
        );
        final cells = decodeCells(jsonEncode(fixture['cells']));
        expect(card.cells, cells);
        expect(cellsOf(card), cells);
        expect(
          [...card.front, ...card.back].whereType<UnsupportedContent>(),
          isEmpty,
        );
      });

      test('converts an earlier card: $name', () async {
        final card = await stored(
          front: fixture['front'],
          back: fixture['back'],
          template: freeTemplate,
          version: cardTemplateVersion,
        );
        expect(card.cells, isNull);
        expect(cellsOf(card), decodeCells(jsonEncode(fixture['cells'])));
      });
    }

    test('a card of a later template has no 칸 list', () async {
      final card = await stored(
        front: const [
          {
            'type': 'text',
            'v': 1,
            'payload': {'text': 'a'},
          },
        ],
        back: const <Object>[],
        template: 'future',
        version: 1,
      );
      expect(cellsOf(card), isNull);
    });

    test('a framed card opens in the editor', () async {
      final card = await stored(
        front: const [
          {
            'type': 'text',
            'v': 3,
            'payload': {'front': 'a', 'back': 'b'},
          },
        ],
        back: const <Object>[],
        template: freeTemplate,
        version: cardFrameVersion,
      );
      expect(canEdit(card), isTrue);
    });

    test('a framed card that breaks its shape is unreadable', () async {
      await expectLater(
        stored(
          front: const [
            {
              'type': 'text',
              'v': 3,
              'payload': {'front': '', 'back': ''},
            },
          ],
          back: const <Object>[],
          template: freeTemplate,
          version: cardFrameVersion,
        ),
        throwsA(isA<Object>()),
      );
    });

    testWidgets('every framed fixture draws without a placeholder', (
      tester,
    ) async {
      for (final fixture in conversions.where((c) => c['cells'] != null)) {
        final card = await tester.runAsync(
          () => stored(
            front: fixture['cells'],
            back: const <Object>[],
            template: freeTemplate,
            version: cardFrameVersion,
          ),
        );
        await shows(tester, card!);
      }
    });
  });
}
