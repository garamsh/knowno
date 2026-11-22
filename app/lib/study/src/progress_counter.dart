import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../deck/deck.dart'
    show DeckFailure, DeckSelection, deckRepositoryProvider;
import 'failure.dart';
import 'overview.dart';
import 'providers.dart';
import 'queue.dart';
import 'study_rereads.dart';

/// Builds what the caller shows of a selection's [DeckProgress], null while it
/// is read or when a domain failure stops the read.
typedef ProgressBuilder = Widget Function(
  BuildContext context,
  DeckProgress? progress,
);

/// Counts how many of [decks]' cards are mastered, learning and new, and
/// shows the count through [builder].
///
/// The count is read again when [decks] changes, whenever the route that
/// shows it comes back on top and, while it is on top, after the cards, their
/// states or the reviews change, as [TodayCounter]'s is.
class ProgressCounter extends ConsumerStatefulWidget {
  const ProgressCounter({
    super.key,
    required this.decks,
    required this.builder,
  });

  final DeckSelection decks;
  final ProgressBuilder builder;

  @override
  ConsumerState<ProgressCounter> createState() => _ProgressCounterState();
}

class _ProgressCounterState extends ConsumerState<ProgressCounter>
    with StudyRereads {
  late Future<DeckProgress> _progress = _readProgress();

  @override
  DeckSelection get decks => widget.decks;

  @override
  void read() => _progress = _readProgress();

  Future<DeckProgress> _readProgress() async {
    final (cards, states) = await readCards(
      widget.decks,
      ref.read(deckRepositoryProvider),
      ref.read(studyRepositoryProvider),
    );
    return DeckProgress.of(cards, states);
  }

  @override
  Widget build(BuildContext context) => FutureBuilder(
    future: _progress,
    builder: (context, progress) => widget.builder(context, switch (progress) {
      // A failed read is a domain failure the [TodayCounter] beside every
      // progress reports from the same read; anything else is rethrown.
      AsyncSnapshot(hasError: true, :final error?)
          when error is! DeckFailure && error is! StudyFailure =>
        Error.throwWithStackTrace(
          error,
          progress.stackTrace ?? StackTrace.empty,
        ),
      AsyncSnapshot(:final data) => data,
    }),
  );
}
