import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';

List<Content> _text(String text) => [TextContent(text)];

/// [text] as a card of the frame shows it.
List<Content> _shown(String text) => [TextContent(text, markup: true)];

IncomingCard _card(
  String front,
  String back, [
  DuplicateChoice onDuplicate = DuplicateChoice.skip,
]) => IncomingCard(
  front: _text(front),
  back: _text(back),
  onDuplicate: onDuplicate,
);

void main() {
  late AppDatabase db;
  late DeckRepository repository;

  setUp(() {
    db = AppDatabase(NativeDatabase.memory());
    var nextId = 0;
    var tick = 0;
    repository = DeckRepository(
      db,
      clock: () => DateTime.utc(2026, 1, 1).add(Duration(seconds: tick++)),
      newId: () => 'id-${nextId++}',
    );
  });

  tearDown(() => db.close());

  /// A deck holding "chat" → "cat".
  Future<Deck> french() async {
    final deck = await repository.createDeck('French');
    await repository.addCard(deck.id, front: _text('chat'), back: _text('cat'));
    return deck;
  }

  test('an import into a new deck creates it and saves import cards', () async {
    final result = await repository.addCards(const AddToNewDeck('Page 12'), [
      _card('chien', 'dog'),
      _card('oiseau', 'bird'),
    ]);

    expect(result.deck.name, 'Page 12');
    expect(result.added, 2);
    final decks = await repository.watchDecks().first;
    expect(decks.map((deck) => deck.name), ['Page 12']);
    final cards = await repository.listCards(result.deck.id);
    expect(
      cards.map(
        (card) => (plainText(card.front), plainText(card.back), card.source),
      ),
      [
        ('chien', 'dog', CardSource.import),
        ('oiseau', 'bird', CardSource.import),
      ],
    );
  });

  test('a failed card rolls back the whole import, deck included', () async {
    await db.customStatement(
      "CREATE TEMP TRIGGER refuse BEFORE INSERT ON cards WHEN NEW.front LIKE '%refused%' "
      "BEGIN SELECT RAISE(ABORT, 'refused'); END",
    );
    // Control: the trigger lets an ordinary import through.
    final control = await repository.addCards(const AddToNewDeck('Accepted'), [
      _card('chien', 'dog'),
    ]);
    expect(control.added, 1);

    await expectLater(
      repository.addCards(const AddToNewDeck('Refused'), [
        _card('oiseau', 'bird'),
        _card('poisson', 'refused'),
      ]),
      throwsA(isA<StorageFailure>()),
    );

    final decks = await repository.watchDecks().first;
    expect(decks.map((deck) => deck.name), ['Accepted']);
    expect(await repository.watchCardCounts().first, {control.deck.id: 1});
  });

  test('skip writes nothing for a colliding card', () async {
    final deck = await french();

    final result = await repository.addCards(AddToDeck(deck.id), [
      _card(' Chat ', 'talk', DuplicateChoice.skip),
      _card('chien', 'dog', DuplicateChoice.skip),
    ]);

    expect((result.added, result.merged), (1, 0));
    final cards = await repository.listCards(deck.id);
    expect(cards.map((card) => (plainText(card.front), plainText(card.back))), [
      ('chat', 'cat'),
      ('chien', 'dog'),
    ]);
  });

  test(
    'merge back appends the back to the existing card on a new line',
    () async {
      final deck = await french();
      final before = (await repository.listCards(deck.id)).single;

      final result = await repository.addCards(AddToDeck(deck.id), [
        _card('CHAT', 'talk', DuplicateChoice.mergeBack),
      ]);

      expect((result.added, result.merged), (0, 1));
      final after = (await repository.listCards(deck.id)).single;
      expect(after.id, before.id);
      expect(after.front, _shown('chat'));
      expect(after.back, [..._shown('cat'), ..._shown('talk')]);
      expect(after.source, CardSource.manual);
    },
  );

  test(
    'merge back changes nothing when the back already holds the text',
    () async {
      final deck = await french();
      final before = (await repository.listCards(deck.id)).single;

      final result = await repository.addCards(AddToDeck(deck.id), [
        _card('chat', '  CAT ', DuplicateChoice.mergeBack),
        // Control: a back the card does not hold is merged.
        _card('chat', 'talk', DuplicateChoice.mergeBack),
      ]);

      expect((result.added, result.merged), (0, 1));
      final after = (await repository.listCards(deck.id)).single;
      expect(after.back, [..._shown('cat'), ..._shown('talk')]);
      expect(after.createdAt, before.createdAt);
    },
  );

  test('add as new keeps the existing card and adds another', () async {
    final deck = await french();

    final result = await repository.addCards(AddToDeck(deck.id), [
      _card('Chat', 'talk', DuplicateChoice.addNew),
    ]);

    expect((result.added, result.merged), (1, 0));
    final cards = await repository.listCards(deck.id);
    expect(
      cards.map(
        (card) => (plainText(card.front), plainText(card.back), card.source),
      ),
      [('chat', 'cat', CardSource.manual), ('Chat', 'talk', CardSource.import)],
    );
  });

  test(
    'a card colliding with one saved earlier in the import follows its choice',
    () async {
      final deck = await repository.createDeck('French');

      final result = await repository.addCards(AddToDeck(deck.id), [
        _card('chat', 'cat', DuplicateChoice.mergeBack),
        _card('chat', 'talk', DuplicateChoice.mergeBack),
      ]);

      expect((result.added, result.merged), (1, 1));
      final card = (await repository.listCards(deck.id)).single;
      expect(card.back, [..._shown('cat'), ..._shown('talk')]);
    },
  );

  test(
    'inserted and merged cards are left unsynced for sync to push',
    () async {
      final deck = await french();
      await db
          .update(db.cards)
          .write(const CardsCompanion(dirty: Value(false)));
      // Setup: every card starts synced.
      expect((await db.select(db.cards).get()).map((row) => row.dirty), [
        false,
      ]);

      await repository.addCards(AddToDeck(deck.id), [
        _card('chat', 'talk', DuplicateChoice.mergeBack),
        _card('chien', 'dog'),
      ]);

      final rows = await db.select(db.cards).get();
      expect(rows.map((row) => (row.cardKey, row.dirty)), [
        ('chat', true),
        ('chien', true),
      ]);
    },
  );

  test('an import into a deleted deck is refused and writes nothing', () async {
    final deck = await french();
    final spanish = await repository.createDeck('Spanish');
    await repository.deleteDeck(deck.id);

    await expectLater(
      repository.addCards(AddToDeck(deck.id), [_card('chien', 'dog')]),
      throwsA(isA<DeckDeleted>()),
    );
    // Control: the same import into a deck that stands is saved.
    final control = await repository.addCards(AddToDeck(spanish.id), [
      _card('chien', 'dog'),
    ]);
    expect(control.added, 1);
    expect(await repository.watchCardCounts().first, {spanish.id: 1});
  });
}
