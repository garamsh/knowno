import 'package:knowno/deck/deck.dart';

/// [blocks] in the shape of `engine/tests/fixtures/markup/`: an array of blocks
/// tagged by `type`.
List<Object?> blocksJson(List<MarkupBlock> blocks) => [
  for (final block in blocks)
    switch (block) {
      ParagraphBlock(:final content) => {
        'type': 'paragraph',
        'content': inlinesJson(content),
      },
      ListBlock(:final ordered, :final items) => {
        'type': 'list',
        'ordered': ordered,
        'items': [
          for (final item in items)
            {
              'content': inlinesJson(item.content),
              'sublists': [
                for (final sub in item.sublists)
                  {
                    'ordered': sub.ordered,
                    'items': [for (final line in sub.items) inlinesJson(line)],
                  },
              ],
            },
        ],
      },
    },
];

List<Object?> inlinesJson(List<MarkupInline> content) => [
  for (final run in content)
    switch (run) {
      TextRun(:final text) => {'type': 'text', 'text': text},
      LineBreakRun() => {'type': 'lineBreak'},
      BoldRun(:final content) => {
        'type': 'bold',
        'content': inlinesJson(content),
      },
      ItalicRun(:final content) => {
        'type': 'italic',
        'content': inlinesJson(content),
      },
      CodeRun(:final text) => {'type': 'code', 'text': text},
      ClozeRun(:final number, :final answer, :final hint) => {
        'type': 'cloze',
        'number': number,
        'answer': inlinesJson(answer),
        'hint': hint,
      },
      BlankRun(:final hint) => {'type': 'blank', 'hint': hint},
    },
];

/// The blocks of a fixture's `document`.
List<MarkupBlock> blocksOf(Object? json) => [
  for (final block in json as List<Object?>)
    _block(block as Map<String, Object?>),
];

MarkupBlock _block(Map<String, Object?> json) => switch (json['type']) {
  'paragraph' => ParagraphBlock(_inlines(json['content'])),
  'list' => ListBlock(
    ordered: json['ordered'] as bool,
    items: [
      for (final raw in json['items'] as List<Object?>)
        _item(raw as Map<String, Object?>),
    ],
  ),
  final type => throw ArgumentError('block $type'),
};

MarkupItem _item(Map<String, Object?> item) =>
    MarkupItem(_inlines(item['content']), [
      for (final raw in item['sublists'] as List<Object?>)
        _sub(raw as Map<String, Object?>),
    ]);

MarkupSubList _sub(Map<String, Object?> sub) => MarkupSubList(
  ordered: sub['ordered'] as bool,
  items: [for (final line in sub['items'] as List<Object?>) _inlines(line)],
);

List<MarkupInline> _inlines(Object? json) => [
  for (final raw in json as List<Object?>) _inline(raw as Map<String, Object?>),
];

MarkupInline _inline(Map<String, Object?> run) => switch (run['type']) {
  'text' => TextRun(run['text'] as String),
  'lineBreak' => const LineBreakRun(),
  'bold' => BoldRun(_inlines(run['content'])),
  'italic' => ItalicRun(_inlines(run['content'])),
  'code' => CodeRun(run['text'] as String),
  'cloze' => ClozeRun(
    number: run['number'] as int,
    answer: _inlines(run['answer']),
    hint: run['hint'] as String?,
  ),
  'blank' => BlankRun(hint: run['hint'] as String?),
  final type => throw ArgumentError('inline $type'),
};
