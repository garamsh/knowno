import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/home/src/deck_screen.dart';

import '../assistant/fakes.dart';
import '../word_breaks.dart';
import 'assistant_home.dart';

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets('invites the first note through 말랑이 where the app has one', (
    tester,
  ) async {
    final home = await openHome(tester, client: FakeAssistantClient());
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
      final home = await openHome(tester, semantics: true);
      expect(shownText('Create a note'), findsOneWidget);
      expect(shownText('Make your first note with Malangi'), findsNothing);
      expect(find.bySemanticsLabel('Chat with Malangi'), findsNothing);
      await home.close();
    },
  );

  testWidgets(
    'makes the hero mascot a button named "Chat with Malangi" that opens the chat',
    (tester) async {
      final home = await openHome(
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
      final home = await openHome(
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
    'is met on 홈 alone: no character or hint on the 노트 tab, a note or 기록',
    (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        semantics: true,
      );
      final entry = find.bySemanticsLabel('Chat with Malangi');
      // Control: 홈 has it, so the check can fail.
      expect(entry, findsOneWidget);
      Future<void> tab(String name) async {
        await tester.tap(
          find.descendant(
            of: find.bySemanticsLabel(RegExp(r'^(Tabs|탭)$')),
            matching: shownText(name),
          ),
        );
        await tester.pumpAndSettle();
      }

      await tab('Notes');
      expect(entry, findsNothing);
      expect(shownText('Tap Malangi to chat any time'), findsNothing);
      expect(shownText('New note'), findsOneWidget, reason: 'as with none');
      await tester.tap(shownText('Alpha'));
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsOneWidget);
      expect(entry, findsNothing);
      expect(shownText('Add card'), findsOneWidget, reason: 'as with none');
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tab('Record');
      expect(entry, findsNothing);
      await home.close();
    },
  );

  testWidgets(
    'shows no bubble before a proposal, once its cards are added, or for changes',
    (tester) async {
      Future<void> opened(Map<String, Object> stored) async {
        final home = await openHome(
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
      final home = await openHome(
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
      final home = await openHome(
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
      final home = await openHome(
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
        final home = await openHome(
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
