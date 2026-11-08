import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/assistant.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/home/src/home_screen.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:knowno/sync/sync.dart';

import '../assistant/fakes.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';
import 'home_data.dart';

/// A sync that only counts its runs.
final class _CountingSync extends Fake implements SyncController {
  var runs = 0;

  @override
  Future<void> sync() async => runs++;
}

/// What [_openHome] opened: the sync it counts, the id of the first note, and
/// how to close it.
final class _Opened {
  _Opened(this.sync, this.firstDeck, this._tester, this._semantics);

  final _CountingSync sync;
  final DeckId? firstDeck;
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

/// 홈 over a database holding [decks] and, with [client], the assistant over
/// [stored] chat; the first note's id is the first deck's.
Future<_Opened> _openHome(
  WidgetTester tester, {
  List<String> decks = const [],
  AssistantClient? client,
  Map<String, Object> stored = const {},
  Locale locale = const Locale('en'),
  double textScale = 1,
  ThemeMode themeMode = ThemeMode.light,
  bool semantics = false,
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
  final created = (await tester.runAsync(
    () async => [
      for (final name in decks) (await repository.createDeck(name)).id,
    ],
  ))!;
  final storage = await openStudyStorage(tester);
  final assistantStorage = await openAssistantStorage(tester, stored);
  final sync = _CountingSync();
  final handle = semantics ? tester.ensureSemantics() : null;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        deckRepositoryProvider.overrideWithValue(repository),
        ...homeOverrides(db, storage: storage),
        syncControllerProvider.overrideWithValue(sync),
        assistantClientProvider.overrideWithValue(client),
        assistantStorageProvider.overrideWithValue(assistantStorage),
      ],
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: const HomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return _Opened(sync, created.firstOrNull, tester, handle);
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets('invites the first note through 말랑이 where the app has one', (
    tester,
  ) async {
    final home = await _openHome(tester, client: FakeAssistantClient());
    expect(shownText('Make your first note with Malangi'), findsOneWidget);
    expect(shownText('Create a note'), findsNothing);
    await tester.tap(shownText('Make your first note with Malangi'));
    await tester.pumpAndSettle();
    expect(shownText('What shall we memorise?'), findsOneWidget);
    await home.close();
  });

  testWidgets(
    'keeps "Create a note" on the first run where the app has no assistant',
    (tester) async {
      final home = await _openHome(tester, semantics: true);
      expect(shownText('Create a note'), findsOneWidget);
      expect(shownText('Make your first note with Malangi'), findsNothing);
      expect(find.bySemanticsLabel('Chat with Malangi'), findsNothing);
      await home.close();
    },
  );

  testWidgets(
    'makes the hero mascot a button named "Chat with Malangi" that opens the chat',
    (tester) async {
      final home = await _openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        semantics: true,
      );
      final mascot = find.bySemanticsLabel('Chat with Malangi');
      expect(mascot, findsOneWidget);
      expect(
        tester.getSemantics(mascot),
        matchesSemantics(
          label: 'Chat with Malangi',
          isButton: true,
          hasTapAction: true,
        ),
      );
      await tester.tap(mascot);
      await tester.pumpAndSettle();
      expect(shownText('What shall we memorise?'), findsOneWidget);
      // Back from the chat is 홈 again.
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(shownText('What shall we memorise?'), findsNothing);
      await home.close();
    },
  );

  testWidgets(
    'says over the mascot how many cards 말랑이 has ready, and the bubble opens the chat',
    (tester) async {
      final home = await _openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(),
        semantics: true,
      );
      expect(shownText('3 cards ready'), findsOneWidget);
      // The mascot's name carries the bubble's words for a screen reader.
      expect(
        find.bySemanticsLabel('Chat with Malangi, 3 cards ready'),
        findsOneWidget,
      );
      await tester.tap(shownText('3 cards ready'));
      await tester.pumpAndSettle();
      expect(shownText('What shall we memorise?'), findsNothing);
      expect(shownText('만들었어요'), findsOneWidget);
      await home.close();
    },
  );

  testWidgets(
    'shows no bubble before a proposal, once its cards are added, or for changes',
    (tester) async {
      Future<void> opened(Map<String, Object> stored) async {
        final home = await _openHome(
          tester,
          decks: ['Alpha'],
          client: FakeAssistantClient(),
          stored: stored,
        );
        expect(shownTextContaining('ready'), findsNothing, reason: '$stored');
        await home.close();
      }

      await opened(const {});
      await opened(storedChatWithProposal(added: (id: 'deck0', name: 'N')));
      await opened(storedChatWithProposal(changes: true));
      // Control: the same chat, its cards not yet added, shows the bubble.
      final home = await _openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(),
      );
      expect(shownText('3 cards ready'), findsOneWidget);
      await home.close();
    },
  );

  testWidgets(
    'opens a note the chat added over the chat, and back returns to the chat',
    (tester) async {
      final home = await _openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(added: (id: 'deck0', name: 'Alpha')),
      );
      expect(home.firstDeck, const DeckId('deck0'), reason: 'the note exists');
      await tester.tap(find.byType(Mascot));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Alpha'));
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsOneWidget);
      expect(home.sync.runs, greaterThan(0), reason: 'the cards come by sync');
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsNothing);
      expect(shownText('만들었어요'), findsOneWidget, reason: 'the same chat');
      await home.close();
    },
  );

  testWidgets(
    'says a note that has not reached the device yet is not there, after a sync',
    (tester) async {
      final home = await _openHome(
        tester,
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(added: (id: 'elsewhere', name: 'Far')),
      );
      await tester.tap(shownText('Make your first note with Malangi'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Far'));
      await tester.pumpAndSettle();
      expect(home.sync.runs, 1);
      expect(find.byType(DeckScreen), findsNothing);
      expect(
        shownText('The note has not loaded yet. Try again in a moment.'),
        findsOneWidget,
      );
      await home.close();
    },
  );

  for (final (mode, scale) in [
    (ThemeMode.light, 1.0),
    (ThemeMode.dark, 1.0),
    (ThemeMode.light, 3.12),
    (ThemeMode.dark, 3.12),
  ]) {
    testWidgets(
      'draws the bubble over the mascot inside the screen, $mode at $scale',
      (tester) async {
        final home = await _openHome(
          tester,
          decks: ['Alpha'],
          client: FakeAssistantClient(),
          stored: storedChatWithProposal(),
          themeMode: mode,
          textScale: scale,
        );
        final bubble = tester.getRect(shownText('3 cards ready'));
        expect(bubble.left, greaterThanOrEqualTo(0));
        expect(bubble.right, lessThanOrEqualTo(390));
        await home.close();
      },
    );
  }
}
