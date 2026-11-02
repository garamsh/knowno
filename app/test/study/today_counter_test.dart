import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/src/failure.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/providers.dart';
import 'package:knowno/study/src/rust/api/engine.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/study_repository.dart';
import 'package:knowno/study/src/study_screen.dart';
import 'package:knowno/study/src/today_counter.dart';

import 'fixtures.dart';
import 'study_storage.dart';

/// Schedules every review one day out, at once.
class _InstantScheduler implements Scheduler {
  @override
  Future<CardState?> fold(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) =>
      throw UnimplementedError('sessions do not fold');

  @override
  Future<double> retrievability(CardState state, DateTime at) =>
      throw UnimplementedError('sessions read no recall');

  @override
  Future<CardState> review(
    CardState? state,
    Answer answer,
    DateTime at, {
    required FuzzFactor fuzz,
  }) async => CardState(
    stability: 1,
    difficulty: 5,
    lastReview: at,
    due: at.add(const Duration(days: 1)),
  );
}

/// Fails every read of the stored states.
class _UnreadableStates implements StudyRepository {
  @override
  ReviewId newReviewId() => const ReviewId('unused');

  @override
  Future<void> queueWrite(Future<void> Function() write) =>
      throw UnimplementedError();

  @override
  Future<Map<CardId, CardState>> statesOf(List<CardId> cards) async =>
      throw const StudyStorageFailure(FormatException('unreadable'));

  @override
  Future<void> record(
    CardId card,
    List<Review> reviews,
    CardState state, {
    required DateTime at,
  }) => throw UnimplementedError();

  @override
  Future<int?> dailyMinutes() => throw UnimplementedError();

  @override
  Future<void> setDailyMinutes(int minutes, {required DateTime at}) =>
      throw UnimplementedError();

  @override
  Future<Map<CardId, CardState>> allStates() => throw UnimplementedError();

  @override
  Future<Map<CardId, DateTime>> latestAnswersBefore(
    List<CardId> cards,
    DateTime end,
  ) => throw UnimplementedError();

  @override
  Future<List<TimedAnswer>> answersBetween(DateTime from, DateTime to) =>
      throw UnimplementedError();

  @override
  Future<List<StoredAnswer>> answersSince(DateTime since) =>
      throw UnimplementedError();

  @override
  Future<DateTime?> latestAnswerBefore(DateTime end) =>
      throw UnimplementedError();

  @override
  Future<List<ReviewRow>> reviews() => throw UnimplementedError();
}

final _now = DateTime.utc(2026, 10, 14, 9);

/// Two decks: "a" holds a card due now, one due tomorrow and two new ones;
/// "b" holds a card due yesterday and a new one. A session over both takes
/// five cards.
class _Decks {
  _Decks(this.db);

  final AppDatabase db;
  var _ids = 0;
  late final cards = DeckRepository(
    db,
    clock: () => _now,
    newId: () => 'id${_ids++}',
  );
  late final study = StudyRepository(db, newId: () => 'review${_ids++}');
  late DeckId a;
  late DeckId b;

  Future<void> seed() async {
    a = (await cards.createDeck('a')).id;
    b = (await cards.createDeck('b')).id;
    await add(a, 'a due', due: _now);
    await add(a, 'a later', due: _now.add(const Duration(days: 1)));
    await add(a, 'a new 1');
    await add(a, 'a new 2');
    await add(b, 'b due', due: _now.subtract(const Duration(days: 1)));
    await add(b, 'b new');
  }

  /// Adds a card to [deck], with a stored state due at [due] after an
  /// interval of [days] days when [due] is given.
  Future<void> add(
    DeckId deck,
    String front, {
    DateTime? due,
    int days = 3,
  }) async {
    final saved = await cards.addCard(
      deck,
      front: [TextContent(front)],
      back: [TextContent(front)],
    );
    final card = switch (saved) {
      CardSaved(:final card) => card,
      DuplicateFront() => fail('the deck held no duplicate'),
    };
    if (due == null) return;
    await review(
      card.id,
      CardState(
        stability: days.toDouble(),
        difficulty: 5,
        lastReview: due.subtract(Duration(days: days)),
        due: due,
      ),
      [Duration.zero],
    );
  }

  /// Records one review of [card] per entry of [durations], a minute apart
  /// and ending at [state]'s last review, with [state] after them.
  Future<void> review(
    CardId card,
    CardState state,
    List<Duration> durations,
  ) async {
    await study.record(
      card,
      [
        for (final (i, duration) in durations.indexed)
          Review(
            id: study.newReviewId(),
            cardId: card,
            answer: Answer.know,
            reviewedAt: state.lastReview.subtract(
              Duration(minutes: durations.length - 1 - i),
            ),
            duration: duration,
            fuzzFactor: FuzzFactor.draw(FirstDraw()),
          ),
      ],
      state,
      at: DateTime.utc(2026, 9, 1),
    );
  }
}

/// Shows a [TodayCounter] over both decks of [decks], as the count's text and
/// a "Study all" button that opens the session over them.
Future<GlobalKey<NavigatorState>> _pump(
  WidgetTester tester,
  _Decks decks, {
  StudyRepository? study,
}) async {
  final navigator = GlobalKey<NavigatorState>();
  final storage = await openStudyStorage(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        studyStorageProvider.overrideWithValue(storage),
        deckRepositoryProvider.overrideWithValue(decks.cards),
        studyRepositoryProvider.overrideWithValue(study ?? decks.study),
        schedulerProvider.overrideWithValue(_InstantScheduler()),
        studyClockProvider.overrideWithValue(() => _now),
        studyZoneProvider.overrideWithValue((_) => Duration.zero),
        studyRandomProvider.overrideWithValue((_) => FirstDraw()),
      ],
      child: MaterialApp(
        navigatorKey: navigator,
        theme: lightTheme,
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: TodayCounter(
            decks: DeckSelection(decks.a, [decks.b]),
            builder: (context, count) => Column(
              children: [
                Text(switch (count) {
                  TodayCounted(
                    :final review,
                    :final fresh,
                    :final pace,
                    backlog: false,
                  ) =>
                    '$review due, $fresh new, ${pace.reviewMs ~/ 1000} s a review, ${pace.firstMs ~/ 1000} s a new card',
                  TodayCounted(:final review, backlog: true) =>
                    '$review due, new cards paused',
                  TodayUnavailable(:final message) => message,
                  TodayPending() => 'pending',
                }),
                TextButton(
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) =>
                          StudyScreen(decks: DeckSelection(decks.a, [decks.b])),
                    ),
                  ),
                  child: const Text('Study all'),
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return navigator;
}

Future<_Decks> _seed(WidgetTester tester) async {
  final decks = _Decks(AppDatabase(NativeDatabase.memory()));
  addTearDown(decks.db.close);
  await tester.runAsync(decks.seed);
  return decks;
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    'the due and new counts add up to the length of the queue a session over the decks opens',
    (tester) async {
      final decks = await _seed(tester);
      await _pump(tester, decks);

      expect(
        find.text('2 due, 3 new, 10 s a review, 10 s a new card'),
        findsOneWidget,
      );

      await tester.tap(find.text('Study all'));
      await tester.pumpAndSettle();

      expect(find.text('0/5'), findsOneWidget);
    },
  );

  testWidgets(
    'new cards first answered today in another deck leave the count only the new cards the day has left',
    (tester) async {
      final decks = await _seed(tester);
      await tester.runAsync(() async {
        // 5 minutes less the 2 reviews due, at 10 s each: 28 new cards today,
        // all but 2 of them first answered in the other deck.
        await decks.study.setDailyMinutes(5, at: DateTime.utc(2026, 10, 14));
        final other = (await decks.cards.createDeck('other')).id;
        for (var index = 0; index < 26; index++) {
          await decks.add(other, 'other $index');
        }
        final answered = await decks.cards.listCards(other);
        for (final card in answered) {
          // First answered at 05:00 UTC today, due again in a week.
          final at = DateTime.utc(2026, 10, 14, 5);
          await decks.review(
            card.id,
            CardState(
              stability: 7,
              difficulty: 5,
              lastReview: at,
              due: at.add(const Duration(days: 7)),
            ),
            [const Duration(seconds: 10)],
          );
        }
      });
      await _pump(tester, decks);

      expect(
        find.text('2 due, 2 new, 10 s a review, 10 s a new card'),
        findsOneWidget,
      );

      await tester.tap(find.text('Study all'));
      await tester.pumpAndSettle();

      expect(find.text('0/4'), findsOneWidget);
    },
  );

  testWidgets('the count is read again when its route comes back on top', (
    tester,
  ) async {
    final decks = await _seed(tester);
    final navigator = await _pump(tester, decks);
    expect(
      find.text('2 due, 3 new, 10 s a review, 10 s a new card'),
      findsOneWidget,
    );

    navigator.currentState!.push(
      MaterialPageRoute<void>(builder: (_) => const Scaffold()),
    );
    await tester.pumpAndSettle();
    await tester.runAsync(() => decks.add(decks.b, 'b new 2'));
    await tester.pumpAndSettle();
    // Control: nothing reads the count while another route covers it.
    expect(
      find.text(
        '2 due, 3 new, 10 s a review, 10 s a new card',
        skipOffstage: false,
      ),
      findsOneWidget,
    );

    navigator.currentState!.pop();
    await tester.pumpAndSettle();

    expect(
      find.text('2 due, 4 new, 10 s a review, 10 s a new card'),
      findsOneWidget,
    );
  });

  testWidgets(
    'the count carries the review pace and the first-answer pace of the study days before today, each once 20 answers of its kind are stored',
    (tester) async {
      final decks = _Decks(AppDatabase(NativeDatabase.memory()));
      addTearDown(decks.db.close);
      final yesterday = DateTime.utc(2026, 10, 13, 9);
      final cards = <CardId>[];
      await tester.runAsync(() async {
        decks.a = (await decks.cards.createDeck('a')).id;
        decks.b = (await decks.cards.createDeck('b')).id;
        await decks.add(decks.a, 'a new');
        final history = (await decks.cards.createDeck('history')).id;
        for (var index = 0; index < 20; index++) {
          await decks.add(history, 'history $index');
        }
        cards.addAll([
          for (final card in await decks.cards.listCards(history)) card.id,
        ]);
        // Each card first answered in 6 s yesterday, then reviewed in 4 s,
        // and not due again within the week; today holds no answer.
        for (final (index, card) in cards.indexed) {
          await decks.review(
            card,
            CardState(
              stability: 7,
              difficulty: 5,
              lastReview: yesterday.add(Duration(minutes: 2 * index)),
              due: _now.add(const Duration(days: 7)),
            ),
            [const Duration(seconds: 6), const Duration(seconds: 4)],
          );
        }
      });
      await _pump(tester, decks);

      expect(
        find.text('0 due, 1 new, 4 s a review, 6 s a new card'),
        findsOneWidget,
      );

      // Control: with one review fewer, 19, the review pace is unknown.
      await tester.runAsync(
        () => decks.db.customStatement(
          'DELETE FROM reviews WHERE card_id = ? AND duration_ms = 4000',
          [cards[0].value],
        ),
      );
      await _pump(tester, decks);

      expect(
        find.text('0 due, 1 new, 10 s a review, 6 s a new card'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'with more than three days of reviews due, the count and the session it opens take no new card',
    (tester) async {
      final decks = await _seed(tester);
      final navigator = await _pump(tester, decks);
      // Control: three cards due every three days are one review a day, and
      // two due are not a backlog.
      expect(
        find.text('2 due, 3 new, 10 s a review, 10 s a new card'),
        findsOneWidget,
      );

      navigator.currentState!.push(
        MaterialPageRoute<void>(builder: (_) => const Scaffold()),
      );
      await tester.pumpAndSettle();
      // Six more due after 30 days: eight due against a load of 1.2 a day.
      await tester.runAsync(() async {
        for (var index = 0; index < 6; index++) {
          await decks.add(
            decks.b,
            'b overdue $index',
            due: _now.subtract(const Duration(days: 1)),
            days: 30,
          );
        }
      });
      navigator.currentState!.pop();
      await tester.pumpAndSettle();

      expect(find.text('8 due, new cards paused'), findsOneWidget);

      await tester.tap(find.text('Study all'));
      await tester.pumpAndSettle();

      expect(find.text('0/8'), findsOneWidget);
    },
  );

  testWidgets('a count that cannot be read says why', (tester) async {
    final decks = await _seed(tester);
    await _pump(tester, decks, study: _UnreadableStates());

    expect(
      find.text(
        "Couldn't read or write the device's storage. Please try again.",
      ),
      findsOneWidget,
    );
    expect(find.text('Study all'), findsOneWidget);
  });
}
