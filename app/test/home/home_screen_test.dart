import 'dart:async';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart' hide DeckRow;
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/home/src/progress_bar.dart';
import 'package:knowno/home/src/home_tab.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart';

import '../contrast.dart';
import 'home_data.dart';
import '../study/minutes_sheet.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';

/// Opens a screen over 홈 holding the daily study minutes' row, as
/// the account screen holds it (`widget_test.dart` opens that screen itself),
/// and the picker the row opens, waiting for it.
Future<void> _openMinutes(WidgetTester tester) async {
  unawaited(
    Navigator.of(tester.element(find.byType(HomeTab))).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            Scaffold(appBar: AppBar(), body: const DailyMinutesRow()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('Daily study time'));
  await waitForPicker(tester);
}

class _List {
  _List(this.tester, this.repository, this.ids)
    : _semantics = tester.ensureSemantics();

  final WidgetTester tester;
  final SemanticsHandle _semantics;
  final DeckRepository repository;

  /// Each deck's id by name.
  final Map<String, DeckId> ids;

  /// The decks of the study session open on top.
  Set<DeckId> get session =>
      tester.widget<StudyScreen>(find.byType(StudyScreen)).decks.ids;

  Future<void> tap(String text) async {
    // The hero scrolls where the test font makes it taller than its space.
    await tester.ensureVisible(find.text(text));
    await tester.pumpAndSettle();
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  /// The tab named [name] in the bar.
  Finder tab(String name) => find.descendant(
    of: find.bySemanticsLabel('Tabs'),
    matching: find.text(name),
  );

  /// Pulls up 홈's drawer, unless it is up.
  Future<void> decks() async {
    if (find.text('Pull up to see all').evaluate().isNotEmpty) {
      await tap('Pull up to see all');
    }
  }

  /// The daily study minutes stored, null while none is.
  Future<int?> storedMinutes() async => (await tester.runAsync<int?>(
    () =>
        // Offstage too, under a screen opened over it.
        ProviderScope.containerOf(
          tester.element(find.byType(HomeScreen, skipOffstage: false)),
        ).read(studyRepositoryProvider).dailyMinutes(),
  ));

  /// Pulls up the drawer and taps its "새 노트", which opens 새 노트.
  Future<void> newDeck() async {
    await decks();
    await tap('New note');
  }

  /// Unmounts the list. Unmounting cancels drift's stream query, whose
  /// cleanup timer must fire before the test body ends.
  Future<void> close() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
    _semantics.dispose();
  }
}

/// Opens the home screen, with in each deck named in [fresh] that many new
/// cards, in each named in [due] that many cards due today after an interval
/// of [dueDays] days, in each named in [later] that many due tomorrow, and in
/// each named in [answeredToday] that many answered an hour before [homeNow]
/// and due tomorrow, and in each named in [mastered] that many reviewed after
/// a 30-day interval and due in ten days.
/// [pace] is the time the user's answers took; [unreadable] names the decks
/// whose cards cannot be read. The first-run daily minutes step has shown
/// unless [minutesAsked] is false. The screen is a phone's unless [screen]
/// says otherwise, in the light theme unless [theme] is another, with
/// [dailyMinutes] stored when given. [photoImport] stands in for the photo import
/// when given: a screen it pushes, which pops with what photo import resolves
/// to.
Future<_List> _open(
  WidgetTester tester, {
  Map<String, int> fresh = const {},
  Map<String, int> due = const {},
  int dueDays = 1,
  Map<String, int> later = const {},
  Map<String, int> answeredToday = const {},
  Map<String, int> mastered = const {},
  Duration? pace,
  Set<String> unreadable = const {},
  Widget Function(DeckId? deck, PhotoOrigin origin)? photoImport,
  SpreadsheetPick? spreadsheet,
  List<String> decks = const ['Alpha', 'Beta', 'Gamma'],
  bool minutesAsked = true,
  Locale locale = const Locale('en'),
  Size screen = const Size(390, 844),
  ThemeData? theme,
  int? dailyMinutes,
}) async {
  Future<Deck?> pushed(
    BuildContext context,
    DeckId? deck,
    PhotoOrigin origin,
  ) => Navigator.of(
    context,
  ).push(MaterialPageRoute<Deck>(builder: (_) => photoImport!(deck, origin)));
  // A phone's screen, so the 오늘 tab's decks are on it.
  tester.view.physicalSize = screen;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  // Tear-downs run last first, so the screen is unmounted before the
  // database closes, even when a test fails before its own close(): closing
  // under a mounted screen leaves its stream queries waiting, and the run
  // hangs until the test times out.
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
  var ids = 0;
  final repository = UnreadableDecks(
    db,
    clock: () => DateTime.utc(2026, 10, 15),
    newId: () => 'deck${ids++}',
  );
  final created = (await tester.runAsync(() async {
    if (dailyMinutes != null) {
      await StudyRepository(
        db,
        newId: () => 'setting',
      ).setDailyMinutes(dailyMinutes, at: homeNow);
    }
    final created = {
      for (final name in decks) name: (await repository.createDeck(name)).id,
    };
    Future<CardId> add(String deck, String front) async =>
        switch (await repository.addCard(
          created[deck]!,
          front: [TextContent(front)],
          back: [TextContent(front)],
        )) {
          CardSaved(:final card) => card.id,
          DuplicateFront() => fail('the deck held no duplicate'),
        };
    for (final MapEntry(key: name, value: count) in fresh.entries) {
      for (var i = 0; i < count; i++) {
        await add(name, '$name new $i');
      }
    }
    for (final MapEntry(key: name, value: count) in due.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name due $i');
        await storeState(db, card, due: homeNow, days: dueDays);
        if (pace != null) await storeAnswers(db, card, 20, pace);
      }
    }
    for (final MapEntry(key: name, value: count) in later.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name later $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
      }
    }
    for (final MapEntry(key: name, value: count) in answeredToday.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name answered $i');
        await storeState(db, card, due: homeNow.add(const Duration(days: 1)));
        await storeAnswerAt(
          db,
          card,
          homeNow.subtract(const Duration(hours: 1)),
        );
      }
    }
    for (final MapEntry(key: name, value: count) in mastered.entries) {
      for (var i = 0; i < count; i++) {
        final card = await add(name, '$name mastered $i');
        await storeState(
          db,
          card,
          due: homeNow.add(const Duration(days: 10)),
          days: 30,
        );
      }
    }
    return created;
  }))!;
  repository.unreadable.addAll([for (final name in unreadable) created[name]!]);
  final list = _List(tester, repository, created);
  final storage = await openStudyStorage(tester, minutesAsked: minutesAsked);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(repository),
        ...homeOverrides(db, storage: storage),
        if (photoImport != null) photoImportProvider.overrideWithValue(pushed),
        if (spreadsheet != null)
          spreadsheetPickProvider.overrideWithValue(spreadsheet),
      ],
      child: MaterialApp(
        theme: theme ?? lightTheme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const HomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return list;
}

/// Scrolls every scrollable on screen to its end, so each part lays out.
Future<void> _scrollThrough(WidgetTester tester) async {
  for (final scrollable
      in find.byType(Scrollable).hitTestable().evaluate().toList()) {
    final state = (scrollable as StatefulElement).state as ScrollableState;
    final finder = find.byElementPredicate((element) => element == scrollable);
    while (state.position.pixels < state.position.maxScrollExtent) {
      await tester.drag(finder, const Offset(0, -300), warnIfMissed: false);
      await tester.pumpAndSettle();
    }
  }
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('tabs', () {
    testWidgets(
      'opens on 홈 between 기록 and 설정, the bar switches tabs, and back from another tab returns to 홈',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        expect(shownText('1 card today'), findsOneWidget);
        final record = list.tab('Record');
        final home = list.tab('Home');
        final settings = list.tab('Settings');
        expect(
          tester.getCenter(record).dx,
          lessThan(tester.getCenter(home).dx),
        );
        expect(
          tester.getCenter(home).dx,
          lessThan(tester.getCenter(settings).dx),
        );
        expect(
          tester.getSemantics(home),
          isSemantics(isSelected: true, hasSelectedState: true),
        );
        // The deck list is 홈's drawer, not a tab of its own.
        expect(list.tab('Notes'), findsNothing);

        // 설정 is built when first shown; `widget_test.dart` opens it.
        expect(find.byType(AccountScreen, skipOffstage: false), findsNothing);
        await tester.tap(record);
        await tester.pumpAndSettle();
        expect(find.text('Correct in reviews'), findsOneWidget);

        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(shownText('1 card today'), findsOneWidget);
        // Control: back on 홈 is left to the platform, which leaves the app.
        expect(await tester.binding.handlePopRoute(), isFalse);
        await list.close();
      },
    );

    testWidgets(
      'a note opens above the menu, back and 홈 return to 홈, and study, the editor and 새 노트 cover the menu',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.decks();
        await list.tap('Alpha');
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(list.tab('Home'), findsOneWidget);
        // Back closes the note, not the app.
        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsNothing);

        await list.decks();
        await list.tap('Alpha');
        await tester.tap(list.tab('Home'));
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsNothing);
        expect(shownText('1 card today'), findsOneWidget);

        await list.decks();
        await list.tap('Alpha');
        await list.tap('Study this note · 1');
        expect(find.byType(StudyScreen), findsOneWidget);
        expect(list.tab('Home'), findsNothing);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(list.tab('Home'), findsOneWidget);
        await list.close();
      },
    );
  });

  group('홈', () {
    testWidgets(
      'today\'s cards fill the hero with the mascot, the count, the minutes and Start, which studies every deck',
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 2, 'Gamma': 1},
          due: {'Alpha': 1, 'Beta': 3},
          pace: const Duration(seconds: 25),
        );
        final colors = AppColors.of(tester.element(find.byType(HomeTab)));
        expect(
          tester
              .widget<Scaffold>(
                find
                    .ancestor(
                      of: shownText('7 cards today'),
                      matching: find.byType(Scaffold),
                    )
                    .first,
              )
              .backgroundColor,
          colors.hero,
        );
        final count = tester.widget<Text>(shownText('7 cards today'));
        expect(count.style?.fontSize, AppType.heroFigure.fontSize);
        expect(count.style?.color, colors.onHero);
        // Seven cards at 25 s each take 175 s, about 3 minutes.
        expect(shownText('About 3 min'), findsOneWidget);
        expect(
          tester.widget<Mascot>(find.byType(Mascot).first).size,
          AppSize.mascotHero,
        );
        final start = tester.widget<AppButton>(
          find.widgetWithText(AppButton, 'Start'),
        );
        expect(start.variant, AppButtonVariant.onHero);
        // The day's other charts are 기록's.
        expect(find.text('Last 7 days'), findsNothing);

        await list.tap('Start');
        expect(list.session, list.ids.values.toSet());
        await list.close();
      },
    );

    testWidgets(
      'the streak is a card in the accent beside the app\'s name, while it is above zero',
      (tester) async {
        final list = await _open(
          tester,
          due: {'Alpha': 1},
          pace: const Duration(seconds: 25),
        );
        final colors = AppColors.of(tester.element(find.byType(HomeTab)));
        final streak = tester.widget<Text>(find.text('1-day streak'));
        expect(streak.style?.color, colors.accent);
        final card = tester.widget<DecoratedBox>(
          find
              .ancestor(
                of: find.text('1-day streak'),
                matching: find.byType(DecoratedBox),
              )
              .first,
        );
        expect((card.decoration as BoxDecoration).color, colors.surface);
        await list.close();

        // Control: with no study day, no streak.
        final fresh = await _open(tester, fresh: {'Alpha': 1});
        expect(find.textContaining('streak'), findsNothing);
        await fresh.close();
      },
    );

    testWidgets('in a backlog the hero says so and Start studies every deck', (
      tester,
    ) async {
      final list = await _open(
        tester,
        fresh: {'Gamma': 1},
        due: {'Alpha': 4, 'Beta': 3},
        dueDays: 30,
      );
      expect(shownText('Pick up where you left off'), findsOneWidget);
      expect(
        shownText(
          '7 overdue reviews, most urgent first. New cards wait for now.',
        ),
        findsOneWidget,
      );
      await list.tap('Start');
      expect(list.session, list.ids.values.toSet());
      await list.close();
    });

    testWidgets(
      'once today\'s cards are done the hero says so with the next review and Study, and the drawer opens higher',
      (tester) async {
        final list = await _open(tester, answeredToday: {'Alpha': 2});
        expect(shownText("You've done today's cards"), findsOneWidget);
        expect(
          shownText('Next review Tomorrow · 2, about 1 min'),
          findsOneWidget,
        );
        expect(find.byType(DeckRow), findsNWidgets(3));
        await list.tap('Study');
        expect(list.session, list.ids.values.toSet());
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        await list.close();

        // Control: with cards due, the closed drawer shows one row.
        final due = await _open(tester, fresh: {'Alpha': 1});
        expect(find.byType(DeckRow), findsOneWidget);
        await due.close();
      },
    );

    testWidgets(
      'with one deck and no card, the hero\'s one action adds a card to it',
      (tester) async {
        final list = await _open(tester, decks: ['Alpha']);
        expect(shownText('Make your first card?'), findsOneWidget);
        await list.tap('Add card');
        expect(find.byType(DeckScreen), findsOneWidget);
        await list.tap('Enter by hand');
        expect(find.byType(CardEditorScreen), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'with several decks and no card, the hero\'s one action opens the drawer',
      (tester) async {
        final list = await _open(tester);
        expect(shownText('Make your first card?'), findsOneWidget);
        expect(find.byTooltip('Search notes'), findsNothing);
        await list.tap('Add cards in a note');
        expect(find.byTooltip('Search notes'), findsOneWidget);
        expect(find.byType(DeckRow), findsNWidgets(3));
        await list.close();
      },
    );

    testWidgets('a count that cannot be read says why atop the drawer', (
      tester,
    ) async {
      final list = await _open(
        tester,
        mastered: {'Alpha': 1},
        unreadable: {'Beta'},
      );
      const why =
          "Couldn't read or write the device's storage. Please try again.";
      final problem = find.text(why);
      expect(problem, findsOneWidget);
      expect(
        tester.getRect(problem).bottom,
        lessThan(tester.getRect(find.byType(DeckRow).first).top),
      );
      expect(find.textContaining('cards today'), findsNothing);
      await list.close();
    });

    testWidgets(
      'the closed drawer shows 내 노트 n and one row; pulled up it holds every deck, the search behind its magnifier, 새 노트 and no public decks without sharing, and a drag down closes it',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        expect(find.text('My notes 3'), findsOneWidget);
        expect(find.byType(DeckRow), findsOneWidget);
        expect(find.byType(EditableText), findsNothing);

        await tester.drag(find.text('My notes 3'), const Offset(0, -200));
        await tester.pumpAndSettle();
        expect(find.byType(DeckRow), findsNWidgets(3));
        expect(find.text('New note'), findsOneWidget);
        expect(find.text('Browse public notes'), findsNothing);
        // The magnifier is a raised 44 point button, and opens the field.
        final magnifier = find.byTooltip('Search notes');
        expect(tester.getSize(magnifier).width, greaterThanOrEqualTo(44));
        expect(tester.getSize(magnifier).height, greaterThanOrEqualTo(44));
        expect(find.byType(EditableText), findsNothing);
        await tester.tap(magnifier);
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(EditableText), 'ALP');
        await tester.pumpAndSettle();
        expect(find.text('Alpha'), findsOneWidget);
        expect(find.text('Beta'), findsNothing);
        await tester.enterText(find.byType(EditableText), 'zebra');
        await tester.pumpAndSettle();
        expect(shownText('No note matches. Try other words.'), findsOneWidget);

        await tester.drag(find.text('My notes 3'), const Offset(0, 200));
        await tester.pumpAndSettle();
        expect(find.byType(DeckRow), findsOneWidget);
        expect(shownText('1 card today'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'a deck row shows its mastered of all cards under its name over a bar whose screen reader label breaks them down, and a deck with no card shows 0 cards and no bar',
      (tester) async {
        // Alpha: one mastered, one learning after a day's interval, two new.
        final list = await _open(
          tester,
          fresh: {'Alpha': 2},
          due: {'Alpha': 1},
          mastered: {'Alpha': 1},
          decks: ['Alpha', 'Beta'],
        );
        await list.decks();
        Finder row(String deck) =>
            find.ancestor(of: find.text(deck), matching: find.byType(DeckRow));
        Finder inRow(String deck, Finder finder) =>
            find.descendant(of: row(deck), matching: finder);

        final line = inRow('Alpha', find.text('1 of 4 mastered'));
        final bar = inRow('Alpha', find.byType(ProgressBar));
        expect(line, findsOneWidget);
        expect(tester.getTopLeft(line).dy, lessThan(tester.getTopLeft(bar).dy));
        expect(
          tester.getSemantics(row('Alpha')).getSemanticsData().label,
          contains('1 mastered, 1 learning, 2 new'),
        );
        // Each row carries its count for today.
        expect(inRow('Alpha', find.text('Today 3')), findsOneWidget);
        expect(inRow('Beta', find.text('0 cards')), findsOneWidget);
        expect(inRow('Beta', find.byType(ProgressBar)), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      'before the first deck the first-run home shows over the menu, its primary opening 새 노트',
      (tester) async {
        final list = await _open(tester, decks: []);
        expect(shownText('Shall we make your first note?'), findsOneWidget);
        expect(list.tab('Home'), findsOneWidget);
        final create = tester.widget<AppButton>(
          find.widgetWithText(AppButton, 'Create a note'),
        );
        expect(create.variant, AppButtonVariant.primary);
        await list.tap('Create a note');
        expect(find.byType(NewDeckScreen), findsOneWidget);
        await list.close();
      },
    );
  });

  group('새 노트', () {
    testWidgets(
      '새 노트 is a screen of the name and four cover colours; Save makes the deck in the colour chosen and opens it above the menu',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.newDeck();
        expect(find.byType(NewDeckScreen), findsOneWidget);
        expect(find.byType(BottomSheet), findsNothing);
        expect(list.tab('Home'), findsNothing);
        for (final colour in ['Blue', 'Peach', 'Sand', 'Slate']) {
          expect(find.bySemanticsLabel(colour), findsOneWidget, reason: colour);
        }
        for (final gone in ['Sky', 'Amber']) {
          expect(find.bySemanticsLabel(gone), findsNothing, reason: gone);
        }

        await list.tap('Save');
        expect(find.text('Enter a name'), findsOneWidget);
        await tester.enterText(find.byType(EditableText), 'Delta');
        await tester.tap(find.bySemanticsLabel('Sand'));
        await tester.pumpAndSettle();
        await list.tap('Save');

        expect(find.byType(DeckScreen), findsOneWidget);
        expect(find.text('Delta'), findsOneWidget);
        expect(list.tab('Home'), findsOneWidget);
        expect(find.text('Enter by hand'), findsNothing);
        final stored = ProviderScope.containerOf(
          tester.element(find.byType(DeckScreen)),
        ).read(decksProvider).value!.firstWhere((deck) => deck.name == 'Delta');
        expect(stored.color, DeckColor.sand);
        await list.close();
      },
    );

    testWidgets(
      'Save and add cards opens the new deck with the add-card sheet up',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        await list.newDeck();
        await tester.enterText(find.byType(EditableText), 'Delta');
        await list.tap('Save and add cards');
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(find.text('Enter by hand'), findsOneWidget);
        await list.close();
      },
    );
  });

  group('text at twice its size', () {
    final states = <String, Future<_List> Function(WidgetTester)>{
      'today': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        fresh: {'Alpha': 120, 'Gamma': 1},
        due: {'Beta': 3},
        dailyMinutes: 60,
      ),
      'done': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        answeredToday: {'Alpha': 35},
        dailyMinutes: 5,
      ),
      'backlog': (tester) => _open(
        tester,
        locale: const Locale('ko'),
        fresh: {'Gamma': 1},
        due: {'Alpha': 40, 'Beta': 30},
        dueDays: 30,
      ),
    };
    for (final MapEntry(key: state, value: open) in states.entries) {
      testWidgets(
        'at 2.0 in Korean, 홈 $state, its open drawer and 새 노트 lay out with nothing clipped',
        (tester) async {
          tester.platformDispatcher.textScaleFactorTestValue = 2;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          final list = await open(tester);
          final home = tester.element(find.byType(HomeTab));
          expect(MediaQuery.textScalerOf(home).scale(10), 20);
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);

          await list.tap('올려서 보기');
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);

          await list.tap('새 노트');
          expect(find.byType(NewDeckScreen), findsOneWidget);
          await _scrollThrough(tester);
          expect(tester.takeException(), isNull);
          await list.close();
        },
      );
    }
  });

  group('daily study minutes', () {
    testWidgets(
      'settings\' screen shows the minutes as one number between − and +, typed in place on the keypad, its tiles following it, and saving updates today\'s count',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          fresh: {'Alpha': 150},
          // Wide enough for the three-figure counts in the test font.
          screen: const Size(800, 844),
        );
        // 20 minutes at the unknown pace of 10 s: 120 new cards.
        expect(shownText('120 cards today'), findsOneWidget);
        await _openMinutes(tester);
        AppButton save() =>
            tester.widget<AppButton>(find.widgetWithText(AppButton, 'Save'));
        Finder tile(String text) => find.descendant(
          of: find.byWidgetPredicate(
            (widget) =>
                widget is Semantics && widget.properties.liveRegion == true,
          ),
          matching: find.text(text),
        );

        // No choices to pick from: the number, its steps and two tiles.
        expect(find.text('10 min'), findsNothing);
        expect(find.text('Custom'), findsNothing);
        final number = find.bySemanticsLabel('20 minutes a day, tap to type');
        expect(number, findsOneWidget);
        expect(tile('New cards a day'), findsOneWidget);
        expect(tile('About 120'), findsOneWidget);
        // 120 today, the other 30 tomorrow.
        expect(tile('All new cards started'), findsOneWidget);
        expect(tile('In 1 day'), findsOneWidget);

        // The number opens the keypad in its place; the tiles follow what is
        // typed before it is committed.
        await tester.tap(number);
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsOneWidget);
        await tester.enterText(find.byType(TextField), '10');
        await tester.pumpAndSettle();
        expect(tile('About 60'), findsOneWidget);
        // 60 today, then 60 and 30.
        expect(tile('In 2 days'), findsOneWidget);

        // Outside 5 to 180: a line says so and saving waits for a fix.
        await tester.enterText(find.byType(TextField), '200');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(find.text('Enter 5 to 180 minutes'), findsOneWidget);
        expect(find.byType(TextField), findsOneWidget);
        expect(save().onPressed, isNull);

        // An empty field keeps the minutes as they were.
        await tester.enterText(find.byType(TextField), '');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(find.byType(TextField), findsNothing);
        expect(number, findsOneWidget);
        expect(save().onPressed, isNotNull);

        // Any whole number in the bounds, committed with Done.
        await tester.tap(number);
        await tester.pumpAndSettle();
        await tester.enterText(find.byType(TextField), '5');
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tester.pumpAndSettle();
        expect(
          find.bySemanticsLabel('5 minutes a day, tap to type'),
          findsOneWidget,
        );
        expect(tile('About 30'), findsOneWidget);
        // Five is the floor.
        expect(
          tester
              .widget<IconButton>(
                find.widgetWithIcon(IconButton, LucideIcons.minus),
              )
              .onPressed,
          isNull,
        );
        // Nothing is stored until Save.
        expect(await list.storedMinutes(), isNull);

        await list.tap('Save');

        // Back on the row's screen, it shows the minutes saved.
        expect(find.byType(DailyMinutesRow), findsOneWidget);
        expect(await list.storedMinutes(), 5);
        expect(find.text('5 min'), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(shownText('30 cards today'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets('leaving the typed number commits it, as Done does', (
      tester,
    ) async {
      final list = await _open(tester, decks: ['Alpha'], fresh: {'Alpha': 3});
      await _openMinutes(tester);
      await tester.tap(find.bySemanticsLabel('20 minutes a day, tap to type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '37');
      await tester.pumpAndSettle();

      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsNothing);
      expect(
        find.bySemanticsLabel('37 minutes a day, tap to type'),
        findsOneWidget,
      );
      await list.close();
    });

    testWidgets(
      'once a deck has cards, the sheet shows once as a first-run step whose Skip keeps the default',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          fresh: {'Alpha': 3},
          minutesAsked: false,
        );

        expect(
          shownText('How many minutes a day will you study?'),
          findsOneWidget,
        );
        await waitForPicker(tester);
        await list.tap('Skip');
        expect(find.byType(BottomSheet), findsNothing);
        expect(await list.storedMinutes(), isNull);
        // 20 minutes at 10 s take all three new cards.
        expect(shownText('3 cards today'), findsOneWidget);

        // Shown once: back on the tab, it does not show again.
        await list.tap('Record');
        await list.tap('Home');
        expect(find.byType(BottomSheet), findsNothing);
        await list.close();
      },
    );

    for (final (name, theme) in [('light', lightTheme), ('dark', darkTheme)]) {
      testWidgets(
        'in the $name theme the today card, settings\' screen and its typed number meet the tap target and contrast guidelines',
        (tester) async {
          Future<void> meetsGuidelines() async {
            await expectLater(
              tester,
              meetsGuideline(labeledTapTargetGuideline),
            );
            await expectLater(
              tester,
              meetsGuideline(androidTapTargetGuideline),
            );
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
          }

          final list = await _open(tester, fresh: {'Alpha': 3}, theme: theme);
          await meetsGuidelines();
          await _openMinutes(tester);
          await meetsGuidelines();
          // With the keypad's field and a number outside the bounds.
          await tester.tap(
            find.bySemanticsLabel('20 minutes a day, tap to type'),
          );
          await tester.pumpAndSettle();
          await tester.enterText(find.byType(TextField), '200');
          await tester.pumpAndSettle();
          await meetsGuidelines();
          await list.close();
        },
      );
    }

    testWidgets('without a card the first-run step waits', (tester) async {
      final list = await _open(tester, decks: ['Alpha'], minutesAsked: false);

      expect(shownText('Make your first card?'), findsOneWidget);
      expect(find.byType(BottomSheet), findsNothing);
      await list.close();
    });
  });
}
