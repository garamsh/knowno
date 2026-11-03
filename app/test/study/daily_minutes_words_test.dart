import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/study/src/daily_minutes_sheet.dart';

import '../app_fonts.dart';
import '../home/home_data.dart';
import '../word_breaks.dart';
import 'minutes_sheet.dart';
import 'study_storage.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  setUpAll(loadAppFonts);
  final ko = lookupAppLocalizations(const Locale('ko'));

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale, in the bundled fonts, the '
      'second tile of 하루 학습 시간 breaks only between words, read as written',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
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
              locale: const Locale('ko'),
              localizationsDelegates: AppLocalizations.localizationsDelegates,
              supportedLocales: AppLocalizations.supportedLocales,
              home: const Scaffold(body: DailyMinutesRow()),
            ),
          ),
        );
        await tester.pumpAndSettle();
        await tester.tap(find.text(ko.dailyMinutesTitle));
        await tester.pumpAndSettle();
        await waitForPicker(tester, more: ko.dailyMinutesMore);

        // No card is left to start, so the tile says every one has started.
        expectBreaksBetweenWords(tester, ko.dailyMinutesAllStarted);
        expect(
          find.bySemanticsLabel(
            RegExp(RegExp.escape(ko.dailyMinutesAllStarted)),
          ),
          findsOneWidget,
        );
        // At the default size the tiles still sit side by side.
        double top(String title) => tester.getTopLeft(find.text(title)).dy;
        expect(
          top(ko.dailyMinutesFreshTitle) == top(ko.dailyMinutesAllTitle),
          scale == 1.0,
        );
      },
    );
  }
}
