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
          'on a ${phone.name} (${phone.size.height.toInt()} pt) at text scale $scale, 홈 $state shows 시작 and the week card whole, scrolling only with the mascot at its floor',
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
            // where it has one, and the week card under it but with no card.
            expect(shownText(title(ko)), findsOneWidget);
            final streak = find.text(
              ko.streakDays(switch (state) {
                'today' => heroStreak,
                'done' => 1,
                _ => 0,
              }),
              findRichText: true,
            );
            expect(streak, state == 'no cards' ? findsNothing : findsOneWidget);
            final action = find.byWidgetPredicate(
              (widget) =>
                  widget is AppButton &&
                  widget.variant == AppButtonVariant.onHero,
            );
            expect(action, findsOneWidget);
            final page = find
                .ancestor(of: action, matching: find.byType(Scrollable))
                .first;
            final position = tester.state<ScrollableState>(page).position;
            final mascot = tester.getSize(
              find.descendant(of: page, matching: find.byType(Mascot)),
            );
            expect(mascot.height, greaterThanOrEqualTo(AppSize.mascotFloor));
            expect(mascot.width, mascot.height);
            // The page scrolls only once the mascot has nothing left to give,
            // and at text scale 1.0 not at all.
            if (position.maxScrollExtent > 0) {
              expect(mascot.height, AppSize.mascotFloor);
            }
            if (scale == 1.0) expect(position.maxScrollExtent, 0);

            // 시작 is whole in the page, above the week card and the tab bar.
            final viewport = tester.getRect(page);
            final tabBar = tester.getRect(find.bySemanticsLabel(ko.tabsLabel));
            expect(viewport.bottom, lessThanOrEqualTo(tabBar.top));
            await tester.ensureVisible(action);
            await tester.pumpAndSettle();
            final shown = tester.getRect(action);
            expect(shown.top, greaterThanOrEqualTo(viewport.top));
            expect(shown.bottom, lessThanOrEqualTo(viewport.bottom));
            if (state != 'no cards') {
              final week = find
                  .ancestor(of: streak, matching: find.byType(DecoratedBox))
                  .first;
              expect(
                shown.bottom + AppSize.edgeButton,
                lessThanOrEqualTo(tester.getRect(week).top),
              );
              // The week card, its edge included, is whole above the tab bar.
              await tester.ensureVisible(week);
              await tester.pumpAndSettle();
              final card = tester.getRect(week);
              expect(card.top, greaterThanOrEqualTo(viewport.top));
              expect(
                card.bottom + AppSize.edgeCard,
                lessThanOrEqualTo(viewport.bottom),
              );
            }
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
