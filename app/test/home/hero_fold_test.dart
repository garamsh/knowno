import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/services.dart';
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
            await _pumpHome(tester, phone, scale, setup);

            // The state asked for is the one drawn.
            expect(shownText(title(ko)), findsOneWidget);
            final streak = find.text(
              ko.streakDays(switch (state) {
                'today' => heroStreak,
                'done' => 1,
                _ => 0,
              }),
              findRichText: true,
            );
            Finder button(AppButtonSize size) => find.byWidgetPredicate(
              (widget) =>
                  widget is AppButton &&
                  widget.variant == AppButtonVariant.onHero &&
                  widget.size == size,
            );
            final action = button(AppButtonSize.cta);
            expect(action, findsOneWidget);
            final page = find
                .ancestor(of: action, matching: find.byType(Scrollable))
                .first;
            final position = tester.state<ScrollableState>(page).position;
            final viewport = tester.getRect(page);
            final tabBar = tester.getRect(find.bySemanticsLabel(ko.tabsLabel));
            expect(viewport.bottom, lessThanOrEqualTo(tabBar.top));
            // The hero's surface, rounded at its foot alone.
            final heroColor = AppColors.of(tester.element(page)).hero;
            final heroBox = find.byWidgetPredicate(
              (widget) =>
                  widget is DecoratedBox &&
                  widget.decoration is BoxDecoration &&
                  (widget.decoration as BoxDecoration).color == heroColor &&
                  (widget.decoration as BoxDecoration).borderRadius ==
                      const BorderRadius.vertical(
                        bottom: Radius.circular(AppRadius.sheet),
                      ),
            );
            expect(heroBox, findsOneWidget);
            // 홈 draws no mascot but the hero's.
            final mascot = find.byType(Mascot);

            // The mascot at its full size in every state, at every height and
            // text size.
            expect(
              tester.getSize(mascot),
              const Size.square(AppSize.mascotHero),
            );

            // The first screen: the hero from the screen's top, behind the
            // status bar, with its words under it and the status bar's
            // glyphs light; filling it but for the week card's top edge, 16
            // high, and the space over it; with no card, the whole of it and
            // nothing under it.
            final hero = tester.getRect(heroBox);
            expect(viewport.top, 0);
            expect(hero.top, 0);
            expect(
              tester.getRect(find.text(ko.appTitle)).top,
              greaterThanOrEqualTo(phone.top),
            );
            expect(
              SystemChrome.latestStyle?.statusBarIconBrightness,
              Brightness.light,
            );
            const peek = AppSpace.s16;
            final fill = state == 'no cards'
                ? viewport.height
                : viewport.height - peek - AppSpace.s16;
            if (state == 'no cards') {
              expect(hero.bottom, greaterThanOrEqualTo(viewport.bottom));
              expect(streak, findsNothing);
              if (scale == 1.0) expect(position.maxScrollExtent, 0);
            } else {
              expect(hero.bottom, greaterThanOrEqualTo(viewport.top + fill));
              // At text scale 1.0 the hero's group fits, so the first screen
              // shows the week card's top edge, 16 high, and no more, with
              // 시작 whole above it on room for its edge; past that, the hero
              // grows and the week card is further down.
              if (scale == 1.0) {
                expect(hero.height, moreOrLessEquals(fill));
                final week = find
                    .ancestor(of: streak, matching: find.byType(DecoratedBox))
                    .first;
                expect(
                  tester.getRect(week).top,
                  moreOrLessEquals(viewport.bottom - peek),
                );
                final start = tester.getRect(action);
                expect(start.top, greaterThanOrEqualTo(viewport.top));
                expect(
                  start.bottom + AppSize.edgeButton,
                  lessThanOrEqualTo(hero.bottom),
                );
              } else {
                expect(hero.height, greaterThan(fill));
              }
            }

            // Where the hero's words need more than the first screen, the
            // page scrolls by what they need past it, as a page does, before
            // the hero shrinks; there 시작 is whole on the screen.
            final excess = hero.height - fill;
            expect(excess, scale == 1.0 ? moreOrLessEquals(0) : greaterThan(0));
            position.jumpTo(excess);
            await tester.pump();
            expect(tester.getRect(heroBox).height, moreOrLessEquals(fill));
            final shown = tester.getRect(action);
            expect(shown.top, greaterThanOrEqualTo(viewport.top));
            expect(
              shown.bottom + AppSize.edgeButton,
              lessThanOrEqualTo(viewport.top + fill),
            );
            position.jumpTo(0);
            await tester.pump();

            if (state != 'no cards') {
              // The minutes the hero says for today's cards, for its bar.
              final minutes = state == 'today'
                  ? [for (var m = 1; m < 1000; m++) m].firstWhere(
                      (m) => shownText(ko.homeMinutes(m)).evaluate().isNotEmpty,
                    )
                  : null;
              // Scrolled, the hero shrinks in place rather than moving: at
              // half its collapse it is still at the screen's top, shorter
              // by the scroll past what its words need beyond the first
              // screen, its mascot smaller and its title smaller and higher,
              // and the week card follows its foot.
              // The face's title, laid out before the bar, which may say it
              // too.
              final faceTitle = shownText(title(ko)).first;
              final restTitle = tester.getRect(faceTitle);
              position.jumpTo(position.maxScrollExtent);
              await tester.pump();
              final bar = tester.getRect(heroBox);
              final travel = fill - bar.height;
              expect(travel, greaterThan(0));
              final half = excess + travel / 2;
              position.jumpTo(half);
              await tester.pump();
              final halfway = tester.getRect(heroBox);
              expect(halfway.top, 0);
              expect(halfway.height, moreOrLessEquals(hero.height - half));
              expect(
                tester.getRect(mascot).width,
                lessThan(AppSize.mascotHero),
              );
              final halfTitle = tester.getRect(faceTitle);
              expect(halfTitle.height, lessThan(restTitle.height));
              expect(halfTitle.top, lessThan(restTitle.top - excess));
              final week = find
                  .ancestor(of: streak, matching: find.byType(DecoratedBox))
                  .first;
              expect(
                tester.getRect(week).top,
                moreOrLessEquals(halfway.bottom + AppSpace.s16),
              );

              // Fully collapsed, a slim bar pinned at the top: the day in a
              // line where cards are left, and a compact 시작, whole on room
              // for its edge, under the status bar, whose glyphs stay light;
              // the hero's own 시작 and mascot are gone, and the week card
              // goes on up beneath the bar.
              position.jumpTo(hero.height - bar.height);
              await tester.pump();
              final collapsed = tester.getRect(heroBox);
              expect(collapsed.top, 0);
              expect(collapsed.height, moreOrLessEquals(bar.height));
              expect(collapsed.height, lessThan(fill / 3));
              expect(action, findsNothing);
              expect(mascot, findsNothing);
              final compact = tester.getRect(button(AppButtonSize.header));
              expect(compact.top, greaterThanOrEqualTo(phone.top));
              expect(
                compact.bottom + AppSize.edgeButton,
                lessThanOrEqualTo(collapsed.bottom),
              );
              if (minutes != null) {
                expect(
                  find.text(ko.homeTodayBar(481, minutes)),
                  findsOneWidget,
                );
              }
              expect(
                SystemChrome.latestStyle?.statusBarIconBrightness,
                Brightness.light,
              );
              expect(
                tester.getRect(week).top,
                moreOrLessEquals(collapsed.bottom + AppSpace.s16),
              );

              // At the page's end the week card's foot is above the tab bar,
              // its edge included, and where the card fits under the bar it
              // is whole there.
              position.jumpTo(position.maxScrollExtent);
              await tester.pump();
              final end = tester.getRect(week);
              expect(
                end.bottom + AppSize.edgeCard,
                lessThanOrEqualTo(viewport.bottom),
              );
              if (end.height + AppSize.edgeCard <=
                  viewport.bottom - collapsed.bottom - AppSpace.s16) {
                expect(end.top, greaterThanOrEqualTo(collapsed.bottom));
              }

              // Pulled back down, the hero expands again to its rest.
              position.jumpTo(0);
              await tester.pump();
              expect(tester.getRect(heroBox), hero);
              expect(action, findsOneWidget);
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

  testWidgets(
    "a drag released short of half the hero's collapse expands it again, one released past half collapses it into the bar, and a scroll the user did not drag stays where it ends",
    (tester) async {
      final (_, setup) = heroStates['today']!;
      await _pumpHome(tester, heroPhones[1], 1.0, setup);
      final action = find.byWidgetPredicate(
        (widget) =>
            widget is AppButton &&
            widget.variant == AppButtonVariant.onHero &&
            widget.size == AppButtonSize.cta,
      );
      final page = find
          .ancestor(of: action, matching: find.byType(Scrollable))
          .first;
      final position = tester.state<ScrollableState>(page).position;
      final viewport = tester.getRect(page);
      position.jumpTo(position.maxScrollExtent);
      await tester.pump();
      // The whole collapse: the page's scroll from the hero at rest to the
      // bar, the hero filling the first screen at text scale 1.0.
      final collapse = position.pixels;
      expect(collapse, greaterThan(viewport.height / 2));
      position.jumpTo(0);
      await tester.pumpAndSettle();

      // A slow drag, so that the release carries no fling.
      Future<void> dragBy(double distance) async {
        await tester.timedDragFrom(
          viewport.center,
          Offset(0, -distance),
          const Duration(seconds: 2),
        );
        await tester.pumpAndSettle();
      }

      await dragBy(collapse * 0.3);
      expect(position.pixels, 0);
      expect(action, findsOneWidget);

      await dragBy(collapse * 0.7);
      expect(position.pixels, moreOrLessEquals(collapse));
      expect(action, findsNothing);

      // Control: the same part way reached without a drag is left there.
      position.jumpTo(collapse * 0.3);
      await tester.pumpAndSettle();
      expect(position.pixels, moreOrLessEquals(collapse * 0.3));
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    },
  );
}

/// Lays 홈 out on [phone] at text [scale] in the light theme, in Korean, with
/// the notes and cards [setup] stores, and waits for it to settle.
Future<void> _pumpHome(
  WidgetTester tester,
  HeroPhone phone,
  double scale,
  HeroSetup setup,
) async {
  tester.view.physicalSize = phone.size;
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(top: phone.top, bottom: phone.bottom);
  tester.view.viewPadding = FakeViewPadding(
    top: phone.top,
    bottom: phone.bottom,
  );
  tester.platformDispatcher.textScaleFactorTestValue = scale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
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
      for (final name in heroNotes) (await repository.createDeck(name)).id,
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
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const HomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
