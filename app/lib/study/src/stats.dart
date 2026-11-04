import '../../database/database.dart';
import '../../deck/deck.dart';
import 'model.dart';
import 'overview.dart';
import 'queue.dart';
import 'rust/api/engine.dart' show Answer;
import 'scheduler.dart';
import 'study_repository.dart';

/// The probability of recall the engine schedules each review for:
/// `DESIRED_RETENTION` in `engine/src/fsrs.rs`.
const targetRetention = 0.9;

/// How many scheduled reviews were answered "Know", out of how many.
final class Retention {
  const Retention({required this.reviews, required this.known})
    : assert(reviews > 0, 'a retention holds at least one review');

  /// The scheduled reviews counted; at least one.
  final int reviews;

  /// Those answered "Know".
  final int known;

  /// The share answered "Know", from 0 to 1.
  double get share => known / reviews;

  /// How far [share] is above [targetRetention], negative below it.
  double get gap => share - targetRetention;
}

/// The [retention] of the scheduled reviews of the study day starting at
/// [day].
typedef DayRetention = ({DateTime day, Retention retention});

/// The retention of each study day holding a scheduled review, oldest first,
/// in the time zone [offsetAt] gives.
///
/// A review is scheduled when it is a card's first answer of its study day
/// and the card has an answer on an earlier one: a card's first answer ever,
/// and a re-show after "Don't know" on the same day, are left out.
List<DayRetention> retentionByDay(
  Iterable<StoredAnswer> answers, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  final lastDay = <CardId, DateTime>{};
  final reviews = <DateTime, int>{};
  final known = <DateTime, int>{};
  final ordered = [...answers]..sort((a, b) => a.at.compareTo(b.at));
  for (final answer in ordered) {
    final day = studyDayStart(answer.at, offsetAt);
    final previous = lastDay[answer.card];
    lastDay[answer.card] = day;
    if (previous == null || !previous.isBefore(day)) continue;
    reviews.update(day, (count) => count + 1, ifAbsent: () => 1);
    if (answer.answer == Answer.know) {
      known.update(day, (count) => count + 1, ifAbsent: () => 1);
    }
  }
  return [
    for (final MapEntry(key: day, value: count) in reviews.entries)
      (day: day, retention: Retention(reviews: count, known: known[day] ?? 0)),
  ]..sort((a, b) => a.day.compareTo(b.day));
}

/// The retention over every scheduled review of [days]; null when they hold
/// none.
Retention? retentionOver(Iterable<DayRetention> days) {
  var reviews = 0;
  var known = 0;
  for (final (day: _, :retention) in days) {
    reviews += retention.reviews;
    known += retention.known;
  }
  return reviews == 0 ? null : Retention(reviews: reviews, known: known);
}

/// A span of study days the retention is shown over.
enum StatsPeriod {
  /// The last 7 study days, today's included (7일).
  week(7),

  /// The last 30 study days, today's included (30일).
  month(30),

  /// Every study day (전체).
  all(null);

  const StatsPeriod(this.days);

  /// How many study days the period holds; null for every one.
  final int? days;

  /// When the period's first study day starts, as of [now] in the time zone
  /// [offsetAt] gives; null for every study day.
  DateTime? start(DateTime now, {UtcOffsetAt offsetAt = localOffsetAt}) {
    final days = this.days;
    if (days == null) return null;
    var start = studyDayStart(now, offsetAt);
    for (var day = 1; day < days; day++) {
      start = studyDayBefore(start, offsetAt);
    }
    return start;
  }
}

/// The days of [days] that fall within [period] as of [now], in the time
/// zone [offsetAt] gives.
List<DayRetention> retentionIn(
  List<DayRetention> days,
  StatsPeriod period,
  DateTime now, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  final start = period.start(now, offsetAt: offsetAt);
  return start == null
      ? days
      : [
          for (final day in days)
            if (!day.day.isBefore(start)) day,
        ];
}

/// The probability of recall from which a card's recall is strong (좋음).
const strongRecall = 0.95;

/// The probability of recall below which a card is fading (곧 잊음).
const fadingRecall = 0.8;

/// A band of the probability of recall.
enum RecallBand {
  /// At least [strongRecall] (좋음).
  strong,

  /// From [fadingRecall] up to [strongRecall] (보통).
  fair,

  /// Below [fadingRecall] (곧 잊음).
  fading,
}

/// The band [recall], a probability of recall, falls in.
RecallBand recallBandOf(double recall) => recall >= strongRecall
    ? RecallBand.strong
    : recall >= fadingRecall
    ? RecallBand.fair
    : RecallBand.fading;

/// How many cards fall in each [RecallBand], and their [mean] probability of
/// recall.
final class RecallBands {
  const RecallBands({
    required this.strong,
    required this.fair,
    required this.fading,
    required this.mean,
  });

  /// The bands of the cards whose probabilities of recall are [recalls].
  factory RecallBands.of(Iterable<double> recalls) {
    var strong = 0;
    var fair = 0;
    var fading = 0;
    var sum = 0.0;
    for (final recall in recalls) {
      sum += recall;
      switch (recallBandOf(recall)) {
        case RecallBand.strong:
          strong++;
        case RecallBand.fair:
          fair++;
        case RecallBand.fading:
          fading++;
      }
    }
    final total = strong + fair + fading;
    return RecallBands(
      strong: strong,
      fair: fair,
      fading: fading,
      mean: total == 0 ? null : sum / total,
    );
  }

  final int strong;
  final int fair;
  final int fading;

  /// The mean probability of recall; null without a card.
  final double? mean;
}

/// How many weeks [masteredByWeek] covers, this one included.
const masteredWeeks = 8;

/// The cards mastered at the end of each of the last [masteredWeeks] weeks,
/// oldest first, the last ending with today's study day. A week is seven
/// study days in the time zone [offsetAt] gives.
///
/// [histories] holds each card's states after each of its reviews, in order;
/// at a week's end a card has the state of its latest review before it, and
/// is mastered by [progressOf].
List<int> masteredByWeek(
  Iterable<List<CardState>> histories,
  DateTime now, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  // Each earlier week ends where the study day after its last one starts.
  final starts = [studyDayStart(now, offsetAt)];
  while (starts.length < 7 * (masteredWeeks - 1)) {
    starts.add(studyDayBefore(starts.last, offsetAt));
  }
  final ends = [
    studyDayEnd(starts.first, offsetAt),
    for (var week = 1; week < masteredWeeks; week++) starts[7 * week - 1],
  ];
  return [
    for (final end in ends.reversed)
      histories.where((states) {
        CardState? latest;
        for (final state in states) {
          if (!state.lastReview.isBefore(end)) break;
          latest = state;
        }
        return progressOf(latest) == CardProgress.mastered;
      }).length,
  ];
}

/// How many more cards are mastered at the end of this week than at the end
/// of the first of [weeks], as [masteredByWeek] gives them, the span the
/// chart draws; null unless more are.
int? masteredGain(List<int> weeks) {
  final gain = weeks.last - weeks.first;
  return gain > 0 ? gain : null;
}

/// How many study days [studyDayCounts] covers: twelve weeks.
const heatmapDays = 84;

/// The cards answered on a study day, and the calendar [date] it starts on,
/// at midnight UTC.
typedef StudyDayCount = ({DateTime date, int cards});

/// The distinct cards answered on each of the last [heatmapDays] study days,
/// oldest first, the last being today's, in the time zone [offsetAt] gives.
List<StudyDayCount> studyDayCounts(
  Iterable<StoredAnswer> answers,
  DateTime now, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  final cards = <DateTime, Set<CardId>>{};
  for (final answer in answers) {
    cards
        .putIfAbsent(studyDayStart(answer.at, offsetAt), () => {})
        .add(answer.card);
  }
  final days = [studyDayStart(now, offsetAt)];
  while (days.length < heatmapDays) {
    days.add(studyDayBefore(days.last, offsetAt));
  }
  return [
    for (final day in days.reversed)
      if (day.toUtc().add(offsetAt(day)) case final wall)
        (
          date: DateTime.utc(wall.year, wall.month, wall.day),
          cards: cards[day]?.length ?? 0,
        ),
  ];
}

/// How many levels a heatmap cell is drawn at, a day without a card included.
const heatLevels = 4;

/// The level a study day with [cards] is drawn at, when the busiest day of
/// the heatmap holds [most]: 0 without a card, then 1 to 3 by which third of
/// 1 to [most] it falls in.
int heatLevel(int cards, int most) =>
    cards <= 0 ? 0 : (3 * cards / most).ceil().clamp(1, heatLevels - 1);

/// The most study days in a row that hold one of [answers], in the time zone
/// [offsetAt] gives.
int bestStreak(
  Iterable<DateTime> answers, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  final days = {for (final at in answers) studyDayStart(at, offsetAt)}.toList()
    ..sort();
  var best = 0;
  var run = 0;
  DateTime? previous;
  for (final day in days) {
    run = previous != null && studyDayEnd(previous, offsetAt) == day
        ? run + 1
        : 1;
    if (run > best) best = run;
    previous = day;
  }
  return best;
}

/// What the 기록 tab shows, read from the device's own data.
final class StudyStats {
  const StudyStats({
    required this.retention,
    required this.recall,
    required this.mastered,
    required this.days,
    required this.streak,
    required this.bestStreak,
  });

  /// [retentionByDay] over every stored answer.
  final List<DayRetention> retention;

  /// The [RecallBands] of the selection's reviewed cards now.
  final RecallBands recall;

  /// [masteredByWeek] over the selection's cards.
  final List<int> mastered;

  /// [studyDayCounts] over every stored answer.
  final List<StudyDayCount> days;

  /// The current streak, as the completion sheet counts it.
  final int streak;

  /// The longest streak ever.
  final int bestStreak;
}

/// Reads the [StudyStats] at [now] in the time zone [offsetAt] gives.
///
/// The retention, the study days and both streaks count every stored answer,
/// whether or not its card is still in a deck. The recall bands and the
/// mastered weeks count the cards of [decks], read through [cards], as their
/// stored reviews fold through [scheduler].
///
/// A failed read throws the [DeckFailure] or [StudyFailure] that reports it,
/// and a refused review the [SchedulingFailure].
Future<StudyStats> readStats(
  DeckSelection decks, {
  required DeckRepository cards,
  required StudyRepository repository,
  required Scheduler scheduler,
  required DateTime now,
  UtcOffsetAt offsetAt = localOffsetAt,
}) async {
  final (live, states) = await readCards(decks, cards, repository);
  final reviews = await repository.reviews();
  final answers = [
    for (final row in reviews)
      (
        card: CardId(row.cardId),
        answer: answerOf(row.rating),
        at: row.reviewedAt,
        duration: Duration(milliseconds: row.durationMs),
      ),
  ];
  final ids = {for (final card in live) card.id.value};
  final byCard = <String, List<ReviewRow>>{};
  for (final row in reviews) {
    if (ids.contains(row.cardId)) {
      byCard.putIfAbsent(row.cardId, () => []).add(row);
    }
  }
  final times = [for (final answer in answers) answer.at];
  return StudyStats(
    retention: retentionByDay(answers, offsetAt: offsetAt),
    recall: RecallBands.of([
      for (final state in states.values)
        await scheduler.retrievability(state, now),
    ]),
    mastered: masteredByWeek(
      [for (final rows in byCard.values) await scheduler.history(rows)],
      now,
      offsetAt: offsetAt,
    ),
    days: studyDayCounts(answers, now, offsetAt: offsetAt),
    streak: streak(
      times,
      now,
      since: DateTime.utc(1970),
      daysBefore: 0,
      offsetAt: offsetAt,
    ),
    bestStreak: bestStreak(times, offsetAt: offsetAt),
  );
}
