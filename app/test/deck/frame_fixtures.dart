import 'package:knowno/deck/deck.dart';

/// A block list of `supabase/fixtures/card-frame/`, which the web reads too,
/// as the server's migration writes it (ADR 0254), the form this build reads:
/// a `cloze` block of version 1 as version 2 where its blanks and answers
/// match in number, and a `text` block of version 2 as version 3 with each
/// part through the escape. A block left as it is, as the migration leaves it.
Object? migrated(Object? blocks) => switch (blocks) {
  final List<Object?> list => [for (final block in list) migrated(block)],
  final Map<String, Object?> block => _migrated(block),
  _ => blocks,
};

Object? _migrated(Map<String, Object?> block) {
  final version = block['v'] ?? 1;
  switch ((block['type'], block['payload'])) {
    case (
          'cloze',
          {'text': final String text, 'answers': final List<Object?> answers},
        )
        when version == 1:
      final parts = text.split('___');
      if (answers.isEmpty ||
          answers.any((answer) => answer is! String || answer.isEmpty) ||
          parts.length - 1 != answers.length) {
        return block;
      }
      return {
        ...block,
        'v': 2,
        'payload': {
          'text': [
            for (final (index, part) in parts.indexed) ...[
              markupEngine.escapeLiteral(part),
              if (index < answers.length)
                '{{c${index + 1}::${markupEngine.escapeLiteral(answers[index]! as String)}}}',
            ],
          ].join(),
        },
      };
    case ('text', {'front': final String front, 'back': final String back})
        when version == 2:
      return {
        ...block,
        'v': 3,
        'payload': {
          'front': markupEngine.escapeLiteral(front),
          'back': markupEngine.escapeLiteral(back),
        },
      };
    default:
      return block;
  }
}

/// [cases], each of a fixture file's cases with its block lists as
/// [migrated] writes them.
List<Map<String, Object?>> migratedCases(List<Map<String, Object?>> cases) => [
  for (final one in cases)
    {
      for (final MapEntry(:key, :value) in one.entries)
        key: const {'front', 'back', 'cells', 'saved', 'blocks'}.contains(key)
            ? migrated(value)
            : value,
    },
];

/// The photo candidates of [cards] as `extract-cards` returns them now: a
/// cloze card's front, which the fixture writes with `___` and `answers`, as
/// Anki's syntax.
Object? returned(Object? cards) => [
  for (final card in cards! as List<Object?>) _returned(card),
];

Object? _returned(Object? card) {
  if (card
      case {
        'type': 'cloze',
        'front': final String front,
        'cloze': {'answers': final List<Object?> answers},
      }
      when front.split('___').length - 1 == answers.length) {
    final parts = front.split('___');
    return {
      ...card as Map<String, Object?>,
      'front': [
        for (final (index, part) in parts.indexed) ...[
          part,
          if (index < answers.length) '{{c${index + 1}::${answers[index]}}}',
        ],
      ].join(),
    };
  }
  return card;
}
