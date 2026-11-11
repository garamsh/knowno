import 'package:drift/native.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/assistant/assistant.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/photo_import/photo_import.dart' show PhotoSource;
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../assistant/fakes.dart';
import '../photo_import/fakes.dart' show openPreferences;
import '../study/study_storage.dart';
import 'hero_states.dart';
import 'home_data.dart';

/// A sync that only counts its runs.
final class CountingSync extends Fake implements SyncController {
  var runs = 0;

  @override
  Future<void> sync() async => runs++;

  @override
  ValueListenable<SyncStatus> get status => ValueNotifier(const SyncIdle());
}

/// What [openHome] opened: the sync it counts, the id of the first note, and
/// how to close it.
final class OpenedHome {
  OpenedHome(
    this.sync,
    this.firstDeck,
    this.storage,
    this._tester,
    this._semantics,
  );

  final CountingSync sync;
  final DeckId? firstDeck;

  /// The device storage the assistant keeps its chat and bubble day in.
  final SharedPreferencesWithCache storage;
  final WidgetTester _tester;
  final SemanticsHandle? _semantics;

  /// Unmounts 홈, whose notes' stream the database holds open, and lets the
  /// stream's cleanup timer fire before the test body ends.
  Future<void> close() async {
    await _tester.pumpWidget(const SizedBox());
    await _tester.pump(const Duration(seconds: 1));
    _semantics?.dispose();
  }
}

/// 홈 over a database holding [decks], or the cards of a `hero_states.dart`
/// state named [heroState], and, with [client], the assistant over
/// [stored] chat; the first note's id is the first deck's.
Future<OpenedHome> openHome(
  WidgetTester tester, {
  List<String> decks = const [],
  AssistantClient? client,
  Map<String, Object> stored = const {},
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeMode themeMode = ThemeMode.light,
  bool semantics = false,
  int cardsPerDeck = 0,
  PhotoSource? photoSource,
  DateTime Function()? clock,
  bool reduceMotion = false,
  String? heroState,
}) async {
  tester.view.physicalSize = const Size(390, 844);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  // Tear-downs run last first, so a screen a failed test left mounted is
  // unmounted before the database closes, which would otherwise hang the run
  // on the stream queries it holds.
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });
  var ids = 0;
  final repository = DeckRepository(
    db,
    clock: () => DateTime.utc(2026, 10, 15),
    newId: () => 'deck${ids++}',
  );
  final created = (await tester.runAsync(() async {
    final ids = [
      for (final name in heroState == null ? decks : heroNotesOf(heroState))
        await () async {
          final deck = await repository.createDeck(name);
          for (var i = 0; i < cardsPerDeck; i++) {
            await repository.addCard(
              deck.id,
              front: [TextContent('$name front $i')],
              back: [TextContent('$name back $i')],
            );
          }
          return deck.id;
        }(),
    ];
    if (heroState != null) {
      final minutes = await heroStates[heroState]!.$2(db, repository, ids);
      if (minutes != null) {
        await StudyRepository(
          db,
          newId: () => 'setting',
        ).setDailyMinutes(minutes, at: homeNow);
      }
    }
    return ids;
  }))!;
  final storage = await openStudyStorage(tester);
  final assistantStorage = await openAssistantStorage(tester, stored);
  final themePreferences = await openPreferences(tester);
  final sync = CountingSync();
  final handle = semantics ? tester.ensureSemantics() : null;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(repository),
        ...homeOverrides(db, storage: storage),
        syncControllerProvider.overrideWithValue(sync),
        appVersionProvider.overrideWithValue('1.0.0'),
        themeStorageProvider.overrideWithValue(themePreferences),
        assistantClientProvider.overrideWithValue(client),
        assistantStorageProvider.overrideWithValue(assistantStorage),
        assistantPhotoSourceProvider.overrideWithValue(photoSource),
        if (clock != null) assistantClockProvider.overrideWithValue(clock),
      ],
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        // A scale of 1 leaves the platform's, which a screenshot sets.
        builder: (context, child) => textScale == 1 && !reduceMotion
            ? child!
            : MediaQuery(
                data: MediaQuery.of(context).copyWith(
                  textScaler: textScale == 1
                      ? null
                      : TextScaler.linear(textScale),
                  disableAnimations: reduceMotion,
                ),
                child: child!,
              ),
        home: const HomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return OpenedHome(
    sync,
    created.firstOrNull,
    assistantStorage,
    tester,
    handle,
  );
}
