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
    for (final scale in [1.0, 3.12]) {
      for (final MapEntry(key: state, value: (title, setup))
          in heroStates.entries) {
        testWidgets(
          'on a ${phone.name} (${phone.size.height.toInt()} pt) at text scale $scale, 홈 $state fills the first screen with the hero and its mascot at full size, the week card\'s top edge under it and the rest a scroll away',
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
            final viewport = tester.getRect(page);
            final tabBar = tester.getRect(find.bySemanticsLabel(ko.tabsLabel));
            expect(viewport.bottom, lessThanOrEqualTo(tabBar.top));
            final heroBox = find
                .ancestor(
                  of: action,
                  matching: find.byWidgetPredicate(
                    (widget) =>
                        widget is DecoratedBox &&
                        widget.decoration is BoxDecoration &&
                        (widget.decoration as BoxDecoration).color ==
                            AppColors.of(tester.element(action)).hero,
                  ),
                )
                .first;

            // The mascot at its full size in every state, at every height and
            // text size.
            expect(
              tester.getSize(
                find.descendant(of: page, matching: find.byType(Mascot)),
              ),
              const Size.square(AppSize.mascotHero),
            );

            // The first screen: the hero from its top, filling it but for the
            // week card's top edge, 16 high, and the space over it; with no
            // card, the whole of it and nothing under it.
            final hero = tester.getRect(heroBox);
            expect(hero.top, viewport.top);
            const peek = AppSpace.s16;
            if (state == 'no cards') {
              expect(hero.bottom, greaterThanOrEqualTo(viewport.bottom));
              if (scale == 1.0) expect(position.maxScrollExtent, 0);
            } else {
              final week = find
                  .ancestor(of: streak, matching: find.byType(DecoratedBox))
                  .first;
              final card = tester.getRect(week);
              expect(
                hero.bottom,
                greaterThanOrEqualTo(viewport.bottom - peek - AppSpace.s16),
              );
              expect(card.top, greaterThan(hero.bottom));
              // At text scale 1.0 the hero's group fits, so the first screen
              // shows the week card's top edge, 16 high, and no more, with
              // 시작 whole above it; past that, the hero grows and the week
              // card is further down.
              if (scale == 1.0) {
                expect(card.top, moreOrLessEquals(viewport.bottom - peek));
                final start = tester.getRect(action);
                expect(start.top, greaterThanOrEqualTo(viewport.top));
                expect(start.bottom, lessThanOrEqualTo(hero.bottom));
              } else {
                expect(card.top, greaterThanOrEqualTo(viewport.bottom - peek));
              }

              // Scrolled to, the week card is whole above the tab bar, its
              // edge included.
              await tester.ensureVisible(week);
              await tester.pumpAndSettle();
              final scrolled = tester.getRect(week);
              expect(position.pixels, greaterThan(0));
              expect(scrolled.top, greaterThanOrEqualTo(viewport.top));
              expect(
                scrolled.bottom + AppSize.edgeCard,
                lessThanOrEqualTo(viewport.bottom),
              );
            }

            // 시작, scrolled to where it is not on the first screen, is whole
            // in the page.
            position.jumpTo(0);
            await tester.ensureVisible(action);
            await tester.pumpAndSettle();
            final shown = tester.getRect(action);
            expect(shown.top, greaterThanOrEqualTo(viewport.top));
            expect(shown.bottom, lessThanOrEqualTo(viewport.bottom));
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
