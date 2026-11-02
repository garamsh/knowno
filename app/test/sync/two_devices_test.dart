// Each request to the stack carries its own bound, the request timeout the
// app treats as offline, so the file sets no bound over a test's sum of them.
@Timeout.none
library;

import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show Value;

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../media/fakes.dart';
import 'bounded_auth.dart';
import 'device.dart';

/// The local Supabase stack `scripts/test-sync.sh` starts, named by the
/// environment it runs this file in.
const _urlVariable = 'KNOWNO_SYNC_TEST_URL';
const _keyVariable = 'KNOWNO_SYNC_TEST_KEY';
const _dbVariable = 'KNOWNO_SYNC_TEST_DB_CONTAINER';

List<Content> _text(String text) => [TextContent(text)];

void main() {
  final url = Platform.environment[_urlVariable];
  final key = Platform.environment[_keyVariable];
  final db = Platform.environment[_dbVariable];
  final skip = url == null || key == null || db == null
      ? 'needs the local Supabase stack that scripts/test-sync.sh starts, '
            'which sets $_urlVariable, $_keyVariable and $_dbVariable'
      : null;

  late Scheduler scheduler;
  late UserId account;
  late Device a;
  late Device b;
  late String email;
  final clients = <SupabaseClient>[];

  setUpAll(() async {
    if (skip != null) return;
    scheduler = await Scheduler.load();
  });

  /// Two devices signed in to one new account, each with its own client.
  setUp(() async {
    if (skip != null) return;
    email = 'sync-${DateTime.now().microsecondsSinceEpoch}@example.com';
    const password = 'two-devices-password';
    // Password sign-in needs no PKCE flow, and so no storage for its verifier.
    const options = AuthClientOptions(authFlowType: AuthFlowType.implicit);
    final first = SupabaseClient(url!, key!, authOptions: options);
    final second = SupabaseClient(url, key, authOptions: options);
    clients.addAll([first, second]);
    final firstServer = SupabaseSyncServer(first);
    final secondServer = SupabaseSyncServer(second);
    // Signing in is bounded as each sync request is.
    final bound = firstServer.timeout;
    await signUpWithinBound(first, email, password, bound);
    await withinBound(
      bound,
      (_) => second.auth.signInWithPassword(email: email, password: password),
    );
    expect(first.auth.currentUser?.email, email);
    account = UserId(first.auth.currentUser!.id);
    expect(second.auth.currentUser?.id, account.value);
    a = Device('a', firstServer, scheduler);
    b = Device('b', secondServer, scheduler);
  });

  tearDown(() async {
    if (skip != null) return;
    await a.close();
    await b.close();
    for (final client in clients) {
      await client.dispose();
    }
    clients.clear();
  });

  Future<Deck> shared() async {
    final deck = await a.deck.createDeck('French');
    await a.sync(account);
    await b.sync(account);
    return deck;
  }

  Future<Card> addCard(Device device, Deck deck, String front) async {
    final saved = await device.deck.addCard(
      deck.id,
      front: _text(front),
      back: _text('$front back'),
      allowDuplicate: true,
    );
    return (saved as CardSaved).card;
  }

  test('a deck and card created on A appear on B', () async {
    final deck = await a.deck.createDeck('French');
    await addCard(a, deck, 'chat');
    expect(await b.deckNames(), isEmpty);

    await a.sync(account);
    await b.sync(account);

    expect(await b.deckNames(), ['French']);
    final cards = await b.deck.listCards(deck.id);
    expect(cards.map((card) => plainText(card.front)), ['chat']);
  }, skip: skip);

  test("a deck's appearance set on A reaches B, and a deck without one stays without", () async {
    final french = await a.deck.createDeck('French');
    final spanish = await a.deck.createDeck('Spanish');
    await a.deck.setAppearance(french.id, DeckIcon.book, DeckColor.violet);

    await a.sync(account);
    await b.sync(account);

    final onB = await b.deck.getDeck(french.id);
    expect((onB.icon, onB.color), (DeckIcon.book, DeckColor.violet));
    final plain = await b.deck.getDeck(spanish.id);
    expect((plain.icon, plain.color), (null, null));
  }, skip: skip);

  test("a deck's image set on A reaches B as its media id, and so does its removal", () async {
    final deck = await a.deck.createDeck('French');
    final image = await a.media.addImage(preparedImage(1));
    await a.deck.setImage(deck.id, image);

    await a.sync(account);
    await b.sync(account);
    expect((await b.deck.getDeck(deck.id)).image, image);

    // A later edit, so it wins over the row both devices hold.
    a.now = a.now.add(const Duration(minutes: 1));
    await a.deck.setImage(deck.id, null);
    await a.sync(account);
    await b.sync(account);
    expect((await b.deck.getDeck(deck.id)).image, isNull);
  }, skip: skip);

  test("a card's template reaches B, and a newer build's template and blocks come through unchanged", () async {
    final deck = await a.deck.createDeck('French');
    await a.deck.addCard(
      deck.id,
      front: [
        const ClozeContent('___ is in France', ['Paris']),
      ],
      back: _text('Paris is in France'),
    );
    // A card as a newer build writes it: a template and block versions
    // this build does not know.
    final front = [
      {
        'type': 'image',
        'v': 3,
        'id': 'img',
        'payload': {'media': 'm1'},
        'boxes': [1, 2],
      },
    ];
    await a.db
        .into(a.db.cards)
        .insert(
          CardsCompanion.insert(
            id: const Uuid().v4(),
            deckId: deck.id.value,
            front: jsonEncode(front),
            back: '[{"type":"text","v":1,"payload":{"text":"cat"}}]',
            cardKey: 'image',
            source: 'manual',
            template: const Value('image_occlusion'),
            templateVersion: const Value(2),
            createdAt: a.now,
            updatedAt: a.now,
          ),
        );

    await a.sync(account);
    await b.sync(account);

    final onB = {
      for (final row in await b.db.select(b.db.cards).get())
        row.template: (row.templateVersion, jsonDecode(row.front)),
    };
    expect(onB['free']?.$1, 1);
    expect(onB['image_occlusion']?.$1, 2);
    expect(onB['image_occlusion']?.$2, front, reason: 'kept as written');
  }, skip: skip);

  test('an edit conflict keeps the later edit on both devices', () async {
    final deck = await shared();
    a.now = a.now.add(const Duration(minutes: 2));
    b.now = b.now.add(const Duration(minutes: 1));
    await a.deck.renameDeck(deck.id, 'Later');
    await b.deck.renameDeck(deck.id, 'Earlier');

    // A pushes first; B's earlier edit then reaches the server and loses.
    await a.sync(account);
    await b.sync(account);
    await a.sync(account);

    expect(await a.deckNames(), ['Later']);
    expect(await b.deckNames(), ['Later']);
  }, skip: skip);

  test('a delete beats a later concurrent edit on both devices', () async {
    final deck = await shared();
    a.now = a.now.add(const Duration(minutes: 1));
    b.now = b.now.add(const Duration(minutes: 2));
    await a.deck.deleteDeck(deck.id);
    await b.deck.renameDeck(deck.id, 'Edited after');

    await b.sync(account);
    await a.sync(account);
    await b.sync(account);

    expect(await a.deckNames(), isEmpty);
    expect(await b.deckNames(), isEmpty);
  }, skip: skip);

  test('reviews made offline on both converge, with each card state the '
      'engine fold of the union', () async {
    final deck = await shared();
    final card = await addCard(a, deck, 'chat');
    await a.sync(account);
    await b.sync(account);
    a.now = a.now.add(const Duration(days: 1));
    b.now = b.now.add(const Duration(days: 2));
    await a.answer(card.id, 'good', fuzz: 0.2);
    await b.answer(card.id, 'again', fuzz: 0.7);
    final before = (await a.stateOf(card.id))!;

    await a.sync(account);
    await b.sync(account);
    await a.sync(account);

    final union = (await a.foldOf(card.id))!;
    expect(before.stability, isNot(union.stability));
    for (final device in [a, b]) {
      final reviews = await device.db.select(device.db.reviews).get();
      expect(
        {for (final review in reviews) review.rating: review.fuzzFactor},
        {'good': 0.2, 'again': 0.7},
        reason: device.name,
      );
      final state = (await device.stateOf(card.id))!;
      expect(
        [state.stability, state.difficulty, state.due.millisecondsSinceEpoch],
        [union.stability, union.difficulty, union.due.millisecondsSinceEpoch],
        reason: device.name,
      );
    }
  }, skip: skip);

  test('an answer and its toggle written as the web app writes them '
      'converge with a phone\'s offline answer on both devices', () async {
    final deck = await shared();
    final card = await addCard(a, deck, 'chat');
    await a.sync(account);
    await b.sync(account);
    // The web app's session: the same account, signed in on its own client.
    final web = SupabaseClient(
      url!,
      key!,
      authOptions: const AuthClientOptions(authFlowType: AuthFlowType.implicit),
    );
    clients.add(web);
    await web.auth.signInWithPassword(
      email: email,
      password: 'two-devices-password',
    );
    String time(DateTime at) => at.toUtc().toIso8601String();
    final reviewId = const Uuid().v4();
    final answeredAt = a.now.add(const Duration(days: 1));
    final toggledAt = answeredAt.add(const Duration(minutes: 1));
    const webFactor = 0.3;
    ReviewRow review(String rating) => ReviewRow(
      id: reviewId,
      cardId: card.id.value,
      rating: rating,
      reviewedAt: answeredAt,
      durationMs: 3000,
      fuzzFactor: webFactor,
      updatedAt: answeredAt,
      dirty: false,
    );
    Future<void> writeState(String rating, DateTime editedAt) async {
      final state = (await scheduler.fold([review(rating)]))!;
      await web.from('card_states').upsert({
        'user_id': account.value,
        'card_id': card.id.value,
        'stability': state.stability,
        'difficulty': state.difficulty,
        'last_review': time(state.lastReview),
        'due': time(state.due),
        'updated_at': time(editedAt),
      }, onConflict: 'user_id,card_id');
    }

    // The rows web/src/features/study/record-answer.ts writes: an answer
    // inserts its review and upserts the card's state; a toggle moves the
    // rating where the server's edit is older, and upserts the state again.
    await web.from('reviews').upsert({
      'id': reviewId,
      'user_id': account.value,
      'card_id': card.id.value,
      'rating': 'good',
      'reviewed_at': time(answeredAt),
      'duration_ms': 3000,
      'fuzz_factor': webFactor,
      'updated_at': time(answeredAt),
    }, ignoreDuplicates: true);
    await writeState('good', answeredAt);
    await web
        .from('reviews')
        .update({'rating': 'again', 'updated_at': time(toggledAt)})
        .eq('id', reviewId)
        .lt('updated_at', time(toggledAt));
    await writeState('again', toggledAt);
    // Meanwhile B answers the card offline, a day after the web.
    b.now = answeredAt.add(const Duration(days: 1));
    await b.answer(card.id, 'good', fuzz: 0.7);
    final offline = (await b.stateOf(card.id))!;

    await a.sync(account);
    await b.sync(account);
    await a.sync(account);

    final union = (await a.foldOf(card.id))!;
    // Control: B's state before the sync left out the web's answer.
    expect(offline.stability, isNot(union.stability));
    for (final device in [a, b]) {
      final reviews = await device.db.select(device.db.reviews).get();
      expect(
        {for (final review in reviews) review.rating: review.fuzzFactor},
        {'again': webFactor, 'good': 0.7},
        reason: device.name,
      );
      final state = (await device.stateOf(card.id))!;
      expect(
        [state.stability, state.difficulty, state.due.millisecondsSinceEpoch],
        [union.stability, union.difficulty, union.due.millisecondsSinceEpoch],
        reason: device.name,
      );
    }
  }, skip: skip);

  /// Runs the server's tombstone purge as if the mark it purges below, the
  /// revision sequence's value now, had been taken 90 days ago; returns the
  /// horizon it stored.
  Future<int> purgeBelowNow() async {
    final result = await Process.run('docker', [
      'exec',
      db!,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      'insert into private.revision_marks (taken_at, revision) '
          "select now() - interval '90 days', last_value from private.revision; "
          'select private.purge_tombstones(); '
          'select revision from private.sync_horizon',
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
    return int.parse((result.stdout as String).trim().split('\n').last);
  }

  test('a device below the horizon rebuilds: a purged card goes, and a '
      'studied one stays stripped with its review', () async {
    final deck = await shared();
    final gone = await addCard(a, deck, 'gone');
    final studied = await addCard(a, deck, 'studied');
    await addCard(a, deck, 'kept');
    await a.answer(studied.id, 'good');
    await a.sync(account);
    await b.sync(account);
    await a.deck.deleteCard(gone.id);
    await a.deck.deleteCard(studied.id);
    await a.sync(account);

    // B stays offline while the server purges past a mark above A's deletes.
    final horizon = await purgeBelowNow();
    final cursors = await b.store.cursors();
    expect(cursors.cardsRevision, inInclusiveRange(1, horizon - 1));
    // Control: B still shows both cards A deleted.
    expect(
      (await b.deck.listCards(deck.id)).map((card) => plainText(card.front)),
      unorderedEquals(['gone', 'studied', 'kept']),
    );

    await b.sync(account);

    expect(
      (await b.deck.listCards(deck.id)).map((card) => plainText(card.front)),
      ['kept'],
    );
    Future<CardRow?> row(CardId id) => (b.db.select(
      b.db.cards,
    )..where((card) => card.id.equals(id.value))).getSingleOrNull();
    expect(await row(gone.id), isNull);
    final stripped = (await row(studied.id))!;
    expect([stripped.front, stripped.back, stripped.cardKey], ['[]', '[]', '']);
    expect(stripped.deletedAt, isNotNull);
    final reviews = await (b.db.select(
      b.db.reviews,
    )..where((review) => review.cardId.equals(studied.id.value))).get();
    expect(reviews.map((review) => review.rating), ['good']);
  }, skip: skip);

  test('equal-key cards from both devices both survive', () async {
    final deck = await shared();
    await addCard(a, deck, 'chat');
    await addCard(b, deck, 'Chat');

    await a.sync(account);
    await b.sync(account);
    await a.sync(account);

    for (final device in [a, b]) {
      final cards = await device.deck.listCards(deck.id);
      expect(cards, hasLength(2), reason: device.name);
      expect(cards.map((card) => card.cardKey.value).toSet(), {'chat'});
    }
  }, skip: skip);

  test('the daily study minutes set on A reach B, the later edit wins on both, and each device reads them offline', () async {
    a.now = a.now.add(const Duration(minutes: 1));
    b.now = b.now.add(const Duration(minutes: 2));
    await a.study.setDailyMinutes(45, at: a.now);
    await b.study.setDailyMinutes(15, at: b.now);

    // A pushes first; B's later edit then reaches the server and wins.
    await a.sync(account);
    await b.sync(account);
    await a.sync(account);

    for (final device in [a, b]) {
      expect(await device.study.dailyMinutes(), 15, reason: device.name);
      expect(await device.store.hasUnsynced(), isFalse, reason: device.name);
    }
    // Control: an older edit on A, synced after, changes neither.
    await a.study.setDailyMinutes(
      60,
      at: b.now.subtract(const Duration(seconds: 30)),
    );
    await a.sync(account);
    await b.sync(account);
    expect(await b.study.dailyMinutes(), 15);
    expect(await a.study.dailyMinutes(), 15);
  }, skip: skip);
}
