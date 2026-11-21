import 'dart:async';
import 'dart:math';

import 'package:drift/drift.dart' show Value;
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/study.dart';

import '../account/fake_account_service.dart';

import 'package:shared_preferences/shared_preferences.dart';

/// The time the home screens' study reads: 09:00 on 15 October 2026, in a
/// zone at UTC, so the study day runs from 04:00 that day to 04:00 the next.
final homeNow = DateTime.utc(2026, 10, 15, 9);

/// What the home screens read beside the decks: a signed-in account, or
/// [account] where one is given, and study over [db] at [homeNow], whose count
/// never finishes reading when [stalled]. Counting and opening a session
/// schedule nothing, so the scheduler only answers the 기록 tab's folds and
/// recall.
List<Override> homeOverrides(
  AppDatabase db, {
  required SharedPreferencesWithCache storage,
  bool stalled = false,
  FakeAccountService? account,
}) => [
  accountServiceProvider.overrideWithValue(
    account ??
        FakeAccountService(
          const SignedIn(
            userId: UserId('00000000-0000-4000-8000-00000000000a'),
            email: 'ada@example.com',
          ),
        ),
  ),
  studyRepositoryProvider.overrideWithValue(
    stalled
        ? _StalledCount(db, newId: () => 'review${_reviews++}')
        : StudyRepository(db, newId: () => 'review${_reviews++}'),
  ),
  schedulerProvider.overrideWithValue(_UnusedScheduler()),
  studyClockProvider.overrideWithValue(() => homeNow),
  studyZoneProvider.overrideWithValue((_) => Duration.zero),
  studyRandomProvider.overrideWithValue((_) => Random(0)),
  studyStorageProvider.overrideWithValue(storage),
  deckStorageProvider.overrideWithValue(storage),
];

var _reviews = 0;

/// Schedules nothing; for the 기록 tab, folds every card into no state and
/// recalls every stored state at [homeRecall].
class _UnusedScheduler extends Fake implements Scheduler {
  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) async => [];

  @override
  Future<double> retrievability(CardState state, DateTime at) async =>
      homeRecall;
}

/// The probability of recall the home screens' scheduler gives every stored
/// state.
const homeRecall = 0.9;

/// A study repository whose first read of the stored states across every
/// deck, the count's, for the day's new cards, never completes; later reads,
/// a session's, do.
class _StalledCount extends StudyRepository {
  _StalledCount(super.db, {required super.newId});

  var _reads = 0;

  @override
  Future<Map<CardId, CardState>> allStates() => _reads++ == 0
      ? Completer<Map<CardId, CardState>>().future
      : super.allStates();
}

/// Stores a reviewed state for [card] that falls due at [due], after an
/// interval of [days] days.
Future<void> storeState(
  AppDatabase db,
  CardId card, {
  required DateTime due,
  int days = 3,
}) => db
    .into(db.cardStates)
    .insert(
      CardStatesCompanion.insert(
        cardId: card.value,
        stability: days.toDouble(),
        difficulty: 5,
        lastReview: due.subtract(Duration(days: days)),
        due: due,
        updatedAt: homeNow,
      ),
    );

/// Stores [count] answers of [card], each taking [duration], on the day
/// before [homeNow]'s study day, so they set the user's pace without taking
/// any of today's new cards.
Future<void> storeAnswers(
  AppDatabase db,
  CardId card,
  int count,
  Duration duration,
) async {
  for (var i = 0; i < count; i++) {
    await db
        .into(db.reviews)
        .insert(
          ReviewsCompanion.insert(
            id: 'answer${_reviews++}',
            cardId: card.value,
            rating: 'good',
            reviewedAt: DateTime.utc(2026, 10, 14, 9, i),
            durationMs: duration.inMilliseconds,
            fuzzFactor: const Value(0),
            updatedAt: homeNow,
          ),
        );
  }
}

/// A deck repository whose list of a deck's cards fails for each deck in
/// [unreadable], as a failing local database does.
class UnreadableDecks extends DeckRepository {
  UnreadableDecks(super.db, {required super.clock, required super.newId});

  final unreadable = <DeckId>{};

  @override
  Future<List<Card>> listCards(DeckId deck) async {
    if (unreadable.contains(deck)) {
      throw const StorageFailure(FormatException('unreadable'));
    }
    return super.listCards(deck);
  }
}

/// Stores one answer of [card] at [at], recorded as "Know".
Future<void> storeAnswerAt(AppDatabase db, CardId card, DateTime at) => db
    .into(db.reviews)
    .insert(
      ReviewsCompanion.insert(
        id: 'answer${_reviews++}',
        cardId: card.value,
        rating: 'good',
        reviewedAt: at,
        durationMs: 3000,
        fuzzFactor: const Value(0),
        updatedAt: at,
      ),
    );
