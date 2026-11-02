import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/sharing/sharing.dart';

import '../home/home_data.dart';
import 'fakes.dart';
import '../study/study_storage.dart';

/// The home screen over an in-memory database, with sharing through a
/// substituted server and network state, and study over the same database.
class SharingApp {
  SharingApp._(this.tester, this.db, this.decks, this.server, this.network)
    : _semantics = tester.ensureSemantics();

  final WidgetTester tester;
  final AppDatabase db;
  final DeckRepository decks;
  final FakeSharingServer server;
  final FakeReachability network;
  final SemanticsHandle _semantics;
  var _closed = false;

  /// Opens the deck list holding a deck for each of [myDecks], each with a
  /// card for each of its entries, front to back.
  static Future<SharingApp> open(
    WidgetTester tester, {
    FakeSharingServer? server,
    bool online = true,
    Map<String, Map<String, String>> myDecks = const {},
    ThemeMode themeMode = ThemeMode.light,
  }) async {
    driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
    final db = AppDatabase(NativeDatabase.memory());
    addTearDown(db.close);
    var ids = 0;
    var tick = 0;
    final decks = DeckRepository(
      db,
      clock: () => DateTime.utc(2026, 10, 15).add(Duration(seconds: tick++)),
      newId: () => 'id${ids++}',
    );
    await tester.runAsync(() async {
      for (final MapEntry(key: name, value: cards) in myDecks.entries) {
        final deck = await decks.createDeck(name);
        for (final MapEntry(key: front, value: back) in cards.entries) {
          await decks.addCard(
            deck.id,
            front: [TextContent(front)],
            back: [TextContent(back)],
          );
        }
      }
    });
    final app = SharingApp._(
      tester,
      db,
      decks,
      server ?? FakeSharingServer(),
      FakeReachability(online),
    );
    // A test that fails before closing still unmounts.
    addTearDown(app.close);
    final sharing = SharingService(
      server: app.server,
      decks: decks,
      reachability: app.network,
      clock: () => DateTime.utc(2026, 10, 15, 12),
    );
    final storage = await openStudyStorage(tester);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          deckRepositoryProvider.overrideWithValue(decks),
          sharingServiceProvider.overrideWithValue(sharing),
          ...homeOverrides(db, storage: storage),
        ],
        child: MaterialApp(
          theme: lightTheme,
          darkTheme: darkTheme,
          themeMode: themeMode,
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const HomeScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
    // The decks tab, where the user's decks are listed, once there is one.
    if (find.text('Notes').evaluate().isNotEmpty) await app.tapText('Notes');
    return app;
  }

  Future<void> tap(Finder finder) async {
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Future<void> tapText(String text) => tap(find.text(text));

  /// Opens the browse screen from the decks tab, or from the first-run home
  /// before the first deck.
  Future<void> browse() => tapText('Browse public notes');

  /// Opens the deck menu of the open screen, then the item [item].
  Future<void> deckMenu(String item) async {
    await tap(find.byTooltip('Note actions'));
    await tapText(item);
  }

  /// The cards of the user's deck named [name], as front, back and source.
  Future<List<(String, String, CardSource)>> cardsOf(String name) async =>
      (await tester.runAsync(() async {
        final deck = (await decks.watchDecks().first).singleWhere(
          (deck) => deck.name == name,
        );
        return [
          for (final card in await decks.listCards(deck.id))
            (plainText(card.front), plainText(card.back), card.source),
        ];
      }))!;

  /// Checks the tap target and contrast guidelines on what is shown.
  Future<void> meetsGuidelines() async {
    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
    await expectLater(tester, meetsGuideline(textContrastGuideline));
  }

  /// Unmounts the app. Unmounting cancels drift's stream queries, whose
  /// cleanup timer must fire before the test body ends.
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
    _semantics.dispose();
  }
}
