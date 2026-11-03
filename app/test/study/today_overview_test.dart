import 'dart:math';

import 'package:drift/drift.dart' show Value, driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/src/model.dart';
import 'package:knowno/study/src/providers.dart';
import 'package:knowno/study/src/scheduler.dart';
import 'package:knowno/study/src/stats.dart';
import 'package:knowno/study/src/study_repository.dart';
import 'package:knowno/study/src/today_overview.dart';

import 'study_storage.dart';

/// 09:00 on 15 October 2026 at UTC: today's study day runs from 04:00.
final _now = DateTime.utc(2026, 10, 15, 9);

/// Folds nothing and recalls everything, for the 기록 tab's read.
class _Scheduler extends Fake implements Scheduler {
  @override
  Future<List<CardState>> history(List<ReviewRow> reviews) async => [];

  @override
  Future<double> retrievability(CardState state, DateTime at) async => 0.9;
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    "홈's last seven days count each study day's distinct cards as 기록 does",
    (tester) async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final cards = DeckRepository(
        db,
        clock: () => _now,
        newId: () => 'id${ids++}',
      );
      final study = StudyRepository(db, newId: () => 'review${ids++}');
      late DeckId deck;
      final card = <CardId>[];
      Future<void> answer(CardId id, DateTime at) => db
          .into(db.reviews)
          .insert(
            ReviewsCompanion.insert(
              id: 'answer${ids++}',
              cardId: id.value,
              rating: 'good',
              reviewedAt: at,
              durationMs: 3000,
              fuzzFactor: const Value(0),
              updatedAt: at,
            ),
          );
      await tester.runAsync(() async {
        deck = (await cards.createDeck('Deck')).id;
        for (var i = 0; i < 3; i++) {
          switch (await cards.addCard(
            deck,
            front: [TextContent('front $i')],
            back: [TextContent('back $i')],
          )) {
            case CardSaved(card: final saved):
              card.add(saved.id);
            case DuplicateFront():
              throw StateError('no duplicate');
          }
        }
        // Today: two cards, one of them twice.
        await answer(card[0], DateTime.utc(2026, 10, 15, 5));
        await answer(card[0], DateTime.utc(2026, 10, 15, 6));
        await answer(card[1], DateTime.utc(2026, 10, 15, 7));
        // Yesterday's study day, the last at 03:00 today, before 04:00.
        await answer(card[2], DateTime.utc(2026, 10, 14, 9));
        await answer(card[1], DateTime.utc(2026, 10, 15, 3));
        // Six study days back, the week's first, and seven, outside it.
        await answer(card[0], DateTime.utc(2026, 10, 9, 12));
        await answer(card[1], DateTime.utc(2026, 10, 8, 12));
      });
      final storage = await openStudyStorage(tester);

      TodayOverview? read;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(cards),
            studyRepositoryProvider.overrideWithValue(study),
            schedulerProvider.overrideWithValue(_Scheduler()),
            studyClockProvider.overrideWithValue(() => _now),
            studyZoneProvider.overrideWithValue((_) => Duration.zero),
            studyRandomProvider.overrideWithValue((_) => Random(0)),
            studyStorageProvider.overrideWithValue(storage),
            deckStorageProvider.overrideWithValue(storage),
          ],
          child: MaterialApp(
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: TodayOverviewReader(
              decks: DeckSelection(deck),
              builder: (context, overview) {
                if (overview is TodayOverview) read = overview;
                return const SizedBox();
              },
            ),
          ),
        ),
      );
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 200)),
      );
      await tester.pumpAndSettle();
      final stats = (await tester.runAsync(
        () => readStats(
          DeckSelection(deck),
          cards: cards,
          repository: study,
          scheduler: _Scheduler(),
          now: _now,
          offsetAt: (_) => Duration.zero,
        ),
      ))!;

      expect(read, isNotNull, reason: 'the overview was read');
      final week = read!.week;
      expect([for (final day in week) day.cards], [1, 0, 0, 0, 0, 2, 2]);
      expect(week.first.date, DateTime.utc(2026, 10, 9));
      expect(week.last.date, DateTime.utc(2026, 10, 15));
      // The same answers read by 기록 give the same seven days.
      expect(week, stats.days.sublist(stats.days.length - week.length));

      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    },
  );
}
