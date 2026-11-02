import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart' show DeckFailure, DeckSelection, describeFailure;
import '../../l10n/app_localizations.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'overview.dart';
import 'providers.dart';
import 'queue.dart';
import 'today_counter.dart';

/// What a selection holds for today, as the home screen shows it.
sealed class TodayOverviewRead {
  const TodayOverviewRead();
}

/// The overview is being read.
final class OverviewPending extends TodayOverviewRead {
  const OverviewPending();
}

/// The overview could not be read; [message] says why, for the user.
final class OverviewUnavailable extends TodayOverviewRead {
  const OverviewUnavailable(this.message);

  final String message;
}

/// Today's [count], the [streak] of study days and the [nextReview].
final class TodayOverview extends TodayOverviewRead {
  const TodayOverview({
    required this.count,
    required this.streak,
    required this.nextReview,
    required this.days,
  });

  final TodayCounted count;
  final int streak;

  /// The first later day with a card due within [chartDays], as
  /// [nextReviewOf] finds it; null when none has one.
  final ({int after, int cards})? nextReview;

  /// The calendar date each of the [chartDays] study days from today starts
  /// on, at midnight UTC: the days the next review names.
  final List<DateTime> days;

  /// The whole minutes [cards] reviews take at the user's pace, rounded up.
  int minutesFor(int cards) => count.pace.minutes(reviews: cards, fresh: 0);
}

/// Builds what the caller shows of a [TodayOverviewRead].
typedef TodayOverviewBuilder = Widget Function(
  BuildContext context,
  TodayOverviewRead overview,
);

/// Reads [decks]' [TodayOverview]: [TodayCounter]'s count, the streak as the
/// completion card counts it, and the next review; shows it through
/// [builder].
///
/// It is read again when [decks] changes and whenever the route that shows it
/// comes back on top.
class TodayOverviewReader extends ConsumerStatefulWidget {
  const TodayOverviewReader({
    super.key,
    required this.decks,
    required this.builder,
  });

  final DeckSelection decks;
  final TodayOverviewBuilder builder;

  @override
  ConsumerState<TodayOverviewReader> createState() =>
      _TodayOverviewReaderState();
}

class _TodayOverviewReaderState extends ConsumerState<TodayOverviewReader> {
  late Future<TodayOverview> _overview = _read();
  bool _onTop = true;

  Future<TodayOverview> _read() async {
    final today = await readToday(widget.decks, ref);
    final repository = ref.read(studyRepositoryProvider);
    final now = ref.read(studyClockProvider)();
    final zone = ref.read(studyZoneProvider);
    final start = today.day.start;
    final recent = await repository.answersSince(start);
    final days = <DateTime>[start];
    while (days.length < chartDays) {
      days.add(studyDayEnd(days.last, zone));
    }
    return TodayOverview(
      count: today.count,
      streak: streak(
        [for (final answer in recent) answer.at],
        now,
        since: start,
        daysBefore: await studyDaysBefore(
          start,
          repository.latestAnswerBefore,
          zone,
        ),
        offsetAt: zone,
      ),
      nextReview: nextReviewOf(today.states.values, today.day, offsetAt: zone),
      days: [
        for (final day in days)
          if (day.toUtc().add(zone(day)) case final wall)
            DateTime.utc(wall.year, wall.month, wall.day),
      ],
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final onTop = ModalRoute.isCurrentOf(context) ?? true;
    if (onTop && !_onTop) _overview = _read();
    _onTop = onTop;
  }

  @override
  void didUpdateWidget(TodayOverviewReader oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!setEquals(oldWidget.decks.ids, widget.decks.ids)) _overview = _read();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return FutureBuilder(
      future: _overview,
      builder: (context, read) => widget.builder(context, switch (read) {
        AsyncSnapshot(hasError: true, :final error?) => OverviewUnavailable(
          switch (error) {
            DeckFailure() => describeFailure(l10n, error),
            StudyFailure() => describeStudyFailure(l10n, error),
            _ => Error.throwWithStackTrace(
              error,
              read.stackTrace ?? StackTrace.empty,
            ),
          },
        ),
        AsyncSnapshot<TodayOverview>(:final data?) => data,
        _ => const OverviewPending(),
      }),
    );
  }
}
