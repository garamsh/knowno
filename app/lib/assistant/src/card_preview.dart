import '../../deck/deck.dart' show clozeAnswers, markupEngine, markupPlain;

/// A proposed card in two lines: what it shows first, and what it adds at the
/// reveal; [photo] where its first side is a photo, which has no text.
typedef CardPreview = ({String front, String back, bool photo});

String _text(Object? value) => value is String ? value.trim() : '';

List<String> _texts(Object? value) => value is List<Object?>
    ? [
        for (final one in value)
          if (_text(one).isNotEmpty) _text(one),
      ]
    : const [];

/// [value] as the engine reads it, its marks left out and its clozes filled.
String _markup(Object? value) => switch (_text(value)) {
  '' => '',
  final text => markupEngine.plainText(text).trim(),
};

CardPreview _clozeMarkup(String text) {
  final blocks = markupEngine.parse(text);
  return (
    front: markupPlain(
      blocks,
      cloze: (run) => run.hint == null ? '___' : '___(${run.hint})',
    ).trim(),
    back: clozeAnswers(blocks).join(', '),
    photo: false,
  );
}

/// A sense as every book reads it: its labels in brackets, then its meaning.
String _sense(Object? value) {
  if (value is! Map<String, Object?>) return '';
  return [
    for (final label in _texts(value['labels'])) '[$label]',
    _text(value['meaning']),
  ].where((part) => part.isNotEmpty).join(' ');
}

/// A block's part of each line, by its type as `add_cards` reads it.
CardPreview _block(Map<String, Object?> block) => switch (block['type']) {
  'text' => (
    front: _markup(block['front']),
    back: _markup(block['back']),
    photo: false,
  ),
  'senses' => (
    front: _text(block['term']),
    back: switch (block['senses']) {
      final List<Object?> senses => senses.map(_sense).join(' · '),
      _ => '',
    },
    photo: false,
  ),
  // Anki's syntax: each cloze a blank, its hint after it, and the answers
  // after the reveal.
  'cloze' => _clozeMarkup(_text(block['text'])),
  'table' => (
    front: _texts(block['columns']).join(' · '),
    back: switch (block['rows']) {
      final List<Object?> rows =>
        rows.map((row) => _texts(row).join(' · ')).join(' / '),
      _ => '',
    },
    photo: false,
  ),
  'image' => (front: '', back: '', photo: true),
  _ => (front: '', back: '', photo: false),
};

/// [card], as `add_cards` or `update_cards` takes it, in two lines: its
/// blocks' first-shown parts joined over what each adds, or the plain front
/// and back with its senses' labels.
CardPreview previewOf(Map<String, Object?> card) {
  if (card['blocks'] is! List<Object?>) {
    return (
      front: _text(card['front']),
      back: [
        for (final label in _texts(card['labels'])) '[$label]',
        _text(card['back']),
      ].where((part) => part.isNotEmpty).join(' '),
      photo: false,
    );
  }
  final lines = [
    for (final block in card['blocks']! as List<Object?>)
      if (block is Map<String, Object?>) _block(block),
  ];
  String joined(String Function(CardPreview line) side) =>
      lines.map(side).where((part) => part.isNotEmpty).join(' · ');
  return (
    front: joined((l) => l.front),
    back: joined((l) => l.back),
    photo: lines.any((line) => line.photo),
  );
}
