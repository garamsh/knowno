import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/src/daily_minutes.dart';
import 'package:knowno/study/src/daily_minutes_sheet.dart';
import 'package:knowno/study/src/study_repository.dart';
import 'package:knowno/study/src/study_time.dart';

import '../home/home_data.dart';
import 'minutes_sheet.dart';
import 'study_storage.dart';
import '../word_breaks.dart';

/// A plan at the unknown pace of 10 s, with [unstarted] cards never answered.
MinutesPlan _plan({
  int due = 0,
  int started = 0,
  required int unstarted,
  bool backlog = false,
}) => MinutesPlan(
  minutes: null,
  due: due,
  started: started,
  unstarted: unstarted,
  backlog: backlog,
  pace: Pace.unknown,
);

/// Shows [DailyMinutesRow] over an in-memory database at [homeNow], on a
/// phone's screen, in [locale].
Future<AppDatabase> _pumpRow(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
}) async {
  // A phone's screen, so the sheet's choices are on it.
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
  final storage = await openStudyStorage(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(
          DeckRepository(db, clock: () => homeNow, newId: () => 'deck'),
        ),
        ...homeOverrides(db, storage: storage),
      ],
      child: MaterialApp(
        theme: lightTheme,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: DailyMinutesRow()),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return db;
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('what a choice of minutes means', () {
    test('today takes the new cards the minutes leave room for, less those started today', () {
      // 20 min at 10 s: 120 a day, of which 20 were started today.
      final (:fresh, :after) = _plan(started: 20, unstarted: 500).at(20);
      expect(fresh, 100);
      // 400 left after today, 120 a day: four more days.
      expect(after, 4);
    });

    test('due reviews come first, so a backlog of them leaves no new card', () {
      // 60 due reviews at 10 s fill 10 minutes.
      expect(_plan(due: 60, unstarted: 50).at(10), (fresh: 0, after: null));
      // Control: five more minutes leave room for 30.
      expect(_plan(due: 60, unstarted: 50).at(15).fresh, 30);
    });

    test('in a backlog no new card is taken, whatever the minutes', () {
      expect(_plan(unstarted: 50, backlog: true).at(60), (
        fresh: 0,
        after: null,
      ));
    });

    test('today takes no more than the cards left, and with none left no day is counted', () {
      expect(_plan(unstarted: 7).at(20), (fresh: 7, after: 0));
      expect(_plan(unstarted: 0).at(20), (fresh: 0, after: null));
    });
  });

  testWidgets(
    "the account screen's row, with no icon, shows the minutes and opens the picker as a screen with a back button, which stores nothing, then shows those saved",
    (tester) async {
      final db = await _pumpRow(tester);
      Future<int?> stored() => tester.runAsync<int?>(
        () => StudyRepository(db, newId: () => 'unused').dailyMinutes(),
      );

      expect(find.text('Daily study time'), findsOneWidget);
      expect(find.text('20 min'), findsOneWidget);
      expect(
        tester.widget<AppListRow>(find.byType(AppListRow)).leading,
        isNull,
      );

      await tester.tap(find.text('Daily study time'));
      await tester.pumpAndSettle();
      await waitForPicker(tester);
      // A screen of its own, not a sheet, titled as the row.
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: find.text('Daily study time'),
        ),
        findsOneWidget,
      );
      // Back leaves the minutes as they were.
      await tester.tap(find.byTooltip('5 minutes more'));
      await tester.pumpAndSettle();
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(DailyMinutesPicker), findsNothing);
      expect(await stored(), isNull);
      expect(find.text('20 min'), findsOneWidget);

      await tester.tap(find.text('Daily study time'));
      await tester.pumpAndSettle();
      await waitForPicker(tester);
      await tester.tap(find.bySemanticsLabel('20 minutes a day, tap to type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '45');
      await tester.pumpAndSettle();
      await tester.tap(shownText('Save'));
      await tester.pumpAndSettle();

      expect(find.byType(DailyMinutesPicker), findsNothing);
      expect(await stored(), 45);
      expect(find.text('45 min'), findsOneWidget);
    },
  );

  testWidgets('in Korean the row reads 하루 학습 시간 and 20분', (tester) async {
    await _pumpRow(tester, locale: const Locale('ko'));

    expect(find.text('하루 학습 시간'), findsOneWidget);
    expect(find.text('20분'), findsOneWidget);
  });

  testWidgets(
    'the − and + move the minutes by 5 within 5 to 180, each disabled at its bound, read by their names',
    (tester) async {
      await _pumpRow(tester);
      await tester.tap(find.text('Daily study time'));
      await tester.pumpAndSettle();
      await waitForPicker(tester);
      IconButton step(String tooltip) => tester.widget<IconButton>(
        find.widgetWithIcon(IconButton, switch (tooltip) {
          '5 minutes less' => LucideIcons.minus,
          _ => LucideIcons.plus,
        }),
      );

      expect(find.byTooltip('5 minutes less'), findsOneWidget);
      expect(find.byTooltip('5 minutes more'), findsOneWidget);
      await tester.tap(find.byTooltip('5 minutes more'));
      await tester.pumpAndSettle();
      expect(
        find.bySemanticsLabel('25 minutes a day, tap to type'),
        findsOneWidget,
      );
      for (var i = 0; i < 4; i++) {
        await tester.tap(find.byTooltip('5 minutes less'));
        await tester.pumpAndSettle();
      }
      expect(find.text('5'), findsOneWidget);
      expect(step('5 minutes less').onPressed, isNull);
      // A tap gives no step the focus, so reaching the bound hands none.
      expect(step('5 minutes more').focusNode!.hasFocus, isFalse);
      // Control: the other step stays enabled.
      expect(step('5 minutes more').onPressed, isNotNull);

      await tester.tap(find.bySemanticsLabel('5 minutes a day, tap to type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '180');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.text('180'), findsOneWidget);
      expect(step('5 minutes more').onPressed, isNull);
      expect(step('5 minutes less').onPressed, isNotNull);
    },
  );

  testWidgets(
    'a step disabled at its bound under the keyboard focus hands the focus to the other',
    (tester) async {
      await _pumpRow(tester);
      await tester.tap(find.text('Daily study time'));
      await tester.pumpAndSettle();
      await waitForPicker(tester);
      await tester.tap(find.bySemanticsLabel('20 minutes a day, tap to type'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '175');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      FocusNode node(IconData icon) => tester
          .widget<IconButton>(find.widgetWithIcon(IconButton, icon))
          .focusNode!;
      node(LucideIcons.plus).requestFocus();
      await tester.pump();
      expect(node(LucideIcons.plus).hasFocus, isTrue);

      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();

      expect(find.text('180'), findsOneWidget);
      expect(node(LucideIcons.minus).hasFocus, isTrue);
      // Control: a step that does not reach a bound keeps the focus.
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('175'), findsOneWidget);
      expect(node(LucideIcons.minus).hasFocus, isTrue);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(find.text('170'), findsOneWidget);
      expect(node(LucideIcons.minus).hasFocus, isTrue);
    },
  );

  testWidgets(
    'at twice the text size the sheet and its keypad field lay out without overflow',
    (tester) async {
      tester.platformDispatcher.textScaleFactorTestValue = 2;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await _pumpRow(tester);

      await tester.tap(find.text('Daily study time'));
      await tester.pumpAndSettle();
      await waitForPicker(tester);
      await tester.tap(find.bySemanticsLabel('20 minutes a day, tap to type'));
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
