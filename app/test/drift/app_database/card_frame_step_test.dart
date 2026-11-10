import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' hide isNotNull, isNull;
import 'package:drift/native.dart';
import 'package:drift_dev/api/migrations_native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart'
    show cellsFromSides, decodeCells, decodeContent;
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import '../../sync/fake_sync_server.dart';
import 'generated/schema.dart';
import 'generated/schema_v13.dart' as v13;
import 'generated/schema_v14.dart' as v14;

const _ada = UserId('00000000-0000-4000-8000-00000000000a');
const _deck = '00000000-0000-4000-8000-0000000000d1';
const _at = '2026-10-01T00:00:00.000Z';
const _edited = '2026-10-20T09:30:00.000Z';
const _later = '2026-10-21T09:30:00.000Z';

List<Map<String, Object?>> _fixtures() => (jsonDecode(
  File('../supabase/fixtures/card-frame/conversion.json').readAsStringSync(),
) as List<Object?>).cast<Map<String, Object?>>();

String _text(String text) =>
    '[{"type":"text","v":1,"payload":{"text":${jsonEncode(text)}}}]';

const _cloze = '[{"type":"cloze","payload":{"text":"___","answers":["x"]}}]';

void _insert(
  Batch batch,
  v13.DatabaseAtV13 old, {
  required String id,
  required String front,
  required String back,
  String? template = 'free',
  int? version = 1,
  String updatedAt = _edited,
  String? deletedAt,
  int dirty = 0,
}) => batch.insert(
  old.cards,
  v13.CardsData(
    id: id,
    deckId: _deck,
    front: front,
    back: back,
    cardKey: 'key $id',
    source: 'manual',
    template: template,
    templateVersion: version,
    createdAt: _at,
    updatedAt: updatedAt,
    deletedAt: deletedAt,
    dirty: dirty,
  ),
);

void _insertDeck(Batch batch, v13.DatabaseAtV13 old) => batch.insert(
  old.decks,
  const v13.DecksData(
    id: _deck,
    name: 'French',
    visibility: 'private',
    createdAt: _at,
    updatedAt: _at,
    dirty: 0,
  ),
);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  late SchemaVerifier verifier;
  final fixtures = _fixtures();

  setUpAll(() => verifier = SchemaVerifier(GeneratedHelper()));

  Future<void> upgrade(
    void Function(Batch batch, v13.DatabaseAtV13 old) items,
    Future<void> Function(v14.DatabaseAtV14 db) validate,
  ) => verifier.testWithDataIntegrity(
    oldVersion: 13,
    newVersion: 14,
    createOld: v13.DatabaseAtV13.new,
    createNew: v14.DatabaseAtV14.new,
    openTestedDatabase: AppDatabase.new,
    createItems: (batch, old) {
      _insertDeck(batch, old);
      items(batch, old);
    },
    validateItems: validate,
  );

  test('the fixtures reach the step: every case, with a list and without', () {
    expect(fixtures.length, greaterThanOrEqualTo(23));
    expect(fixtures.where((f) => f['cells'] != null), isNotEmpty);
    expect(fixtures.where((f) => f['cells'] == null), isNotEmpty);
  });

  test('the upgrade from 13 to 14 writes every fixture as its expected list, and as cellsFromSides reads the same card, keeping its key, edit time and dirty flag', () async {
    await upgrade(
      (batch, old) {
        for (final (index, fixture) in fixtures.indexed) {
          _insert(
            batch,
            old,
            id: '$index',
            front: jsonEncode(fixture['front']),
            back: jsonEncode(fixture['back']),
            dirty: index.isOdd ? 1 : 0,
          );
        }
      },
      (db) async {
        final rows = {
          for (final row in await db.select(db.cards).get()) row.id: row,
        };
        for (final (index, fixture) in fixtures.indexed) {
          final row = rows['$index']!;
          final reason = fixture['name'] as String;
          final expected = fixture['cells'];
          final frame = cellsFromSides(
            decodeContent(jsonEncode(fixture['front'])),
            decodeContent(jsonEncode(fixture['back'])),
          );
          expect(
            (row.cardKey, row.updatedAt, row.dirty),
            ('key $index', _edited, index.isOdd ? 1 : 0),
            reason: reason,
          );
          if (expected == null) {
            expect(frame, isNull, reason: reason);
            expect(
              (row.front, row.back, row.template, row.templateVersion),
              (
                jsonEncode(fixture['front']),
                jsonEncode(fixture['back']),
                'free',
                1,
              ),
              reason: reason,
            );
            continue;
          }
          expect(jsonDecode(row.front), expected, reason: reason);
          expect(
            (row.back, row.template, row.templateVersion),
            ('[]', 'free', 2),
            reason: reason,
          );
          expect(decodeCells(row.front), frame, reason: reason);
        }
      },
    );
  });

  test('the step reads every template the server does, and leaves a tombstone, a template or version no build wrote, a card in the frame, and what it cannot read or would write as an empty 글', () async {
    const kept = [
      ('deleted', _cloze, '[]'),
      ('mindmap', _cloze, '[]'),
      ('newer', _cloze, '[]'),
      (
        'framed',
        '[{"type":"text","v":2,"payload":{"front":"a","back":"b"}}]',
        '[]',
      ),
      ('no-json', 'not json', '[]'),
      ('no-list', '{}', '[]'),
      ('scalar', '["a scalar"]', '[]'),
      ('no-text', '[{"type":"text","payload":{}}]', '[]'),
      (
        'bad-version',
        '[{"type":"text","v":"one","payload":{"text":"a"}}]',
        '[]',
      ),
      (
        'bad-cloze',
        '[{"type":"cloze","payload":{"text":"___","answers":["x","y"]}}]',
        '[]',
      ),
      (
        'bad-table',
        '[{"type":"table","payload":{"columns":"a","rows":3}}]',
        '[]',
      ),
    ];
    final emptyBack = _text('');
    final spaceBack = _text(' 　\n');
    const emptyAnswer =
        '[{"type":"image","payload":{"media":"m","width":1,"height":1,'
        '"boxes":[{"id":"x","x":0,"y":0,"w":1,"h":1,"answer":""}]}}]';
    await upgrade(
      (batch, old) {
        for (final (id, front, back) in kept) {
          _insert(
            batch,
            old,
            id: id,
            front: front,
            back: back,
            template: switch (id) {
              'mindmap' => 'mindmap',
              'framed' => 'free',
              _ => 'free',
            },
            version: id == 'framed' || id == 'newer' ? 2 : 1,
            deletedAt: id == 'deleted' ? _edited : null,
          );
        }
        _insert(batch, old, id: 'empty', front: _cloze, back: emptyBack);
        _insert(batch, old, id: 'space', front: _cloze, back: spaceBack);
        _insert(batch, old, id: 'answer', front: _cloze, back: emptyAnswer);
        for (final (id, template, version) in const [
          ('none', null, null),
          ('free', 'free', 1),
          ('flip', 'flip', 1),
          ('cloze', 'cloze', 1),
          ('table', 'table', 1),
        ]) {
          _insert(
            batch,
            old,
            id: id,
            front: _text('front'),
            back: _text('back'),
            template: template,
            version: version,
          );
        }
        _insert(batch, old, id: 'joins', front: _text('x'), back: emptyBack);
      },
      (db) async {
        final rows = {
          for (final row in await db.select(db.cards).get()) row.id: row,
        };
        for (final (id, front, back) in kept) {
          expect(
            (rows[id]!.front, rows[id]!.back, rows[id]!.templateVersion),
            (front, back, id == 'framed' || id == 'newer' ? 2 : 1),
            reason: id,
          );
        }
        expect(rows['mindmap']!.template, 'mindmap');
        expect(rows['newer']!.templateVersion, 2);
        for (final id in ['empty', 'space', 'answer']) {
          expect(rows[id]!.templateVersion, 1, reason: id);
          expect(rows[id]!.front, _cloze, reason: id);
        }
        expect(rows['empty']!.back, emptyBack);
        for (final id in ['none', 'free', 'flip', 'cloze', 'table']) {
          expect(
            (rows[id]!.template, rows[id]!.templateVersion, rows[id]!.back),
            ('free', 2, '[]'),
            reason: id,
          );
          expect(jsonDecode(rows[id]!.front), [
            {
              'type': 'text',
              'v': 2,
              'payload': {'front': 'front', 'back': 'back'},
            },
          ], reason: id);
        }
        expect(jsonDecode(rows['joins']!.front), [
          {
            'type': 'text',
            'v': 2,
            'payload': {'front': 'x', 'back': ''},
          },
        ], reason: 'a back of no text beside a front 글 joins it: the control');
      },
    );
  });

  test('the step and cellsFromSides agree on every front and back of up to two blocks of each kind', () {
    const blocks = <Object?>[
      {
        'type': 'text',
        'v': 1,
        'id': 't',
        'payload': {'text': 'word'},
      },
      {
        'type': 'text',
        'payload': {'text': 'word ___'},
      },
      {
        'type': 'senses',
        'v': 1,
        'id': 's',
        'payload': {
          'senses': [
            {'labels': <Object?>[], 'meaning': '사과', 'examples': <Object?>[]},
          ],
        },
      },
      {
        'type': 'cloze',
        'v': 1,
        'payload': {
          'text': '___ is word',
          'answers': ['Rose'],
        },
      },
      {
        'type': 'table',
        'v': 2,
        'payload': {
          'columns': ['A'],
          'rows': [
            ['word'],
          ],
          'blanks': [
            {'row': 0, 'column': 0},
          ],
          'spans': <Object?>[],
        },
      },
      {
        'type': 'image',
        'v': 1,
        'id': 'i',
        'payload': {
          'media': 'm',
          'width': 1,
          'height': 1,
          'boxes': <Object?>[],
        },
      },
      {
        'type': 'image',
        'payload': {
          'media': 'm',
          'width': 1,
          'height': 1,
          'boxes': [
            {'id': 'x', 'x': 0, 'y': 0, 'w': 1, 'h': 1, 'answer': 'heart'},
            {'id': 'y', 'x': 0, 'y': 0, 'w': 1, 'h': 1},
          ],
        },
      },
      {
        'type': 'audio',
        'v': 1,
        'payload': {'media': 'a', 'duration_ms': 9},
      },
    ];
    final sides = [
      <Object?>[],
      for (final block in blocks) [block],
      for (final first in blocks)
        for (final second in blocks) [first, second],
    ];
    for (final front in sides) {
      for (final back in sides) {
        final stored = (jsonEncode(front), jsonEncode(back));
        final framed = frameSides(stored.$1, stored.$2);
        expect(framed, isNotNull, reason: '$stored');
        expect(
          decodeCells(framed!),
          cellsFromSides(decodeContent(stored.$1), decodeContent(stored.$2)),
          reason: '$stored',
        );
      }
    }
  });

  group('a pull of the migrated deck after the step', () {
    late Scheduler scheduler;
    const rows = 4038;

    setUpAll(() async => scheduler = await Scheduler.load());

    String id(int n) =>
        '00000000-0000-4000-8000-${n.toString().padLeft(12, '0')}';

    CardRow card(
      String cardId, {
      required String front,
      String back = '[]',
      int version = 2,
      String? key,
    }) => CardRow(
      id: cardId,
      deckId: _deck,
      front: front,
      back: back,
      cardKey: key ?? 'key $cardId',
      source: 'manual',
      template: 'free',
      templateVersion: version,
      createdAt: DateTime.parse(_at),
      updatedAt: DateTime.parse(_edited),
      dirty: false,
    );

    String serverCopy(String cardId) =>
        '[{"type":"text","v":2,"id":"server","payload":{"front":"$cardId","back":"from the server"}}]';

    test('a device takes the server\'s copy of 4,038 synced cards and keeps and pushes each edit not yet pushed', () async {
      final schema = await verifier.schemaAt(13);
      final old = v13.DatabaseAtV13(schema.newConnection());
      await old.batch((batch) {
        _insertDeck(batch, old);
        for (var n = 0; n < rows; n++) {
          _insert(
            batch,
            old,
            id: id(n),
            front: _text(id(n)),
            back: _text('back'),
          );
        }
        // Two edits not yet pushed: one later than the server's row, one on
        // its tie, both of the same edit time on the server.
        _insert(
          batch,
          old,
          id: 'later',
          front: _text('later edit'),
          back: _text('kept'),
          updatedAt: _later,
          dirty: 1,
        );
        _insert(
          batch,
          old,
          id: 'tied',
          front: _text('tied edit'),
          back: _text('kept'),
          dirty: 1,
        );
      });
      await old.close();

      final db = AppDatabase(schema.newConnection());
      addTearDown(db.close);
      final stored = await db.select(db.cards).get();
      expect(stored, hasLength(rows + 2));
      expect(stored.every((row) => row.templateVersion == 2), isTrue);

      final server = FakeSyncServer(_ada);
      await server.pushDecks(_ada, [
        DeckRow(
          id: _deck,
          name: 'French',
          visibility: 'private',
          publication: 'private',
          createdAt: DateTime.parse(_at),
          updatedAt: DateTime.parse(_at),
          dirty: false,
        ),
      ]);
      await server.pushCards(_ada, [
        for (var n = 0; n < rows; n++)
          card(id(n), front: serverCopy(id(n)), key: 'key ${id(n)}'),
        card('later', front: serverCopy('later')),
        card('tied', front: serverCopy('tied')),
      ]);

      final store = SyncStore(db, scheduler, clock: DateTime.now);
      await Synchronizer(store, server).run(_ada);

      final after = {
        for (final row in await db.select(db.cards).get()) row.id: row,
      };
      expect(after, hasLength(rows + 2));
      for (var n = 0; n < rows; n++) {
        expect(after[id(n)]!.front, serverCopy(id(n)));
        expect(after[id(n)]!.dirty, isFalse);
      }
      for (final (cardId, text) in const [
        ('later', 'later edit'),
        ('tied', 'tied edit'),
      ]) {
        expect(jsonDecode(after[cardId]!.front), [
          {
            'type': 'text',
            'v': 2,
            'payload': {'front': text, 'back': 'kept'},
          },
        ], reason: '$cardId keeps its edit, in the frame');
        expect(after[cardId]!.dirty, isFalse, reason: '$cardId is pushed');
        expect(
          server.cards[cardId]!.row.front,
          after[cardId]!.front,
          reason: '$cardId reaches the server',
        );
      }
      expect(await store.hasUnsynced(), isFalse);
    });

    test('a device without the step keeps its edit at v1 and pushes it over the frame', () async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final server = FakeSyncServer(_ada);
      final deck = DeckRow(
        id: _deck,
        name: 'French',
        visibility: 'private',
        publication: 'private',
        createdAt: DateTime.parse(_at),
        updatedAt: DateTime.parse(_at),
        dirty: false,
      );
      await db.into(db.decks).insert(deck);
      await server.pushDecks(_ada, [deck]);
      final edit = card(
        'edit',
        front: _text('edit'),
        back: _text('kept'),
        version: 1,
      ).copyWith(dirty: true);
      await db.into(db.cards).insert(edit);
      await server.pushCards(_ada, [card('edit', front: serverCopy('edit'))]);

      await Synchronizer(
        SyncStore(db, scheduler, clock: DateTime.now),
        server,
      ).run(_ada);

      final after = await db.select(db.cards).getSingle();
      expect((after.front, after.back), (_text('edit'), _text('kept')));
      expect(server.cards['edit']!.row.front, _text('edit'));
      expect(server.cards['edit']!.row.templateVersion, 1);
    });
  });
}
