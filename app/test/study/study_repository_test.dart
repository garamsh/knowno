import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart' show CardId;
import 'package:knowno/study/src/study_repository.dart';

void main() {
  late AppDatabase db;
  late StudyRepository study;
  final day = DateTime.utc(2026, 10, 14, 4);

  setUp(() async {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    db = AppDatabase(NativeDatabase.memory());
    study = StudyRepository(db, newId: () => 'unused');
    await db
        .into(db.decks)
        .insert(
          DecksCompanion.insert(
            id: 'deck',
            name: 'French',
            createdAt: day,
            updatedAt: day,
          ),
        );
  });

  tearDown(() => db.close());

  var reviews = 0;

  /// Stores an answer to [card] at [at], creating the card on first use.
  Future<void> answer(String card, DateTime at) async {
    await db
        .into(db.cards)
        .insertOnConflictUpdate(
          CardsCompanion.insert(
            id: card,
            deckId: 'deck',
            front: '[]',
            back: '[]',
            cardKey: card,
            source: 'manual',
            createdAt: day,
            updatedAt: day,
          ),
        );
    await db
        .into(db.reviews)
        .insert(
          ReviewsCompanion.insert(
            id: 'review ${reviews++}',
            cardId: card,
            rating: 'good',
            reviewedAt: at,
            durationMs: 1000,
            updatedAt: at,
          ),
        );
  }

  test('the answers between two times are the ones from the first up to the second, each marked when it is its card\'s first answer', () async {
    await answer('new today', day.add(const Duration(hours: 2)));
    await answer('new today', day.add(const Duration(hours: 3)));
    await answer('answered before', day.subtract(const Duration(days: 1)));
    await answer('answered before', day.add(const Duration(hours: 1)));
    await answer('at the end', day.add(const Duration(days: 1)));

    final between = await study.answersBetween(
      day,
      day.add(const Duration(days: 1)),
    );

    expect(
      [for (final answer in between) (answer.at, answer.first)],
      [
        (day.add(const Duration(hours: 1)), false),
        (day.add(const Duration(hours: 2)), true),
        (day.add(const Duration(hours: 3)), false),
      ],
    );
  });

  test('the latest answers before a time are each named card\'s last one before it, for those that have one', () async {
    await answer('a', day.subtract(const Duration(days: 2)));
    await answer('a', day.subtract(const Duration(days: 1)));
    await answer('a', day.add(const Duration(hours: 1)));
    await answer('b', day.add(const Duration(hours: 1)));
    await answer('c', day.subtract(const Duration(hours: 3)));

    final latest = await study.latestAnswersBefore([
      const CardId('a'),
      const CardId('b'),
    ], day);

    expect(latest, {const CardId('a'): day.subtract(const Duration(days: 1))});
    expect(await study.latestAnswersBefore(const [], day), isEmpty);
  });

  test('answers since a time come oldest first to the millisecond, from a time given in any zone', () async {
    final at = day.add(const Duration(minutes: 5));
    await answer('b', at.add(const Duration(milliseconds: 2)));
    await answer('a', at.add(const Duration(milliseconds: 1)));
    await answer('c', at.add(const Duration(milliseconds: 10)));
    await answer('before', at.subtract(const Duration(milliseconds: 1)));

    final since = await study.answersSince(at.toLocal());

    expect([for (final stored in since) stored.card.value], ['a', 'b', 'c']);
  });

  test(
    'the latest answer before a time is the last one before it, or none',
    () async {
      await answer('a', day);
      await answer('b', day.add(const Duration(hours: 1)));
      await answer('c', day.add(const Duration(hours: 3)));

      expect(
        await study.latestAnswerBefore(day.add(const Duration(hours: 3))),
        day.add(const Duration(hours: 1)),
      );
      expect(
        await study.latestAnswerBefore(day.add(const Duration(hours: 1))),
        day,
      );
      expect(await study.latestAnswerBefore(day), isNull);
    },
  );

  test('a read of the answers or the states waits for every write queued before it', () async {
    final at = day.add(const Duration(hours: 1));
    final held = Completer<void>();
    unawaited(
      study.queueWrite(() async {
        await held.future;
        await answer('a', at);
        await db
            .into(db.cardStates)
            .insert(
              CardStatesCompanion.insert(
                cardId: 'a',
                stability: 1,
                difficulty: 5,
                lastReview: at,
                due: at.add(const Duration(days: 1)),
                updatedAt: at,
              ),
            );
      }),
    );

    final answers = study.answersSince(day);
    final states = study.statesOf(const [CardId('a')]);
    // Every turn the reads need to finish, before the write runs.
    await pumpEventQueue();
    held.complete();

    expect([for (final stored in await answers) stored.card.value], ['a']);
    expect((await states).keys, [const CardId('a')]);
  });

  test('a write that throws is reported, and a read and a write queued behind it still run', () async {
    final reported = <Object>[];
    final previousHandler = FlutterError.onError;
    FlutterError.onError = (details) => reported.add(details.exception);
    addTearDown(() => FlutterError.onError = previousHandler);
    final broken = StateError('engine state lost');
    final at = day.add(const Duration(hours: 1));

    unawaited(study.queueWrite(() async => throw broken));
    final read = study.answersSince(day);
    unawaited(study.queueWrite(() => answer('a', at)));
    final after = study.answersSince(day);

    expect(await read, isEmpty);
    expect([for (final stored in await after) stored.card.value], ['a']);
    expect(reported, [broken]);
  });
}
