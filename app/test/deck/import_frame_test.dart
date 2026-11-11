import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/spreadsheet.dart';
import 'package:knowno/deck/src/spreadsheet_cards.dart';

import 'frame_fixtures.dart';

/// The sheet's and the merge's cases of the file
/// `web/src/features/decks/__tests__/import-frame.test.ts` reads (ADR 0137).
final _fixture = jsonDecode(
  File('../supabase/fixtures/card-frame/import.json').readAsStringSync(),
) as Map<String, Object?>;

List<Map<String, Object?>> _cases(String part) => [
  for (final one
      in (_fixture[part]! as List<Object?>).cast<Map<String, Object?>>())
    {
      ...one,
      if (one['cards'] != null) 'cards': returned(one['cards']),
      if (one['saved'] != null) 'saved': migrated(one['saved']),
    },
];

/// [cells] as stored, without the ids a save draws.
List<Object?> _stored(List<Cell> cells) => [
  for (final block
      in jsonDecode(encodeCells(cells, newId: () => 'id')) as List<Object?>)
    {...block! as Map<String, Object?>}..remove('id'),
];

/// One row of a sheet of [cells], all text.
List<SheetRow> _sheet(List<Object?> rows) => [
  for (final (index, row) in rows.indexed)
    SheetRow(index + 1, [
      for (final cell in row! as List<Object?>)
        SheetCell(cell! as String, isText: true),
    ]),
];

void main() {
  group('shared cases', () {
    for (final c in _cases('sheet')) {
      test('sheet: ${c['name']}', () {
        final columns = c['columns']! as Map<String, Object?>;
        final result = cardsOfRows(
          _sheet(c['rows']! as List<Object?>),
          SheetColumns(
            front: columns['front']! as int,
            back: columns['back']! as int,
            label: columns['label'] as int?,
            example: columns['example'] as int?,
          ),
          header: false,
        );
        expect([
          for (final card in result.cards) _stored(card.cells),
        ], c['saved']);
      });
    }
    for (final c in _cases('held')) {
      test('held: ${c['name']}', () {
        final merged = mergeBack([
          TextContent(c['stored']! as String),
        ], c['back']! as String);
        expect(merged == null, c['held']);
      });
    }
  });

  test('an empty back merges nothing, against a back of text', () {
    expect(mergeBack(const [TextContent('수도')], '  '), isNull);
    expect(mergeBack(const [TextContent('수도')], '서울'), isNotNull);
  });

  test('a spreadsheet row is written free v2', () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    var nextId = 0;
    final repository = DeckRepository(
      db,
      clock: () => DateTime.utc(2026),
      newId: () => 'id-${nextId++}',
    );
    final result = cardsOfRows(
      _sheet([
        ['수도', '서울'],
      ]),
      const SheetColumns(front: 0, back: 1),
      header: false,
    );
    await repository.addCards(const AddToNewDeck('노트'), [
      IncomingCard.framed(
        result.cards.single.cells,
        onDuplicate: DuplicateChoice.addNew,
      ),
    ], source: const FromFile());

    final row = await db.select(db.cards).getSingle();
    expect((row.template, row.templateVersion, row.back), ('free', 2, '[]'));
    expect(decodeCells(row.front), [const TextCell(front: '수도', back: '서울')]);
    final block = (jsonDecode(row.front) as List<Object?>).single! as Map;
    expect((block['type'], block['v']), ('text', 3));
  });
}
