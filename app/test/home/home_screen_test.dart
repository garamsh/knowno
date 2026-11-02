import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/database/database.dart' hide DeckRow;
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/streak_flame.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/home/src/progress_bar.dart';
import 'package:knowno/home/src/today_tab.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart';

import '../contrast.dart';
import 'home_data.dart';
import '../study/minutes_sheet.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';

/// The home screen over decks named "Alpha", "Beta" and "Gamma", opening on
/// the 오늘 tab.
/// Opens a screen over the 오늘 tab holding the daily study minutes' row, as
/// the account screen holds it (`widget_test.dart` opens that screen itself),
/// and the picker the row opens, waiting for it.
Future<void> _openMinutes(WidgetTester tester) async {
  unawaited(
    Navigator.of(tester.element(find.byType(TodayTab))).push(
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
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  /// Shows the decks tab.
  Future<void> decks() => tap('Decks');

  /// The daily study minutes stored, null while none is.
  Future<int?> storedMinutes() async => (await tester.runAsync<int?>(
    () =>
        // Offstage too, under a screen opened over it.
        ProviderScope.containerOf(
          tester.element(find.byType(HomeScreen, skipOffstage: false)),
        ).read(studyRepositoryProvider).dailyMinutes(),
  ));

  /// Taps "새 덱 만들기" under the deck rows, which opens the new-deck sheet.
  Future<void> newDeck() async {
    await tester.ensureVisible(find.text('Create a deck'));
    await tap('Create a deck');
  }

  /// The row showing [deck].
  Finder row(String deck) =>
      find.ancestor(of: find.text(deck), matching: find.byType(InkWell)).first;

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

/// The rounded card on the 오늘 tab that holds [inside].
Finder _card(Finder inside) => find
    .ancestor(
      of: inside,
      matching: find.byWidgetPredicate(
        (widget) =>
            widget is DecoratedBox &&
            widget.decoration is BoxDecoration &&
            (widget.decoration as BoxDecoration).borderRadius ==
                BorderRadius.circular(AppRadius.card),
      ),
    )
    .first;

/// Hands out one row of a CSV as the file picked.
final class _OneFile implements SpreadsheetPick {
  const _OneFile();

  @override
  Future<OpenedFile?> pick() async =>
      parseSpreadsheet('words.csv', utf8.encode('pear,배'));
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('tabs', () {
    testWidgets(
      'opens on 오늘, the bar switches tabs, and back from another tab returns to 오늘',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        expect(find.text('Last 7 days'), findsOneWidget);
        expect(
          tester.getSemantics(find.text('Today').last),
          isSemantics(isSelected: true, hasSelectedState: true),
        );

        await list.decks();
        expect(find.text('My decks 3'), findsOneWidget);
        expect(find.text('Last 7 days'), findsNothing);
        await list.tap('Record');
        expect(find.text('Correct in reviews'), findsOneWidget);

        expect(await tester.binding.handlePopRoute(), isTrue);
        await tester.pumpAndSettle();
        expect(find.text('Last 7 days'), findsOneWidget);
        // Control: back on 오늘 is left to the platform, which leaves the app.
        expect(await tester.binding.handlePopRoute(), isFalse);
        await list.close();
      },
    );
  });

  group('덱', () {
    testWidgets(
      "a deck row shows its mastered of all cards under its name over a bar whose screen reader label breaks them down, with no learning line, and a deck with no card shows 0 cards and no bar",
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
        expect(bar, findsOneWidget);
        expect(
          tester.getTopLeft(line).dy,
          lessThan(tester.getTopLeft(bar).dy),
          reason: 'the line is under the name and over the bar',
        );
        expect(inRow('Alpha', find.textContaining('learning')), findsNothing);
        expect(
          tester.getSemantics(row('Alpha')).getSemanticsData().label,
          contains('1 mastered, 1 learning, 2 new'),
        );

        expect(inRow('Beta', find.text('0 cards')), findsOneWidget);
        expect(inRow('Beta', find.byType(ProgressBar)), findsNothing);
        expect(inRow('Beta', find.textContaining('mastered')), findsNothing);
        await list.close();
      },
    );
  });

  group('기록', () {
    testWidgets(
      'the tab is built once first shown, and shows study\'s record over every deck',
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 1},
          due: {'Alpha': 1, 'Beta': 2},
        );
        expect(find.text('Memory', skipOffstage: false), findsNothing);

        await list.tap('Record');
        // Every deck's stored state, each recalled at the substituted 0.9.
        expect(
          find.bySemanticsLabel(
            'Of 3 cards: good 0, fair 3, fading soon 0, average 90%',
          ),
          findsOneWidget,
        );
        expect(homeRecall, 0.9);
        await list.close();
      },
    );
  });

  group('오늘', () {
    testWidgets(
      'with one deck and no card, it shows how to start, adding a card to the deck as its one primary, not a finished day',
      (tester) async {
        final list = await _open(tester, decks: ['Alpha']);

        expect(shownText('Make your first card?'), findsOneWidget);
        expect(shownText('Add cards to a deck to start.'), findsNothing);
        expect(find.text("You've done today's cards"), findsNothing);
        AppButton button(String label) =>
            tester.widget<AppButton>(find.widgetWithText(AppButton, label));
        expect(button('Add card').variant, AppButtonVariant.primary);
        // The one action that leads out.
        expect(
          find.descendant(
            of: find.byType(TodayTab),
            matching: find.byType(AppButton),
          ),
          findsOneWidget,
        );

        // "Add card" opens the deck and its add sheet.
        await list.tap('Add card');
        await list.tap('Enter by hand');
        expect(find.byType(CardEditorScreen), findsOneWidget);
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'with several decks and no card, its one primary shows the 덱 tab',
      (tester) async {
        final list = await _open(tester);

        expect(shownText('Make your first card?'), findsOneWidget);
        await list.tap('Add cards in a deck');
        expect(find.text('My decks 3'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets('with a card in any deck, it shows the day, not how to start', (
      tester,
    ) async {
      final list = await _open(tester, decks: ['Alpha'], fresh: {'Alpha': 1});

      expect(shownText('Make your first card?'), findsNothing);
      expect(find.text('Study all'), findsOneWidget);
      await list.close();
    });

    // Each card the 오늘 tab can lead with, by the text it shows: the today
    // card, its ring's figures three digits, the done card, and the backlog
    // card.
    final states =
        <
          String,
          (
            String Function(AppLocalizations),
            Future<_List> Function(WidgetTester, Locale),
          )
        >{
          'the today card': (
            (l10n) => l10n.studyAll,
            (tester, locale) => _open(
              tester,
              locale: locale,
              fresh: {'Alpha': 120, 'Gamma': 1},
              due: {'Beta': 3},
              answeredToday: {'Beta': 100},
              dailyMinutes: 60,
            ),
          ),
          'the done card': (
            (l10n) => l10n.todayDone,
            (tester, locale) => _open(
              tester,
              locale: locale,
              decks: ['Alpha'],
              answeredToday: {'Alpha': 35},
              dailyMinutes: 5,
            ),
          ),
          'the backlog card': (
            (l10n) => l10n.backlogTitle,
            (tester, locale) => _open(
              tester,
              locale: locale,
              fresh: {'Gamma': 1},
              due: {'Alpha': 40, 'Beta': 30},
              dueDays: 30,
            ),
          ),
        };
    testWidgets(
      'in Korean the backlog card\'s sentence breaks only between words on a phone, and reads as written (#454)',
      (tester) async {
        final list = await _open(
          tester,
          locale: const Locale('ko'),
          fresh: {'Gamma': 1},
          due: {'Alpha': 60, 'Beta': 60},
          dueDays: 30,
        );
        // At a three-digit count the first line's end falls inside "것부터".
        const sentence = '밀린 복습 120장을 급한 것부터 해요. 새 카드는 잠시 쉬어요.';
        expectBreaksBetweenWords(tester, sentence);
        final semantics = tester.ensureSemantics();
        await tester.pump();
        expect(
          find.bySemanticsLabel(RegExp(RegExp.escape(sentence))),
          findsOneWidget,
        );
        semantics.dispose();
        await list.close();
      },
    );

    for (final locale in const [Locale('ko'), Locale('en')]) {
      for (final MapEntry(key: state, value: (title, open)) in states.entries) {
        testWidgets(
          'at twice the text size in ${locale.languageCode}, the 오늘 tab with $state and its tab bar lay out without overflow and keep the day bar labels on one line',
          (tester) async {
            tester.platformDispatcher.textScaleFactorTestValue = 2;
            addTearDown(
              tester.platformDispatcher.clearTextScaleFactorTestValue,
            );
            final list = await open(tester, locale);
            // The setup is the state asked for: the text twice its size,
            // and the tab leading with that card.
            final tab = tester.element(find.byType(TodayTab));
            expect(MediaQuery.textScalerOf(tab).scale(10), 20);
            expect(find.text(title(AppLocalizations.of(tab))), findsOneWidget);
            // Every part of the tab laid out, from its top to its foot.
            final scrollable = find
                .descendant(
                  of: find.byType(TodayTab),
                  matching: find.byType(Scrollable),
                )
                .first;
            final position = tester.state<ScrollableState>(scrollable).position;
            while (position.pixels < position.maxScrollExtent) {
              await tester.drag(scrollable, const Offset(0, -300));
              await tester.pumpAndSettle();
            }
            expect(position.maxScrollExtent, greaterThan(0));
            expect(tester.takeException(), isNull);
            // The day bars' label for today stays one line: a word that
            // broke inside itself would lay out taller than one line.
            final today = AppLocalizations.of(tab).dayToday;
            for (final label in find.text(today).evaluate()) {
              final paragraph = label.renderObject! as RenderParagraph;
              final line = TextPainter(
                text: paragraph.text,
                textScaler: paragraph.textScaler,
                textDirection: TextDirection.ltr,
              )..layout();
              expect(paragraph.size.height, line.height, reason: today);
              line.dispose();
            }
            await list.close();
          },
        );
      }
    }

    testWidgets(
      'the today card counts every deck as done over the day\'s cards with their minutes and a bar, the streak, and Study all studies every deck',
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 2, 'Gamma': 1},
          due: {'Alpha': 1, 'Beta': 3},
          pace: const Duration(seconds: 25),
        );

        // The large count is the bar's figures, which the bar reads.
        expect(find.text('0 / 7', findRichText: true), findsOneWidget);
        expect(find.bySemanticsLabel('0 of 7 cards'), findsOneWidget);
        expect(
          tester
              .widget<LinearProgressIndicator>(
                find.byType(LinearProgressIndicator),
              )
              .value,
          0,
        );
        // Seven cards at 25 s each take 175 s, about 3 minutes; none done,
        // so nothing is said to be left.
        expect(find.text('About 3 min'), findsOneWidget);
        // The progress is stated once: no line under the bar restates it.
        expect(_todayCardTexts(tester), {
          "Today's cards",
          '1-day streak',
          '0 / 7',
          'About 3 min',
          'Study all',
        });
        // The pace's answers were given the day before, which starts the
        // streak.
        // The today card's chip alone: the last seven days' card has no line.
        expect(find.text('1-day streak'), findsOneWidget);
        // The chip's flame burns at the streak's stage.
        final chip = find.ancestor(
          of: find.text('1-day streak').first,
          matching: find.byType(Row),
        );
        expect(
          tester
              .widget<StreakFlame>(
                find.descendant(
                  of: chip.first,
                  matching: find.byType(StreakFlame),
                ),
              )
              .days,
          1,
        );

        await list.tap('Study all');

        expect(list.session, list.ids.values.toSet());
        await list.close();
      },
    );

    testWidgets(
      'cards studied past the day\'s plan leave the done card and its goal as planned, and show apart as more cards today',
      (tester) async {
        // 5 minutes at the unknown pace of 10 s: 30 new cards a day, so the
        // 35 first answered today are 30 planned and 5 past the plan.
        final list = await _open(
          tester,
          decks: ['Alpha'],
          answeredToday: {'Alpha': 35},
          dailyMinutes: 5,
        );

        expect(find.text("You've done today's cards"), findsOneWidget);
        expect(find.text('Goal of 30 reached'), findsOneWidget);
        expect(find.text('5 more cards today'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'with cards still left, the today card shows the cards studied past the day\'s plan under its bar',
      (tester) async {
        // 5 minutes at 10 s: one review due takes 10 s, leaving room for 29
        // new cards, so of the 35 first answered today 6 are past the plan,
        // and the review is left.
        final list = await _open(
          tester,
          decks: ['Alpha', 'Beta'],
          due: {'Beta': 1},
          answeredToday: {'Alpha': 35},
          dailyMinutes: 5,
        );

        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        expect(find.text('6 more cards today'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'control: within the day\'s plan, no card is shown as more today',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          answeredToday: {'Alpha': 30},
          dailyMinutes: 5,
        );

        expect(find.text('Goal of 30 reached'), findsOneWidget);
        expect(find.textContaining('more card'), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      "the goal counts the cards answered today as done on the count and the bar, and the minutes those left",
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 2},
          answeredToday: {'Beta': 1},
        );

        expect(find.text('1 / 3', findRichText: true), findsOneWidget);
        expect(find.bySemanticsLabel('1 of 3 cards'), findsOneWidget);
        expect(
          tester
              .widget<LinearProgressIndicator>(
                find.byType(LinearProgressIndicator),
              )
              .value,
          closeTo(1 / 3, 1e-9),
        );
        // Once a card is done the minutes are those left: two at 10 s.
        expect(find.text('About 1 min left'), findsOneWidget);
        // Two cards left: nothing but the figure and the bar says so.
        expect(_todayCardTexts(tester), {
          "Today's cards",
          '1-day streak',
          '1 / 3',
          'About 1 min left',
          'Study all',
        });
        // Answered today: the streak counts today.
        // The today card's chip alone: the last seven days' card has no line.
        expect(find.text('1-day streak'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'the last seven days show the cards answered on each study day and the week\'s minutes, and open 기록',
      (tester) async {
        // Beta's card answered 20 times at 25 s on Wednesday, and two of
        // Alpha's cards today at 3 s each.
        final list = await _open(
          tester,
          due: {'Beta': 1},
          pace: const Duration(seconds: 25),
          answeredToday: {'Alpha': 2},
        );

        // homeNow is Thursday 15 October 2026.
        expect(
          find.bySemanticsLabel(
            'Studied 3 cards in 9 min over the last 7 days, Friday 0, '
            'Saturday 0, Sunday 0, Monday 0, Tuesday 0, Wednesday 1, '
            'Thursday 2',
          ),
          findsOneWidget,
        );
        // The card is its heading and its bars: no summary line.
        expect(find.text('Last 7 days'), findsOneWidget);
        expect(find.textContaining('This week'), findsNothing);
        // The streak is on the today card's chip alone.
        expect(find.text('2-day streak'), findsOneWidget);
        expect(find.text('Next 7 days'), findsNothing);

        await tester.ensureVisible(find.text('Last 7 days'));
        await list.tap('Last 7 days');
        expect(find.text('Correct in reviews'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      "today's decks are those with cards left, and a row studies its deck",
      (tester) async {
        final list = await _open(
          tester,
          fresh: {'Alpha': 2},
          later: {'Beta': 1},
        );

        expect(find.text("Today's decks"), findsOneWidget);
        expect(find.bySemanticsLabel('Study Alpha, 2 today'), findsOneWidget);
        // Control: a deck with nothing left today has no row.
        expect(find.bySemanticsLabel(RegExp('^Study Beta')), findsNothing);

        // Centred, so the tab bar does not cover it.
        unawaited(
          Scrollable.ensureVisible(
            tester.element(find.bySemanticsLabel('Study Alpha, 2 today')),
            alignment: 0.5,
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.bySemanticsLabel('Study Alpha, 2 today'));
        await tester.pumpAndSettle();

        expect(list.session, {list.ids['Alpha']});
        await list.close();
      },
    );

    testWidgets(
      'the current tab\'s name is in the accent, and moves with the tab',
      (tester) async {
        final list = await _open(tester, fresh: {'Alpha': 1});
        final colors = AppColors.of(tester.element(find.byType(TodayTab)));
        Color? tab(String name) => tester
            .widget<Text>(
              find.descendant(
                of: find.byWidgetPredicate(
                  (widget) =>
                      widget is Semantics &&
                      widget.properties.label == 'Tabs',
                ),
                matching: find.text(name),
              ),
            )
            .style
            ?.color;

        expect(tab('Today'), colors.accent);
        expect(tab('Decks'), colors.ink2);
        await list.tap('Decks');
        expect(tab('Today'), colors.ink2);
        expect(tab('Decks'), colors.accent);
        await list.close();
      },
    );

    testWidgets(
      'the last seven days draw today in the accent and the other days in the chart\'s quiet colour, and the catch-up the same, with no amber',
      (tester) async {
        Finder bars(Color fill) => find.descendant(
          of: find.byType(TodayTab),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Container &&
                widget.constraints?.maxWidth == AppSpace.s24 - 2 &&
                (widget.decoration as BoxDecoration).color == fill,
          ),
        );
        var list = await _open(tester, fresh: {'Alpha': 3});
        final colors = AppColors.of(tester.element(find.byType(TodayTab)));
        expect(bars(colors.accent), findsOneWidget);
        expect(bars(colors.chartQuiet), findsNWidgets(6));
        await list.close();

        list = await _open(tester, due: {'Alpha': 4, 'Beta': 3}, dueDays: 30);
        expect(find.text('Pick up where you left off'), findsOneWidget);
        expect(bars(colors.accent), findsOneWidget);
        expect(bars(colors.chartQuiet), findsNWidgets(6));
        expect(bars(colors.streak), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      'once today\'s cards are done the done card names the next review and the goal reached, and Study studies every deck',
      (tester) async {
        final list = await _open(tester, answeredToday: {'Alpha': 2});

        expect(find.text("You've done today's cards"), findsOneWidget);
        expect(find.text('Study all'), findsNothing);
        expect(find.bySemanticsLabel(RegExp('for today')), findsNothing);
        expect(
          find.text('Next review Tomorrow · 2, about 1 min'),
          findsOneWidget,
        );
        expect(find.text('Goal of 2 reached'), findsOneWidget);
        // The today card's chip alone: the last seven days' card has no line.
        expect(find.text('1-day streak'), findsOneWidget);
        expect(find.textContaining('This week'), findsNothing);
        // Study is inside the done card, as every state's primary is in its
        // card, and the last seven days follow the card.
        final doneCard = find.ancestor(
          of: find.text("You've done today's cards"),
          matching: find.byType(DecoratedBox),
        );
        // On the surface, so the coral button stands alone on the screen.
        final colors = AppColors.of(tester.element(find.byType(TodayTab)));
        expect(
          find.descendant(
            of: find.byType(TodayTab),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is DecoratedBox &&
                  widget.decoration is BoxDecoration &&
                  (widget.decoration as BoxDecoration).borderRadius != null &&
                  (widget.decoration as BoxDecoration).color ==
                      colors.brandTint &&
                  find
                      .descendant(
                        of: find.byWidget(widget),
                        matching: find.text("You've done today's cards"),
                      )
                      .evaluate()
                      .isNotEmpty,
            ),
          ),
          findsNothing,
        );
        expect(
          find.descendant(
            of: find.byType(TodayTab),
            matching: find.byWidgetPredicate(
              (widget) =>
                  widget is DecoratedBox &&
                  widget.decoration is BoxDecoration &&
                  (widget.decoration as BoxDecoration).color ==
                      colors.surface &&
                  find
                      .descendant(
                        of: find.byWidget(widget),
                        matching: find.text("You've done today's cards"),
                      )
                      .evaluate()
                      .isNotEmpty,
            ),
          ),
          findsOneWidget,
        );
        expect(
          find.descendant(
            of: doneCard.first,
            matching: find.widgetWithText(AppButton, 'Study'),
          ),
          findsOneWidget,
        );
        expect(
          tester.getRect(find.text('Study')).bottom,
          lessThan(tester.getRect(find.text('Last 7 days')).top),
        );

        await list.tap('Study');

        expect(list.session, list.ids.values.toSet());
        await list.close();
      },
    );

    testWidgets(
      'a done day with nothing answered and nothing due this week reaches no goal and has no next review',
      (tester) async {
        // A card due in ten days: nothing this week.
        final list = await _open(tester, mastered: {'Alpha': 1});

        expect(find.text("You've done today's cards"), findsOneWidget);
        expect(find.text('No reviews in the next 7 days'), findsOneWidget);
        expect(find.textContaining('reached'), findsNothing);
        expect(find.textContaining('streak'), findsNothing);
        await list.close();
      },
    );

    testWidgets(
      'in a backlog the backlog card counts the overdue reviews, says new cards wait, and studies every deck, and not otherwise',
      (tester) async {
        const title = 'Pick up where you left off';
        // Seven reviews due after 30-day intervals are far more than three
        // days' load, so the new card waits.
        var list = await _open(
          tester,
          fresh: {'Gamma': 1},
          due: {'Alpha': 4, 'Beta': 3},
          dueDays: 30,
        );

        expect(find.text(title), findsOneWidget);
        expect(
          shownText(
            '7 overdue reviews, most urgent first. New cards wait for now.',
          ),
          findsOneWidget,
        );
        // Seven reviews after 30-day intervals ask for a quarter of a card
        // a day, so the catch-up runs at one a day.
        expect(find.text('At 1 a day you catch up in 7 days'), findsOneWidget);
        expect(
          find.bySemanticsLabel(
            'Overdue reviews expected: Today 7, Tomorrow 6, Sat 5, Sun 4, '
            'Mon 3, Tue 2, Wed 1',
          ),
          findsOneWidget,
        );
        // The pace is the one plan for today: the button names no count,
        // and no note under the chart says the pace again.
        expect(find.textContaining('1 a day'), findsOneWidget);
        expect(find.textContaining(RegExp(r'Study \d')), findsNothing);
        await list.tap('Study all');
        expect(list.session, list.ids.values.toSet());
        await list.close();

        // Control: the same reviews after one-day intervals are within three
        // days' load, so the today card takes the new card.
        list = await _open(
          tester,
          fresh: {'Gamma': 1},
          due: {'Alpha': 4, 'Beta': 3},
        );

        expect(find.bySemanticsLabel('0 of 8 cards'), findsOneWidget);
        expect(find.text(title), findsNothing);
        await list.close();
      },
    );

    for (final (name, theme) in [('light', lightTheme), ('dark', darkTheme)]) {
      testWidgets(
        'in the $name theme the today, backlog and unreadable-count cards are white with an ink bar and an ink button, and meet the contrast guideline',
        (tester) async {
          for (final (state, open) in [
            ('today', () => _open(tester, fresh: {'Alpha': 3}, theme: theme)),
            (
              'backlog',
              () => _open(
                tester,
                due: {'Alpha': 4, 'Beta': 3},
                dueDays: 30,
                theme: theme,
              ),
            ),
            (
              'unreadable',
              () => _open(
                tester,
                mastered: {'Alpha': 1},
                unreadable: {'Beta'},
                theme: theme,
              ),
            ),
          ]) {
            final list = await open();
            final colors = AppColors.of(tester.element(find.byType(TodayTab)));
            final button = find.descendant(
              of: find.byType(TodayTab),
              matching: find.byType(AppButton),
            );
            expect(button, findsOneWidget, reason: state);
            final card = _card(button);
            expect(
              (tester.widget<DecoratedBox>(card).decoration as BoxDecoration)
                  .color,
              colors.surface,
              reason: state,
            );
            expect(
              tester.widget<AppButton>(button).variant,
              AppButtonVariant.primary,
              reason: state,
            );
            final bars = find.descendant(
              of: card,
              matching: find.byType(LinearProgressIndicator),
            );
            for (final bar in bars.evaluate()) {
              expect(
                (bar.widget as LinearProgressIndicator).color,
                colors.accent,
                reason: state,
              );
            }
            if (state == 'today') expect(bars, findsOneWidget);
            expectTextReadable(tester, card, colors.surface);
            await expectLater(tester, meetsGuideline(textContrastGuideline));
            expectScreenTextReadable(tester);
            await list.close();
          }
        },
      );
    }

    testWidgets('a count that cannot be read says why', (tester) async {
      final list = await _open(
        tester,
        mastered: {'Alpha': 1},
        unreadable: {'Beta'},
      );

      expect(
        find.text(
          "Couldn't read or write the device's storage. Please try again.",
        ),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel(RegExp('for today')), findsNothing);
      await list.close();
    });
  });

  group('daily study minutes', () {
    testWidgets(
      'no card on 오늘 holds a minutes control: the today, done and backlog cards',
      (tester) async {
        Finder pencil() => find.byWidgetPredicate(
          (widget) => widget is Icon && widget.icon == LucideIcons.pencil,
        );
        // The today card, the done card and the backlog card.
        var list = await _open(tester, fresh: {'Alpha': 3});
        expect(find.bySemanticsLabel('0 of 3 cards'), findsOneWidget);
        expect(pencil(), findsNothing);
        await list.close();
        list = await _open(tester, answeredToday: {'Alpha': 2});
        expect(find.text("You've done today's cards"), findsOneWidget);
        expect(pencil(), findsNothing);
        await list.close();
        list = await _open(tester, due: {'Alpha': 4, 'Beta': 3}, dueDays: 30);
        expect(find.text('Pick up where you left off'), findsOneWidget);
        expect(pencil(), findsNothing);
        await list.close();
      },
    );

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
        expect(find.bySemanticsLabel('0 of 120 cards'), findsOneWidget);
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
        expect(find.bySemanticsLabel('0 of 30 cards'), findsOneWidget);
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
        expect(find.bySemanticsLabel('0 of 3 cards'), findsOneWidget);

        // Shown once: back on the tab, it does not show again.
        await list.decks();
        await list.tap('Today');
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

    testWidgets(
      'the search keeps the decks whose name holds it, ignoring case',
      (tester) async {
        final list = await _open(tester);
        await list.decks();

        await tester.enterText(find.byType(EditableText), 'ALP');
        await tester.pumpAndSettle();
        expect(find.text('Alpha'), findsOneWidget);
        expect(find.text('Beta'), findsNothing);

        await tester.enterText(find.byType(EditableText), 'zebra');
        await tester.pumpAndSettle();
        expect(shownText('No deck matches. Try other words.'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'Choose a file on the new-deck sheet saves the rows reviewed into the deck chosen and opens it',
      (tester) async {
        final list = await _open(tester, spreadsheet: const _OneFile());
        await list.decks();

        await list.newDeck();
        await list.tap('Choose a file');
        await list.tap('Choose file');
        await list.tap('Add to');
        await list.tap('Beta');
        await tester.tap(find.widgetWithText(AppButton, 'Add 1 card'));
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 50)),
        );
        await tester.pumpAndSettle();

        expect(find.byType(DeckScreen), findsOneWidget);
        expect(find.text('Beta'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'Create a deck under the rows opens the new-deck sheet, which makes one by hand, and offers no photo without photo import',
      (tester) async {
        final list = await _open(tester);
        await list.decks();

        await list.newDeck();
        // The sheet is titled by what it makes, over the entry that opened it.
        expect(shownText('New deck'), findsOneWidget);
        expect(shownText('Create a deck'), findsOneWidget);
        expect(find.text('Enter by hand'), findsOneWidget);
        expect(find.text('Take photo'), findsNothing);
        expect(find.text('Choose from album'), findsNothing);
        expect(find.text('Choose a file'), findsOneWidget);
        await list.tap('Enter by hand');
        // The name sheet is "New deck", as photo import's is.
        expect(shownText('New deck'), findsOneWidget);
        await tester.enterText(find.byType(EditableText).last, 'Delta');
        await list.tap('Create');
        // 덱 꾸미기 comes next, and the pair chosen there reaches the tile.
        expect(shownText('Customize deck'), findsOneWidget);
        await tester.tap(find.bySemanticsLabel('Star'));
        await tester.pumpAndSettle();
        await list.tap('Save');

        // The new deck opens, as a photo import's deck does.
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(
          find.descendant(
            of: find.byType(DeckTile),
            matching: find.byIcon(LucideIcons.star),
          ),
          findsOneWidget,
        );
        expect(find.text('Delta'), findsOneWidget);
        expect(shownText('No cards yet'), findsOneWidget);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.text('My decks 4'), findsOneWidget);
        expect(find.text('Delta'), findsOneWidget);
        await list.close();
      },
    );

    testWidgets(
      'with photo import, Create a deck offers the camera and the album in the same sheet, each opening photo import for a new deck from its source',
      (tester) async {
        final opened = <(DeckId?, PhotoOrigin)>[];
        final list = await _open(
          tester,
          photoImport: (deck, origin) {
            opened.add((deck, origin));
            return Builder(
              builder: (context) => Scaffold(
                body: TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('photo import'),
                ),
              ),
            );
          },
        );
        await list.decks();

        for (final row in ['Take photo', 'Choose from album']) {
          await list.newDeck();
          expect(find.text('Enter by hand'), findsOneWidget);
          await list.tap(row);
          expect(find.text('photo import'), findsOneWidget);
          await list.tap('photo import');
        }
        expect(opened, [(null, PhotoOrigin.camera), (null, PhotoOrigin.album)]);
        await list.close();
      },
    );

    testWidgets('a photo import that saved returns to the deck it saved into', (
      tester,
    ) async {
      final list = await _open(
        tester,
        photoImport: (_, _) => Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).pop(
                Deck(
                  id: const DeckId('deck1'),
                  name: 'Beta',
                  createdAt: DateTime.utc(2026, 10, 15),
                  updatedAt: DateTime.utc(2026, 10, 15),
                ),
              ),
              child: const Text('saved'),
            ),
          ),
        ),
      );
      expect(list.ids['Beta'], const DeckId('deck1'));
      await list.decks();

      await list.newDeck();
      await list.tap('Take photo');
      await list.tap('saved');

      expect(find.byType(HomeScreen), findsNothing);
      expect(find.text('Beta'), findsOneWidget);
      expect(find.text('Add card'), findsOneWidget);
      await list.close();
    });

    testWidgets('a photo import left without saving returns to the deck list', (
      tester,
    ) async {
      final list = await _open(
        tester,
        photoImport: (_, _) => Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('left'),
            ),
          ),
        ),
      );
      await list.decks();

      await list.newDeck();
      await list.tap('Take photo');
      await list.tap('left');

      expect(find.byType(HomeScreen), findsOneWidget);
      expect(find.text('My decks 3'), findsOneWidget);
      await list.close();
    });

    testWidgets(
      'the top bar holds the title alone, a long-press opens a deck as a tap does, and Create a deck sits under the rows',
      (tester) async {
        final list = await _open(tester);
        await list.decks();

        final bar = find.byType(AppBar);
        expect(
          find.descendant(of: bar, matching: find.text('My decks 3')),
          findsOneWidget,
        );
        expect(
          find.descendant(of: bar, matching: find.byType(ButtonStyleButton)),
          findsNothing,
        );
        expect(find.text('Select'), findsNothing);
        expect(find.text('New deck'), findsNothing);

        // With no selection mode, a long-press opens the deck as a tap does.
        await tester.longPress(find.text('Beta'));
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(find.textContaining('selected'), findsNothing);
        await tester.pageBack();
        await tester.pumpAndSettle();

        await tester.ensureVisible(shownText('Create a deck'));
        expect(
          tester.getRect(shownText('Create a deck')).top,
          greaterThan(tester.getRect(find.text('Gamma')).bottom),
        );
        // Control: without sharing there is no way to public decks beside it.
        expect(find.text('Browse public decks'), findsNothing);
        await list.close();
      },
    );
  });

  group('icons', () {
    /// The nearest row around [text]: a chip's, or the row a card leads with.
    Finder rowOf(String text) =>
        find.ancestor(of: find.text(text), matching: find.byType(Row)).first;

    Finder chipOf(String text) =>
        find.ancestor(of: find.text(text), matching: find.byType(AppChip));

    testWidgets(
      'the new-deck sheet\'s rows draw no icon, and by hand has no second line while each photo row keeps its own',
      (tester) async {
        final list = await _open(
          tester,
          photoImport: (deck, origin) => const SizedBox(),
        );
        await list.decks();
        await list.newDeck();

        final rows = find.byType(AppListRow);
        expect(rows, findsNWidgets(4));
        expect(
          find.descendant(of: rows, matching: find.byType(Icon)),
          findsNothing,
        );
        AppListRow row(String title) =>
            tester.widget<AppListRow>(find.widgetWithText(AppListRow, title));
        expect(row('Enter by hand').subtitle, isNull);
        expect(row('Take photo').subtitle, isNotNull);
        expect(row('Choose from album').subtitle, isNotNull);
        expect(row('Choose a file').subtitle, isNotNull);
        await list.close();
      },
    );

    testWidgets(
      'Create a deck under the deck rows is an outlined button of its words alone',
      (tester) async {
        final list = await _open(tester);
        await list.decks();

        final button = find.widgetWithText(AppButton, 'Create a deck');
        expect(
          tester.widget<AppButton>(button).variant,
          AppButtonVariant.secondary,
        );
        expect(
          find.descendant(of: button, matching: find.byType(Icon)),
          findsNothing,
        );
        await list.close();
      },
    );

    testWidgets(
      'the done card\'s goal and more-today chips are words alone, its streak chip keeps the flame, and its mascot is happy with no z\'s',
      (tester) async {
        final list = await _open(
          tester,
          decks: ['Alpha'],
          answeredToday: {'Alpha': 35},
          dailyMinutes: 5,
        );

        for (final chip in ['Goal of 30 reached', '5 more cards today']) {
          expect(chipOf(chip), findsOneWidget);
          expect(
            find.descendant(of: chipOf(chip), matching: find.byType(Icon)),
            findsNothing,
            reason: chip,
          );
        }
        // Control: the chip finder reaches a chip's leading mark.
        expect(
          find.descendant(
            of: chipOf('1-day streak'),
            matching: find.byType(StreakFlame),
          ),
          findsOneWidget,
        );
        expect(
          tester.widget<Mascot>(find.byType(Mascot)).expression,
          MascotExpression.happy,
        );
        expect(find.text('z'), findsNothing);
        await list.close();
      },
    );

    testWidgets('the backlog card\'s mascot carries no badge', (tester) async {
      final list = await _open(
        tester,
        fresh: {'Gamma': 1},
        due: {'Alpha': 4, 'Beta': 3},
        dueDays: 30,
      );

      final lead = rowOf('Pick up where you left off');
      expect(
        tester
            .widget<Mascot>(
              find.descendant(of: lead, matching: find.byType(Mascot)),
            )
            .expression,
        MascotExpression.thinking,
      );
      expect(
        find.descendant(of: lead, matching: find.byType(Icon)),
        findsNothing,
      );
      await list.close();
    });

    testWidgets(
      'a 오늘 tab with no card says how to start under the happy mascot, and the first-run home under the thinking one',
      (tester) async {
        var list = await _open(tester, decks: ['Alpha']);
        expect(shownText('Make your first card?'), findsOneWidget);
        expect(
          tester.widget<Mascot>(find.byType(Mascot)).expression,
          MascotExpression.happy,
        );
        await list.close();

        list = await _open(tester, decks: []);
        expect(shownText('Shall we make your first deck?'), findsOneWidget);
        expect(
          tester.widget<Mascot>(find.byType(Mascot)).expression,
          MascotExpression.thinking,
        );
        await list.close();
      },
    );
  });
}

/// Every text on the 오늘 tab's today card, the card that holds its bar.
Set<String> _todayCardTexts(WidgetTester tester) => {
  for (final text in tester.widgetList<Text>(
    find.descendant(
      of: find
          .ancestor(
            of: find.byType(LinearProgressIndicator),
            matching: find.byType(Column),
          )
          .first,
      matching: find.byType(Text),
    ),
  ))
    (text.data ?? text.textSpan!.toPlainText()).replaceAll('\u2060', ''),
};
