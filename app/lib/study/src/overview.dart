import '../../deck/deck.dart';
import 'model.dart';
import 'queue.dart';

/// The interval from which a reviewed card counts as mastered (익힘).
const masteredInterval = Duration(days: 21);

/// How far a card has come.
enum CardProgress {
  /// Reviewed, with a current interval of at least [masteredInterval] (익힘).
  mastered,

  /// Reviewed, with a shorter interval (학습 중).
  learning,

  /// Never reviewed (새 카드).
  fresh,
}

/// The progress of a card whose stored state is [state], null when it was
/// never reviewed. The current interval is the time from its last review to
/// its due time.
CardProgress progressOf(CardState? state) => switch (state) {
  null => CardProgress.fresh,
  CardState(:final lastReview, :final due)
      when due.difference(lastReview) >= masteredInterval =>
    CardProgress.mastered,
  CardState() => CardProgress.learning,
};

/// How many of a selection's cards are mastered, learning and new.
final class DeckProgress {
  const DeckProgress({
    required this.mastered,
    required this.learning,
    required this.fresh,
  });

  /// The progress of every one of [cards], from the stored [states] of those
  /// reviewed.
  factory DeckProgress.of(Iterable<Card> cards, Map<CardId, CardState> states) {
    var mastered = 0;
    var learning = 0;
    var fresh = 0;
    for (final card in cards) {
      switch (progressOf(states[card.id])) {
        case CardProgress.mastered:
          mastered++;
        case CardProgress.learning:
          learning++;
        case CardProgress.fresh:
          fresh++;
      }
    }
    return DeckProgress(mastered: mastered, learning: learning, fresh: fresh);
  }

  final int mastered;
  final int learning;
  final int fresh;

  int get total => mastered + learning + fresh;
}

/// How many study days the next review looks ahead over, today included.
const chartDays = 7;

/// The first study day after [day], within [chartDays] of it, on which one of
/// the stored [states] falls due, in the time zone [offsetAt] gives: how many
/// days after [day] it is, and how many cards fall due in it; null when none
/// does.
({int after, int cards})? nextReviewOf(
  Iterable<CardState> states,
  StudyDay day, {
  UtcOffsetAt offsetAt = localOffsetAt,
}) {
  final ends = <DateTime>[day.end];
  while (ends.length < chartDays) {
    ends.add(studyDayEnd(ends.last, offsetAt));
  }
  final counts = List.filled(chartDays, 0);
  for (final state in states) {
    // A card due before the day ends, today's or overdue, is on no later day.
    final index = ends.indexWhere(state.due.isBefore);
    if (index > 0) counts[index]++;
  }
  for (var after = 1; after < chartDays; after++) {
    if (counts[after] > 0) return (after: after, cards: counts[after]);
  }
  return null;
}
