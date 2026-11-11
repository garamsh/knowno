import 'dart:convert';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_template.dart';

/// A card's stored template, its version, and its sides as stored.
typedef _Stored = ({
  String? template,
  int? templateVersion,
  List<Object?> front,
  List<Object?> back,
});

void main() {
  late AppDatabase db;
  late DeckRepository repository;
  late Deck deck;

  setUp(() async {
    db = AppDatabase(NativeDatabase.memory());
    var ids = 0;
    var blocks = 0;
    var tick = 0;
    repository = DeckRepository(
      db,
      clock: () => DateTime.utc(2026, 1, 1).add(Duration(seconds: tick++)),
      newId: () => 'id-${ids++}',
      newBlockId: () => 'block-${blocks++}',
    );
    deck = await repository.createDeck('French');
  });

  tearDown(() => db.close());

  Future<_Stored> stored(String id) async {
    final row = await (db.select(
      db.cards,
    )..where((card) => card.id.equals(id))).getSingle();
    return (
      template: row.template,
      templateVersion: row.templateVersion,
      front: jsonDecode(row.front) as List<Object?>,
      back: jsonDecode(row.back) as List<Object?>,
    );
  }

  Card saved(SaveCardResult result) => switch (result) {
    CardSaved(:final card) => card,
    DuplicateFront() => fail('expected a save, got $result'),
  };

  /// A card as a build from before ADR 0106 wrote it: no template, and
  /// blocks with neither a version nor an id.
  Future<Card> legacy(String id, String front, String back) async {
    await db
        .into(db.cards)
        .insert(
          CardsCompanion.insert(
            id: id,
            deckId: deck.id.value,
            front: front,
            back: back,
            cardKey: id,
            source: 'manual',
            createdAt: DateTime.utc(2026),
            updatedAt: DateTime.utc(2026),
          ),
        );
    return (await repository.listCards(deck.id))
        .singleWhere((card) => card.id.value == id);
  }

  test(
    'every card added or edited records the free template at v1, whatever '
    'its blocks, an edit of a card of an earlier template included',
    () async {
      final text = saved(
        await repository.addCard(
          deck.id,
          front: [const TextContent('chat')],
          back: [const TextContent('cat')],
        ),
      );
      final cloze = saved(
        await repository.addCard(
          deck.id,
          front: [const ClozeContent('{{c1::Paris}} is in France')],
          back: const [],
        ),
      );
      final table = saved(
        await repository.addCard(
          deck.id,
          front: [
            const TextContent('Capitals'),
            const TableContent(
              columns: ['Capital'],
              rows: [
                ['Paris'],
              ],
              blanks: [(row: 0, column: 0)],
            ),
          ],
          back: const [],
        ),
      );
      expect(
        [
          for (final card in [text, cloze, table])
            (
              (await stored(card.id.value)).template,
              (await stored(card.id.value)).templateVersion,
            ),
        ],
        [('free', 1), ('free', 1), ('free', 1)],
      );
      expect((text.template, text.templateVersion), ('free', 1));

      // A card an earlier build wrote as 앞뒤.
      await (db.update(db.cards)..where((row) => row.id.equals(text.id.value)))
          .write(const CardsCompanion(template: Value('flip')));
      final flip = (await repository.listCards(deck.id))
          .singleWhere((card) => card.id == text.id);
      expect(flip.template, 'flip', reason: 'the setup: an earlier template');
      saved(
        await repository.editCard(flip, front: flip.front, back: flip.back),
      );
      expect((await stored(text.id.value)).template, 'free');
    },
  );

  test('every block written carries v1 and an id, and keeps its id through an '
      'edit of its content', () async {
    final card = saved(
      await repository.addCard(
        deck.id,
        front: [const TextContent('chat')],
        back: [
          const SensesContent([CardSense(meaning: 'cat')]),
          const TextContent('extras'),
        ],
      ),
    );
    final before = await stored(card.id.value);
    expect(before.front, [
      {
        'type': 'text',
        'v': 1,
        'id': 'block-0',
        'payload': {'text': 'chat'},
      },
    ]);
    expect([for (final block in before.back) (block! as Map)['v']], [1, 1]);

    saved(
      await repository.editCard(
        card,
        front: [const TextContent('chatte')],
        back: [
          const SensesContent([CardSense(meaning: 'she-cat')]),
          const TextContent('extras'),
        ],
      ),
    );
    final after = await stored(card.id.value);
    expect(
      [
        for (final block in [...after.front, ...after.back])
          (block! as Map)['id'],
      ],
      [
        for (final block in [...before.front, ...before.back])
          (block! as Map)['id'],
      ],
      reason: 'each block keeps its id though its content changed',
    );
  });

  test('a card from before templates is editable and gets the free template, '
      'and ids on its blocks, on its next write', () async {
    final card = await legacy(
      'old',
      '[{"type":"text","payload":{"text":"France"}}]',
      '[{"type":"text","payload":{"text":"Paris"}}]',
    );
    expect((card.template, card.templateVersion), (null, null));
    expect(canEdit(card), isTrue);
    expect(
      (await stored('old')).template,
      isNull,
      reason: 'reading rewrites nothing',
    );

    saved(await repository.editCard(card, front: card.front, back: card.back));
    final after = await stored('old');
    expect((after.template, after.templateVersion), ('free', 1));
    expect((after.front.single! as Map)['v'], 1);
    expect((after.front.single! as Map)['id'], isA<String>());
  });

  test(
    'a template or a template version this build does not know opens '
    'nothing, and a merged back keeps them and the unknown block as stored',
    () async {
      const unknownBlock =
          '{"type":"image","v":3,"id":"img","payload":{"media":"m1"},'
          '"boxes":[1,2]}';
      await db
          .into(db.cards)
          .insert(
            CardsCompanion.insert(
              id: 'new',
              deckId: deck.id.value,
              front: '[$unknownBlock]',
              back: '[{"type":"text","v":1,"id":"t","payload":{"text":"cat"}}]',
              cardKey: 'chat',
              source: 'manual',
              template: const Value('image_occlusion'),
              templateVersion: const Value(2),
              createdAt: DateTime.utc(2026),
              updatedAt: DateTime.utc(2026),
            ),
          );
      final card = (await repository.listCards(deck.id)).single;
      expect(canEdit(card), isFalse, reason: 'read-only in the editor');
      expect(
        canEdit(
          Card(
            id: card.id,
            deckId: card.deckId,
            front: card.front,
            back: card.back,
            cardKey: card.cardKey,
            source: card.source,
            createdAt: card.createdAt,
            updatedAt: card.updatedAt,
            template: 'flip',
            templateVersion: 2,
          ),
        ),
        isFalse,
        reason: 'a known template at a later version is read-only too',
      );
      for (final (template, version, editable) in [
        ('free', 2, true),
        ('free', 3, false),
        ('cloze', 2, false),
      ]) {
        expect(
          canEdit(
            Card(
              id: card.id,
              deckId: card.deckId,
              front: card.front,
              back: card.back,
              cardKey: card.cardKey,
              source: card.source,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
              template: template,
              templateVersion: version,
            ),
          ),
          editable,
          reason: 'the frame is free v2 alone: $template v$version',
        );
      }
      // Control: every template a build of this app wrote, at v1, and none.
      for (final template in ['flip', 'cloze', 'table', 'free', null]) {
        expect(
          canEdit(
            Card(
              id: card.id,
              deckId: card.deckId,
              front: card.front,
              back: card.back,
              cardKey: card.cardKey,
              source: card.source,
              createdAt: card.createdAt,
              updatedAt: card.updatedAt,
              template: template,
              templateVersion: template == null ? null : 1,
            ),
          ),
          isTrue,
          reason: '$template',
        );
      }

      // Photo import merges a back into it: the only write the app makes to
      // such a card.
      await repository.addCards(AddToDeck(deck.id), [
        const IncomingCard(
          front: [TextContent('chat')],
          back: [TextContent('a cat')],
          onDuplicate: DuplicateChoice.mergeBack,
        ),
      ]);
      final after = await db.select(db.cards).getSingle();
      expect((after.template, after.templateVersion), ('image_occlusion', 2));
      expect(after.front, '[$unknownBlock]', reason: 'byte for byte');
      expect(
        [for (final block in jsonDecode(after.back) as List) block['id']],
        ['t', isA<String>()],
        reason: 'the merged line is a new block',
      );
    },
  );

  test('a merged back makes a card of an earlier template free, as any write '
      'of it does', () async {
    final card = saved(
      await repository.addCard(
        deck.id,
        front: [const TextContent('chat')],
        back: [const TextContent('cat')],
      ),
    );
    await (db.update(db.cards)..where((row) => row.id.equals(card.id.value)))
        .write(const CardsCompanion(template: Value('flip')));
    await repository.addCards(AddToDeck(deck.id), [
      const IncomingCard(
        front: [TextContent('chat')],
        back: [TextContent('a cat')],
        onDuplicate: DuplicateChoice.mergeBack,
      ),
    ]);
    final after = await stored(card.id.value);
    expect(after.back, hasLength(2), reason: 'the setup: the back merged');
    expect((after.template, after.templateVersion), ('free', 1));
  });

  test(
    'a photo-imported card, one from a file and a copied one are stored with '
    'the free template, the cloze at v2 and the text at v1',
    () async {
      for (final source in [
        const FromPhoto(),
        const FromFile(),
        FromCopy(deck.id, owner: 'owner'),
      ]) {
        await repository.addCards(AddToDeck(deck.id), source: source, [
          const IncomingCard(
            front: [ClozeContent('{{c1::Paris}} is in France')],
            back: [TextContent('Paris is in France')],
            onDuplicate: DuplicateChoice.addNew,
          ),
        ]);
      }
      final rows = await db.select(db.cards).get();
      expect(
        [for (final row in rows) row.source],
        ['import', 'import', 'copy'],
      );
      for (final row in rows) {
        expect((row.template, row.templateVersion), ('free', 1));
        expect(
          [
            for (final side in [row.front, row.back])
              for (final block in jsonDecode(side) as List) block['v'],
          ],
          [2, 1],
        );
      }
    },
  );
}
