import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/session.dart';
import 'package:knowno/study/src/study_repository.dart';

import 'fixtures.dart';

/// Schedules every review one day out, except the first, for which it
/// throws an error that is not a `StudyFailure`.
class _FirstCallBreaks implements Scheduler {
  @override
  Future<CardState?> fold(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<double> retrievability(CardState state, DateTime at) =>
      throw UnimplementedError('sessions read no recall');

  final unexpected = StateError('engine state lost');
  var _calls = 0;

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) async {
    if (_calls++ == 0) throw unexpected;
    return CardState(
      stability: 1,
      difficulty: 5,
      lastReview: at,
      due: at.add(const Duration(days: 1)),
    );
  }
}

/// Schedules every review one day out; while [hold] has a write held, each
/// review waits for it to be let go.
class _HeldScheduler implements Scheduler {
  @override
  Future<CardState?> fold(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<double> retrievability(CardState state, DateTime at) =>
      throw UnimplementedError('sessions read no recall');

  Completer<void>? _held;

  /// Whether a review is waiting for the held write to be let go.
  var waiting = false;

  /// Holds every later review until the returned completer completes.
  Completer<void> hold() => _held = Completer<void>();

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) async {
    if (_held case final held?) {
      waiting = true;
      await held.future;
      waiting = false;
    }
    return CardState(
      stability: 1,
      difficulty: 5,
      lastReview: at,
      due: at.add(const Duration(days: 1)),
    );
  }
}

Future<void> _untilLoaded(StudySession session) {
  final loaded = Completer<void>();
  void check() {
    if (session.state is! SessionLoading && !loaded.isCompleted) {
      loaded.complete();
    }
  }

  session.addListener(check);
  check();
  return loaded.future.whenComplete(() => session.removeListener(check));
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  test('an unexpected error in one write is reported, and later answers are still recorded', () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    var created = DateTime.utc(2026, 10, 1);
    var ids = 0;
    final cards = DeckRepository(
      db,
      clock: () => created = created.add(const Duration(minutes: 1)),
      newId: () => 'id${ids++}',
    );
    final deck = await cards.createDeck('French');
    final cardIds = <CardId>[];
    for (final name in ['a', 'b', 'c']) {
      final saved = await cards.addCard(
        deck.id,
        front: [TextContent(name)],
        back: [TextContent(name)],
      );
      cardIds.add(switch (saved) {
        CardSaved(:final card) => card.id,
        DuplicateFront() => fail('the deck held no duplicate'),
      });
    }
    final scheduler = _FirstCallBreaks();
    final repository = StudyRepository(db, newId: () => 'review${ids++}');

    final reported = <FlutterErrorDetails>[];
    final previousHandler = FlutterError.onError;
    FlutterError.onError = reported.add;
    addTearDown(() => FlutterError.onError = previousHandler);

    final failures = <Object>[];
    final session = StudySession(
      decks: DeckSelection(deck.id),
      cards: cards,
      repository: repository,
      scheduler: scheduler,
      clock: () => DateTime.utc(2026, 10, 14, 9),
      random: FirstDraw(),
      onFailure: failures.add,
    );
    addTearDown(session.dispose);
    await _untilLoaded(session);
    expect((session.state as SessionStudying).current.id, cardIds.first);

    session.answer(Answer.know);
    session.answer(Answer.know);
    session.answer(Answer.know);
    await session.settled;
    // The failing write was the first card's, so it alone has no state.

    expect(
      [for (final details in reported) details.exception],
      [scheduler.unexpected],
    );
    // Control: the answers after the failed one reached the database.
    final stored = await repository.statesOf(cardIds);
    expect(stored.keys, unorderedEquals([cardIds[1], cardIds[2]]));
    expect(failures, isEmpty);
  });

  test("a session opened while a closed one's change of answer is still being written studies the card that change leaves left", () async {
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    var ids = 0;
    final cards = DeckRepository(
      db,
      clock: () => DateTime.utc(2026, 10, 1),
      newId: () => 'id${ids++}',
    );
    final deck = await cards.createDeck('French');
    final card = switch (await cards.addCard(
      deck.id,
      front: [const TextContent('a')],
      back: [const TextContent('a')],
    )) {
      CardSaved(:final card) => card.id,
      DuplicateFront() => fail('the deck held no duplicate'),
    };
    final scheduler = _HeldScheduler();
    final repository = StudyRepository(db, newId: () => 'review${ids++}');
    StudySession open() => StudySession(
      decks: DeckSelection(deck.id),
      cards: cards,
      repository: repository,
      scheduler: scheduler,
      clock: () => DateTime.utc(2026, 10, 14, 9),
      random: FirstDraw(),
      onFailure: (failure) => fail('unexpected $failure'),
      offsetAt: (_) => Duration.zero,
    );

    final first = open();
    await _untilLoaded(first);
    first.answer(Answer.know);
    await first.settled;
    final held = scheduler.hold();
    first.redecide(0, Answer.dontKnow);
    // Closing the screen leaves its write running.
    first.dispose();
    final second = open();
    addTearDown(second.dispose);
    // Every turn the second session needs to read the store, before the
    // write lands.
    await pumpEventQueue();
    expect(scheduler.waiting, isTrue);
    held.complete();
    await first.settled;
    await _untilLoaded(second);

    expect(
      second.state,
      isA<SessionStudying>().having(
        (state) => state.current.id,
        'current',
        card,
      ),
    );
  });
}
