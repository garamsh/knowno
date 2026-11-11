import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import '../deck/two_sides.dart';
import '../media/fakes.dart';
import 'device.dart';
import 'fake_sync_server.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');
const _grace = UserId('00000000-0000-4000-8000-00000000000b');

List<Content> _text(String text) => [TextContent(text)];

void main() {
  late Scheduler scheduler;
  late FakeSyncServer server;
  late Device a;
  late Device b;

  setUpAll(() async => scheduler = await Scheduler.load());

  setUp(() {
    server = FakeSyncServer(_ada);
    a = Device('a', server, scheduler);
    b = Device('b', server, scheduler);
  });

  tearDown(() async {
    await a.close();
    await b.close();
  });

  Future<Card> addCard(Device device, Deck deck, String front) async {
    final saved = await device.deck.addCard(
      deck.id,
      front: _text(front),
      back: _text('$front back'),
      allowDuplicate: true,
    );
    return (saved as CardSaved).card;
  }

  test("a deck's image removed on one device is removed on the other, where a set one arrives", () async {
    final deck = await a.deck.createDeck('French');
    final image = await a.media.addImage(preparedImage(1));
    await a.deck.setImage(deck.id, image);
    await a.sync(_ada);
    await b.sync(_ada);
    expect((await b.deck.getDeck(deck.id)).image, image);

    a.now = a.now.add(const Duration(minutes: 1));
    await a.deck.setImage(deck.id, null);
    await a.sync(_ada);
    await b.sync(_ada);

    expect((await b.deck.getDeck(deck.id)).image, isNull);
  });

  group('push', () {
    test('sends every unsynced row and marks it synced', () async {
      final deck = await a.deck.createDeck('French');
      await addCard(a, deck, 'chat');
      expect(await a.store.hasUnsynced(), isTrue);

      await a.sync(_ada);

      expect(server.decks.keys, [deck.id.value]);
      expect(server.cards, hasLength(1));
      expect(await a.store.hasUnsynced(), isFalse);
    });

    test('a row edited while its push is under way stays unsynced', () async {
      final deck = await a.deck.createDeck('French');
      server.beforePush = (table) async {
        if (table != 'decks') return;
        a.now = a.now.add(const Duration(seconds: 1));
        await a.deck.renameDeck(deck.id, 'Français');
      };

      await a.sync(_ada);

      expect(server.decks[deck.id.value]!.row.name, 'French');
      expect(await a.store.hasUnsynced(), isTrue);
      // Control: the next run pushes the edit and leaves nothing unsynced.
      server.beforePush = null;
      await a.sync(_ada);
      expect(server.decks[deck.id.value]!.row.name, 'Français');
      expect(await a.store.hasUnsynced(), isFalse);
    });
  });

  group('pull', () {
    test(
      'brings rows above the cursor page by page, and moves the cursor',
      () async {
        final paged = Device('paged', server, scheduler, pageSize: 2);
        addTearDown(paged.close);
        final deck = await a.deck.createDeck('French');
        for (final front in ['un', 'deux', 'trois', 'quatre', 'cinq']) {
          a.now = a.now.add(const Duration(seconds: 1));
          await addCard(a, deck, front);
        }
        await a.sync(_ada);

        await paged.sync(_ada);

        final cards = await paged.deck.listCards(deck.id);
        expect(cards.map((card) => plainText(card.front)), [
          'un',
          'deux',
          'trois',
          'quatre',
          'cinq',
        ]);
        final last = server.cards.values
            .map((stored) => stored.revision)
            .reduce((x, y) => x > y ? x : y);
        expect((await paged.store.cursors()).cardsRevision, last);
        // Control: a pull from the moved cursor asks for nothing already seen.
        server.requests.clear();
        await paged.sync(_ada);
        expect(server.requests.where((r) => r == 'pullCards'), hasLength(1));
      },
    );

    test('stops a page at a row whose parent has not arrived', () async {
      final deck = await a.deck.createDeck('French');
      await addCard(a, deck, 'chat');
      await a.sync(_ada);
      await b.store.claim(_ada);
      final card = server.cards.values.single;

      final stopped = await b.store.applyCards([
        (row: card.row, revision: card.revision),
      ]);

      expect(stopped.complete, isFalse);
      expect(await b.db.select(b.db.cards).get(), isEmpty);
      expect((await b.store.cursors()).cardsRevision, 0);
      // Control: once the deck is on the device, the same page applies.
      final stored = server.decks.values.single;
      await b.store.applyDecks([(row: stored.row, revision: stored.revision)]);
      final applied = await b.store.applyCards([
        (row: card.row, revision: card.revision),
      ]);
      expect(applied.complete, isTrue);
      expect(await b.db.select(b.db.cards).get(), hasLength(1));
      expect((await b.store.cursors()).cardsRevision, card.revision);
    });

    test('a pulled row that loses its merge is pushed back', () async {
      final deck = await a.deck.createDeck('French');
      await a.sync(_ada);
      await b.sync(_ada);
      // B's later rename reaches the server first; A's earlier one overwrites it.
      b.now = a.now.add(const Duration(minutes: 2));
      await b.deck.renameDeck(deck.id, 'Later');
      await b.sync(_ada);
      a.now = a.now.add(const Duration(minutes: 1));
      await a.deck.renameDeck(deck.id, 'Earlier');
      await a.store.claim(_ada);
      await server.pushDecks(_ada, await a.store.unsyncedDecks());

      await b.sync(_ada);

      expect(await b.deckNames(), ['Later']);
      expect(server.decks[deck.id.value]!.row.name, 'Later');
    });
  });

  group('conflicts', () {
    Future<Deck> shared() async {
      final deck = await a.deck.createDeck('French');
      await a.sync(_ada);
      await b.sync(_ada);
      return deck;
    }

    test('an edit conflict keeps the later edit on both devices', () async {
      final deck = await shared();
      a.now = a.now.add(const Duration(minutes: 1));
      b.now = b.now.add(const Duration(minutes: 2));
      await a.deck.renameDeck(deck.id, 'Earlier');
      await b.deck.renameDeck(deck.id, 'Later');

      await b.sync(_ada);
      await a.sync(_ada);

      expect(await a.deckNames(), ['Later']);
      expect(await b.deckNames(), ['Later']);
    });

    test('the same edits with A\'s later keep A\'s', () async {
      final deck = await shared();
      a.now = a.now.add(const Duration(minutes: 2));
      b.now = b.now.add(const Duration(minutes: 1));
      await a.deck.renameDeck(deck.id, 'Later');
      await b.deck.renameDeck(deck.id, 'Earlier');

      await b.sync(_ada);
      await a.sync(_ada);
      await b.sync(_ada);

      expect(await a.deckNames(), ['Later']);
      expect(await b.deckNames(), ['Later']);
    });

    test('a delete beats a later concurrent edit', () async {
      final deck = await shared();
      a.now = a.now.add(const Duration(minutes: 1));
      b.now = b.now.add(const Duration(minutes: 2));
      await a.deck.deleteDeck(deck.id);
      await b.deck.renameDeck(deck.id, 'Edited after');

      await a.sync(_ada);
      await b.sync(_ada);
      await a.sync(_ada);

      expect(await a.deckNames(), isEmpty);
      expect(await b.deckNames(), isEmpty);
      expect(server.decks[deck.id.value]!.row.deletedAt, isNotNull);
    });

    test(
      'a review pulled for a card recomputes its state from every review',
      () async {
        final deck = await shared();
        final card = await addCard(a, deck, 'chat');
        await a.sync(_ada);
        await b.sync(_ada);
        a.now = a.now.add(const Duration(days: 1));
        b.now = b.now.add(const Duration(days: 2));
        await a.answer(card.id, 'good', fuzz: 0.2);
        await b.answer(card.id, 'again', fuzz: 0.7);
        final aBefore = await a.stateOf(card.id);

        await a.sync(_ada);
        await b.sync(_ada);
        await a.sync(_ada);

        final union = (await a.foldOf(card.id))!;
        expect(await a.db.select(a.db.reviews).get(), hasLength(2));
        expect(await b.db.select(b.db.reviews).get(), hasLength(2));
        for (final device in [a, b]) {
          final state = (await device.stateOf(card.id))!;
          expect(
            [
              state.stability,
              state.difficulty,
              state.due.millisecondsSinceEpoch,
            ],
            [
              union.stability,
              union.difficulty,
              union.due.millisecondsSinceEpoch,
            ],
            reason: device.name,
          );
        }
        // Control: A's own state before the pull was not already the union's.
        expect(aBefore!.stability, isNot(union.stability));
      },
    );

    test(
      'a pull that brings no review leaves a card state as it was',
      () async {
        final deck = await shared();
        final card = await addCard(a, deck, 'chat');
        await a.answer(card.id, 'good');
        await a.sync(_ada);
        await b.sync(_ada);
        // A state the fold would not give, written as synced.
        await (b.db.update(b.db.cardStates)).write(
          const CardStatesCompanion(stability: Value(99), dirty: Value(false)),
        );

        await a.deck.renameDeck(deck.id, 'Renamed');
        await a.sync(_ada);
        await b.sync(_ada);

        expect((await b.stateOf(card.id))!.stability, 99);
        // Control: a pulled review does replace it with the fold.
        a.now = a.now.add(const Duration(days: 1));
        await a.answer(card.id, 'good');
        await a.sync(_ada);
        await b.sync(_ada);
        expect(
          (await b.stateOf(card.id))!.stability,
          (await b.foldOf(card.id))!.stability,
        );
      },
    );

    test('equal-key cards from both devices both survive', () async {
      final deck = await shared();
      await addCard(a, deck, 'chat');
      await addCard(b, deck, 'Chat');

      await a.sync(_ada);
      await b.sync(_ada);
      await a.sync(_ada);

      for (final device in [a, b]) {
        final cards = await device.deck.listCards(deck.id);
        expect(cards, hasLength(2), reason: device.name);
        expect(cards.map((card) => card.cardKey.value).toSet(), {'chat'});
      }
    });
  });

  group('horizon', () {
    /// A synced deck row the server does not hold, as a tombstone purged on
    /// the server leaves on a device that never pulled it.
    Future<void> strayDeck(Device device) => device.db
        .into(device.db.decks)
        .insert(
          DecksCompanion.insert(
            id: 'stray',
            name: 'Purged elsewhere',
            createdAt: device.now,
            updatedAt: device.now,
            dirty: const Value(false),
          ),
        );

    Future<List<String>> deckIds(Device device) async => [
      for (final row in await device.db.select(device.db.decks).get()) row.id,
    ];

    test('a table no one writes keeps its cursor at the watermark, so it is not rebuilt as the horizon passes its rows', () async {
      final deck = await a.deck.createDeck('French');
      await a.sync(_ada);
      await b.sync(_ada);
      // Other tables move the sequence on; no deck is written again.
      for (final front in ['un', 'deux', 'trois']) {
        await addCard(b, deck, front);
        await b.sync(_ada);
      }
      await a.sync(_ada);
      final deckRevision = server.decks[deck.id.value]!.revision;
      expect((await a.store.cursors()).decksRevision, server.revision);
      expect(server.revision, greaterThan(deckRevision));
      server.purgedBelow = server.revision;
      await strayDeck(a);

      await a.sync(_ada);

      expect(await deckIds(a), containsAll(['stray', deck.id.value]));
      // Control: a cursor below the horizon rebuilds the table.
      await a.db
          .update(a.db.syncState)
          .write(SyncStateCompanion(decksRevision: Value(deckRevision)));
      await a.sync(_ada);
      expect(await deckIds(a), [deck.id.value]);
    });

    test('a device the horizon passed rebuilds: rows purged elsewhere go, unsynced ones are pushed', () async {
      final kept = await a.deck.createDeck('Kept');
      final purged = await a.deck.createDeck('Purged');
      await a.sync(_ada);
      await b.sync(_ada);
      b.now = b.now.add(const Duration(days: 100));
      final offline = await b.deck.createDeck('Made offline');
      await a.deck.deleteDeck(purged.id);
      await a.sync(_ada);
      // The purge deletes the tombstone and stores the horizon above it.
      server.decks.remove(purged.id.value);
      server.purgedBelow = server.revision;

      await b.sync(_ada);

      expect(await b.deckNames(), unorderedEquals(['Kept', 'Made offline']));
      expect(
        await deckIds(b),
        unorderedEquals([kept.id.value, offline.id.value]),
      );
      expect(server.decks.keys, contains(offline.id.value));
      expect(
        (await b.store.cursors()).decksRevision,
        greaterThanOrEqualTo(server.purgedBelow),
      );
    });

    test('a pushed row whose parent the server no longer holds is deleted, and the rest of its request is pushed', () async {
      final gone = await a.deck.createDeck('Gone');
      final live = await a.deck.createDeck('Live');
      await a.sync(_ada);
      a.now = a.now.add(const Duration(minutes: 1));
      await addCard(a, gone, 'chat');
      final pushed = await addCard(a, live, 'chien');
      // The deck is gone from the server, as a purge elsewhere leaves it.
      server.decks.remove(gone.id.value);

      await a.sync(_ada);

      expect(server.cards.keys, [pushed.id.value]);
      expect(
        [for (final row in await a.db.select(a.db.cards).get()) row.id],
        [pushed.id.value],
      );
      expect(await a.store.hasUnsynced(), isFalse);
    });
  });

  group('local purge', () {
    test('after a run that leaves nothing unsynced, tombstones lose their content in place and the studied card keeps its state', () async {
      final deck = await a.deck.createDeck('French');
      final studied = await addCard(a, deck, 'chat');
      final unstudied = await addCard(a, deck, 'chien');
      await a.answer(studied.id, 'good');
      await a.sync(_ada);
      a.now = a.now.add(const Duration(minutes: 1));
      await a.deck.deleteDeck(deck.id);

      await a.sync(_ada);

      final cards = await a.db.select(a.db.cards).get();
      expect(
        {for (final row in cards) row.id},
        {studied.id.value, unstudied.id.value},
      );
      for (final row in cards) {
        expect(
          [row.front, row.back, row.cardKey, row.deletedAt, row.dirty],
          ['[]', '[]', '', isNotNull, false],
        );
      }
      final stored = await a.db.select(a.db.decks).getSingle();
      expect(
        [stored.name, stored.description, stored.visibility, stored.dirty],
        ['', null, 'private', false],
      );
      expect(await a.db.select(a.db.reviews).get(), hasLength(1));
      expect(
        [
          for (final row in await a.db.select(a.db.cardStates).get())
            row.cardId,
        ],
        [studied.id.value],
      );
      // The server's copies keep their content until its own purge.
      expect(server.decks[deck.id.value]!.row.name, 'French');
    });

    test('waits while a row is unsynced', () async {
      final deck = await a.deck.createDeck('French');
      await addCard(a, deck, 'chat');
      await a.sync(_ada);
      await a.deck.deleteDeck(deck.id);
      server.failure = SyncOffline(Exception('offline'));
      await expectLater(a.sync(_ada), throwsA(isA<SyncOffline>()));
      server.failure = null;
      await a.store.purge();

      expect((await a.db.select(a.db.decks).getSingle()).name, 'French');
      // Control: once the tombstone is pushed, the purge strips it.
      await a.sync(_ada);
      expect((await a.db.select(a.db.decks).getSingle()).name, '');
    });

    test('a review pushed after another device purged its card\'s tombstone reaches that device', () async {
      final z = Device('z', server, scheduler);
      addTearDown(z.close);
      final deck = await a.deck.createDeck('French');
      final card = await addCard(a, deck, 'chat');
      await a.sync(_ada);
      await b.sync(_ada);
      // A studies offline; B deletes the card; Z pulls the tombstone and
      // purges it.
      a.now = a.now.add(const Duration(minutes: 1));
      await a.answer(card.id, 'good');
      b.now = b.now.add(const Duration(minutes: 2));
      await b.deck.deleteCard(card.id);
      await b.sync(_ada);
      await z.sync(_ada);
      expect(await z.db.select(z.db.reviews).get(), isEmpty);
      expect((await z.db.select(z.db.cards).getSingle()).cardKey, '');

      await a.sync(_ada);
      await z.sync(_ada);

      final review = await z.db.select(z.db.reviews).getSingle();
      expect(review.cardId, card.id.value);
      expect(await z.store.hasUnsynced(), isFalse);
    });
  });

  group('ownership', () {
    test(
      'rows from before any sign-in are pushed as the first account\'s',
      () async {
        await a.deck.createDeck('Before sign-in');
        expect(await a.store.owner(), isNull);

        await a.sync(_ada);

        expect(await a.store.owner(), _ada);
        expect(server.decks.values.single.owner, _ada);
        expect(server.decks.values.single.row.name, 'Before sign-in');
      },
    );

    test('a database another account owns is cleared, never pushed', () async {
      await a.deck.createDeck('Ada\'s');
      await a.sync(_ada);
      server.decks.clear();
      await a.deck.createDeck('Ada\'s unsynced');
      server.account = _grace;

      await a.sync(_grace);

      expect(server.decks, isEmpty);
      expect(await a.deckNames(), isEmpty);
      expect(await a.store.owner(), _grace);
      // Control: the same database, synced by its owner, pushes its rows.
      final other = Device('other', server, scheduler);
      addTearDown(other.close);
      await other.deck.createDeck('Grace\'s');
      await other.sync(_grace);
      await a.sync(_grace);
      expect(await a.deckNames(), ['Grace\'s']);
    });
  });

  group('study settings', () {
    test('the daily minutes set on one device reach the other, and the setting stays unsynced until pushed', () async {
      await a.study.setDailyMinutes(45, at: a.now);
      expect(await a.store.hasUnsynced(), isTrue);

      await a.sync(_ada);
      await b.sync(_ada);

      expect(server.studySettings[_ada]?.dailyMinutes, 45);
      expect(await a.store.hasUnsynced(), isFalse);
      expect(await b.study.dailyMinutes(), 45);
      // Control: a device that never synced holds none.
      final fresh = Device('fresh', server, scheduler);
      addTearDown(fresh.close);
      expect(await fresh.study.dailyMinutes(), isNull);
    });

    test('the later edit wins: a later server setting replaces an older device one, and a later unsynced device one is kept and pushed', () async {
      await a.study.setDailyMinutes(30, at: a.now);
      await a.sync(_ada);
      // B sets 10 earlier than A's 30 but has not synced: A's later one wins.
      await b.study.setDailyMinutes(
        10,
        at: a.now.subtract(const Duration(minutes: 1)),
      );
      await b.sync(_ada);
      expect(await b.study.dailyMinutes(), 30);
      expect(server.studySettings[_ada]?.dailyMinutes, 30);

      // B sets 60 later than A's: B's is kept, pushed, and reaches A.
      await b.study.setDailyMinutes(
        60,
        at: a.now.add(const Duration(minutes: 1)),
      );
      await b.sync(_ada);
      await a.sync(_ada);
      expect(server.studySettings[_ada]?.dailyMinutes, 60);
      expect(await a.study.dailyMinutes(), 60);
    });

    test(
      'a setting changed while its push is under way stays unsynced',
      () async {
        await a.study.setDailyMinutes(30, at: a.now);
        server.beforePush = (table) async {
          if (table != 'study_settings') return;
          await a.study.setDailyMinutes(
            45,
            at: a.now.add(const Duration(seconds: 1)),
          );
        };

        await a.sync(_ada);

        expect(server.studySettings[_ada]?.dailyMinutes, 30);
        expect(await a.store.hasUnsynced(), isTrue);
        server.beforePush = null;
        await a.sync(_ada);
        expect(server.studySettings[_ada]?.dailyMinutes, 45);
        expect(await a.store.hasUnsynced(), isFalse);
      },
    );

    test('another account claiming the database, or sign-out, clears the setting, so the next account starts at the default', () async {
      await a.study.setDailyMinutes(45, at: a.now);
      await a.sync(_ada);
      server.account = _grace;

      await a.sync(_grace);

      expect(await a.study.dailyMinutes(), isNull);
      expect(server.studySettings[_grace], isNull);
      await a.study.setDailyMinutes(15, at: a.now);
      await a.store.clear();
      expect(await a.study.dailyMinutes(), isNull);
    });
  });

  group('templates and block versions (ADR 0106)', () {
    test('a card a newer build wrote keeps its unknown template and blocks '
        'unchanged through this build, a merge into it refused', () async {
      // The newer build: a template this build does not know, at a version
      // above its own, and a block of a type and version it does not know.
      final newer = Device('newer', server, scheduler);
      addTearDown(newer.close);
      final deck = await newer.deck.createDeck('French');
      const front =
          '[{"type":"image","v":3,"id":"img","payload":{"media":"m1"},'
          '"boxes":[{"x":1}]},{"type":"text","v":7,"payload":{"body":"chat"}}]';
      await newer.db
          .into(newer.db.cards)
          .insert(
            CardsCompanion.insert(
              id: 'newer-card',
              deckId: deck.id.value,
              front: front,
              back: '[{"type":"text","v":1,"id":"t","payload":{"text":"cat"}}]',
              cardKey: 'chat',
              source: 'manual',
              template: const Value('image_occlusion'),
              templateVersion: const Value(2),
              createdAt: newer.now,
              updatedAt: newer.now,
            ),
          );
      await newer.sync(_ada);

      await a.sync(_ada);
      final onA = (await a.deck.listCards(deck.id)).single;
      expect((onA.template, onA.templateVersion), ('image_occlusion', 2));
      expect(onA.front.every((block) => block is UnsupportedContent), isTrue);

      // A photo's back merges into no card this build cannot edit.
      a.now = a.now.add(const Duration(minutes: 1));
      final merged = await a.deck.addCards(AddToDeck(deck.id), [
        const IncomingCard(
          front: [TextContent('chat')],
          back: [TextContent('a cat')],
          onDuplicate: DuplicateChoice.mergeBack,
        ),
      ]);
      expect(merged.merged, 0);
      await a.sync(_ada);
      await b.sync(_ada);

      final onServer = server.cards['newer-card']!.row;
      expect(
        (onServer.template, onServer.templateVersion),
        ('image_occlusion', 2),
      );
      expect(onServer.front, front, reason: 'byte for byte');
      expect(
        onServer.back,
        '[{"type":"text","v":1,"id":"t","payload":{"text":"cat"}}]',
        reason: 'as the newer build wrote it',
      );
      final onB = await b.db.select(b.db.cards).getSingle();
      expect(
        (onB.template, onB.templateVersion, onB.front),
        ('image_occlusion', 2, front),
      );
    });

    test('a card added from a file reaches the server and the other device as a free v2 import', () async {
      final deck = await a.deck.createDeck('French');
      await a.deck.addCards(AddToDeck(deck.id), source: const FromFile(), [
        const IncomingCard(
          front: [TextContent('chat')],
          back: [TextContent('a cat')],
          onDuplicate: DuplicateChoice.addNew,
        ),
      ]);
      await a.sync(_ada);
      await b.sync(_ada);

      final onServer = server.cards.values.single.row;
      expect(
        (onServer.template, onServer.templateVersion, onServer.source),
        ('free', 2, 'import'),
      );
      final onB = (await b.deck.listCards(deck.id)).single;
      expect(plainText(onB.front), 'chat');
      expect(onB.source, CardSource.import);
    });

    test('a template set on one device reaches the other', () async {
      final deck = await a.deck.createDeck('French');
      await storeSides(
        a.db,
        a.deck,
        deck.id,
        front: [const ClozeContent('{{c1::Paris}} is in France')],
        back: _text('Paris is in France'),
      );
      await a.sync(_ada);
      await b.sync(_ada);

      final onB = (await b.deck.listCards(deck.id)).single;
      expect((onB.template, onB.templateVersion), ('free', 1));
    });
  });
}
