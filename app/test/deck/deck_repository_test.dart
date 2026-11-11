import 'dart:io';

import 'package:drift/drift.dart' show Value;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_template.dart';
import 'package:knowno/media/media.dart';

import '../media/fakes.dart';
import 'two_sides.dart';

List<Content> _text(String text) => [TextContent(text)];

/// [text] as a card of the frame shows it.
List<Content> _shown(String text) => [TextContent(text, markup: true)];

DeckRepository _repository(AppDatabase db) {
  var nextId = 0;
  var tick = 0;
  return DeckRepository(
    db,
    clock: () => DateTime.utc(2026, 1, 1).add(Duration(seconds: tick++)),
    newId: () => 'id-${nextId++}',
  );
}

Card _saved(SaveCardResult result) => switch (result) {
  CardSaved(:final card) => card,
  DuplicateFront() => fail('expected the card to be saved, got $result'),
};

void main() {
  group('with an in-memory database', () {
    late AppDatabase db;
    late DeckRepository repository;

    setUp(() {
      db = AppDatabase(NativeDatabase.memory());
      repository = _repository(db);
    });

    tearDown(() => db.close());

    Future<List<Card>> cardsOf(DeckId deckId) =>
        repository.watchCards(deckId).first;

    group('where the server has a deck', () {
      final at = DateTime.utc(2026, 10, 15);

      test('each state is stored as the server stores it and read back as '
          'the same state', () async {
        final deck = await repository.createDeck('French');
        expect(deck.visibility, isA<PrivateDeck>());
        final stored = <DeckVisibility, (String, String, bool)>{
          const PrivateDeck(): ('private', 'private', false),
          CheckingDeck(at): ('public', 'checking', true),
          HeldDeck(at): ('public', 'held', true),
          const RefusedDeck(): ('private', 'refused', false),
          PublicDeck(at): ('public', 'public', true),
        };

        for (final MapEntry(key: state, value: columns) in stored.entries) {
          final read = await repository.setVisibility(deck.id, state);
          final row = await db.select(db.decks).getSingle();

          expect(read.visibility.runtimeType, state.runtimeType);
          expect((row.visibility, row.publication), (columns.$1, columns.$2));
          expect(row.publishedAt != null, columns.$3);
          expect(read.visibility.requested, columns.$3);
        }
      });

      test('a row whose two columns disagree reads as the one state the '
          'server shows', () async {
        final deck = await repository.createDeck('French');
        Future<DeckVisibility> read(
          String visibility,
          String publication,
        ) async {
          await (db.update(
            db.decks,
          )..where((d) => d.id.equals(deck.id.value))).write(
            DecksCompanion(
              visibility: Value(visibility),
              publication: Value(publication),
              publishedAt: Value(visibility == 'public' ? at : null),
            ),
          );
          return (await repository.getDeck(deck.id)).visibility;
        }

        expect(await read('public', 'refused'), isA<PublicDeck>());
        expect(await read('public', 'private'), isA<PublicDeck>());
        expect(await read('private', 'held'), isA<PrivateDeck>());
        expect(await read('private', 'public'), isA<PrivateDeck>());
      });
    });

    group('duplicate rule', () {
      test(
        'refuses an equal key in the same deck and allows it in another deck',
        () async {
          final french = await repository.createDeck('French');
          final spanish = await repository.createDeck('Spanish');
          final first = _saved(
            await repository.addCard(
              french.id,
              front: _text('Hola'),
              back: _text('hello'),
            ),
          );
          expect(await cardsOf(french.id), hasLength(1));

          final sameDeck = await repository.addCard(
            french.id,
            front: _text('  HOLA '),
            back: _text('hi'),
          );
          final otherDeck = await repository.addCard(
            spanish.id,
            front: _text('  HOLA '),
            back: _text('hi'),
          );

          expect(sameDeck, isA<DuplicateFront>());
          expect((sameDeck as DuplicateFront).existing.id, first.id);
          expect(await cardsOf(french.id), hasLength(1));
          expect(otherDeck, isA<CardSaved>());
          expect(await cardsOf(spanish.id), hasLength(1));
        },
      );

      test("a cloze card's key is its filled text: a cloze filling to a stored "
          'front collides, and one filling to another does not', () async {
        final french = await repository.createDeck('French');
        _saved(
          await repository.addCard(
            french.id,
            front: _text('Paris is in France'),
            back: _text('capital'),
          ),
        );

        final same = await repository.addCard(
          french.id,
          front: [const ClozeContent('{{c1::Paris}} is in France')],
          back: _text('Paris is in France'),
        );
        // Control: a cloze filling to another text is a new card.
        final other = await repository.addCard(
          french.id,
          front: [const ClozeContent('{{c1::Lyon}} is in France')],
          back: _text('Lyon is in France'),
        );

        expect(same, isA<DuplicateFront>());
        expect(other, isA<CardSaved>());
        expect((await cardsOf(french.id)).last.front, [
          const ClozeContent('{{c1::Lyon}} is in France'),
        ]);
      });

      test('add anyway stores the second card', () async {
        final deck = await repository.createDeck('French');
        await repository.addCard(
          deck.id,
          front: _text('chat'),
          back: _text('cat'),
        );
        expect(await cardsOf(deck.id), hasLength(1));

        final result = await repository.addCard(
          deck.id,
          front: _text('Chat'),
          back: _text('chat (talk)'),
          allowDuplicate: true,
        );

        expect(result, isA<CardSaved>());
        final cards = await cardsOf(deck.id);
        expect(cards.map((card) => card.back), [
          _shown('cat'),
          _shown('chat (talk)'),
        ]);
      });

      test('refuses an edit that collides with another card and allows one that keeps its own key', () async {
        final deck = await repository.createDeck('French');
        final chat = _saved(
          await repository.addCard(
            deck.id,
            front: _text('chat'),
            back: _text('cat'),
          ),
        );
        final chien = _saved(
          await repository.addCard(
            deck.id,
            front: _text('chien'),
            back: _text('dog'),
          ),
        );

        final collision = await repository.editCard(
          chien,
          front: _text('CHAT'),
          back: _text('dog'),
        );
        final ownKey = await repository.editCard(
          chien,
          front: _text('Chien'),
          back: _text('dog!'),
        );

        expect(collision, isA<DuplicateFront>());
        expect((collision as DuplicateFront).existing.id, chat.id);
        expect(ownKey, isA<CardSaved>());
        final cards = await cardsOf(deck.id);
        expect(cards.map((card) => card.front), [
          _shown('chat'),
          _text('Chien'),
        ]);
      });
    });

    test('editing a card stores the new front, back, and key', () async {
      final deck = await repository.createDeck('French');
      final card = _saved(
        await repository.addCard(deck.id, front: _text('a'), back: _text('b')),
      );

      await repository.editCard(
        card,
        front: _text('Pomme'),
        back: _text('apple'),
      );

      final stored = (await cardsOf(deck.id)).single;
      expect(stored.front, _text('Pomme'));
      expect(stored.back, _text('apple'));
      expect(stored.cardKey, CardKey.fromFront('pomme'));
      expect(stored.source, CardSource.manual);
    });

    test('deleting a card removes only that card', () async {
      final deck = await repository.createDeck('French');
      final kept = _saved(
        await repository.addCard(deck.id, front: _text('a'), back: _text('1')),
      );
      final removed = _saved(
        await repository.addCard(deck.id, front: _text('b'), back: _text('2')),
      );

      await repository.deleteCard(removed.id);

      expect((await cardsOf(deck.id)).map((card) => card.id), [kept.id]);
    });

    test(
      'counts each deck\'s cards, and leaves out a deck with none',
      () async {
        final french = await repository.createDeck('French');
        final spanish = await repository.createDeck('Spanish');
        final empty = await repository.createDeck('Empty');
        for (final front in ['a', 'b', 'c']) {
          await repository.addCard(
            french.id,
            front: _text(front),
            back: _text('1'),
          );
        }
        await repository.addCard(
          spanish.id,
          front: _text('a'),
          back: _text('1'),
        );

        final counts = await repository.watchCardCounts().first;

        expect(counts, {french.id: 3, spanish.id: 1});
        expect(counts.containsKey(empty.id), isFalse);
      },
    );

    test('renaming a deck changes its name', () async {
      final deck = await repository.createDeck('Frnech');

      await repository.renameDeck(deck.id, 'French');

      expect((await repository.watchDecks().first).single.name, 'French');
    });

    test("setting a deck's appearance stores both keys, unsynced, and other decks keep the default", () async {
      final french = await repository.createDeck('French');
      final spanish = await repository.createDeck('Spanish');
      await db
          .update(db.decks)
          .write(const DecksCompanion(dirty: Value(false)));

      await repository.setAppearance(
        french.id,
        DeckIcon.book,
        DeckColor.violet,
      );

      final decks = {
        for (final deck in await repository.watchDecks().first) deck.id: deck,
      };
      expect(
        (decks[french.id]!.icon, decks[french.id]!.color),
        (DeckIcon.book, DeckColor.violet),
      );

      // Saving an icon alone stores no colour, so none reads as chosen.
      await repository.setAppearance(spanish.id, DeckIcon.star, null);
      final spanishNow = await repository.getDeck(spanish.id);
      expect(spanishNow.icon, DeckIcon.star);
      expect(spanishNow.color, isNull);
      expect((decks[spanish.id]!.icon, decks[spanish.id]!.color), (null, null));
      final row = await (db.select(
        db.decks,
      )..where((deck) => deck.id.equals(french.id.value))).getSingle();
      expect((row.icon, row.color, row.dirty), ('book', 'violet', true));
      expect(row.updatedAt.isAfter(french.updatedAt), isTrue);
    });

    test('listKeys gives the keys of the deck\'s live cards alone', () async {
      final deck = await repository.createDeck('Colours');
      final other = await repository.createDeck('Other');
      Future<Card> add(DeckId into, String front) async {
        final saved = await repository.addCard(
          into,
          front: [TextContent(front)],
          back: const [TextContent('back')],
        );
        return (saved as CardSaved).card;
      }

      await add(deck.id, ' Rose  Red ');
      final deleted = await add(deck.id, 'Gone');
      await add(other.id, 'Elsewhere');
      expect(await repository.listKeys(deck.id), {
        CardKey.fromFront('rose red'),
        CardKey.fromFront('gone'),
      });
      await repository.deleteCard(deleted.id);
      expect(await repository.listKeys(deck.id), {
        CardKey.fromFront('rose red'),
      });
    });

    group('adding a framed card', () {
      const cloze = ClozeContent('{{c1::Rose}} is red.');
      const cells = [BlankCell(cloze), TextCell(back: 'A flower.')];
      final sides = sidesOf(cells);
      final incoming = IncomingCard(
        front: sides.front,
        back: sides.back,
        cells: cells,
        onDuplicate: DuplicateChoice.mergeBack,
      );

      Future<CardRow> row(DeckId deck) => (db.select(
        db.cards,
      )..where((card) => card.deckId.equals(deck.value))).getSingle();

      test('stores its 칸 list in free v2, each block with an id, its back '
          'empty', () async {
        final deck = await repository.createDeck('Colours');
        await repository.addCards(AddToDeck(deck.id), [incoming]);

        final stored = await row(deck.id);
        expect(stored.template, 'free');
        expect(stored.templateVersion, 2);
        expect(stored.back, '[]');
        expect(decodeCells(stored.front), cells);
        expect(
          decodeCells(stored.front).every((cell) => cell.id != null),
          isTrue,
        );
        expect(stored.cardKey, frameKey(cells).value);
        expect((await cardsOf(deck.id)).single.cells, cells);

        // Control: a card of two sides stays at free v1.
        final other = await repository.createDeck('Other');
        await repository.addCards(AddToDeck(other.id), [
          const IncomingCard(
            front: [TextContent('Rose')],
            back: [TextContent('red')],
            onDuplicate: DuplicateChoice.addNew,
          ),
        ]);
        expect((await row(other.id)).templateVersion, 1);
      });

      test('a merged back joins a stored 칸 list as a 글 with a back alone, '
          'never in the back column', () async {
        final deck = await repository.createDeck('Colours');
        await repository.addCards(AddToDeck(deck.id), [incoming]);

        final added = await repository.addCards(AddToDeck(deck.id), [
          IncomingCard(
            front: sides.front,
            back: const [TextContent('Also a colour.')],
            onDuplicate: DuplicateChoice.mergeBack,
          ),
        ]);

        expect(added.merged, 1);
        final stored = await row(deck.id);
        expect(stored.back, '[]');
        expect(stored.templateVersion, 2);
        expect(decodeCells(stored.front), [
          ...cells,
          const TextCell(back: 'Also a colour.'),
        ]);
      });

      test('a merge onto a framed card the editor can edit keeps it in the '
          'frame, which the editor then opens with the merged 글', () async {
        final deck = await repository.createDeck('Colours');
        await repository.addCards(AddToDeck(deck.id), [incoming]);
        final before = (await cardsOf(deck.id)).single;
        expect(canEdit(before), isTrue, reason: 'the setup: editable');

        await repository.addCards(AddToDeck(deck.id), [
          IncomingCard(
            front: sides.front,
            back: const [TextContent('Also a colour.')],
            onDuplicate: DuplicateChoice.mergeBack,
          ),
        ]);

        final stored = await row(deck.id);
        expect((stored.template, stored.templateVersion), ('free', 2));
        final card = (await cardsOf(deck.id)).single;
        expect(card.cells, [...cells, const TextCell(back: 'Also a colour.')]);
        expect(cellsOf(card), card.cells);
      });

      test('the editor\'s save writes its 칸 in free v2 with the back empty, '
          'keyed by what shows before the reveal, and a card of two sides '
          'is taken into the frame', () async {
        final deck = await repository.createDeck('Colours');
        const saved = [TextCell(front: 'Rose', back: 'A flower.')];
        final projection = sidesOf(saved);
        final added = await repository.addCard(
          deck.id,
          front: projection.front,
          back: projection.back,
          cells: saved,
        );
        expect(added, isA<CardSaved>());
        final stored = await row(deck.id);
        expect((stored.template, stored.templateVersion), ('free', 2));
        expect(stored.back, '[]');
        expect(stored.cardKey, frameKey(saved).value);
        expect(decodeCells(stored.front), saved);

        final other = await repository.createDeck('Other');
        final card = await storeSides(
          db,
          repository,
          other.id,
          front: const [TextContent('Rose')],
          back: const [TextContent('A flower.')],
        );
        expect(card.templateVersion, 1, reason: 'the setup: two side lists');
        await repository.editCard(
          card,
          front: projection.front,
          back: projection.back,
          cells: saved,
        );
        final edited = await row(other.id);
        expect((edited.template, edited.templateVersion), ('free', 2));
        expect(edited.back, '[]');
        expect(decodeCells(edited.front), saved);
      });

      test('a back already on the card, or none, merges nothing into a stored '
          '칸 list', () async {
        final deck = await repository.createDeck('Colours');
        await repository.addCards(AddToDeck(deck.id), [incoming]);

        final added = await repository.addCards(AddToDeck(deck.id), [
          IncomingCard(
            front: sides.front,
            back: const [TextContent('A flower.')],
            onDuplicate: DuplicateChoice.mergeBack,
          ),
          IncomingCard(
            front: sides.front,
            back: const [],
            onDuplicate: DuplicateChoice.mergeBack,
          ),
        ]);

        expect(added.merged, 0);
        expect(decodeCells((await row(deck.id)).front), cells);
      });
    });

    group("a deck's image", () {
      late Directory directory;
      late FakeMediaServer server;
      late MediaStore media;

      setUp(() {
        directory = newMediaDirectory();
        server = FakeMediaServer();
        var nextMedia = 0;
        media = MediaStore(
          db,
          server,
          directory: directory,
          clock: () => DateTime.utc(2026, 1, 1),
          newId: () =>
              '00000000-0000-4000-8000-${'${nextMedia++}'.padLeft(12, '0')}',
        );
        repository = DeckRepository(
          db,
          clock: DateTime.now,
          newId: () => 'id-${nextMedia++}',
          media: media,
        );
      });

      tearDown(() => deleteMediaDirectory(directory));

      Future<List<String>> releasedIds() async => [
        for (final row in await db.select(db.mediaDeletions).get()) row.id,
      ];

      test(
        'is stored, unsynced, and a new one releases the one it replaces',
        () async {
          final deck = await repository.createDeck('French');
          final first = await media.addImage(preparedImage(1));
          final second = await media.addImage(preparedImage(2));

          await repository.setImage(deck.id, first);
          expect((await repository.getDeck(deck.id)).image, first);
          expect(await releasedIds(), isEmpty);

          await db
              .update(db.decks)
              .write(const DecksCompanion(dirty: Value(false)));
          await repository.setImage(deck.id, second);
          final row = await db.select(db.decks).getSingle();
          expect((row.imageMediaId, row.dirty), (second.value, true));
          expect(await releasedIds(), [first.value]);
        },
      );

      test(
        'removed, leaves the deck its icon and releases the image',
        () async {
          final deck = await repository.createDeck('French');
          final image = await media.addImage(preparedImage(1));
          await repository.setImage(deck.id, image);

          await repository.setImage(deck.id, null);

          expect((await repository.getDeck(deck.id)).image, isNull);
          expect(await releasedIds(), [image.value]);
        },
      );

      test("is released with its deck, and another deck's is kept", () async {
        final french = await repository.createDeck('French');
        final spanish = await repository.createDeck('Spanish');
        final frenchImage = await media.addImage(preparedImage(1));
        final spanishImage = await media.addImage(preparedImage(2));
        await repository.setImage(french.id, frenchImage);
        await repository.setImage(spanish.id, spanishImage);

        await repository.deleteDeck(french.id);

        expect(await releasedIds(), [frenchImage.value]);
        expect((await repository.getDeck(spanish.id)).image, spanishImage);
      });

      test("a card's sound is kept through an edit that keeps it, released by one that drops it, and with its card (ADR 0112)", () async {
        final deck = await repository.createDeck('French');
        final first = await media.addAudio(preparedAudio(1000));
        final second = await media.addAudio(preparedAudio(2000));
        AudioContent sound(MediaId id) =>
            AudioContent(media: id, duration: const Duration(seconds: 1));
        final card = await storeSides(
          db,
          repository,
          deck.id,
          front: [const TextContent('listen'), sound(first)],
          back: const [TextContent('cat')],
        );
        final other = await storeSides(
          db,
          repository,
          deck.id,
          front: const [TextContent('dog')],
          back: [sound(second)],
        );

        final kept = await repository.editCard(
          card,
          front: [const TextContent('hear it'), sound(first)],
          back: card.back,
        );
        expect(await releasedIds(), isEmpty, reason: 'kept');
        await repository.editCard(
          (kept as CardSaved).card,
          front: const [TextContent('no sound')],
          back: card.back,
        );
        expect(await releasedIds(), [first.value]);

        await repository.deleteCard(other.id);
        expect(await releasedIds(), [first.value, second.value]);
      });

      group("a card's photo (ADR 0109)", () {
        ImageContent photo(MediaId media) => ImageContent(
          media: media,
          width: 4,
          height: 3,
          boxes: const [ImageBox(id: '1', x: 0, y: 0, w: 0.5, h: 0.5)],
        );

        Future<Card> cardWith(Deck deck, MediaId media, String front) =>
            storeSides(
              db,
              repository,
              deck.id,
              front: [TextContent(front), photo(media)],
              back: const [TextContent('back')],
            );

        test('is kept through an edit that keeps it, and released by one that drops it', () async {
          final deck = await repository.createDeck('French');
          final image = await media.addImage(preparedImage(1));
          final card = await cardWith(deck, image, 'a photo');

          final kept = await repository.editCard(
            card,
            front: [const TextContent('the photo'), photo(image)],
            back: card.back,
          );
          expect(await releasedIds(), isEmpty, reason: 'kept');

          await repository.editCard(
            (kept as CardSaved).card,
            front: const [TextContent('no photo')],
            back: card.back,
          );
          expect(await releasedIds(), [image.value]);
        });

        test("is released with its card, and with its deck, and another card's is kept", () async {
          final french = await repository.createDeck('French');
          final spanish = await repository.createDeck('Spanish');
          final first = await media.addImage(preparedImage(1));
          final second = await media.addImage(preparedImage(2));
          final third = await media.addImage(preparedImage(3));
          final deleted = await cardWith(french, first, 'one');
          await cardWith(french, second, 'two');
          await cardWith(spanish, third, 'three');

          await repository.deleteCard(deleted.id);
          expect(await releasedIds(), [first.value]);

          await repository.deleteDeck(french.id);
          expect(await releasedIds(), [first.value, second.value]);
          expect(
            (await repository.listCards(spanish.id)).single.front,
            contains(photo(third)),
          );
        });

        test('an edit releases what the stored card held, not what the given copy holds', () async {
          final deck = await repository.createDeck('French');
          final image = await media.addImage(preparedImage(1));
          final stale = await storeSides(
            db,
            repository,
            deck.id,
            front: _text('no photo yet'),
            back: _text('back'),
          );
          // Another writer, as sync would, gives the stored card a photo.
          await repository.editCard(
            stale,
            front: [const TextContent('a photo'), photo(image)],
            back: stale.back,
          );
          expect(
            (await repository.listCards(deck.id)).single.front,
            contains(photo(image)),
          );

          await repository.editCard(
            stale,
            front: _text('no photo'),
            back: stale.back,
          );

          expect(await releasedIds(), [image.value]);
        });

        test(
          'shared by two cards is kept until the last of them lets it go',
          () async {
            final french = await repository.createDeck('French');
            final spanish = await repository.createDeck('Spanish');
            final shared = await media.addImage(preparedImage(1));
            final first = await cardWith(french, shared, 'one');
            final copy = await cardWith(french, shared, 'copy');
            final other = await cardWith(spanish, shared, 'other');

            await repository.editCard(
              first,
              front: _text('no photo'),
              back: first.back,
            );
            await repository.deleteCard(copy.id);
            await repository.deleteDeck(french.id);
            expect(
              await releasedIds(),
              isEmpty,
              reason: 'the Spanish card holds it',
            );

            await repository.deleteCard(other.id);
            expect(await releasedIds(), [shared.value]);
          },
        );

        test("equal to a deck's image is kept until both let it go", () async {
          final french = await repository.createDeck('French');
          final spanish = await repository.createDeck('Spanish');
          final first = await media.addImage(preparedImage(1));
          final second = await media.addImage(preparedImage(2));
          await repository.setImage(french.id, first);
          final frenchCard = await cardWith(french, first, 'one');
          await repository.setImage(spanish.id, second);
          final spanishCard = await cardWith(spanish, second, 'two');

          await repository.deleteCard(frenchCard.id);
          await repository.setImage(spanish.id, null);
          expect(await releasedIds(), isEmpty, reason: 'each is still held');

          await repository.setImage(french.id, null);
          await repository.deleteCard(spanishCard.id);
          expect(await releasedIds(), [first.value, second.value]);
        });
      });
    });

    test('a key this build does not know reads as none, and the stored key is kept through an edit', () async {
      final deck = await repository.createDeck('French');
      await (db.update(
        db.decks,
      )..where((row) => row.id.equals(deck.id.value))).write(
        const DecksCompanion(icon: Value('rocket'), color: Value('teal')),
      );

      final read = await repository.getDeck(deck.id);
      expect((read.icon, read.color), (null, null));

      // A rename writes the name alone, so a newer app's keys survive it.
      await repository.renameDeck(deck.id, 'Français');
      final row = await db.select(db.decks).getSingle();
      expect((row.name, row.icon, row.color), ('Français', 'rocket', 'teal'));
    });

    test('deleting a deck tombstones it and its cards, unsynced, and leaves other decks', () async {
      final french = await repository.createDeck('French');
      final spanish = await repository.createDeck('Spanish');
      await repository.addCard(french.id, front: _text('a'), back: _text('1'));
      await repository.addCard(spanish.id, front: _text('b'), back: _text('2'));
      expect(await repository.countCards(french.id), 1);

      await repository.deleteDeck(french.id);

      final rows = await db.select(db.cards).get();
      expect(
        {
          for (final row in rows)
            row.deckId: (row.deletedAt != null, row.dirty),
        },
        {french.id.value: (true, true), spanish.id.value: (false, true)},
      );
      final deck = await (db.select(
        db.decks,
      )..where((row) => row.id.equals(french.id.value))).getSingle();
      expect([deck.deletedAt != null, deck.dirty], [true, true]);
      expect((await repository.watchDecks().first).map((deck) => deck.id), [
        spanish.id,
      ]);
      expect(await repository.countCards(french.id), 0);
      expect(await repository.watchCardCounts().first, {spanish.id: 1});
    });

    test(
      'a tombstoned card is out of every list and of the duplicate check',
      () async {
        final deck = await repository.createDeck('French');
        final removed = _saved(
          await repository.addCard(
            deck.id,
            front: _text('chat'),
            back: _text('1'),
          ),
        );

        await repository.deleteCard(removed.id);

        expect(await repository.listCards(deck.id), isEmpty);
        expect(await cardsOf(deck.id), isEmpty);
        final again = await repository.addCard(
          deck.id,
          front: _text('Chat'),
          back: _text('2'),
        );
        expect(again, isA<CardSaved>());
        // Control: a live card with the same key is still a duplicate.
        expect(
          await repository.addCard(
            deck.id,
            front: _text('chat'),
            back: _text('3'),
          ),
          isA<DuplicateFront>(),
        );
      },
    );

    test('every edit leaves its row unsynced', () async {
      final deck = await repository.createDeck('French');
      final card = _saved(
        await repository.addCard(deck.id, front: _text('a'), back: _text('1')),
      );
      await db
          .update(db.decks)
          .write(const DecksCompanion(dirty: Value(false)));
      await db
          .update(db.cards)
          .write(const CardsCompanion(dirty: Value(false)));

      await repository.renameDeck(deck.id, 'Français');
      await repository.editCard(card, front: _text('b'), back: _text('2'));

      expect((await db.select(db.decks).getSingle()).dirty, isTrue);
      expect((await db.select(db.cards).getSingle()).dirty, isTrue);
    });

    test('reads a stored block of an unknown type without failing', () async {
      final deck = await repository.createDeck('French');
      await db
          .into(db.cards)
          .insert(
            CardsCompanion.insert(
              id: 'stored',
              deckId: deck.id.value,
              front:
                  '[{"type":"text","payload":{"text":"chat"}},'
                  '{"type":"video","payload":{"path":"chat.mp4"}}]',
              back: '[{"type":"text","payload":{"text":"cat"}}]',
              cardKey: 'chat',
              source: 'manual',
              createdAt: DateTime.utc(2026),
              updatedAt: DateTime.utc(2026),
            ),
          );

      final card = (await cardsOf(deck.id)).single;

      expect(card.front.first, const TextContent('chat'));
      expect(card.front.last, isA<UnsupportedContent>());
    });

    test('a write the database refuses is a storage failure, and a valid one is not', () async {
      final deck = await repository.createDeck('French');

      final valid = repository.addCard(
        deck.id,
        front: _text('chat'),
        back: _text('cat'),
      );
      final orphan = repository.addCard(
        const DeckId('missing'),
        front: _text('chien'),
        back: _text('dog'),
      );

      await expectLater(valid, completion(isA<CardSaved>()));
      await expectLater(orphan, throwsA(isA<StorageFailure>()));
    });

    test(
      'a stored card that cannot be decoded is reported as unreadable',
      () async {
        final deck = await repository.createDeck('French');
        await db
            .into(db.cards)
            .insert(
              CardsCompanion.insert(
                id: 'broken',
                deckId: deck.id.value,
                front: 'not json',
                back: '[]',
                cardKey: 'broken',
                source: 'manual',
                createdAt: DateTime.utc(2026),
                updatedAt: DateTime.utc(2026),
              ),
            );

        await expectLater(
          cardsOf(deck.id),
          throwsA(
            isA<UnreadableCard>().having(
              (failure) => failure.cardId,
              'cardId',
              const CardId('broken'),
            ),
          ),
        );
      },
    );

    test('an edit whose content the decoder refuses is not stored, and the deck still lists, where a readable edit is', () async {
      final deck = await repository.createDeck('French');
      final saved = await repository.addCard(
        deck.id,
        front: [const ClozeContent('a {{c1::x}} b')],
        back: [const TextContent('a x b')],
      );
      final card = (saved as CardSaved).card;

      // A table with a blank outside it: a shape the decoder refuses.
      await expectLater(
        repository.editCard(
          card,
          front: [
            const TableContent(
              columns: ['a'],
              rows: [
                ['1'],
              ],
              blanks: [(row: 3, column: 0)],
            ),
          ],
          back: [const TextContent('a x b c')],
        ),
        throwsA(isA<UnreadableCard>()),
      );
      expect((await cardsOf(deck.id)).single.front, card.front);

      // Control: a readable edit of the same card is stored.
      await repository.editCard(
        card,
        front: [const ClozeContent('a {{c1::x}} b c')],
        back: [const TextContent('a x b c')],
      );
      expect((await cardsOf(deck.id)).single.front, [
        const ClozeContent('a {{c1::x}} b c'),
      ]);
    });

    test('the cards table indexes deck id and card key', () async {
      final indexes = await db
          .customSelect(
            "SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cards'",
          )
          .map((row) => row.read<String?>('sql'))
          .get();

      expect(indexes, contains(contains('(deck_id, card_key)')));
    });
  });

  test(
    'data written before closing the database is read after reopening',
    () async {
      final dir = await Directory.systemTemp.createTemp('knowno_db');
      addTearDown(() => dir.delete(recursive: true));
      final file = File('${dir.path}/knowno.sqlite');

      final before = AppDatabase(NativeDatabase(file));
      final writer = _repository(before);
      final deck = await writer.createDeck('French');
      await writer.addCard(deck.id, front: _text('chat'), back: _text('cat'));
      await before.close();

      final after = AppDatabase(NativeDatabase(file));
      addTearDown(after.close);
      final reopened = _repository(after);

      expect((await reopened.watchDecks().first).single.name, 'French');
      final card = (await reopened.watchCards(deck.id).first).single;
      expect(card.front, _shown('chat'));
      expect(card.back, _shown('cat'));
    },
  );
}
