import 'dart:convert';

import 'protocol.dart';

/// The most turns a message carries, as the function's `MAX_TURNS`.
const maxTurns = 40;

/// The longest a user's message may be, as the function's `MAX_TURN_TEXT`.
const maxMessageLength = 4000;

/// A web source a reply cites.
typedef Citation = ({String url, String title});

/// What a commit wrote: the note and how many of its cards.
typedef Added = ({String deckId, String deckName, int count});

/// How a reply ended: whole, failed at the model, cut at the output limit, or
/// stopped by the user.
enum Ending { ok, modelError, cut, stopped }

/// A proposal as the chat shows it: the card ids checked in each group, and
/// what adding it wrote.
final class ShownProposal {
  const ShownProposal({
    required this.proposal,
    required this.checked,
    this.added,
  });

  /// [proposal] with every card checked.
  factory ShownProposal.of(Proposal proposal) => ShownProposal(
    proposal: proposal,
    checked: {
      for (final group in proposal.groups)
        group.id: [for (final card in group.cards) card.id],
    },
  );

  final Proposal proposal;
  final Map<String, List<String>> checked;
  final Added? added;

  /// How many cards adding it would add or change: those checked.
  int get checkedCount =>
      checked.values.fold(0, (sum, ids) => sum + ids.length);

  ShownProposal copyWith({Map<String, List<String>>? checked, Added? added}) =>
      ShownProposal(
        proposal: proposal,
        checked: checked ?? this.checked,
        added: added ?? this.added,
      );

  /// This proposal sent again as [next], a group remade: each group that kept
  /// its cards keeps its checks, and a remade one is checked whole.
  ShownProposal remade(Proposal next) {
    final fresh = ShownProposal.of(next);
    for (final group in next.groups) {
      final kept = checked[group.id];
      final old = proposal.groups
          .where((one) => one.id == group.id)
          .firstOrNull;
      final ids = {for (final card in group.cards) card.id};
      if (kept != null &&
          old != null &&
          old.cards.length == ids.length &&
          old.cards.every((card) => ids.contains(card.id))) {
        fresh.checked[group.id] = kept;
      }
    }
    return fresh;
  }

  Map<String, Object?> toJson() => {
    'proposal': proposal.toJson(),
    'checked': checked,
    'added': switch (added) {
      final added? => {
        'deck_id': added.deckId,
        'deck_name': added.deckName,
        'count': added.count,
      },
      null => null,
    },
  };

  static ShownProposal? parse(Object? value) {
    if (value case {
      'proposal': final Object? raw,
      'checked': final Map<String, Object?> checked,
    }) {
      final proposal = Proposal.parse(raw);
      final ids = <String, List<String>>{};
      for (final MapEntry(:key, value: list) in checked.entries) {
        if (list is! List<Object?> || !list.every((id) => id is String)) {
          return null;
        }
        ids[key] = [...list.cast<String>()];
      }
      if (proposal == null) return null;
      final Added? added;
      switch (value['added']) {
        case null:
          added = null;
        case {
          'deck_id': final String deckId,
          'deck_name': final String deckName,
          'count': final int count,
        }:
          added = (deckId: deckId, deckName: deckName, count: count);
        default:
          return null;
      }
      return ShownProposal(proposal: proposal, checked: ids, added: added);
    }
    return null;
  }
}

sealed class Turn {
  const Turn({required this.id, required this.text});

  final String id;
  final String text;
}

final class UserTurn extends Turn {
  const UserTurn({required super.id, required super.text});
}

/// 말랑이's turn; its [ending] is null while it streams.
final class AssistantTurn extends Turn {
  const AssistantTurn({
    required super.id,
    super.text = '',
    this.citations = const [],
    this.proposals = const [],
    this.choice,
    this.ending,
  });

  final List<Citation> citations;
  final List<ShownProposal> proposals;
  final Choice? choice;
  final Ending? ending;

  AssistantTurn copyWith({
    String? text,
    List<Citation>? citations,
    List<ShownProposal>? proposals,
    Choice? choice,
    Ending? ending,
  }) => AssistantTurn(
    id: id,
    text: text ?? this.text,
    citations: citations ?? this.citations,
    proposals: proposals ?? this.proposals,
    choice: choice ?? this.choice,
    ending: ending ?? this.ending,
  );

  /// This turn with [event] of its stream applied; `usage` and `job` change
  /// nothing.
  AssistantTurn withEvent(AssistantEvent event) => switch (event) {
    TextDelta(:final delta) => copyWith(text: text + delta),
    CitationEvent(:final url, :final title) =>
      citations.any((one) => one.url == url)
          ? this
          : copyWith(citations: [...citations, (url: url, title: title)]),
    ProposalEvent(:final proposal) => copyWith(
      proposals: switch (proposals.indexWhere(
        (one) => one.proposal.id == proposal.id,
      )) {
        -1 => [...proposals, ShownProposal.of(proposal)],
        final at => [
          for (var i = 0; i < proposals.length; i++)
            if (i == at) proposals[i].remade(proposal) else proposals[i],
        ],
      },
    ),
    ChoiceEvent(:final choice) => copyWith(choice: choice),
    ErrorEvent(:final error) => copyWith(
      ending: switch (error) {
        ReplyError.modelError => Ending.modelError,
        ReplyError.cut => Ending.cut,
      },
    ),
    UsageEvent() || JobEvent() => this,
    MalformedEvent() => copyWith(ending: Ending.modelError),
  };
}

/// The one conversation, kept on the device, and the message being written.
final class Conversation {
  const Conversation({this.turns = const [], this.draft = ''});

  final List<Turn> turns;
  final String draft;

  bool get isEmpty => turns.isEmpty && draft.isEmpty;

  Conversation copyWith({List<Turn>? turns, String? draft}) =>
      Conversation(turns: turns ?? this.turns, draft: draft ?? this.draft);

  /// The proposal 말랑이 has ready: the last one shown, while it is not added
  /// and the reply that showed it has ended; null otherwise.
  ShownProposal? get ready {
    final last = turns
        .whereType<AssistantTurn>()
        .where((turn) => turn.proposals.isNotEmpty)
        .lastOrNull;
    final proposal = last?.proposals.last;
    return last?.ending != null && proposal != null && proposal.added == null
        ? proposal
        : null;
  }

  /// The last [maxTurns] turns as a message sends them, oldest first, each
  /// reply with its proposals and question (`assistant.md` §Requests).
  List<Map<String, Object?>> get requestTurns => [
    for (final turn
        in turns.length > maxTurns
            ? turns.sublist(turns.length - maxTurns)
            : turns)
      switch (turn) {
        UserTurn() => {'role': 'user', 'text': turn.text},
        AssistantTurn() => {
          'role': 'assistant',
          'text': turn.text,
          if (turn.proposals.isNotEmpty)
            'proposals': [
              for (final one in turn.proposals) one.proposal.toJson(),
            ],
          if (turn.choice case final choice?) 'choice': choice.toJson(),
        },
      },
  ];

  /// The turns as stored; the draft is stored apart, so typing rewrites no
  /// turn.
  String encode() => jsonEncode({
    'version': 1,
    'turns': [
      for (final turn in turns)
        switch (turn) {
          UserTurn() => {'role': 'user', 'id': turn.id, 'text': turn.text},
          AssistantTurn() => {
            'role': 'assistant',
            'id': turn.id,
            'text': turn.text,
            'citations': [
              for (final c in turn.citations) {'url': c.url, 'title': c.title},
            ],
            'proposals': [for (final one in turn.proposals) one.toJson()],
            'choice': turn.choice?.toJson(),
            'ending': turn.ending?.name,
          },
        },
    ],
  });

  /// [text] read as stored turns under [draft], or the empty conversation
  /// when it is none. A reply stored mid-stream ended where it was stored.
  static Conversation parse(String? text, {String draft = ''}) {
    if (text == null) return Conversation(draft: draft);
    final Object? value;
    try {
      value = jsonDecode(text);
    } on FormatException {
      return Conversation(draft: draft);
    }
    if (value is Map<String, Object?> && value['version'] == 1) {
      final raw = value['turns'];
      if (raw is List<Object?>) {
        final turns = [for (final one in raw) _parseTurn(one)];
        if (!turns.contains(null)) {
          return Conversation(turns: [...turns.nonNulls], draft: draft);
        }
      }
    }
    return Conversation(draft: draft);
  }
}

Turn? _parseTurn(Object? value) {
  if (value is! Map<String, Object?>) return null;
  if (value case {'id': final String id, 'text': final String text}) {
    switch (value['role']) {
      case 'user':
        return UserTurn(id: id, text: text);
      case 'assistant':
        final citations = switch (value['citations']) {
          final List<Object?> list => [
            for (final one in list)
              if (one case {
                'url': final String url,
                'title': final String title,
              })
                (url: url, title: title),
          ],
          _ => <Citation>[],
        };
        final shown = switch (value['proposals']) {
          final List<Object?> list => [
            for (final one in list) ShownProposal.parse(one),
          ],
          _ => <ShownProposal?>[],
        };
        if (shown.contains(null)) return null;
        final ending = Ending.values
            .where((e) => e.name == value['ending'])
            .firstOrNull;
        return AssistantTurn(
          id: id,
          text: text,
          citations: citations,
          proposals: [...shown.nonNulls],
          choice: Choice.parse(value['choice']),
          ending: ending ?? Ending.stopped,
        );
    }
  }
  return null;
}
