import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart' hide DeckRow;
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../account/fake_account_service.dart';
import '../settle_until.dart';
import '../word_breaks.dart';
import '../study/study_storage.dart';
import 'home_data.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('홈 while sync applies cards', () {
    Future<(DeckRepository, DeckId, AppDatabase)> open(
      WidgetTester tester, {
      required Future<void> Function(
        DeckRepository repository,
        DeckId deck,
        AppDatabase db,
      )
      before,
      FakeAccountService? account,
    }) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final db = AppDatabase(NativeDatabase.memory());
      addTearDown(db.close);
      var ids = 0;
      final repository = DeckRepository(
        db,
        clock: () => DateTime.utc(2026, 10, 15),
        newId: () => 'deck${ids++}',
      );
      final deck = (await tester.runAsync(() async {
        final deck = (await repository.createDeck('Alpha')).id;
        await before(repository, deck, db);
        return deck;
      }))!;
      final storage = await openStudyStorage(tester);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            deckRepositoryProvider.overrideWithValue(repository),
            ...homeOverrides(db, storage: storage, account: account),
          ],
          child: MaterialApp(
            theme: lightTheme,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            locale: const Locale('en'),
            home: const AccountGate(signedIn: HomeScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();
      return (repository, deck, db);
    }

    /// Unmounts the screen, so no read or timer outlives the test.
    Future<void> close(WidgetTester tester) async {
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    }

    Future<void> receive(
      WidgetTester tester,
      DeckRepository repository,
      DeckId deck,
      int count,
    ) async {
      final written = Future.wait([
        for (var i = 0; i < count; i++)
          repository.addCard(
            deck,
            front: [TextContent('arrived $i')],
            back: [TextContent('arrived $i')],
          ),
      ]);
      await tester.runAsync(() => written);
    }

    testWidgets(
      'first sign-in: a deck that arrives before its cards does not leave "All done" once the cards arrive',
      (tester) async {
        final (repository, deck, _) = await open(
          tester,
          before: (_, _, _) async {},
        );
        expect(shownText('All done'), findsNothing);

        await receive(tester, repository, deck, 3);
        await settleUntil(
          tester,
          'the arrived cards to be counted',
          () => shownText('3 cards').evaluate().isNotEmpty,
        );

        expect(shownText('All done'), findsNothing);
        await close(tester);
      },
    );

    testWidgets(
      'reopening: due cards that sync applies replace "All done" without a navigation',
      (tester) async {
        final (repository, deck, _) = await open(
          tester,
          before: (repository, deck, db) async {
            final card = switch (await repository.addCard(
              deck,
              front: [TextContent('known')],
              back: [TextContent('known')],
            )) {
              CardSaved(:final card) => card.id,
              DuplicateFront() => fail('the deck held no duplicate'),
            };
            await storeState(
              db,
              card,
              due: homeNow.add(const Duration(days: 1)),
            );
          },
        );
        expect(shownText('All done'), findsOneWidget);

        await receive(tester, repository, deck, 2);
        await settleUntil(
          tester,
          'the arrived cards to be counted',
          () => shownText('2 cards').evaluate().isNotEmpty,
        );

        expect(shownText('All done'), findsNothing);
        await close(tester);
      },
    );

    testWidgets(
      'signing out and in again: the cards that sync pulls into the emptied store replace "All done"',
      (tester) async {
        final account = FakeAccountService(
          const SignedIn(
            userId: UserId('00000000-0000-4000-8000-00000000000a'),
            email: 'ada@example.com',
          ),
        );
        final (repository, _, db) = await open(
          tester,
          account: account,
          before: (repository, deck, db) async {
            await repository.addCard(
              deck,
              front: [const TextContent('before')],
              back: [const TextContent('before')],
            );
          },
        );
        expect(shownText('1 card'), findsOneWidget);

        // Signing out clears the store; signing in starts a first pull.
        await account.signOut();
        await tester.pumpAndSettle();
        await tester.runAsync(() async {
          await db.delete(db.cards).go();
          await db.delete(db.decks).go();
        });
        await account.signInWithGoogle();
        await tester.pumpAndSettle();
        expect(shownText('1 card'), findsNothing);

        // The pull: the deck first, and then its cards.
        final deck = (await tester.runAsync(
          () async => (await repository.createDeck('Pulled')).id,
        ))!;
        await tester.pump(const Duration(seconds: 1));
        await receive(tester, repository, deck, 3);
        await settleUntil(
          tester,
          'the pulled cards to be counted',
          () => shownText('3 cards').evaluate().isNotEmpty,
        );

        expect(shownText('All done'), findsNothing);
        await close(tester);
      },
    );
  });
}
