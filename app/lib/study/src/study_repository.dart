import 'dart:async';

import 'package:drift/drift.dart';

import '../../database/database.dart';
import '../../deck/deck.dart';
import 'failure.dart';
import 'model.dart';
import 'queue.dart' show defaultDailyMinutes;

/// Reads and writes the study domain's tables: card states, reviews and the
/// study settings.
///
/// A failed read reaches the caller as [StudyStorageFailure], and a failed
/// write as [AnswerNotSaved].
class StudyRepository {
  StudyRepository(this._db, {required this._newId});

  final AppDatabase _db;
  final String Function() _newId;

  /// The last write [queueWrite] queued while it runs; each runs after the
  /// one before.
  Future<void>? _writing;

  /// Runs [write] once every write queued before it has finished, and holds
  /// every read until it has, so a read sees every answer given before it,
  /// though the session that gave it has closed.
  ///
  /// [write] completes without an error, reporting its own failures, since an
  /// errored write would fail every read and write behind it; and it reads
  /// nothing through this repository, which would wait on itself.
  Future<void> queueWrite(Future<void> Function() write) {
    final written = switch (_writing) {
      final writing? => writing.then((_) => write()),
      null => Future.microtask(write),
    };
    _writing = written;
    unawaited(
      written.then((_) {
        if (identical(_writing, written)) _writing = null;
      }),
    );
    return written;
  }

  /// A fresh id for a review about to be recorded.
  ReviewId newReviewId() => ReviewId(_newId());

  /// The stored state of each of [cards] that has one; a card never reviewed
  /// is absent.
  Future<Map<CardId, CardState>> statesOf(
    List<CardId> cards,
  ) => _read(() async {
    final query = _db.select(_db.cardStates)
      ..where((row) => row.cardId.isIn([for (final card in cards) card.value]));
    return {
      for (final row in await query.get()) CardId(row.cardId): _toState(row),
    };
  });

  /// Stores [reviews] of [card] and the card's [state] after the last of
  /// them, in one transaction, each row edited [at] and left for sync to
  /// push. A review already stored under the same id is replaced, which is how
  /// a toggled answer is rewritten.
  Future<void> record(
    CardId card,
    List<Review> reviews,
    CardState state, {
    required DateTime at,
  }) async {
    try {
      await _db.transaction(() async {
        for (final review in reviews) {
          await _db
              .into(_db.reviews)
              .insertOnConflictUpdate(
                ReviewRow(
                  id: review.id.value,
                  cardId: review.cardId.value,
                  rating: ratingOf(review.answer),
                  reviewedAt: review.reviewedAt,
                  durationMs: review.duration.inMilliseconds,
                  fuzzFactor: review.fuzzFactor.value,
                  updatedAt: at,
                  dirty: true,
                ),
              );
        }
        await _db
            .into(_db.cardStates)
            .insertOnConflictUpdate(
              CardStateRow(
                cardId: card.value,
                stability: state.stability,
                difficulty: state.difficulty,
                lastReview: state.lastReview,
                due: state.due,
                updatedAt: at,
                dirty: true,
              ),
            );
      });
    } on Exception catch (cause, stackTrace) {
      Error.throwWithStackTrace(AnswerNotSaved(cause), stackTrace);
    }
  }

  // The reads by time below are written in SQL: drift compares text times
  // through julianday(), which no index on reviewed_at serves.

  /// The stored state of every reviewed card, across every deck.
  Future<Map<CardId, CardState>> allStates() => _read(() async {
    final query = _db.select(_db.cardStates);
    return {
      for (final row in await query.get()) CardId(row.cardId): _toState(row),
    };
  });

  /// The time of the latest answer given before [end] to each of
  /// [cards] that has one.
  Future<Map<CardId, DateTime>> latestAnswersBefore(
    List<CardId> cards,
    DateTime end,
  ) => _read(() async {
    if (cards.isEmpty) return const {};
    final rows = await _db
        .customSelect(
          'SELECT card_id, max(reviewed_at) AS latest FROM reviews '
          'WHERE reviewed_at < ? '
          'AND card_id IN (${List.filled(cards.length, '?').join(', ')}) '
          'GROUP BY card_id',
          variables: [
            Variable<DateTime>(storedTime(end)),
            for (final card in cards) Variable<String>(card.value),
          ],
          readsFrom: {_db.reviews},
        )
        .get();
    return {
      for (final row in rows)
        CardId(row.read<String>('card_id')): row.read<DateTime>('latest'),
    };
  });

  /// Every answer given at or after [from] and before [to],
  /// oldest first, each with whether it is its card's first answer.
  Future<List<TimedAnswer>> answersBetween(DateTime from, DateTime to) =>
      _read(() async {
        final rows = await _db
            .customSelect(
              'SELECT r.reviewed_at, r.duration_ms, NOT EXISTS ('
              'SELECT 1 FROM reviews AS e WHERE e.card_id = r.card_id '
              'AND e.reviewed_at < r.reviewed_at'
              ') AS first FROM reviews AS r '
              'WHERE r.reviewed_at >= ? '
              'AND r.reviewed_at < ? ORDER BY r.reviewed_at',
              variables: [
                Variable<DateTime>(storedTime(from)),
                Variable<DateTime>(storedTime(to)),
              ],
              readsFrom: {_db.reviews},
            )
            .get();
        return [
          for (final row in rows)
            (
              at: row.read<DateTime>('reviewed_at'),
              duration: Duration(milliseconds: row.read<int>('duration_ms')),
              first: row.read<bool>('first'),
            ),
        ];
      });

  /// Every answer given at or after [since], oldest first.
  Future<List<StoredAnswer>> answersSince(DateTime since) => _read(() async {
    final rows = await _db
        .customSelect(
          'SELECT * FROM reviews WHERE reviewed_at >= ? '
          'ORDER BY reviewed_at',
          variables: [Variable<DateTime>(storedTime(since))],
          readsFrom: {_db.reviews},
        )
        .map((row) => _db.reviews.map(row.data))
        .get();
    return [
      for (final row in rows)
        (
          card: CardId(row.cardId),
          answer: answerOf(row.rating),
          at: row.reviewedAt,
          duration: Duration(milliseconds: row.durationMs),
        ),
    ];
  });

  /// The time of the latest answer given before [end], or null
  /// when there is none: one probe of the index on `reviewed_at`.
  Future<DateTime?> latestAnswerBefore(DateTime end) => _read(() async {
    final row = await _db
        .customSelect(
          'SELECT max(reviewed_at) AS latest FROM reviews '
          'WHERE reviewed_at < ?',
          variables: [Variable<DateTime>(storedTime(end))],
          readsFrom: {_db.reviews},
        )
        .getSingle();
    return row.readNullable<DateTime>('latest');
  });

  /// The daily study minutes the user set, on any device; null while none is
  /// stored, when the day takes [defaultDailyMinutes].
  Future<int?> dailyMinutes() => _read(() async {
    final row = await _db.select(_db.studySettings).getSingleOrNull();
    return row?.dailyMinutes;
  });

  /// Stores [minutes] as the daily study minutes, edited [at] and left for
  /// sync to push. A failed write throws [SettingNotSaved].
  Future<void> setDailyMinutes(int minutes, {required DateTime at}) async {
    try {
      await _db
          .into(_db.studySettings)
          .insertOnConflictUpdate(
            StudySettingsRow(
              id: 0,
              dailyMinutes: minutes,
              updatedAt: at,
              dirty: true,
            ),
          );
    } on Exception catch (cause, stackTrace) {
      Error.throwWithStackTrace(SettingNotSaved(cause), stackTrace);
    }
  }

  /// Every review, oldest first, whether or not its card is
  /// live.
  Future<List<ReviewRow>> reviews() => _read(
    () => (_db.select(
      _db.reviews,
    )..orderBy([(row) => OrderingTerm.asc(row.reviewedAt)])).get(),
  );

  Future<T> _read<T>(Future<T> Function() read) async {
    if (_writing case final writing?) await writing;
    try {
      return await read();
    } on Exception catch (cause, stackTrace) {
      Error.throwWithStackTrace(StudyStorageFailure(cause), stackTrace);
    }
  }

  CardState _toState(CardStateRow row) => CardState(
    stability: row.stability,
    difficulty: row.difficulty,
    lastReview: row.lastReview,
    due: row.due,
  );
}
