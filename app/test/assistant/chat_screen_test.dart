import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/assistant_client.dart';
import 'package:knowno/assistant/src/assistant_controller.dart';
import 'package:knowno/assistant/src/conversation.dart';
import 'package:knowno/assistant/src/protocol.dart';
import 'package:knowno/assistant/src/providers.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/round_check.dart';

import '../word_breaks.dart';
import 'fakes.dart';

Future<void> _type(WidgetTester tester, String text) async {
  await tester.enterText(find.byType(TextField), text);
  await tester.pump();
}

Future<void> _send(WidgetTester tester, String text) async {
  await _type(tester, text);
  await tester.tap(find.byTooltip('Send'));
  await tester.pumpAndSettle();
}

Finder _text(String text) => shownText(text);

AssistantTurn _lastReply(ProviderContainer container) => container
    .read(assistantProvider)
    .conversation
    .turns
    .whereType<AssistantTurn>()
    .last;

MascotExpression _face(WidgetTester tester) =>
    tester.widget<Mascot>(find.byType(Mascot)).expression;

final _threeGroups = proposalOf(
  groups: [
    ('Unit 1', CardForm.senses, [('apple', '사과'), ('pear', '배')]),
    ('Unit 2', CardForm.cloze, [('{{c1::서울}}', '수도')]),
  ],
);

void main() {
  testWidgets('asks what to memorise and shows the share of the day left', (
    tester,
  ) async {
    final client = FakeAssistantClient();
    await pumpChat(tester, client, await openAssistantStorage(tester));
    expect(_text('What shall we memorise?'), findsOneWidget);
    expect(_text('75% left today'), findsOneWidget);
    expect(_face(tester), MascotExpression.thinking);
    // The menu's clear is disabled with nothing to clear.
    await tester.tap(find.byTooltip('Chat menu'));
    await tester.pumpAndSettle();
    expect(
      tester.widget<MenuItemButton>(find.byType(MenuItemButton)).onPressed,
      isNull,
    );
  });

  testWidgets('streams the reply in, then keeps the chat and its draft', (
    tester,
  ) async {
    final feed = StreamController<AssistantEvent>();
    final client = FakeAssistantClient(scripts: [streaming(feed)]);
    final storage = await openAssistantStorage(tester);
    final container = await pumpChat(tester, client, storage);
    await _send(tester, '영단어 만들어 줘');
    expect(_text('영단어 만들어 줘'), findsOneWidget);
    expect(_text('Malangi is thinking'), findsOneWidget);
    expect(client.sent.single, [
      {'role': 'user', 'text': '영단어 만들어 줘'},
    ]);
    feed.add(const TextDelta('좋아요, '));
    // A stream's event is delivered in a microtask, drawn by the next frame.
    await tester.pump();
    await tester.pump();
    expect(_text('좋아요, '), findsOneWidget);
    expect(find.byTooltip('Stop'), findsOneWidget);
    feed.add(const TextDelta('만들게요'));
    feed.add(const UsageEvent(Allowance(budget: 200000, used: 100000)));
    await feed.close();
    await tester.pumpAndSettle();
    expect(shownTextContaining('좋아요, 만들게요'), findsOneWidget);
    expect(_text('50% left today'), findsOneWidget);
    expect(find.byTooltip('Send'), findsOneWidget);

    // A draft typed and not sent is kept with the turns.
    await _type(tester, '다음엔');
    final stored = Conversation.parse(
      storage.getString('assistant.conversation'),
      draft: storage.getString('assistant.draft') ?? '',
    );
    expect(stored.turns, hasLength(2));
    expect(stored.draft, '다음엔');
    expect(_lastReply(container).ending, Ending.ok);

    // The chat opened anew, from what the device kept.
    await tester.pumpWidget(const SizedBox());
    final client2 = FakeAssistantClient();
    await pumpChat(tester, client2, storage);
    expect(shownTextContaining('좋아요, 만들게요'), findsOneWidget);
    expect(find.widgetWithText(TextField, '다음엔'), findsOneWidget);
  });

  testWidgets(
    'offers a question\'s options and sends the pick as the next message',
    (tester) async {
      final client = FakeAssistantClient(
        scripts: [
          reply([
            const TextDelta('어떤 형식으로 할까요?'),
            const ChoiceEvent(
              Choice(prompt: '형식은?', options: ['단어', '빈칸 문장', '알아서 섞어서']),
            ),
          ]),
          reply([const TextDelta('네')]),
        ],
      );
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '토익 단어');
      expect(_text('형식은?'), findsOneWidget);
      expect(_text('빈칸 문장'), findsOneWidget);
      await tester.tap(_text('빈칸 문장'));
      await tester.pumpAndSettle();
      expect(client.sent.last.last, {'role': 'user', 'text': '빈칸 문장'});
      // The question went back with its reply.
      expect(client.sent.last[1]['choice'], isNotNull);
      // Answered, its options are gone, but for the pick in the user's message;
      // the question stays.
      expect(_text('빈칸 문장'), findsOneWidget);
      expect(_text('단어'), findsNothing);
      expect(_text('알아서 섞어서'), findsNothing);
      expect(_text('형식은?'), findsOneWidget);
    },
  );

  testWidgets(
    'shows a proposal by groups with their form, and adds the cards checked',
    (tester) async {
      final client = FakeAssistantClient(
        scripts: [
          reply([const TextDelta('만들었어요'), ProposalEvent(_threeGroups)]),
        ],
      );
      final container = await pumpChat(
        tester,
        client,
        await openAssistantStorage(tester),
      );
      await _send(tester, '만들어 줘');
      expect(_text('New note · 영단어'), findsOneWidget);
      expect(_text('Unit 1'), findsOneWidget);
      expect(_text('Word'), findsOneWidget, reason: 'the first group\'s chip');
      expect(_text('Fill in the blank'), findsOneWidget);
      expect(_text('apple'), findsOneWidget);
      expect(_text('사과'), findsOneWidget);
      expect(_text('Add 3 cards'), findsOneWidget);

      await tester.tap(_text('pear'));
      await tester.pump();
      expect(_text('Add 2 cards'), findsOneWidget);
      // A group's check unchecks all its cards, and checks them again.
      await tester.tap(find.bySemanticsLabel('Select all of Unit 2'));
      await tester.pump();
      expect(_text('Add 1 card'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Select all of Unit 2'));
      await tester.pump();
      expect(_text('Add 2 cards'), findsOneWidget);
      await tester.tap(find.bySemanticsLabel('Select all of Unit 1'));
      await tester.pump();
      expect(_text('Add 3 cards'), findsOneWidget);

      await tester.tap(_text('pear'));
      await tester.tap(_text('서울'));
      await tester.pump();
      expect(_text('Add 1 card'), findsOneWidget);
      await tester.tap(_text('Add 1 card'));
      await tester.pumpAndSettle();
      expect(client.commits.single.checked, {
        'g0': ['g0-c0'],
        'g1': <String>[],
      });
      // Added: the checks and the action go, a shortcut to the note comes.
      expect(shownTextContaining('Add '), findsNothing);
      expect(find.byType(RoundCheck), findsNothing);
      expect(_text('영단어'), findsOneWidget);
      expect(_text('2 cards'), findsOneWidget);
      expect(_face(tester), MascotExpression.happy);
      expect(
        container.read(assistantProvider).conversation.ready,
        isNull,
        reason: 'nothing is ready once the cards are added',
      );
    },
  );

  testWidgets('writes a changes proposal as "Change n cards"', (tester) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([
          ProposalEvent(
            proposalOf(
              deckId: 'd9',
              kind: ProposalKind.changes,
              groups: [
                ('Fixes', CardForm.text, [('a', 'b')]),
              ],
            ),
          ),
        ]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, 'fix');
    expect(_text('Change 1 card'), findsOneWidget);
    expect(_text('영단어'), findsOneWidget, reason: 'the note\'s own name');
  });

  testWidgets('collapses a group of six cards until it is opened', (
    tester,
  ) async {
    List<(String, String)> cards(int n) => [
      for (var i = 0; i < n; i++) ('front $i', 'back $i'),
    ];
    final client = FakeAssistantClient(
      scripts: [
        reply([
          ProposalEvent(
            proposalOf(
              groups: [
                ('Five', CardForm.text, cards(5)),
                ('Six', CardForm.senses, cards(6)),
              ],
            ),
          ),
        ]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, 'many');
    expect(_text('front 4'), findsOneWidget, reason: 'five stay open');
    expect(_text('6 cards · Word'), findsOneWidget);
    expect(_text('front 5'), findsNothing);
    await tester.tap(_text('6 cards · Word'));
    await tester.pumpAndSettle();
    expect(_text('6 cards · Word'), findsNothing);
    expect(_text('front 5'), findsOneWidget);
  });

  testWidgets('asks 말랑이 to remake a group in another form', (tester) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([ProposalEvent(_threeGroups)]),
        reply([const TextDelta('바꿨어요')]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '만들어 줘');
    expect(
      _text('Fill in the blank'),
      findsOneWidget,
      reason: 'group 2\'s chip',
    );
    expect(_text('Table'), findsNothing);
    await tester.tap(_text('In another form').first);
    await tester.pumpAndSettle();
    // The other forms, not the group's own (its chip stays the one) and not a photo's.
    expect(_text('Table'), findsOneWidget);
    expect(_text('Fill in the blank'), findsNWidgets(2));
    expect(_text('Word'), findsOneWidget);
    expect(_text('Photo'), findsNothing);
    await tester.tap(_text('Fill in the blank').first);
    await tester.pumpAndSettle();
    expect(client.sent.last.last, {
      'role': 'user',
      'text': 'Make Unit 1 again as Fill in the blank',
    });
  });

  testWidgets('sends a message refused as busy again after a few seconds', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [
        refuse(const Busy()),
        reply([const TextDelta('이제 답해요')]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _type(tester, '안녕');
    await tester.tap(find.byTooltip('Send'));
    await tester.pump();
    await tester.pump();
    expect(
      shownTextContaining('Still finishing the last message. Sending'),
      findsOneWidget,
    );
    expect(client.sent, hasLength(1));
    await tester.pump(busyRetryDelay - const Duration(milliseconds: 1));
    expect(client.sent, hasLength(1), reason: 'not before the delay');
    await tester.pump(const Duration(milliseconds: 1));
    await tester.pumpAndSettle();
    expect(client.sent, hasLength(2));
    expect(client.sent.last, client.sent.first);
    expect(_text('이제 답해요'), findsOneWidget);
    expect(shownTextContaining('Still finishing'), findsNothing);
  });

  testWidgets('says the day\'s tokens are used and takes no more messages', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [refuse(const RateLimited(Allowance(budget: 100, used: 100)))],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '안녕');
    expect(shownTextContaining('You have used today\'s share'), findsOneWidget);
    expect(_text('0% left today'), findsOneWidget);
    expect(_face(tester), MascotExpression.sleepy);
    expect(find.byType(TextField), findsNothing);
    // Control: a refusal that can be tried again leaves the field.
  });

  testWidgets(
    'offers another try after a refusal that can pass, and sends again',
    (tester) async {
      final client = FakeAssistantClient(
        scripts: [
          refuse(const Unavailable()),
          reply([const TextDelta('됐어요')]),
        ],
      );
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '안녕');
      expect(shownTextContaining('Malangi cannot answer now'), findsOneWidget);
      expect(find.byType(TextField), findsOneWidget);
      expect(_face(tester), MascotExpression.sad);
      await tester.tap(_text('Try again'));
      await tester.pumpAndSettle();
      expect(_text('됐어요'), findsOneWidget);
      expect(client.sent, hasLength(2));
      expect(shownTextContaining('Malangi cannot answer now'), findsNothing);
    },
  );

  testWidgets(
    'says why a reply ended in an error, and replaces it on a retry',
    (tester) async {
      final client = FakeAssistantClient(
        scripts: [
          reply([
            const TextDelta('음…'),
            const ErrorEvent(ReplyError.modelError),
          ]),
          reply([const TextDelta('다시 답해요')]),
        ],
      );
      await pumpChat(tester, client, await openAssistantStorage(tester));
      await _send(tester, '안녕');
      expect(_text('Malangi could not answer. Try again.'), findsOneWidget);
      expect(_face(tester), MascotExpression.sad);
      await tester.tap(_text('Try again'));
      await tester.pumpAndSettle();
      expect(_text('다시 답해요'), findsOneWidget);
      expect(_text('음…'), findsNothing, reason: 'the failed reply is replaced');
      expect(client.sent.last.last, {'role': 'user', 'text': '안녕'});
    },
  );

  testWidgets('says a reply was cut at the output limit', (tester) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([const TextDelta('길어서'), const ErrorEvent(ReplyError.cut)]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '안녕');
    expect(shownTextContaining('stopped midway'), findsOneWidget);
    expect(_text('Try again'), findsNothing, reason: 'cut asks to go on');
  });

  testWidgets('stops a reply streaming in', (tester) async {
    final feed = StreamController<AssistantEvent>();
    final client = FakeAssistantClient(scripts: [streaming(feed)]);
    final container = await pumpChat(
      tester,
      client,
      await openAssistantStorage(tester),
    );
    await _send(tester, '길게 말해 줘');
    feed.add(const TextDelta('음, 먼저'));
    await tester.pump();
    await tester.tap(find.byTooltip('Stop'));
    await tester.pumpAndSettle();
    expect(_text('Stopped.'), findsOneWidget);
    expect(_text('음, 먼저'), findsOneWidget, reason: 'what arrived is kept');
    expect(_lastReply(container).ending, Ending.stopped);
    expect(find.byTooltip('Send'), findsOneWidget);
  });

  testWidgets('lists the sources a reply cites, a web address as a link', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([
          const TextDelta('찾아봤어요'),
          const CitationEvent(url: 'https://example.com/a', title: '예시 문서'),
          const CitationEvent(url: 'javascript:alert(1)', title: '위험한 주소'),
          const CitationEvent(url: 'https://example.com/a', title: '또 같은 주소'),
        ]),
      ],
    );
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '찾아 줘');
    expect(_text('예시 문서'), findsOneWidget, reason: 'once, though cited twice');
    expect(_text('또 같은 주소'), findsNothing);
    expect(
      find.ancestor(of: _text('예시 문서'), matching: find.byType(TextButton)),
      findsOneWidget,
      reason: 'a web address is a link',
    );
    expect(_text('위험한 주소'), findsOneWidget);
    expect(
      find.ancestor(of: _text('위험한 주소'), matching: find.byType(TextButton)),
      findsNothing,
      reason: 'another scheme is text, never opened',
    );
  });

  testWidgets('keeps a message to the 4,000 characters the function takes', (
    tester,
  ) async {
    await pumpChat(
      tester,
      FakeAssistantClient(),
      await openAssistantStorage(tester),
    );
    await _type(tester, '가' * 4001);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      hasLength(4000),
    );
    // Control: a message of the limit is kept whole.
    await _type(tester, '나' * 4000);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      hasLength(4000),
    );
  });

  testWidgets('stops a reply streaming in when the chat is left', (
    tester,
  ) async {
    final feed = StreamController<AssistantEvent>();
    final client = FakeAssistantClient(scripts: [streaming(feed)]);
    final container = await pumpChat(
      tester,
      client,
      await openAssistantStorage(tester),
    );
    await _send(tester, '길게 말해 줘');
    feed.add(const TextDelta('음, 먼저'));
    await tester.pump();
    await tester.pump();
    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(find.text('open chat'), findsOneWidget);
    expect(_lastReply(container).ending, Ending.stopped);
    expect(_lastReply(container).text, '음, 먼저');
  });

  testWidgets('shows no share of the day while the tokens cannot be read', (
    tester,
  ) async {
    final client = FakeAssistantClient()..tokens = null;
    await pumpChat(tester, client, await openAssistantStorage(tester));
    expect(shownTextContaining('left today'), findsNothing);
    // Control: the same chat with tokens read shows it.
    await tester.pumpWidget(const SizedBox());
    await pumpChat(
      tester,
      FakeAssistantClient(),
      await openAssistantStorage(tester),
    );
    expect(_text('75% left today'), findsOneWidget);
  });

  testWidgets('says why adding failed and adds again on the next tap', (
    tester,
  ) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([ProposalEvent(_threeGroups)]),
      ],
    )..commitWith = (_) => const CommitFailed(CommitFailure.failed);
    await pumpChat(tester, client, await openAssistantStorage(tester));
    await _send(tester, '만들어 줘');
    await tester.tap(_text('Add 3 cards'));
    await tester.pumpAndSettle();
    expect(
      shownTextContaining('Could not add the cards. Try again'),
      findsOneWidget,
    );
    expect(_text('Add 3 cards'), findsOneWidget);
    client.commitWith = (proposal) =>
        Committed((deckId: 'd', deckName: proposal.deckName, count: 3));
    await tester.tap(_text('Add 3 cards'));
    await tester.pumpAndSettle();
    expect(client.commits, hasLength(2));
    expect(shownTextContaining('Could not add'), findsNothing);
    expect(_text('3 cards'), findsOneWidget);
  });

  testWidgets('clears the conversation only once confirmed', (tester) async {
    final client = FakeAssistantClient(
      scripts: [
        reply([const TextDelta('답')]),
      ],
    );
    final storage = await openAssistantStorage(tester);
    await pumpChat(tester, client, storage);
    await _send(tester, '질문');
    await _type(tester, '쓰던 말');
    Future<void> openClear() async {
      await tester.tap(find.byTooltip('Chat menu'));
      await tester.pumpAndSettle();
      await tester.tap(_text('Clear chat'));
      await tester.pumpAndSettle();
    }

    await openClear();
    expect(_text('Clear the chat?'), findsOneWidget);
    expect(_text('A cleared chat cannot be brought back.'), findsOneWidget);
    await tester.tap(_text('Cancel'));
    await tester.pumpAndSettle();
    expect(_text('질문'), findsOneWidget, reason: 'cancelled, nothing cleared');

    await openClear();
    await tester.tap(_text('Clear'));
    await tester.pumpAndSettle();
    expect(_text('질문'), findsNothing);
    expect(_text('What shall we memorise?'), findsOneWidget);
    expect(find.widgetWithText(TextField, '쓰던 말'), findsNothing);
    final stored = Conversation.parse(
      storage.getString('assistant.conversation'),
      draft: storage.getString('assistant.draft') ?? '',
    );
    expect(stored.turns, isEmpty);
    expect(stored.draft, isEmpty);
  });

  testWidgets(
    'opens a note it added and returns to the same chat, scroll and draft kept',
    (tester) async {
      final added = ShownProposal.of(_threeGroups)
          .copyWith(added: (deckId: 'deck-7', deckName: '영단어 노트', count: 3));
      final turns = <Turn>[
        const UserTurn(id: 'u0', text: '만들어 줘'),
        AssistantTurn(
          id: 'a0',
          text: '만들었어요',
          proposals: [added],
          ending: Ending.ok,
        ),
        for (var i = 1; i <= 12; i++) ...[
          UserTurn(id: 'u$i', text: '질문 $i ${'길게 ' * 30}'),
          AssistantTurn(
            id: 'a$i',
            text: '답 $i ${'길게 ' * 30}',
            ending: Ending.ok,
          ),
        ],
      ];
      final storage = await openAssistantStorage(tester, {
        'assistant.conversation': Conversation(turns: turns).encode(),
        'assistant.draft': '쓰던 말',
      });
      await pumpChat(tester, FakeAssistantClient(), storage);
      final list = find.byType(ListView);
      await tester.dragUntilVisible(
        find.text('영단어 노트'),
        list,
        const Offset(0, 300),
      );
      await tester.pumpAndSettle();
      double offset() => tester
          .state<ScrollableState>(find.byType(Scrollable).first)
          .position
          .pixels;
      final kept = offset();
      expect(
        kept,
        greaterThan(500),
        reason: 'the chat was scrolled away from its end',
      );
      await tester.tap(find.text('영단어 노트'));
      await tester.pumpAndSettle();
      expect(opened, ['deck-7']);
      expect(find.text('note deck-7'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('note deck-7'), findsNothing);
      expect(offset(), kept);
      expect(find.widgetWithText(TextField, '쓰던 말'), findsOneWidget);
    },
  );

  for (final (mode, scale) in [
    (ThemeMode.light, 1.0),
    (ThemeMode.dark, 1.0),
    (ThemeMode.light, 3.12),
    (ThemeMode.dark, 3.12),
  ]) {
    testWidgets(
      'draws a proposal and a question without overflow, $mode at $scale',
      (tester) async {
        final client = FakeAssistantClient(
          scripts: [
            reply([
              const TextDelta('어떤 형식이 좋을까요? 아래에서 골라 주세요.'),
              ProposalEvent(_threeGroups),
              const ChoiceEvent(
                Choice(prompt: '형식은?', options: ['단어', '빈칸 문장', '알아서 섞어서']),
              ),
            ]),
          ],
        );
        await pumpChat(
          tester,
          client,
          await openAssistantStorage(tester),
          themeMode: mode,
          textScale: scale,
        );
        await _send(tester, '만들어 줘');
        await meetsTapTargets(tester);
      },
    );
  }
}

/// Every button on screen is at least 44 points square.
Future<void> meetsTapTargets(WidgetTester tester) async {
  await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
}
