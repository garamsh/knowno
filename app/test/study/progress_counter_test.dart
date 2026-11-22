import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/src/progress_counter.dart';
import 'package:knowno/study/src/providers.dart';
import 'package:knowno/study/src/study_repository.dart';

import '../settle_until.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets(
    'cards and states written after the row is built are counted once they stop changing',
    (tester) async {
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      final now = DateTime.utc(2026, 10, 14, 9);
      var ids = 0;
      final cards = DeckRepository(
        db,
        clock: () => now,
        newId: () => 'id${ids++}',
      );
      final study = StudyRepository(db, newId: () => 'review${ids++}');
      final deck = (await tester.runAsync(
        () async => (await cards.createDeck('Alpha')).id,
      ))!;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(cards),
            studyRepositoryProvider.overrideWithValue(study),
          ],
          child: MaterialApp(
            home: ProgressCounter(
              decks: DeckSelection(deck),
              builder: (context, progress) => Text(
                progress == null
                    ? 'pending'
                    : '${progress.total} cards, ${progress.mastered} mastered, '
                          '${progress.learning} learning, ${progress.fresh} new',
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(
        find.text('0 cards, 0 mastered, 0 learning, 0 new'),
        findsOneWidget,
      );

      // A pull applies the cards and then their states.
      final written = () async {
        final saved = [
          for (final front in ['known', 'new'])
            await cards.addCard(
              deck,
              front: [TextContent(front)],
              back: [TextContent(front)],
            ),
        ];
        final known = switch (saved.first) {
          CardSaved(:final card) => card.id,
          DuplicateFront() => fail('the deck held no duplicate'),
        };
        await db
            .into(db.cardStates)
            .insert(
              CardStatesCompanion.insert(
                cardId: known.value,
                stability: 30,
                difficulty: 5,
                lastReview: now.subtract(const Duration(days: 30)),
                due: now,
                updatedAt: now,
              ),
            );
      }();
      await tester.runAsync(() => written);
      await settleUntil(
        tester,
        'the arrived cards to be counted',
        () => find
            .text('2 cards, 1 mastered, 0 learning, 1 new')
            .evaluate()
            .isNotEmpty,
      );

      // Unmounted, so no read or timer outlives the test.
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    },
  );
}
