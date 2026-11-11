import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/assistant_client.dart';
import 'package:knowno/assistant/src/conversation.dart';
import 'package:knowno/assistant/src/protocol.dart';
import 'package:knowno/design/mascot.dart';

import '../word_breaks.dart';
import 'fakes.dart';

final _dot = find.byKey(const ValueKey('typing-dot-0'));

Finder get _name => shownText('Malangi');

/// The profiles on screen, the mascots in them.
Finder get _profiles => find.byType(Mascot);

Future<void> _send(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
  await tester.tap(find.byTooltip('Send'));
  await tester.pump();
  await tester.pump();
}

/// A delivery of [event] to a streamed reply, drawn.
Future<void> _deliver(
  WidgetTester tester,
  StreamController<AssistantEvent> feed,
  AssistantEvent event,
) async {
  feed.add(event);
  await tester.pump();
  await tester.pump();
}

MascotExpression _lowestFace(WidgetTester tester) =>
    (tester.widgetList<Mascot>(_profiles).toList()..sort(
          (a, b) => tester
              .getTopLeft(find.byWidget(b))
              .dy
              .compareTo(tester.getTopLeft(find.byWidget(a)).dy),
        ))
        .first
        .expression;

/// Where the first dot is, which moves while the dots rise.
double _dotTop(WidgetTester tester) => tester.getTopLeft(_dot).dy;

void main() {
  group('the typing bubble', () {
    testWidgets(
      'shows from the send, before the server answers, and goes on the first text',
      (tester) async {
        // The server answers its headers only after it has read the session,
        // the skills and the day's budget; the reply's turn does not exist
        // until then.
        final headers = Completer<SendOutcome>();
        final feed = StreamController<AssistantEvent>();
        final client = FakeAssistantClient(
          scripts: [
            (abort) async {
              final outcome = await headers.future;
              return outcome;
            },
          ],
        );
        await pumpChat(tester, client, await openAssistantStorage(tester));
        expect(_dot, findsNothing, reason: 'nothing is being made yet');
        await _send(tester, '영단어 만들어 줘');
        expect(headers.isCompleted, isFalse);
        expect(_dot, findsOneWidget);
        expect(find.byKey(const ValueKey('typing-dot-2')), findsOneWidget);
        expect(_name, findsNWidgets(2), reason: 'the title and the profile');
        expect(_lowestFace(tester), MascotExpression.thinking);
        headers.complete(SendStarted(feed.stream));
        await tester.pump();
        await tester.pump();
        expect(_dot, findsOneWidget, reason: 'still no text');
        await _deliver(tester, feed, const TextDelta('좋아요'));
        expect(_dot, findsNothing);
        expect(shownTextContaining('좋아요'), findsOneWidget);
        expect(_name, findsNWidgets(2), reason: 'the reply keeps the profile');
        await feed.close();
        await tester.pumpAndSettle();
      },
    );

    testWidgets('shows beside the passing line the server sends', (
      tester,
    ) async {
      final feed = StreamController<AssistantEvent>();
      final client = FakeAssistantClient(scripts: [streaming(feed)]);
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '찾아 줘');
      await _deliver(tester, feed, const TextDelta('찾아볼게요'));
      await _deliver(tester, feed, const InterimEvent());
      expect(_dot, findsOneWidget);
      expect(shownText('찾아볼게요'), findsOneWidget);
      await feed.close();
      await tester.pumpAndSettle();
    });

    testWidgets('goes on a refusal', (tester) async {
      final headers = Completer<SendOutcome>();
      final client = FakeAssistantClient(scripts: [(_) => headers.future]);
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '안녕');
      expect(_dot, findsOneWidget);
      headers.complete(const SendRefused(Unreachable()));
      await tester.pumpAndSettle();
      expect(_dot, findsNothing);
      expect(shownText('Try again'), findsOneWidget);
    });

    testWidgets('goes on stop, before any text and after a turn exists', (
      tester,
    ) async {
      final headers = Completer<SendOutcome>();
      final client = FakeAssistantClient(
        scripts: [
          (abort) async {
            // The abort ends the request as the HTTP client's does.
            final outcome = await Future.any([
              headers.future,
              abort.then((_) => const SendAborted() as SendOutcome),
            ]);
            return outcome;
          },
        ],
      );
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '긴 얘기 해 줘');
      expect(_dot, findsOneWidget);
      await tester.tap(find.byTooltip('Stop'));
      await tester.pumpAndSettle();
      expect(_dot, findsNothing);
      expect(find.byTooltip('Send'), findsOneWidget);
    });

    testWidgets('goes on stop once the turn exists with no text yet', (
      tester,
    ) async {
      final feed = StreamController<AssistantEvent>();
      final client = FakeAssistantClient(scripts: [streaming(feed)]);
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '긴 얘기 해 줘');
      expect(_dot, findsOneWidget);
      await tester.tap(find.byTooltip('Stop'));
      await tester.pumpAndSettle();
      expect(_dot, findsNothing);
      expect(shownText('Stopped.'), findsOneWidget);
    });

    testWidgets('rises in turn, and stands still under reduce motion', (
      tester,
    ) async {
      final feed = StreamController<AssistantEvent>();
      final client = FakeAssistantClient(scripts: [streaming(feed)]);
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '안녕');
      final dots = [
        for (var at = 0; at < 3; at++) find.byKey(ValueKey('typing-dot-$at')),
      ];
      List<double> tops() => [
        for (final dot in dots) tester.getTopLeft(dot).dy,
      ];
      final before = tops();
      await tester.pump(const Duration(milliseconds: 150));
      final after = tops();
      expect(after[0], lessThan(before[0]), reason: 'the first dot rises');
      expect(after[2], before[2], reason: 'the third has not started');
      await tester.pumpWidget(const SizedBox());
      await feed.close();
    });

    testWidgets('stands still under reduce motion', (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      final feed = StreamController<AssistantEvent>();
      final client = FakeAssistantClient(scripts: [streaming(feed)]);
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '안녕');
      expect(_dot, findsOneWidget);
      final before = _dotTop(tester);
      await tester.pump(const Duration(milliseconds: 150));
      await tester.pump(const Duration(milliseconds: 300));
      expect(_dotTop(tester), before);
      // The reply is not waited on: nothing is animating, so the test settles.
      expect(tester.hasRunningAnimations, isFalse);
      await feed.close();
      await tester.pumpAndSettle();
    });
  });

  group('the profile', () {
    final run = Conversation(
      turns: const [
        UserTurn(id: 'u1', text: '단어 만들어 줘'),
        AssistantTurn(id: 'a1', text: '첫 번째', ending: Ending.ok),
        AssistantTurn(id: 'a2', text: '두 번째', ending: Ending.ok),
        UserTurn(id: 'u2', text: '고마워'),
        AssistantTurn(id: 'a3', text: '세 번째', ending: Ending.ok),
      ],
    ).encode();

    testWidgets('and the name are on a run\'s first bubble only', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester, {'assistant.conversation': run}),
      );
      // Two runs, so two profiles and, with the title, three names.
      expect(_profiles, findsNWidgets(2));
      expect(_name, findsNWidgets(3));
      final profileY = [
        for (final mascot in _profiles.evaluate())
          tester.getTopLeft(find.byWidget(mascot.widget)).dy,
      ]..sort();
      final first = tester.getTopLeft(shownTextContaining('첫 번째')).dy;
      final second = tester.getTopLeft(shownTextContaining('두 번째')).dy;
      final third = tester.getTopLeft(shownTextContaining('세 번째')).dy;
      // The profile sits at the first bubble of its run, left of it.
      expect(profileY.first, lessThan(first));
      expect(profileY.first, greaterThan(first - 60));
      expect(profileY.last, lessThan(third));
      expect(profileY.last, greaterThan(third - 60));
      expect(second, greaterThan(first));
      expect(
        tester.getTopLeft(shownTextContaining('첫 번째')).dx,
        tester.getTopLeft(shownTextContaining('두 번째')).dx,
        reason: 'a later bubble stays beside where the profile was',
      );
      expect(
        tester.getTopLeft(find.byWidget(_profiles.evaluate().first.widget)).dx,
        lessThan(tester.getTopLeft(shownTextContaining('첫 번째')).dx),
      );
    });

    testWidgets('takes the face of the state, the last run alone', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(
          scripts: [
            reply([const ErrorEvent(ReplyError.modelError)]),
            refuse(const RateLimited(null)),
          ],
        ),
        await openAssistantStorage(tester, {'assistant.conversation': run}),
      );
      expect(_lowestFace(tester), MascotExpression.thinking);
      await _send(tester, '또');
      await tester.pumpAndSettle();
      expect(_lowestFace(tester), MascotExpression.sad);
      expect(
        [
          for (final one in tester.widgetList<Mascot>(_profiles))
            one.expression,
        ],
        containsAll([MascotExpression.sad, MascotExpression.thinking]),
        reason: 'the earlier run keeps its face',
      );
      await _send(tester, '다시');
      await tester.pumpAndSettle();
      expect(_lowestFace(tester), MascotExpression.sleepy);
    });

    testWidgets('of a refusal with no reply before it takes the sleepy face', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(scripts: [refuse(const RateLimited(null))]),
        await openAssistantStorage(tester),
      );
      await _send(tester, '안녕');
      await tester.pumpAndSettle();
      expect(_profiles, findsOneWidget);
      expect(_lowestFace(tester), MascotExpression.sleepy);
    });
  });

  group('the top bar', () {
    testWidgets('holds no mascot, and centres 말랑이 with the share left', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
      );
      final bar = tester.getRect(find.byType(BackButton)).bottom;
      for (final mascot in tester.widgetList<Mascot>(_profiles)) {
        expect(
          tester.getTopLeft(find.byWidget(mascot)).dy,
          greaterThan(bar),
          reason: 'no mascot in the bar',
        );
      }
      final width =
          tester.view.physicalSize.width / tester.view.devicePixelRatio;
      final title = tester.getCenter(_name.first);
      final share = tester.getCenter(shownText('75% left today'));
      expect(title.dx, closeTo(width / 2, 0.5));
      expect(share.dx, closeTo(width / 2, 0.5));
      expect(share.dy, greaterThan(title.dy));
    });
  });

  group('the empty chat', () {
    testWidgets('is a large profile with the name and what to memorise', (
      tester,
    ) async {
      await pumpChat(
        tester,
        FakeAssistantClient(),
        await openAssistantStorage(tester),
      );
      expect(_profiles, findsOneWidget);
      expect(
        tester.getSize(find.byWidget(tester.widget(_profiles))).width,
        greaterThan(60),
      );
      expect(
        _name,
        findsNWidgets(2),
        reason: 'the title and under the profile',
      );
      final profile = tester.getBottomLeft(_profiles).dy;
      final ask = tester.getTopLeft(shownText('What shall we memorise?')).dy;
      expect(ask, greaterThan(profile));
      final field = tester.getTopLeft(find.byType(TextField)).dy;
      expect(ask, lessThan(field), reason: 'above the input');
    });
  });
}
