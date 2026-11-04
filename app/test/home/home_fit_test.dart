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
          scale == 1.0
              ? 'on a ${phone.name} (${phone.size.height.toInt()} pt) at text scale 1.0, 홈 $state is one screen with no scroll: the sky over the ground, the mascot at 140 on the hill, and the action whole above the tab bar'
              : 'on a ${phone.name} (${phone.size.height.toInt()} pt) at text scale 3.12, 홈 $state cuts nothing and scrolls to the action whole',
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
                for (final name in heroNotesOf(state))
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

            // The state asked for is the one drawn, with the streak on the
            // ground but with no card.
            final heading = shownText(title(ko));
            expect(heading, findsOneWidget);
            final streak = find.text(
              ko.streakDays(switch (state) {
                'today' => heroStreak,
                'done' => 1,
                _ => 0,
              }),
              findRichText: true,
            );
            expect(
              streak,
              state == 'no cards' || state == 'first run'
                  ? findsNothing
                  : findsOneWidget,
            );
            final action = find
                .byWidgetPredicate(
                  (widget) =>
                      widget is AppButton && widget.size == AppButtonSize.cta,
                )
                .last;
            final page = find
                .ancestor(of: action, matching: find.byType(Scrollable))
                .first;
            final position = tester.state<ScrollableState>(page).position;
            final viewport = tester.getRect(page);
            final tabBar = tester.getRect(find.bySemanticsLabel(ko.tabsLabel));
            expect(viewport.bottom, lessThanOrEqualTo(tabBar.top));
            final mascot = find.descendant(
              of: page,
              matching: find.byType(Mascot),
            );

            // The mascot at 140 in every state, at every height and text
            // size, under the words and over the action, overlapping
            // neither.
            expect(
              tester.getSize(mascot),
              const Size.square(AppSize.mascotHero),
            );
            expect(
              tester.getRect(heading).bottom,
              lessThanOrEqualTo(tester.getRect(mascot).top),
            );
            expect(
              tester.getRect(mascot).bottom,
              lessThanOrEqualTo(tester.getRect(action).top),
            );
            if (state != 'no cards' && state != 'first run') {
              expect(
                tester.getRect(mascot).bottom,
                lessThanOrEqualTo(tester.getRect(streak).top),
              );
              expect(
                tester.getRect(streak).bottom,
                lessThanOrEqualTo(tester.getRect(action).top),
              );
            }
            // The sky runs from the top of the screen, behind the status
            // bar.
            final sky = find
                .ancestor(
                  of: mascot,
                  matching: find.byWidgetPredicate(
                    (widget) =>
                        widget is DecoratedBox &&
                        widget.decoration is ShapeDecoration,
                  ),
                )
                .first;
            expect(tester.getRect(sky).top, 0);

            if (scale == 1.0) {
              // One screen: nothing to scroll, the sky about 58% of the
              // screen, and the action's raised edge whole above the tab bar.
              expect(position.maxScrollExtent, 0);
              expect(
                tester.getRect(sky).height,
                moreOrLessEquals(phone.size.height * 0.58, epsilon: 60),
              );
              expect(
                tester.getRect(action).bottom + AppSize.edgeButton,
                lessThanOrEqualTo(viewport.bottom),
              );
            } else {
              // Too much to fit: the page scrolls, and the action, scrolled
              // to, is whole with its edge.
              expect(position.maxScrollExtent, greaterThan(0));
              await tester.ensureVisible(action);
              await tester.pumpAndSettle();
              final shown = tester.getRect(action);
              expect(shown.top, greaterThanOrEqualTo(viewport.top));
              expect(
                shown.bottom + AppSize.edgeButton,
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
