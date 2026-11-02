import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/study.dart';

import '../app_fonts.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';
import 'hero_states.dart';
import 'home_data.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  setUpAll(loadAppFonts);
  final ko = lookupAppLocalizations(const Locale('ko'));

  for (final phone in heroPhones) {
    for (final scale in [1.0, 2.0]) {
      for (final MapEntry(key: state, value: (title, setup))
          in heroStates.entries) {
        testWidgets(
          'on a ${phone.name} (${phone.size.height.toInt()} pt) at text scale $scale, 홈 $state shows its hero whole above the drawer, scrolling only with the mascot at its floor',
          (tester) async {
            tester.view.physicalSize = phone.size;
            tester.view.devicePixelRatio = 1;
            tester.view.padding = FakeViewPadding(
              top: phone.top,
              bottom: phone.bottom,
            );
            tester.view.viewPadding = FakeViewPadding(
              top: phone.top,
              bottom: phone.bottom,
            );
            tester.platformDispatcher.textScaleFactorTestValue = scale;
            addTearDown(tester.view.reset);
            addTearDown(
              tester.platformDispatcher.clearTextScaleFactorTestValue,
            );
            final db = AppDatabase(NativeDatabase.memory());
            addTearDown(db.close);
            addTearDown(() async {
              await tester.pumpWidget(const SizedBox());
              await tester.pump(const Duration(seconds: 1));
            });
            var ids = 0;
            final repository = DeckRepository(
              db,
              clock: () => DateTime.utc(2026, 10, 15),
              newId: () => 'id${ids++}',
            );
            await tester.runAsync(() async {
              final decks = [
                for (final name in heroNotes)
                  (await repository.createDeck(name)).id,
              ];
              final minutes = await setup(db, repository, decks);
              if (minutes != null) {
                await StudyRepository(
                  db,
                  newId: () => 'setting',
                ).setDailyMinutes(minutes, at: homeNow);
              }
            });
            final storage = await openStudyStorage(tester);
            await tester.pumpWidget(
              ProviderScope(
                overrides: [
                  deckRepositoryProvider.overrideWithValue(repository),
                  ...homeOverrides(db, storage: storage),
                ],
                child: MaterialApp(
                  theme: lightTheme,
                  locale: const Locale('ko'),
                  localizationsDelegates:
                      AppLocalizations.localizationsDelegates,
                  supportedLocales: AppLocalizations.supportedLocales,
                  home: const HomeScreen(),
                ),
              ),
            );
            await tester.pumpAndSettle();

            // The state asked for is the one drawn, on the owner's streak
            // where it has one.
            expect(shownText(title(ko)), findsOneWidget);
            if (state == 'today') {
              expect(find.text(ko.streakDays(3)), findsOneWidget);
            }
            final action = find.byWidgetPredicate(
              (widget) =>
                  widget is AppButton &&
                  widget.variant == AppButtonVariant.onHero,
            );
            expect(action, findsOneWidget);
            final hero = find
                .ancestor(of: action, matching: find.byType(Scrollable))
                .first;
            final position = tester.state<ScrollableState>(hero).position;
            final mascot = tester.getSize(
              find.descendant(of: hero, matching: find.byType(Mascot)),
            );
            expect(mascot.height, greaterThanOrEqualTo(AppSize.mascotMedium));
            // The hero scrolls only once the mascot has nothing left to give.
            if (position.maxScrollExtent > 0) {
              expect(mascot.height, AppSize.mascotMedium);
            }
            // At text scale 1.0 above the smallest phone it fits outright.
            if (scale == 1.0 && phone.size.height > 667) {
              expect(position.maxScrollExtent, 0);
            }

            // 시작 is whole inside the hero, and above the drawer.
            await tester.ensureVisible(action);
            await tester.pumpAndSettle();
            final shown = tester.getRect(action);
            final space = tester.getRect(hero);
            expect(shown.top, greaterThanOrEqualTo(space.top));
            expect(shown.bottom, lessThanOrEqualTo(space.bottom));
            expect(
              shown.bottom,
              lessThanOrEqualTo(
                tester.getTopLeft(find.text(ko.myDecks(heroNotes.length))).dy,
              ),
            );
            expect(tester.takeException(), isNull);
            // Unmounting cancels drift's stream queries, whose cleanup timer
            // must fire before the test body ends.
            await tester.pumpWidget(const SizedBox());
            await tester.pump(const Duration(seconds: 1));
          },
        );
      }
    }
  }
}
