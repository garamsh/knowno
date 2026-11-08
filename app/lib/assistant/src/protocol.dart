import 'dart:convert';

/// The card forms a proposal group takes, each card of the group in it.
enum CardForm { text, senses, cloze, table, image, mixed }

/// A proposed card: its [id] and the card exactly as `add_cards` or
/// `update_cards` takes it.
final class ProposalCard {
  const ProposalCard({required this.id, required this.card});

  final String id;
  final Map<String, Object?> card;

  Map<String, Object?> toJson() => {'id': id, 'card': card};

  static ProposalCard? parse(Object? value) => switch (value) {
    {'id': final String id, 'card': final Map<String, Object?> card} =>
      ProposalCard(id: id, card: card),
    _ => null,
  };
}

final class ProposalGroup {
  const ProposalGroup({
    required this.id,
    required this.title,
    required this.form,
    required this.cards,
  });

  final String id;
  final String title;
  final CardForm form;
  final List<ProposalCard> cards;

  Map<String, Object?> toJson() => {
    'id': id,
    'title': title,
    'format': form.name,
    'cards': [for (final card in cards) card.toJson()],
  };

  static ProposalGroup? parse(Object? value) {
    if (value case {
      'id': final String id,
      'title': final String title,
      'format': final String format,
      'cards': final List<Object?> cards,
    }) {
      final form = CardForm.values.where((f) => f.name == format).firstOrNull;
      final parsed = [for (final card in cards) ProposalCard.parse(card)];
      if (form == null || parsed.contains(null)) return null;
      return ProposalGroup(
        id: id,
        title: title,
        form: form,
        cards: [...parsed.nonNulls],
      );
    }
    return null;
  }
}

/// New cards for a note, or a new note where [deckId] is null; or changes to
/// a note's cards.
enum ProposalKind { cards, changes }

final class Proposal {
  const Proposal({
    required this.id,
    required this.kind,
    required this.deckId,
    required this.deckName,
    required this.groups,
  });

  final String id;
  final ProposalKind kind;
  final String? deckId;
  final String deckName;
  final List<ProposalGroup> groups;

  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind.name,
    'deck': {'id': deckId, 'name': deckName},
    'groups': [for (final group in groups) group.toJson()],
  };

  static Proposal? parse(Object? value) {
    if (value case {
      'id': final String id,
      'kind': final String kind,
      'deck': {'id': final String? deckId, 'name': final String deckName},
      'groups': final List<Object?> groups,
    }) {
      final kindOf = ProposalKind.values
          .where((k) => k.name == kind)
          .firstOrNull;
      final parsed = [for (final group in groups) ProposalGroup.parse(group)];
      if (kindOf == null || groups.isEmpty || parsed.contains(null)) {
        return null;
      }
      return Proposal(
        id: id,
        kind: kindOf,
        deckId: deckId,
        deckName: deckName,
        groups: [...parsed.nonNulls],
      );
    }
    return null;
  }
}

/// A question 말랑이 asks, with its quick-reply options.
final class Choice {
  const Choice({required this.prompt, required this.options});

  final String prompt;
  final List<String> options;

  Map<String, Object?> toJson() => {'prompt': prompt, 'options': options};

  static Choice? parse(Object? value) => switch (value) {
    {'prompt': final String prompt, 'options': final List<Object?> options}
        when options.isNotEmpty && options.every((o) => o is String) =>
      Choice(prompt: prompt, options: [...options.cast<String>()]),
    _ => null,
  };
}

/// The day's tokens: the plan's [budget], null for none, and those [used].
final class Allowance {
  const Allowance({required this.budget, required this.used});

  final int? budget;
  final int used;

  /// The share of the day's budget left, 0 to 100, or null without a budget.
  int? get leftShare {
    final budget = this.budget;
    if (budget == null) return null;
    if (budget <= 0) return 0;
    return (((budget - used) / budget) * 100).floor().clamp(0, 100);
  }

  /// The allowance [fields] hold as `token_budget` and `tokens_used`, or
  /// null when they are not that.
  static Allowance? parse(Map<String, Object?> fields) =>
      switch ((fields['token_budget'], fields['tokens_used'])) {
        (final int? budget, final int used) => Allowance(
          budget: budget,
          used: used,
        ),
        _ => null,
      };
}

/// How a reply ended other than whole.
enum ReplyError { modelError, cut }

/// One event of a message's stream (`assistant.md` §Stream).
sealed class AssistantEvent {
  const AssistantEvent();
}

final class TextDelta extends AssistantEvent {
  const TextDelta(this.delta);

  final String delta;
}

final class CitationEvent extends AssistantEvent {
  const CitationEvent({required this.url, required this.title});

  final String url;
  final String title;
}

final class ProposalEvent extends AssistantEvent {
  const ProposalEvent(this.proposal);

  final Proposal proposal;
}

final class ChoiceEvent extends AssistantEvent {
  const ChoiceEvent(this.choice);

  final Choice choice;
}

/// A photo job started. Read at the boundary and drawn nowhere yet.
final class JobEvent extends AssistantEvent {
  const JobEvent({required this.id, required this.photos});

  final String id;
  final int photos;
}

final class ErrorEvent extends AssistantEvent {
  const ErrorEvent(this.error);

  final ReplyError error;
}

final class UsageEvent extends AssistantEvent {
  const UsageEvent(this.allowance);

  final Allowance allowance;
}

/// A known event whose data is not its form.
final class MalformedEvent extends AssistantEvent {
  const MalformedEvent();
}

/// The event named [name] carrying the JSON [data]; null for a name this
/// client does not draw, [MalformedEvent] for a known name whose data is not
/// its form.
AssistantEvent? parseEvent(String name, String data) {
  const known = {
    'text',
    'citation',
    'proposal',
    'choice',
    'job',
    'error',
    'usage',
  };
  if (!known.contains(name)) return null;
  final Object? value;
  try {
    value = jsonDecode(data);
  } on FormatException {
    return const MalformedEvent();
  }
  if (value is! Map<String, Object?>) return const MalformedEvent();
  final event = switch (name) {
    'text' => switch (value) {
      {'delta': final String delta} => TextDelta(delta),
      _ => null,
    },
    'citation' => switch (value) {
      {'url': final String url, 'title': final String title} => CitationEvent(
        url: url,
        title: title,
      ),
      _ => null,
    },
    'proposal' => switch (Proposal.parse(value)) {
      final proposal? => ProposalEvent(proposal),
      null => null,
    },
    'choice' => switch (Choice.parse(value)) {
      final choice? => ChoiceEvent(choice),
      null => null,
    },
    'job' => switch (value) {
      {'id': final String id, 'photos': final int photos} => JobEvent(
        id: id,
        photos: photos,
      ),
      _ => null,
    },
    'error' => switch (value['error']) {
      'model_error' => const ErrorEvent(ReplyError.modelError),
      'cut' => const ErrorEvent(ReplyError.cut),
      _ => null,
    },
    _ => switch (Allowance.parse(value)) {
      final allowance? => UsageEvent(allowance),
      null => null,
    },
  };
  return event ?? const MalformedEvent();
}

/// Why a message was not started, or did not reach the function.
sealed class MessageRefusal {
  const MessageRefusal();
}

/// The day's budget is used; the body's [allowance] when it says so.
final class RateLimited extends MessageRefusal {
  const RateLimited(this.allowance);

  final Allowance? allowance;
}

/// Another message of the user is still running.
final class Busy extends MessageRefusal {
  const Busy();
}

final class SignInNeeded extends MessageRefusal {
  const SignInNeeded();
}

final class Suspended extends MessageRefusal {
  const Suspended();
}

final class TooLong extends MessageRefusal {
  const TooLong();
}

final class Unavailable extends MessageRefusal {
  const Unavailable();
}

final class Unreachable extends MessageRefusal {
  const Unreachable();
}

/// The refusal a message's [status] and [body] mean (`assistant.md`
/// §Requests).
MessageRefusal parseRefusal(int status, String body) {
  Map<String, Object?>? fields;
  try {
    if (jsonDecode(body) case final Map<String, Object?> decoded) {
      fields = decoded;
    }
  } on FormatException {
    fields = null;
  }
  return switch (status) {
    429 when fields?['error'] == 'busy' => const Busy(),
    429 => RateLimited(fields == null ? null : Allowance.parse(fields)),
    401 => const SignInNeeded(),
    403 => const Suspended(),
    413 => const TooLong(),
    _ => const Unavailable(),
  };
}
