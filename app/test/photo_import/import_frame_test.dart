import 'dart:convert';
import 'dart:io';

import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/photo_import/src/extraction_client.dart';
import 'package:knowno/photo_import/src/import_list.dart';

import '../deck/frame_fixtures.dart';
import '../deck/two_sides.dart';

/// The cases `web/src/features/decks/__tests__/import-frame.test.ts` reads, so
/// the app and the web save equal 칸 for the same candidates (ADR 0137);
/// `test/deck/import_frame_test.dart` holds the sheet's and the merge's.
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

/// The rows of [cards], every one included, in the stored [form] when given.
ImportList _list(Object? cards, [Object? form]) {
  final extracted = parseExtraction(200, jsonEncode({'cards': cards}));
  final list = ImportList(extracted.cards, const {});
  for (final section in list.sections) {
    section.form = SectionForm.fromJson(form) ?? section.form;
    for (final row in section.rows) {
      row.included = true;
    }
  }
  return list;
}

Map<String, Object?> _rowCard({
  String front = 'face',
  String answer = '얼굴\n직면하다',
  String kind = 'vocabulary',
  String type = 'concept',
}) => {
  'front': front,
  'answer': answer,
  'topic': '단어',
  'kind': kind,
  'type': type,
  if (kind == 'vocabulary')
    'senses': [
      {'labels': <Object?>[], 'meaning': '얼굴', 'examples': <Object?>[]},
      {'labels': <Object?>[], 'meaning': '직면하다', 'examples': <Object?>[]},
    ],
  if (type == 'cloze')
    'cloze': {
      'answers': ['서울'],
    },
};

void main() {
  group('shared cases', () {
    for (final c in _cases('photo')) {
      test('photo: ${c['name']}', () {
        final saved = _list(c['cards'], c['form']).toImport();
        expect([for (final card in saved) _stored(card.cells!)], c['saved']);
        expect([
          for (final card in saved) frameProblem(card.cells!),
        ], everyElement(isNull));
      });
    }
  });

  group('saved', () {
    late AppDatabase db;
    late DeckRepository repository;

    setUp(() {
      db = AppDatabase(NativeDatabase.memory());
      var nextId = 0;
      repository = DeckRepository(
        db,
        clock: () => DateTime.utc(2026),
        newId: () => 'id-${nextId++}',
      );
    });

    tearDown(() => db.close());

    Future<CardRow> single() => db.select(db.cards).getSingle();

    test('a photo card is written free v2, its 칸 in front and [] in back, its '
        "key the side it asks", () async {
      final list = _list([_rowCard()]);
      final added = await repository.addCards(
        const AddToNewDeck('노트'),
        list.toImport(),
      );

      expect(added.added, 1);
      final row = await single();
      expect(row.template, 'free');
      expect(row.templateVersion, 2);
      expect(row.back, '[]');
      expect(row.cardKey, 'face');
      expect(row.source, 'import');
      expect((decodeCells(row.front).single as WordCell).ask, WordAsk.term);
    });

    /// The blocks of the stored card's front, as the database holds them.
    Future<List<Map<String, Object?>>> storedBlocks() async => [
      for (final block in jsonDecode((await single()).front) as List<Object?>)
        block! as Map<String, Object?>,
    ];

    test('a text candidate is stored as text version 3, its markup as the '
        'service returned it and not escaped again', () async {
      await repository.addCards(
        const AddToNewDeck('노트'),
        _list([_rowCard(front: '**굵게** 2 * 3', answer: '여섯', kind: 'note')])
            .toImport(),
      );

      final [block] = await storedBlocks();
      expect((block['type'], block['v']), ('text', 3));
      expect(block['payload'], {'front': '**굵게** 2 * 3', 'back': '여섯'});
    });

    test('a cloze candidate is stored as cloze version 2, its Anki text as '
        'written and without answers', () async {
      await repository.addCards(
        const AddToNewDeck('노트'),
        _list([
          _rowCard(
            front: '{{c1::서울}}은 한국의 *수도*',
            answer: '서울',
            kind: 'note',
            type: 'cloze',
          ),
        ]).toImport(),
      );

      final [block] = await storedBlocks();
      expect((block['type'], block['v']), ('cloze', 2));
      expect(block['payload'], {'text': '{{c1::서울}}은 한국의 *수도*'});
    });

    test('a repeated import of two senses merges nothing, against a new '
        'sense, which appends a 글 of a back alone', () async {
      final first = await repository.addCards(
        const AddToNewDeck('노트'),
        _list([_rowCard()]).toImport(),
      );
      final deck = AddToDeck(first.deck.id);

      final repeated = await repository.addCards(
        deck,
        _list([_rowCard()]).toImport(),
      );

      expect((repeated.added, repeated.merged), (0, 0));
      expect(decodeCells((await single()).front), hasLength(1));

      final changed = _list([_rowCard()]);
      changed.rows.single.senses[1].meaning = '마주하다';
      final merged = await repository.addCards(deck, changed.toImport());

      expect((merged.added, merged.merged), (0, 1));
      final cells = decodeCells((await single()).front);
      expect(cells.last, const TextCell(back: '얼굴\n마주하다'));
      final blocks = await storedBlocks();
      expect(blocks.last['type'], 'text');
      expect(blocks.last['v'], 3, reason: 'the merge writes version 3');
      expect((await single()).back, '[]');
    });

    test('the same two senses repeated after a merge onto a card of two sides '
        'stay one back', () async {
      final deck = await repository.createDeck('노트');
      await storeSides(
        db,
        repository,
        deck.id,
        front: const [TextContent('face')],
        back: const [TextContent('낯')],
      );
      final target = AddToDeck(deck.id);

      final first = await repository.addCards(
        target,
        _list([_rowCard()]).toImport(),
      );
      final again = await repository.addCards(
        target,
        _list([_rowCard()]).toImport(),
      );

      expect(first.merged, 1);
      expect(again.merged, 0);
      final row = await single();
      expect((row.template, row.templateVersion), ('free', 2));
      expect(row.back, '[]');
      expect(plainText(sidesOf(decodeCells(row.front)).back), '낯\n얼굴\n직면하다');
    });

    test('a cloze saved again over a card of two sides writes nothing: it has '
        'no back to merge', () async {
      final cloze = _rowCard(
        front: '수도는 {{c1::서울}}이다',
        answer: '서울',
        kind: 'note',
        type: 'cloze',
      );
      final deck = await repository.createDeck('노트');
      await storeSides(
        db,
        repository,
        deck.id,
        front: const [ClozeContent('수도는 {{c1::서울}}이다')],
        back: const [TextContent('수도는 서울이다')],
      );

      final repeated = await repository.addCards(
        AddToDeck(deck.id),
        _list([cloze]).toImport(),
      );

      expect((repeated.added, repeated.merged), (0, 0));
      expect(plainText(decodeContent((await single()).back)), '수도는 서울이다');
    });
  });
}
