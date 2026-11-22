import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart'
    show
        Card,
        CardId,
        DeckFailure,
        DeckSelection,
        deckRepositoryProvider,
        describeFailure;
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'providers.dart';
import 'queue.dart';
import 'study_rereads.dart';
import 'study_time.dart';
import 'today.dart';

/// What a session over a selection would study now.
sealed class TodayCount {
  const TodayCount();
}

/// The count is being read.
final class TodayPending extends TodayCount {
  const TodayPending();
}

/// [review] cards are due and [fresh] cards are new, at the user's [pace].
final class TodayCounted extends TodayCount {
  const TodayCounted({
    required this.review,
    required this.fresh,
    this.pace = Pace.unknown,
  }) : backlog = false;

  /// So many reviews are due that new cards pause until they are done.
  const TodayCounted.backlog({required this.review, this.pace = Pace.unknown})
    : fresh = 0,
      backlog = true;

  final int review;
  final int fresh;
  final Pace pace;

  /// Whether new cards pause for a backlog of reviews.
  final bool backlog;

  /// The size of the session: every due card and every new one.
  int get total => review + fresh;

  /// The whole minutes the session takes at [pace], rounded up.
  int get minutes => pace.minutes(reviews: review, fresh: fresh);
}

/// The count could not be read; [message] says why, for the user.
final class TodayUnavailable extends TodayCount {
  const TodayUnavailable(this.message);

  final String message;
}

/// What [decks] hold for today, read through [ref]: their cards and the
/// stored states of those reviewed, the study day, its [DayPlan] from today's
/// list, the count of the cards left at the user's pace, and, across every
/// deck, the reviews [due] as the day stood when it started and the cards
/// [started] in it ([readStudyDay]).
///
/// A failed read throws the [DeckFailure] or `StudyFailure` that reports it.
Future<
  ({
    List<Card> cards,
    Map<CardId, CardState> states,
    StudyDay day,
    DayPlan plan,
    TodayCounted count,
    int due,
    int started,
  })
>
readToday(DeckSelection decks, WidgetRef ref) async {
  final repository = ref.read(studyRepositoryProvider);
  final (cards, states) = await readCards(
    decks,
    ref.read(deckRepositoryProvider),
    repository,
  );
  final (:day, :pace, :due, :started, dailyMinutes: _) = await readStudyDay(
    repository,
    ref.read(studyClockProvider)(),
    ref.read(studyZoneProvider),
  );
  final ids = {for (final card in cards) card.id};
  final plan = dayPlanOf(cards, states, day, [
    for (final answer in await repository.answersSince(day.start))
      if (ids.contains(answer.card))
        (card: answer.card, answer: answer.answer, at: answer.at),
  ]);
  // The cards still on "Don't know" are reviews, as every card with a state is.
  final fresh = plan.selected.cards
      .where((card) => !states.containsKey(card.id))
      .length;
  final count = plan.selected.backlog
      ? TodayCounted.backlog(review: plan.left, pace: pace)
      : TodayCounted(review: plan.left - fresh, fresh: fresh, pace: pace);
  return (
    cards: cards,
    states: states,
    day: day,
    plan: plan,
    count: count,
    due: due,
    started: started,
  );
}

/// Builds what the caller shows of a [TodayCount].
typedef TodayBuilder = Widget Function(BuildContext context, TodayCount count);

/// Counts the due and new cards left today for a session over [decks], by
/// the rules that build its queue, whether new cards pause for a backlog, and
/// the user's pace, and shows the count through [builder].
///
/// The count is read again when [decks] changes, whenever the route that
/// shows it comes back on top, and, while it is on top, after the cards, their
/// states or the reviews change.
class TodayCounter extends ConsumerStatefulWidget {
  const TodayCounter({super.key, required this.decks, required this.builder});

  final DeckSelection decks;
  final TodayBuilder builder;

  @override
  ConsumerState<TodayCounter> createState() => _TodayCounterState();
}

class _TodayCounterState extends ConsumerState<TodayCounter> with StudyRereads {
  late Future<TodayCounted> _count = _readCount();

  @override
  DeckSelection get decks => widget.decks;

  @override
  void read() => _count = _readCount();

  Future<TodayCounted> _readCount() async =>
      (await readToday(widget.decks, ref)).count;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder(
      future: _count,
      builder: (context, count) => widget.builder(context, switch (count) {
        AsyncSnapshot(hasError: true, :final error?) => TodayUnavailable(
          _describe(l10n, error, count.stackTrace ?? StackTrace.empty),
        ),
        AsyncSnapshot<TodayCount>(:final data?) => data,
        _ => const TodayPending(),
      }),
    );
  }
}

/// The message for a failed count; any error other than a domain failure is
/// rethrown, since no user message can explain it.
String _describe(AppLocalizations l10n, Object error, StackTrace stackTrace) =>
    switch (error) {
      DeckFailure() => describeFailure(l10n, error),
      StudyFailure() => describeStudyFailure(l10n, error),
      _ => Error.throwWithStackTrace(error, stackTrace),
    };
