import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/conversation.dart';
import 'package:knowno/assistant/src/protocol.dart';

import 'fakes.dart';

Proposal _two() => proposalOf(
  groups: [
    ('A', CardForm.senses, [('a1', 'b1'), ('a2', 'b2')]),
    ('B', CardForm.cloze, [('c1', 'd1')]),
  ],
);

void main() {
  test('sends the last 40 turns, a reply with its proposals and question', () {
    final turns = <Turn>[
      for (var i = 0; i < 45; i++)
        if (i.isEven)
          UserTurn(id: 'u$i', text: 'q$i')
        else
          AssistantTurn(
            id: 'a$i',
            text: 'r$i',
            proposals: i == 43 ? [ShownProposal.of(_two())] : const [],
            choice: i == 41
                ? const Choice(prompt: '?', options: ['x', 'y'])
                : null,
            ending: Ending.ok,
          ),
    ];
    final sent = Conversation(turns: turns).requestTurns;
    expect(sent, hasLength(40));
    expect(sent.first['text'], 'r5');
    expect(sent.last, {'role': 'user', 'text': 'q44'});
    final withChoice = sent.firstWhere((t) => t['text'] == 'r41');
    expect(withChoice['choice'], {
      'prompt': '?',
      'options': ['x', 'y'],
    });
    final withProposal = sent.firstWhere((t) => t['text'] == 'r43');
    expect(
      (withProposal['proposals']! as List<Object?>).single,
      _two().toJson(),
    );
    // Control: a reply with neither carries neither.
    expect(sent.firstWhere((t) => t['text'] == 'r39').keys, ['role', 'text']);
  });

  test('applies a reply\'s events and counts a source once', () {
    var turn = const AssistantTurn(id: 'a');
    for (final event in [
      const TextDelta('안'),
      const TextDelta('녕'),
      const CitationEvent(url: 'https://a.b', title: 'A'),
      const CitationEvent(url: 'https://a.b', title: 'A again'),
      ProposalEvent(_two()),
      const UsageEvent(Allowance(budget: 1, used: 1)),
      const JobEvent(id: 'j', photos: 3),
    ]) {
      turn = turn.withEvent(event);
    }
    expect(turn.text, '안녕');
    expect(turn.citations, [(url: 'https://a.b', title: 'A')]);
    expect(turn.proposals.single.checkedCount, 3);
    expect(turn.ending, isNull);
    expect(turn.withEvent(const ErrorEvent(ReplyError.cut)).ending, Ending.cut);
  });

  test('keeps the checks of the groups a remade proposal left alone', () {
    var turn = AssistantTurn(id: 'a').withEvent(ProposalEvent(_two()));
    final unchecked = turn.proposals.single.copyWith(
      checked: {
        'g0': ['g0-c0'],
        'g1': <String>[],
      },
    );
    turn = turn.copyWith(proposals: [unchecked]);
    final remade = proposalOf(
      groups: [
        ('A', CardForm.senses, [('a1', 'b1'), ('a2', 'b2')]),
        ('B', CardForm.table, [('new', 'cards')]),
      ],
    );
    // The remade group has the old card id: only its form and card changed.
    final next = Proposal(
      id: remade.id,
      kind: remade.kind,
      deckId: remade.deckId,
      deckName: remade.deckName,
      groups: [
        remade.groups[0],
        ProposalGroup(
          id: 'g1',
          title: 'B',
          form: CardForm.table,
          cards: const [ProposalCard(id: 'fresh', card: {})],
        ),
      ],
    );
    final shown = turn.withEvent(ProposalEvent(next)).proposals.single;
    expect(shown.checked['g0'], ['g0-c0'], reason: 'the kept group');
    expect(shown.checked['g1'], ['fresh'], reason: 'the remade group, whole');
  });

  test(
    'stores turns and reads them back, a reply cut off mid-stream stopped',
    () {
      final conversation = Conversation(
        turns: [
          const UserTurn(id: 'u', text: 'hi'),
          AssistantTurn(
            id: 'a',
            text: 'hello',
            citations: const [(url: 'https://a.b', title: 'A')],
            proposals: [
              ShownProposal.of(_two())
                  .copyWith(added: (deckId: 'd', deckName: 'N', count: 3)),
            ],
            choice: const Choice(prompt: 'p', options: ['o', 'q']),
            ending: Ending.cut,
          ),
          const AssistantTurn(id: 'b', text: 'half'),
        ],
      );
      final read = Conversation.parse(conversation.encode(), draft: 'typing');
      expect(read.draft, 'typing');
      expect(read.turns, hasLength(3));
      final a = read.turns[1] as AssistantTurn;
      expect(a.ending, Ending.cut);
      expect(a.proposals.single.added, (deckId: 'd', deckName: 'N', count: 3));
      expect(a.proposals.single.proposal.toJson(), _two().toJson());
      expect(a.choice?.options, ['o', 'q']);
      expect((read.turns[2] as AssistantTurn).ending, Ending.stopped);
    },
  );

  test('reads nothing from a stored text that is not a conversation', () {
    for (final text in [
      null,
      'nope',
      '[]',
      '{"version":2,"turns":[]}',
      '{"version":1,"turns":[{"role":"x"}]}',
    ]) {
      expect(
        Conversation.parse(text, draft: 'd').turns,
        isEmpty,
        reason: '$text',
      );
    }
    expect(Conversation.parse('nope', draft: 'd').draft, 'd');
  });

  test(
    'has a proposal ready only once its reply ended and until it is added',
    () {
      final shown = ShownProposal.of(_two());
      AssistantTurn reply(Ending? ending, {ShownProposal? proposal}) =>
          AssistantTurn(
            id: 'a',
            proposals: [proposal ?? shown],
            ending: ending,
          );
      expect(Conversation(turns: [reply(null)]).ready, isNull);
      expect(Conversation(turns: [reply(Ending.ok)]).ready, same(shown));
      final added = shown.copyWith(
        added: (deckId: 'd', deckName: 'N', count: 3),
      );
      expect(
        Conversation(turns: [reply(Ending.ok, proposal: added)]).ready,
        isNull,
      );
    },
  );
}
