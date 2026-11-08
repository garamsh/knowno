import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/assistant/assistant.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/home/src/deck_screen.dart';

import '../assistant/fakes.dart';
import '../word_breaks.dart';
import 'assistant_home.dart';

const _hint = 'Tap Malangi to chat any time';

final _edges = find.byType(EdgeAssistant);

/// The edge character's mascot: the only one that breathes at its size, which
/// a note's empty state does not.
final _character = find.byWidgetPredicate(
  (widget) => widget is Mascot && widget.breathes,
);

/// Shows the tab named [name] in the bar.
Future<void> _tab(WidgetTester tester, String name) async {
  await tester.tap(
    find.descendant(
      of: find.bySemanticsLabel(RegExp(r'^(Tabs|탭)$')),
      matching: shownText(name),
    ),
  );
  await tester.pumpAndSettle();
}

/// Opens the note named [name] on the 노트 tab.
Future<void> _note(WidgetTester tester, String name) async {
  await tester.tap(shownText(name));
  await tester.pumpAndSettle();
}

Future<void> _menu(WidgetTester tester, String tooltip) async {
  await tester.tap(find.byTooltip(tooltip));
  await tester.pumpAndSettle();
}

/// The first vertical scroll view on screen, to its end.
Future<void> _scrollToEnd(WidgetTester tester) async {
  final list = find
      .byWidgetPredicate((w) => w is Scrollable && w.axis == Axis.vertical)
      .first;
  await tester.drag(list, const Offset(0, -20000));
  await tester.pumpAndSettle(edgeReturnDelay * 4);
}

/// Where every control and every line of text on screen is, but the hint's
/// own close button: what the user presses and reads.
List<Rect> _controls(WidgetTester tester) {
  final own = find.byTooltip('Dismiss the hint');
  final ownRect = own.evaluate().isEmpty ? null : tester.getRect(own);
  return [
    for (final finder in [
      find.byType(InkWell),
      find.byType(IconButton),
      find.byType(ButtonStyleButton),
      find.byType(TextField),
      // What the user reads: the character never covers a line either.
      find.byType(RichText),
    ])
      for (final element in finder.evaluate())
        if (tester.getRect(find.byWidget(element.widget)) case final rect
            when rect != ownRect &&
                rect.overlaps(Offset.zero & const Size(390, 844)))
          rect,
  ];
}

/// The controls the character, at its rest, sits over.
List<Rect> _covered(WidgetTester tester) {
  final character = tester.getRect(_character);
  return [
    for (final rect in _controls(tester))
      if (rect.overlaps(character)) rect,
  ];
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  testWidgets('is drawn on the 노트 tab, inside a note and on 기록, and not on 홈', (
    tester,
  ) async {
    final home = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      semantics: true,
    );
    expect(_edges, findsNothing, reason: '홈 has its big mascot instead');
    await _tab(tester, 'Notes');
    expect(_edges, findsOneWidget);
    await _note(tester, 'Alpha');
    expect(find.byType(DeckScreen), findsOneWidget);
    expect(_edges, findsOneWidget, reason: 'inside the note');
    await tester.pageBack();
    await tester.pumpAndSettle();
    await _tab(tester, 'Record');
    expect(_edges, findsOneWidget);
    await _tab(tester, 'Home');
    expect(_edges, findsNothing);
    await home.close();
  });

  testWidgets('is not drawn where the app has no assistant', (tester) async {
    final home = await openHome(tester, decks: ['Alpha'], semantics: true);
    await _tab(tester, 'Notes');
    expect(
      _edges,
      findsOneWidget,
      reason: 'the widget is there, drawing nothing',
    );
    expect(_character, findsNothing);
    await home.close();
  });

  testWidgets(
    'is not drawn on 설정 or the card editor, which cover the screens under them',
    (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        semantics: true,
      );
      await tester.tap(find.byType(ProfileButton));
      await tester.pumpAndSettle();
      expect(_edges, findsNothing);
      expect(_character, findsNothing);
      await tester.pageBack();
      await tester.pumpAndSettle();
      await _tab(tester, 'Notes');
      await _note(tester, 'Alpha');
      await _menu(tester, 'Note settings');
      await tester.tap(shownText('Add by hand'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Enter by hand'));
      await tester.pumpAndSettle();
      expect(find.byType(CardEditorScreen), findsOneWidget);
      expect(_edges, findsNothing);
      expect(_character, findsNothing);
      await home.close();
    },
  );

  group('직접 추가', () {
    testWidgets(
      'moves "Add card" into the note\'s ⋯, which opens the ways to add one',
      (tester) async {
        final home = await openHome(
          tester,
          decks: ['Alpha'],
          client: FakeAssistantClient(),
          semantics: true,
        );
        await _tab(tester, 'Notes');
        await _note(tester, 'Alpha');
        expect(shownText('Add card'), findsNothing, reason: 'no header action');
        await _menu(tester, 'Note settings');
        final items = tester.widgetList<MenuItemButton>(
          find.byType(MenuItemButton),
        );
        expect(
          items.first.child,
          isA<Text>().having((t) => t.data, 'text', 'Add by hand'),
        );
        await tester.tap(shownText('Add by hand'));
        await tester.pumpAndSettle();
        expect(
          shownText('Enter by hand'),
          findsOneWidget,
          reason: 'the add sheet',
        );
        await home.close();
      },
    );

    testWidgets('moves "New note" into the 노트 tab\'s ⋯', (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      expect(shownText('New note'), findsNothing, reason: 'no header action');
      await _menu(tester, 'Notes menu');
      await tester.tap(shownText('Add by hand'));
      await tester.pumpAndSettle();
      expect(find.byType(NewDeckScreen), findsOneWidget);
      await home.close();
    });

    testWidgets('keeps both header actions where the app has no assistant', (
      tester,
    ) async {
      final home = await openHome(tester, decks: ['Alpha'], semantics: true);
      await _tab(tester, 'Notes');
      expect(shownText('New note'), findsOneWidget);
      expect(shownText('Add by hand'), findsNothing);
      await _note(tester, 'Alpha');
      expect(shownText('Add card'), findsOneWidget);
      await home.close();
    });
  });

  group('the hint', () {
    testWidgets(
      'shows once a note exists, on the 노트 tab, and is gone for every screen once dismissed',
      (tester) async {
        final home = await openHome(
          tester,
          decks: ['Alpha'],
          client: FakeAssistantClient(),
          semantics: true,
        );
        await _tab(tester, 'Notes');
        expect(shownText(_hint), findsOneWidget);
        await tester.tap(find.byTooltip('Dismiss the hint'));
        await tester.pumpAndSettle();
        expect(shownText(_hint), findsNothing);
        expect(home.storage.getBool('assistant.hintShown'), isTrue);
        await _note(tester, 'Alpha');
        expect(shownText(_hint), findsNothing);
        await tester.pageBack();
        await tester.pumpAndSettle();
        await _tab(tester, 'Record');
        expect(shownText(_hint), findsNothing);
        await home.close();
      },
    );

    testWidgets('waits for a first note', (tester) async {
      final home = await openHome(
        tester,
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      expect(_edges, findsOneWidget);
      expect(shownText(_hint), findsNothing);
      await home.close();
    });

    testWidgets(
      'shows inside a note too, and goes where the character is tapped',
      (tester) async {
        final home = await openHome(
          tester,
          decks: ['Alpha'],
          client: FakeAssistantClient(),
          semantics: true,
        );
        await _tab(tester, 'Notes');
        await _note(tester, 'Alpha');
        expect(shownText(_hint), findsOneWidget);
        await tester.tap(_character);
        await tester.pumpAndSettle();
        expect(home.storage.getBool('assistant.hintShown'), isTrue);
        await home.close();
      },
    );
  });

  group('the chat from the edge', () {
    testWidgets('opens from the 노트 tab with no context', (tester) async {
      final client = FakeAssistantClient(scripts: [textReply('네')]);
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: client,
        semantics: true,
      );
      await _tab(tester, 'Notes');
      await tester.tap(_character);
      await tester.pumpAndSettle();
      expect(shownText('What shall we memorise?'), findsOneWidget);
      expect(shownTextContaining('From the note'), findsNothing);
      await tester.enterText(find.byType(TextField), '안녕');
      await tester.pump();
      await tester.tap(find.byTooltip('Send'));
      await tester.pumpAndSettle();
      expect(client.contexts, [null]);
      await home.close();
    });

    testWidgets(
      'opens from inside a note, naming it, and sends its id; back is the note',
      (tester) async {
        final client = FakeAssistantClient(scripts: [textReply('네')]);
        final home = await openHome(
          tester,
          decks: ['Alpha'],
          client: client,
          semantics: true,
        );
        await _tab(tester, 'Notes');
        await _note(tester, 'Alpha');
        await tester.tap(_character);
        await tester.pumpAndSettle();
        expect(shownText('From the note Alpha'), findsOneWidget);
        await tester.enterText(find.byType(TextField), '카드 더 만들어 줘');
        await tester.pump();
        await tester.tap(find.byTooltip('Send'));
        await tester.pumpAndSettle();
        expect(client.contexts, [home.firstDeck!.value]);
        await tester.pageBack();
        await tester.pumpAndSettle();
        expect(find.byType(DeckScreen), findsOneWidget);
        expect(shownText('Alpha'), findsWidgets);
        await home.close();
      },
    );

    testWidgets('draws no character on a note it opened over itself', (
      tester,
    ) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(added: (id: 'deck0', name: 'Alpha')),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      await tester.tap(_character);
      await tester.pumpAndSettle();
      await tester.tap(shownText('Alpha'));
      await tester.pumpAndSettle();
      expect(shownText('Add by hand'), findsNothing);
      expect(_edges, findsNothing);
      expect(_character, findsNothing);
      await home.close();
    });
  });

  group('never overlaps a control', () {
    testWidgets('at the foot of the 노트 tab', (tester) async {
      final names = [for (var i = 0; i < 12; i++) 'Note $i'];
      final home = await openHome(
        tester,
        decks: names,
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      // Control: at the top the character sits over a deck's row, so the check
      // can fail where the list has not been scrolled to its room.
      expect(_covered(tester), isNotEmpty);
      await _scrollToEnd(tester);
      expect(_controls(tester), hasLength(greaterThan(3)));
      expect(_covered(tester), isEmpty);
      await home.close();
    });

    testWidgets('at the foot of a note', (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        cardsPerDeck: 20,
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      await _note(tester, 'Alpha');
      expect(_covered(tester), isNotEmpty, reason: 'the control: at the top');
      await _scrollToEnd(tester);
      expect(shownText('Alpha front 19'), findsOneWidget);
      expect(_covered(tester), isEmpty);
      await home.close();
    });

    testWidgets('on 기록, over a note with no card and with cards', (
      tester,
    ) async {
      final home = await openHome(
        tester,
        decks: ['Alpha', 'Beta'],
        cardsPerDeck: 3,
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Record');
      await _scrollToEnd(tester);
      expect(_covered(tester), isEmpty);
      await home.close();
    });

    testWidgets('on a note with no card, and the 노트 tab with none', (
      tester,
    ) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        semantics: true,
      );
      await _tab(tester, 'Notes');
      await _note(tester, 'Alpha');
      expect(_covered(tester), isEmpty);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(_covered(tester), isEmpty);
      await home.close();
    });
  });
}
