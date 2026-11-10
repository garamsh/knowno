import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:drift_dev/api/migrations_native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';

import 'generated/schema.dart';
import 'generated/schema_v1.dart' as v1;
import 'generated/schema_v2.dart' as v2;
import 'generated/schema_v3.dart' as v3;
import 'generated/schema_v4.dart' as v4;
import 'generated/schema_v5.dart' as v5;
import 'generated/schema_v6.dart' as v6;
import 'generated/schema_v7.dart' as v7;
import 'generated/schema_v8.dart' as v8;
import 'generated/schema_v9.dart' as v9;
import 'generated/schema_v10.dart' as v10;
import 'generated/schema_v11.dart' as v11;
import 'generated/schema_v12.dart' as v12;
import 'generated/schema_v13.dart' as v13;
import 'generated/schema_v14.dart' as v14;
import 'generated/schema_v15.dart' as v15;

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  late SchemaVerifier verifier;

  setUpAll(() {
    verifier = SchemaVerifier(GeneratedHelper());
  });

  test('a new database matches the latest exported schema', () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    expect(GeneratedHelper.versions.last, db.schemaVersion);

    await verifier.migrateAndValidate(db, db.schemaVersion);
  });

  group('every exported schema migrates to the current schema', () {
    const versions = GeneratedHelper.versions;
    for (final fromVersion in versions) {
      test('from $fromVersion', () async {
        final schema = await verifier.schemaAt(fromVersion);
        final db = AppDatabase(schema.newConnection());
        addTearDown(db.close);

        await verifier.migrateAndValidate(db, db.schemaVersion);
      });
    }
  });

  test('decks, cards and reviews survive the upgrade from 1 to 2, which adds empty card states', () async {
    // Schema helpers hold a date as drift stores it: seconds since the epoch.
    final created = DateTime.utc(2026, 10, 1).millisecondsSinceEpoch ~/ 1000;
    await verifier.testWithDataIntegrity(
      oldVersion: 1,
      newVersion: 2,
      createOld: v1.DatabaseAtV1.new,
      createNew: v2.DatabaseAtV2.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          v1.DecksData(
            id: 'deck',
            name: 'French',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.cards,
          v1.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.reviews,
          v1.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: created,
            durationMs: 1200,
          ),
        );
      },
      validateItems: (db) async {
        expect((await db.select(db.decks).getSingle()).name, 'French');
        expect((await db.select(db.cards).getSingle()).cardKey, 'chat');
        final review = await db.select(db.reviews).getSingle();
        expect(
          [review.id, review.rating, review.durationMs],
          ['review', 'good', 1200],
        );
        expect(await db.select(db.cardStates).get(), isEmpty);
      },
    );
  });

  test('reviews and card states survive the upgrade from 2 to 3, each review without a fuzz factor', () async {
    // Schema helpers hold a date as drift stores it: seconds since the epoch.
    final created = DateTime.utc(2026, 10, 1).millisecondsSinceEpoch ~/ 1000;
    await verifier.testWithDataIntegrity(
      oldVersion: 2,
      newVersion: 3,
      createOld: v2.DatabaseAtV2.new,
      createNew: v3.DatabaseAtV3.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          v2.DecksData(
            id: 'deck',
            name: 'French',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.cards,
          v2.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.reviews,
          v2.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: created,
            durationMs: 1200,
          ),
        );
        batch.insert(
          old.cardStates,
          v2.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: created,
            due: created + 2 * 86400,
          ),
        );
      },
      validateItems: (db) async {
        final review = await db.select(db.reviews).getSingle();
        expect(
          [review.id, review.rating, review.durationMs, review.fuzzFactor],
          ['review', 'good', 1200, null],
        );
        final state = await db.select(db.cardStates).getSingle();
        expect([state.cardId, state.stability], ['card', 2.3065]);
      },
    );
  });

  test('every row survives the upgrade from 3 to 4 live and unsynced, with reviews and states dated by their times, and no owner', () async {
    // Schema helpers hold a date as drift stores it, seconds since the epoch,
    // and a flag as 1 or 0.
    final created = DateTime.utc(2026, 10, 1).millisecondsSinceEpoch ~/ 1000;
    final reviewed = created + 3600;
    await verifier.testWithDataIntegrity(
      oldVersion: 3,
      newVersion: 4,
      createOld: v3.DatabaseAtV3.new,
      createNew: v4.DatabaseAtV4.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          v3.DecksData(
            id: 'deck',
            name: 'French',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.cards,
          v3.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: created,
            updatedAt: created,
          ),
        );
        batch.insert(
          old.reviews,
          v3.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: reviewed,
            durationMs: 1200,
            fuzzFactor: 0.25,
          ),
        );
        batch.insert(
          old.cardStates,
          v3.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: reviewed,
            due: reviewed + 2 * 86400,
          ),
        );
      },
      validateItems: (db) async {
        final deck = await db.select(db.decks).getSingle();
        expect([deck.name, deck.deletedAt, deck.dirty], ['French', null, 1]);
        final card = await db.select(db.cards).getSingle();
        expect([card.cardKey, card.deletedAt, card.dirty], ['chat', null, 1]);
        final review = await db.select(db.reviews).getSingle();
        expect(
          [
            review.id,
            review.rating,
            review.fuzzFactor,
            review.deletedAt,
            review.dirty,
          ],
          ['review', 'good', 0.25, null, 1],
        );
        expect(review.updatedAt, reviewed);
        final state = await db.select(db.cardStates).getSingle();
        expect(
          [state.cardId, state.stability, state.deletedAt, state.dirty],
          ['card', 2.3065, null, 1],
        );
        expect(state.updatedAt, reviewed);
        expect(await db.select(db.syncState).get(), isEmpty);
      },
    );
  });

  test('every row survives the upgrade from 4 to 5, decks private and cards without an origin', () async {
    final created = DateTime.utc(2026, 10, 1).millisecondsSinceEpoch ~/ 1000;
    await verifier.testWithDataIntegrity(
      oldVersion: 4,
      newVersion: 5,
      createOld: v4.DatabaseAtV4.new,
      createNew: v5.DatabaseAtV5.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          v4.DecksData(
            id: 'deck',
            name: 'French',
            createdAt: created,
            updatedAt: created,
            dirty: 0,
          ),
        );
        batch.insert(
          old.cards,
          v4.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'import',
            createdAt: created,
            updatedAt: created,
            dirty: 0,
          ),
        );
        batch.insert(
          old.reviews,
          v4.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: created,
            durationMs: 1200,
            updatedAt: created,
            dirty: 0,
          ),
        );
        batch.insert(
          old.cardStates,
          v4.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: created,
            due: created + 86400,
            updatedAt: created,
            dirty: 0,
          ),
        );
      },
      validateItems: (db) async {
        final deck = await db.select(db.decks).getSingle();
        expect(
          [deck.name, deck.visibility, deck.publishedAt, deck.description],
          ['French', 'private', null, null],
        );
        final card = await db.select(db.cards).getSingle();
        expect(
          [card.cardKey, card.source, card.originDeckId, card.dirty],
          ['chat', 'import', null, 0],
        );
        expect(await db.select(db.reviews).get(), hasLength(1));
        expect(await db.select(db.cardStates).get(), hasLength(1));
      },
    );
  });

  test('every row survives the upgrade from 5 to 6 with its dirty flag, tombstones included, each time as UTC text at the millisecond', () async {
    // Schema v5 holds a date as seconds since the epoch, v6 as UTC text.
    const created = 1790812800; // 2026-10-01 00:00:00 UTC
    const edited = created + 3661;
    const deleted = created + 86399;
    String text(int seconds) => DateTime.fromMillisecondsSinceEpoch(
      seconds * 1000,
      isUtc: true,
    ).toIso8601String();
    expect(text(edited), '2026-10-01T01:01:01.000Z');
    await verifier.testWithDataIntegrity(
      oldVersion: 5,
      newVersion: 6,
      createOld: v5.DatabaseAtV5.new,
      createNew: v6.DatabaseAtV6.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insertAll(old.decks, [
          v5.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'public',
            publishedAt: edited,
            description: 'verbs',
            createdAt: created,
            updatedAt: edited,
            dirty: 1,
          ),
          v5.DecksData(
            id: 'gone',
            name: 'Old',
            visibility: 'private',
            createdAt: created,
            updatedAt: deleted,
            deletedAt: deleted,
            dirty: 0,
          ),
        ]);
        batch.insertAll(old.cards, [
          v5.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[{"type":"text","text":"chat"}]',
            back: '[]',
            cardKey: 'chat',
            source: 'shared',
            originDeckId: 'origin',
            createdAt: created,
            updatedAt: edited,
            dirty: 1,
          ),
          v5.CardsData(
            id: 'removed',
            deckId: 'gone',
            front: '[]',
            back: '[]',
            cardKey: 'chien',
            source: 'manual',
            createdAt: created,
            updatedAt: deleted,
            deletedAt: deleted,
            dirty: 0,
          ),
        ]);
        batch.insertAll(old.reviews, [
          v5.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: edited,
            durationMs: 1200,
            fuzzFactor: 0.25,
            updatedAt: edited,
            dirty: 1,
          ),
          v5.ReviewsData(
            id: 'kept',
            cardId: 'removed',
            rating: 'again',
            reviewedAt: created,
            durationMs: 900,
            updatedAt: created,
            dirty: 0,
          ),
        ]);
        batch.insertAll(old.cardStates, [
          v5.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: edited,
            due: edited + 86400,
            updatedAt: edited,
            dirty: 1,
          ),
          v5.CardStatesData(
            cardId: 'removed',
            stability: 0.212,
            difficulty: 6.4133,
            lastReview: created,
            due: created + 600,
            updatedAt: deleted,
            deletedAt: deleted,
            dirty: 0,
          ),
        ]);
      },
      validateItems: (db) async {
        expect(
          await (db.select(
            db.decks,
          )..orderBy([(row) => OrderingTerm.asc(row.id)])).get(),
          [
            v6.DecksData(
              id: 'deck',
              name: 'French',
              visibility: 'public',
              publishedAt: text(edited),
              description: 'verbs',
              createdAt: text(created),
              updatedAt: text(edited),
              dirty: 1,
            ),
            v6.DecksData(
              id: 'gone',
              name: 'Old',
              visibility: 'private',
              createdAt: text(created),
              updatedAt: text(deleted),
              deletedAt: text(deleted),
              dirty: 0,
            ),
          ],
        );
        expect(
          await (db.select(
            db.cards,
          )..orderBy([(row) => OrderingTerm.asc(row.id)])).get(),
          [
            v6.CardsData(
              id: 'card',
              deckId: 'deck',
              front: '[{"type":"text","text":"chat"}]',
              back: '[]',
              cardKey: 'chat',
              source: 'shared',
              originDeckId: 'origin',
              createdAt: text(created),
              updatedAt: text(edited),
              dirty: 1,
            ),
            v6.CardsData(
              id: 'removed',
              deckId: 'gone',
              front: '[]',
              back: '[]',
              cardKey: 'chien',
              source: 'manual',
              createdAt: text(created),
              updatedAt: text(deleted),
              deletedAt: text(deleted),
              dirty: 0,
            ),
          ],
        );
        expect(
          await (db.select(
            db.reviews,
          )..orderBy([(row) => OrderingTerm.asc(row.id)])).get(),
          [
            v6.ReviewsData(
              id: 'kept',
              cardId: 'removed',
              rating: 'again',
              reviewedAt: text(created),
              durationMs: 900,
              updatedAt: text(created),
              dirty: 0,
            ),
            v6.ReviewsData(
              id: 'review',
              cardId: 'card',
              rating: 'good',
              reviewedAt: text(edited),
              durationMs: 1200,
              fuzzFactor: 0.25,
              updatedAt: text(edited),
              dirty: 1,
            ),
          ],
        );
        expect(
          await (db.select(
            db.cardStates,
          )..orderBy([(row) => OrderingTerm.asc(row.cardId)])).get(),
          [
            v6.CardStatesData(
              cardId: 'card',
              stability: 2.3065,
              difficulty: 2.118,
              lastReview: text(edited),
              due: text(edited + 86400),
              updatedAt: text(edited),
              dirty: 1,
            ),
            v6.CardStatesData(
              cardId: 'removed',
              stability: 0.212,
              difficulty: 6.4133,
              lastReview: text(created),
              due: text(created + 600),
              updatedAt: text(deleted),
              deletedAt: text(deleted),
              dirty: 0,
            ),
          ],
        );
        expect(
          await db.customSelect('PRAGMA foreign_key_check').get(),
          isEmpty,
        );
      },
    );
  });

  test('every review and card state survives the upgrade from 6 to 7 with its dirty flag, without deleted_at, and the index on reviewed_at is whole', () async {
    const created = '2026-10-01T00:00:00.000Z';
    const edited = '2026-10-02T09:30:00.250Z';
    await verifier.testWithDataIntegrity(
      oldVersion: 6,
      newVersion: 7,
      createOld: v6.DatabaseAtV6.new,
      createNew: v7.DatabaseAtV7.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v6.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: created,
            updatedAt: created,
            dirty: 0,
          ),
        );
        batch.insert(
          old.cards,
          const v6.CardsData(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: created,
            updatedAt: created,
            dirty: 0,
          ),
        );
        batch.insertAll(old.reviews, [
          const v6.ReviewsData(
            id: 'review',
            cardId: 'card',
            rating: 'good',
            reviewedAt: edited,
            durationMs: 1200,
            fuzzFactor: 0.25,
            updatedAt: edited,
            dirty: 1,
          ),
          const v6.ReviewsData(
            id: 'synced',
            cardId: 'card',
            rating: 'again',
            reviewedAt: created,
            durationMs: 900,
            updatedAt: created,
            dirty: 0,
          ),
        ]);
        batch.insert(
          old.cardStates,
          const v6.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: edited,
            due: '2026-10-03T09:30:00.250Z',
            updatedAt: edited,
            dirty: 1,
          ),
        );
      },
      validateItems: (db) async {
        expect(
          await (db.select(
            db.reviews,
          )..orderBy([(row) => OrderingTerm.asc(row.id)])).get(),
          const [
            v7.ReviewsData(
              id: 'review',
              cardId: 'card',
              rating: 'good',
              reviewedAt: edited,
              durationMs: 1200,
              fuzzFactor: 0.25,
              updatedAt: edited,
              dirty: 1,
            ),
            v7.ReviewsData(
              id: 'synced',
              cardId: 'card',
              rating: 'again',
              reviewedAt: created,
              durationMs: 900,
              updatedAt: created,
              dirty: 0,
            ),
          ],
        );
        expect(await db.select(db.cardStates).get(), const [
          v7.CardStatesData(
            cardId: 'card',
            stability: 2.3065,
            difficulty: 2.118,
            lastReview: edited,
            due: '2026-10-03T09:30:00.250Z',
            updatedAt: edited,
            dirty: 1,
          ),
        ]);
        final indexes = await db
            .customSelect(
              "SELECT name, sql FROM sqlite_master WHERE type = 'index' "
              "AND tbl_name = 'reviews' AND name LIKE 'reviews_%reviewed_at'",
            )
            .get();
        expect(
          {
            for (final row in indexes)
              row.read<String>('name'): row.read<String>('sql'),
          },
          {
            'reviews_card_id_reviewed_at': contains('(card_id, reviewed_at)'),
            'reviews_reviewed_at': isNot(contains('WHERE')),
          },
        );
      },
    );
  });

  test("a copied card's source becomes copy in the upgrade from 7 to 8, and every other card, its dirty flag and its origin are kept", () async {
    const at = '2026-10-01T00:00:00.000Z';
    v7.CardsData card(String id, String source, int dirty, [String? origin]) =>
        v7.CardsData(
          id: id,
          deckId: 'deck',
          front: '[]',
          back: '[]',
          cardKey: id,
          source: source,
          originDeckId: origin,
          createdAt: at,
          updatedAt: at,
          dirty: dirty,
        );
    await verifier.testWithDataIntegrity(
      oldVersion: 7,
      newVersion: 8,
      createOld: v7.DatabaseAtV7.new,
      createNew: v8.DatabaseAtV8.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v7.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
        batch.insertAll(old.cards, [
          card('copied', 'shared', 0, 'origin'),
          card('photo', 'import', 1),
          card('typed', 'manual', 0),
        ]);
      },
      validateItems: (db) async {
        final cards = await (db.select(
          db.cards,
        )..orderBy([(row) => OrderingTerm.asc(row.id)])).get();
        expect(
          [
            for (final row in cards)
              (row.id, row.source, row.dirty, row.originDeckId),
          ],
          [
            ('copied', 'copy', 0, 'origin'),
            ('photo', 'import', 1, null),
            ('typed', 'manual', 0, null),
          ],
        );
      },
    );
  });

  test('the upgrade from 8 to 9 adds the study settings empty, so the default holds, and keeps every deck as it was', () async {
    const at = '2026-10-01T00:00:00.000Z';
    await verifier.testWithDataIntegrity(
      oldVersion: 8,
      newVersion: 9,
      createOld: v8.DatabaseAtV8.new,
      createNew: v9.DatabaseAtV9.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v8.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: at,
            updatedAt: at,
            dirty: 1,
          ),
        );
      },
      validateItems: (db) async {
        expect(await db.select(db.studySettings).get(), isEmpty);
        final deck = await db.select(db.decks).getSingle();
        expect((deck.id, deck.name, deck.dirty), ('deck', 'French', 1));
      },
    );
  });

  test('the upgrade from 9 to 10 gives every deck neither appearance key, and keeps it as it was', () async {
    const at = '2026-10-01T00:00:00.000Z';
    await verifier.testWithDataIntegrity(
      oldVersion: 9,
      newVersion: 10,
      createOld: v9.DatabaseAtV9.new,
      createNew: v10.DatabaseAtV10.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v9.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            description: 'Verbs',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
      },
      validateItems: (db) async {
        final deck = await db.select(db.decks).getSingle();
        expect(
          (deck.id, deck.name, deck.description, deck.dirty),
          ('deck', 'French', 'Verbs', 0),
        );
        expect((deck.icon, deck.color), (null, null));
      },
    );
  });

  test('the upgrade from 10 to 11 gives every card neither template column, and keeps it as it was', () async {
    const at = '2026-10-01T00:00:00.000Z';
    const front = '[{"type":"text","payload":{"text":"chat"}}]';
    await verifier.testWithDataIntegrity(
      oldVersion: 10,
      newVersion: 11,
      createOld: v10.DatabaseAtV10.new,
      createNew: v11.DatabaseAtV11.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v10.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
        batch.insert(
          old.cards,
          const v10.CardsData(
            id: 'card',
            deckId: 'deck',
            front: front,
            back: '[{"type":"text","payload":{"text":"cat"}}]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
      },
      validateItems: (db) async {
        final card = await db.select(db.cards).getSingle();
        expect(
          (card.id, card.front, card.cardKey, card.dirty),
          ('card', front, 'chat', 0),
          reason: 'no row is rewritten',
        );
        expect((card.template, card.templateVersion), (null, null));
      },
    );
  });

  test('the upgrade from 11 to 12 gives every deck no image and leaves both media queues empty', () async {
    const at = '2026-10-01T00:00:00.000Z';
    await verifier.testWithDataIntegrity(
      oldVersion: 11,
      newVersion: 12,
      createOld: v11.DatabaseAtV11.new,
      createNew: v12.DatabaseAtV12.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v11.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            icon: 'book',
            color: 'violet',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
      },
      validateItems: (db) async {
        final deck = await db.select(db.decks).getSingle();
        expect(
          (deck.id, deck.icon, deck.color, deck.dirty),
          ('deck', 'book', 'violet', 0),
          reason: 'no row is rewritten',
        );
        expect(deck.imageMediaId, null);
        expect(await db.select(db.mediaUploads).get(), isEmpty);
        expect(await db.select(db.mediaDeletions).get(), isEmpty);
      },
    );
  });

  test("the upgrade from 12 to 13 makes every live card of a known template, or none, a free card at version 1, and keeps its content, edit time and dirty flag, and every other card as it was", () async {
    const at = '2026-10-01T00:00:00.000Z';
    const edited = '2026-10-20T09:30:00.000Z';
    const deleted = '2026-10-21T00:00:00.000Z';
    const text = '[{"type":"text","v":1,"id":"b1","payload":{"text":"chat"}}]';
    // Each card's id, template, template version, tombstone and dirty flag.
    const cards = [
      ('flip', 'flip', 1, null, 0),
      ('flip-unsynced', 'flip', 1, null, 1),
      ('cloze', 'cloze', 1, null, 0),
      ('table', 'table', 1, null, 1),
      ('none', null, null, null, 0),
      ('free', 'free', 1, null, 0),
      ('unknown', 'mindmap', 1, null, 0),
      ('newer', 'flip', 2, null, 0),
      ('deleted', 'flip', 1, deleted, 1),
    ];
    await verifier.testWithDataIntegrity(
      oldVersion: 12,
      newVersion: 13,
      createOld: v12.DatabaseAtV12.new,
      createNew: v13.DatabaseAtV13.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v12.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
        for (final (id, template, version, deletedAt, dirty) in cards) {
          batch.insert(
            old.cards,
            v12.CardsData(
              id: id,
              deckId: 'deck',
              front: text,
              back:
                  '[{"type":"text","v":1,"id":"b2","payload":{"text":"$id"}}]',
              cardKey: 'chat',
              source: 'manual',
              template: template,
              templateVersion: version,
              createdAt: at,
              updatedAt: edited,
              deletedAt: deletedAt,
              dirty: dirty,
            ),
          );
        }
      },
      validateItems: (db) async {
        final rows = {
          for (final row in await db.select(db.cards).get()) row.id: row,
        };
        expect(rows.keys, unorderedEquals([for (final card in cards) card.$1]));
        expect(
          {
            for (final MapEntry(:key, value: row) in rows.entries)
              key: (row.template, row.templateVersion),
          },
          {
            'flip': ('free', 1),
            'flip-unsynced': ('free', 1),
            'cloze': ('free', 1),
            'table': ('free', 1),
            'none': ('free', 1),
            'free': ('free', 1),
            'unknown': ('mindmap', 1),
            'newer': ('flip', 2),
            'deleted': ('flip', 1),
          },
        );
        for (final (id, _, _, _, dirty) in cards) {
          final row = rows[id]!;
          expect(
            (row.front, row.back, row.cardKey, row.updatedAt, row.dirty),
            (
              text,
              '[{"type":"text","v":1,"id":"b2","payload":{"text":"$id"}}]',
              'chat',
              edited,
              dirty,
            ),
            reason: '$id keeps its content, edit time and dirty flag',
          );
        }
      },
    );
  });

  test('the database reads a migrated time back as the instant it stored, and writes every time in UTC at the millisecond', () async {
    final schema = await verifier.schemaAt(5);
    final old = v5.DatabaseAtV5(schema.newConnection());
    const created = 1790812800;
    await old
        .into(old.decks)
        .insert(
          const v5.DecksData(
            id: 'deck',
            name: 'French',
            visibility: 'private',
            createdAt: created,
            updatedAt: created,
            dirty: 0,
          ),
        );
    await old.close();
    final db = AppDatabase(schema.newConnection());
    addTearDown(db.close);

    final deck = await db.select(db.decks).getSingle();
    expect(deck.createdAt, DateTime.utc(2026, 10, 1));
    expect(deck.createdAt.isUtc, isTrue);

    // A local time with microseconds is stored as its UTC instant, truncated.
    final local = DateTime(2026, 10, 2, 9, 30, 15, 123, 456);
    await (db.update(db.decks)..where((row) => row.id.equals('deck'))).write(
      DecksCompanion(updatedAt: Value(local)),
    );
    final stored = await db
        .customSelect("SELECT updated_at FROM decks WHERE id = 'deck'")
        .getSingle();
    expect(
      stored.read<String>('updated_at'),
      DateTime.fromMillisecondsSinceEpoch(
        local.millisecondsSinceEpoch,
        isUtc: true,
      ).toIso8601String(),
    );
    expect(stored.read<String>('updated_at'), endsWith('.123Z'));
  });

  test('a card row takes the source copy with its origin, and refuses an unknown source and the old shared', () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final at = DateTime.utc(2026, 10, 1);
    await db
        .into(db.decks)
        .insert(
          DecksCompanion.insert(
            id: 'deck',
            name: 'French',
            createdAt: at,
            updatedAt: at,
          ),
        );
    CardsCompanion card(String id, String source) => CardsCompanion.insert(
      id: id,
      deckId: 'deck',
      front: '[]',
      back: '[]',
      cardKey: id,
      source: source,
      originDeckId: const Value('origin'),
      createdAt: at,
      updatedAt: at,
    );
    await db.into(db.cards).insert(card('copied', 'copy'));
    for (final (id, source) in [('unknown', 'borrowed'), ('old', 'shared')]) {
      await expectLater(
        db.into(db.cards).insert(card(id, source)),
        throwsA(isA<SqliteException>()),
        reason: source,
      );
    }
    final stored = await db.select(db.cards).getSingle();
    expect([stored.source, stored.originDeckId], ['copy', 'origin']);
  });

  test('a review row refuses a fuzz factor outside 0 to 1', () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    final at = DateTime.utc(2026, 10, 1);
    await db
        .into(db.decks)
        .insert(
          DecksCompanion.insert(
            id: 'deck',
            name: 'French',
            createdAt: at,
            updatedAt: at,
          ),
        );
    await db
        .into(db.cards)
        .insert(
          CardsCompanion.insert(
            id: 'card',
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: 'chat',
            source: 'manual',
            createdAt: at,
            updatedAt: at,
          ),
        );
    ReviewsCompanion review(String id, double factor) =>
        ReviewsCompanion.insert(
          id: id,
          cardId: 'card',
          rating: 'good',
          reviewedAt: at,
          durationMs: 1200,
          fuzzFactor: Value(factor),
          updatedAt: at,
        );

    for (final factor in [-0.1, 1.0]) {
      await expectLater(
        db.into(db.reviews).insert(review('refused $factor', factor)),
        throwsA(isA<SqliteException>()),
      );
    }
    // Control: the ends of the range a factor is drawn from are stored.
    await db.into(db.reviews).insert(review('least', 0));
    await db.into(db.reviews).insert(review('greatest', 0.9999));
    expect([
      for (final row in await db.select(db.reviews).get()) row.id,
    ], unorderedEquals(['least', 'greatest']));
  });

  test('the upgrade from 14 to 15 makes a public deck public and a private one private, and keeps each as it was', () async {
    const at = '2026-10-01T00:00:00.000Z';
    await verifier.testWithDataIntegrity(
      oldVersion: 14,
      newVersion: 15,
      createOld: v14.DatabaseAtV14.new,
      createNew: v15.DatabaseAtV15.new,
      openTestedDatabase: AppDatabase.new,
      createItems: (batch, old) {
        batch.insert(
          old.decks,
          const v14.DecksData(
            id: 'open',
            name: 'Open',
            visibility: 'public',
            publishedAt: at,
            createdAt: at,
            updatedAt: at,
            dirty: 0,
          ),
        );
        batch.insert(
          old.decks,
          const v14.DecksData(
            id: 'closed',
            name: 'Closed',
            visibility: 'private',
            createdAt: at,
            updatedAt: at,
            dirty: 1,
          ),
        );
      },
      validateItems: (db) async {
        final rows = {
          for (final row in await db.select(db.decks).get()) row.id: row,
        };
        expect(rows['open']?.publication, 'public');
        expect(rows['closed']?.publication, 'private');
        expect((rows['open']?.dirty, rows['closed']?.dirty), (0, 1));
      },
    );
  });
}
