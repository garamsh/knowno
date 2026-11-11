import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';

import '../assistant/fakes.dart';
import '../word_breaks.dart';
import 'assistant_home.dart';

const _cards = 'Want to turn what you learned today into cards?';
const _done = 'Great work today.';
const _plain = 'Let\'s talk with Malangi';

/// The bubble's lines, any of which on screen is the chat bubble.
final _any = find.byWidgetPredicate(
  (widget) =>
      widget is Text &&
      const {_cards, _done, _plain}.contains(
        (widget.data ?? widget.textSpan?.toPlainText())?.replaceAll(
          '\u2060',
          '',
        ),
      ),
);

/// Time passes, and what it started is drawn.
Future<void> _wait(WidgetTester tester, Duration time) async {
  await tester.pump(time);
  await tester.pump();
}

/// Pumps in steps of 50 ms until the bubble is drawn, and says when; it
/// fails if it is not drawn by [within].
Future<DateTime> _untilShown(
  WidgetTester tester, {
  Duration within = const Duration(seconds: 5),
}) async {
  final end = tester.binding.clock.now().add(within);
  while (_any.evaluate().isEmpty) {
    expect(tester.binding.clock.now().isBefore(end), isTrue, reason: 'shown');
    await _wait(tester, const Duration(milliseconds: 50));
  }
  return tester.binding.clock.now();
}

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

const _wait1 = Duration(milliseconds: 1500);
const _stay = Duration(seconds: 6);
const _fade = Duration(milliseconds: 300);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;
  var now = DateTime(2026, 10, 15, 9);
  setUp(() => now = DateTime(2026, 10, 15, 9));

  testWidgets(
    'comes a moment after 홈 shows, spends the day, and fades after about 6 s',
    (tester) async {
      final opening = tester.binding.clock.now();
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        clock: () => now,
      );
      await _wait(tester, _wait1 - const Duration(milliseconds: 300));
      expect(_any, findsNothing, reason: 'not at once');
      expect(home.storage.getString('assistant.inviteDay'), isNull);
      final shownAt = await _untilShown(tester);
      expect(
        shownAt.difference(opening),
        greaterThanOrEqualTo(_wait1),
        reason: 'a moment after 홈 appears',
      );
      expect(shownText(_plain), findsOneWidget);
      expect(home.storage.getString('assistant.inviteDay'), '2026-10-15');
      await _wait(tester, _stay - const Duration(milliseconds: 150));
      expect(shownText(_plain), findsOneWidget, reason: 'still there');
      await _wait(tester, const Duration(milliseconds: 300) + _fade);
      expect(_any, findsNothing, reason: 'faded after about 6 s');
      await home.close();
    },
  );

  testWidgets('shows once a day, and again the next', (tester) async {
    final today = {'assistant.inviteDay': '2026-10-15'};
    var home = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      stored: today,
      clock: () => now,
    );
    await _wait(tester, _wait1 * 2);
    expect(_any, findsNothing, reason: 'it showed today already');
    expect(today['assistant.inviteDay'], '2026-10-15');
    await home.close();
    // Control: the same device the next local day.
    now = DateTime(2026, 10, 16, 0, 5);
    home = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      stored: today,
      clock: () => now,
    );
    await _untilShown(tester);
    expect(shownText(_plain), findsOneWidget);
    expect(home.storage.getString('assistant.inviteDay'), '2026-10-16');
    await home.close();
  });

  group('its line', () {
    for (final (state, line) in [('today', _cards), ('done', _done)]) {
      testWidgets('is "$line" on 홈 $state', (tester) async {
        final home = await openHome(
          tester,
          heroState: state,
          client: FakeAssistantClient(),
          clock: () => now,
        );
        await _untilShown(tester);
        expect(shownText(line), findsOneWidget);
        expect(_any, findsOneWidget, reason: 'no other line beside it');
        await home.close();
      });
    }

    testWidgets('is the plain line with no card, and before a first note', (
      tester,
    ) async {
      for (final decks in [
        <String>['Alpha'],
        <String>[],
      ]) {
        final home = await openHome(
          tester,
          decks: decks,
          client: FakeAssistantClient(),
          clock: () => now,
        );
        await _untilShown(tester);
        expect(shownText(_plain), findsOneWidget, reason: '$decks');
        await home.close();
      }
    });
  });

  testWidgets('opens the chat when tapped', (tester) async {
    final home = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      clock: () => now,
    );
    await _untilShown(tester);
    await _wait(tester, _fade);
    await tester.tap(shownText(_plain));
    await tester.pumpAndSettle();
    expect(shownText('What shall we memorise?'), findsOneWidget);
    await home.close();
  });

  testWidgets(
    'gives way to the ready bubble, and keeps the day for when it is gone',
    (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        stored: storedChatWithProposal(),
        clock: () => now,
      );
      await _wait(tester, _wait1 + _stay + _fade);
      expect(shownText('3 cards ready'), findsOneWidget);
      expect(_any, findsNothing);
      expect(
        home.storage.getString('assistant.inviteDay'),
        isNull,
        reason: 'the day is not spent unseen',
      );
      await home.close();
      // Control: the same 홈 with no proposal ready says its line and spends
      // the day.
      final clear = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        clock: () => now,
      );
      await _untilShown(tester);
      expect(shownText(_plain), findsOneWidget);
      expect(shownText('3 cards ready'), findsNothing);
      expect(clear.storage.getString('assistant.inviteDay'), '2026-10-15');
      await clear.close();
    },
  );

  testWidgets('is not drawn where the app has no assistant', (tester) async {
    final home = await openHome(tester, decks: ['Alpha'], clock: () => now);
    await _wait(tester, _wait1 + _stay);
    expect(_any, findsNothing);
    await home.close();
    // Control: the same 홈 with an assistant says its line.
    final withOne = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      clock: () => now,
    );
    await _untilShown(tester);
    expect(shownText(_plain), findsOneWidget);
    await withOne.close();
  });

  testWidgets('waits while another tab shows, and comes when 홈 is back', (
    tester,
  ) async {
    final home = await openHome(
      tester,
      decks: ['Alpha'],
      client: FakeAssistantClient(),
      semantics: true,
      clock: () => now,
    );
    await _tab(tester, 'Notes');
    await _wait(tester, _wait1 * 2);
    expect(home.storage.getString('assistant.inviteDay'), isNull);
    await _tab(tester, 'Home');
    await _untilShown(tester);
    expect(shownText(_plain), findsOneWidget);
    await home.close();
  });

  group('under reduce motion', () {
    Finder fading() =>
        find.ancestor(of: _any, matching: find.byType(AnimatedOpacity));

    testWidgets('appears and goes with no fade', (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        reduceMotion: true,
        clock: () => now,
      );
      await _untilShown(tester);
      final shown = tester.widget<AnimatedOpacity>(fading());
      expect(shown.opacity, 1, reason: 'whole in its first frame');
      expect(shown.duration, Duration.zero);
      await _wait(tester, _stay - const Duration(milliseconds: 150));
      expect(_any, findsOneWidget);
      await _wait(tester, const Duration(milliseconds: 300));
      expect(_any, findsNothing, reason: 'gone with no fade frames');
      await home.close();
    });

    testWidgets('control: otherwise it fades in and out', (tester) async {
      final home = await openHome(
        tester,
        decks: ['Alpha'],
        client: FakeAssistantClient(),
        clock: () => now,
      );
      await _untilShown(tester);
      await _wait(tester, const Duration(milliseconds: 100));
      final shown = tester.widget<AnimatedOpacity>(fading());
      expect(shown.duration, _fade);
      expect(shown.opacity, 1);
      await _wait(tester, _stay - const Duration(milliseconds: 50));
      expect(_any, findsOneWidget, reason: 'fading, not yet gone');
      expect(tester.widget<AnimatedOpacity>(fading()).opacity, 0);
      await _wait(tester, _fade);
      expect(_any, findsNothing);
      await home.close();
    });
  });
}
