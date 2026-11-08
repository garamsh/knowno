import 'dart:convert';

import 'package:flutter/foundation.dart' show listEquals;

import 'card_key.dart';
import 'card_template.dart';
import 'content.dart';
import 'model.dart';

/// A side a placed 칸 sits on.
enum CellSide { front, back }

/// Which of a 단어's parts shows before the reveal.
enum WordAsk { term, meaning }

/// One 칸 of a card: its type decides whether it has sides (ADR 0137). Two
/// 칸 are equal when their kind and content are; their [id]s are not compared.
sealed class Cell {
  const Cell({this.id});

  /// The stored block's id, kept across a conversion.
  final String? id;
}

/// A 글: its [front] shows before the reveal and its [back] is added by it.
/// Either may be empty.
///
/// A 글 of version 3 reads its parts as markup, a Markdown subset the engine
/// parses (ADR 0202); one of version 2, or drawn from a side block, reads
/// them as written.
final class TextCell extends Cell {
  const TextCell({
    this.front = '',
    this.back = '',
    this.markup = false,
    super.id,
  });

  final String front;
  final String back;

  /// Whether [front] and [back] are read as markup: the 글 is version 3.
  final bool markup;

  @override
  bool operator ==(Object other) =>
      other is TextCell &&
      other.front == front &&
      other.back == back &&
      other.markup == markup;

  @override
  int get hashCode => Object.hash(front, back, markup);
}

/// A 단어: a word and its meanings, [ask] naming the one shown first.
final class WordCell extends Cell {
  const WordCell({
    required this.term,
    required this.senses,
    required this.ask,
    super.id,
  });

  final String term;
  final List<CardSense> senses;
  final WordAsk ask;

  @override
  bool operator ==(Object other) =>
      other is WordCell &&
      other.term == term &&
      other.ask == ask &&
      listEquals(other.senses, senses);

  @override
  int get hashCode => Object.hash(term, ask, Object.hashAll(senses));
}

/// A 칸 whose blanks are the question and whose filling is the answer: a
/// cloze, a table or an image with boxes.
final class BlankCell extends Cell {
  const BlankCell(this.block, {super.id});

  final Content block;

  @override
  bool operator ==(Object other) => other is BlankCell && other.block == block;

  @override
  int get hashCode => block.hashCode;
}

/// A 사진 without a box or a 소리, on one [side].
final class PlacedCell extends Cell {
  const PlacedCell(this.block, this.side, {super.id});

  final Content block;
  final CellSide side;

  @override
  bool operator ==(Object other) =>
      other is PlacedCell && other.block == block && other.side == side;

  @override
  int get hashCode => Object.hash(block, side);
}

/// A 칸 of a type or version this build does not know, kept as stored.
final class UnknownCell extends Cell {
  const UnknownCell(this.block);

  final UnsupportedContent block;

  @override
  bool operator ==(Object other) =>
      other is UnknownCell && other.block.stored == block.stored;

  @override
  int get hashCode => block.type.hashCode;
}

const _frameVersions = {'text': 2, 'senses': 2, 'image': 2, 'audio': 2};

/// The version of a 글 whose text is markup.
const _markupTextVersion = 3;

/// Decodes a stored 칸 list. A block of the frame's versions reads its own
/// fields, and one of an earlier version reads as it was drawn on a front;
/// an unknown type or version is kept. Throws [FormatException] for a block
/// that breaks its shape, as [decodeContent] does.
List<Cell> decodeCells(String encoded) {
  final decoded = jsonDecode(encoded);
  if (decoded is! List<Object?>) {
    throw FormatException('a 칸 list is not a list', encoded);
  }
  return [for (final block in decoded) _decodeCell(block, encoded)];
}

Cell _decodeCell(Object? block, String source) {
  if (block
      case {
        'type': final String type,
        'v': final int version,
        'payload': final Map<String, Object?> payload,
      }
      when version == _frameVersions[type] ||
          type == 'text' && version == _markupTextVersion) {
    final id = block['id'];
    if (id != null && id is! String) {
      throw FormatException('a $type block has an id that is not text', source);
    }
    final cell = switch (type) {
      'text' => _decodeText(
        payload,
        id as String?,
        markup: version == _markupTextVersion,
      ),
      'senses' => _decodeWord(payload, id as String?),
      _ => _decodePlaced(type, payload, block, source),
    };
    if (cell == null) {
      throw FormatException('a $type block breaks its shape', source);
    }
    return cell;
  }
  return switch (decodeBlock(block, source)) {
    final UnsupportedContent kept => UnknownCell(kept),
    final content => _frontCell(content),
  };
}

TextCell? _decodeText(
  Map<String, Object?> payload,
  String? id, {
  required bool markup,
}) => switch (payload) {
  {'front': final String front, 'back': final String back}
      when front.trim().isNotEmpty || back.trim().isNotEmpty =>
    TextCell(front: front, back: back, markup: markup, id: id),
  _ => null,
};

WordCell? _decodeWord(Map<String, Object?> payload, String? id) {
  if (payload
      case {
        'term': final String term,
        'senses': final List<Object?> senses,
        'ask': final String ask,
      }
      when WordAsk.values.any((value) => value.name == ask)) {
    final decoded = [for (final sense in senses) decodeSense(sense)];
    if (decoded.isEmpty || decoded.contains(null)) return null;
    return WordCell(
      term: term,
      senses: decoded.cast<CardSense>(),
      ask: WordAsk.values.byName(ask),
      id: id,
    );
  }
  return null;
}

/// A v2 image or audio block: its payload without `side` reads as v1's, and
/// a 사진 holds `side` exactly while it holds no box, a 소리 always.
Cell? _decodePlaced(
  String type,
  Map<String, Object?> payload,
  Map<Object?, Object?> block,
  String source,
) {
  final side = payload['side'];
  final content = decodeBlock({
    'type': type,
    'id': ?block['id'],
    'payload': {...payload}..remove('side'),
  }, source);
  if (hasBlank(content)) {
    return side == null ? BlankCell(content, id: content.id) : null;
  }
  if (side is! String || !CellSide.values.any((value) => value.name == side)) {
    return null;
  }
  return PlacedCell(content, CellSide.values.byName(side), id: content.id);
}

/// [block] as a 칸 drawn where it was on a front.
Cell _frontCell(Content block) => switch (block) {
  TextContent(:final text, :final id) => TextCell(front: text, id: id),
  SensesContent(:final senses, :final id) => WordCell(
    term: '',
    senses: senses,
    ask: WordAsk.meaning,
    id: id,
  ),
  ClozeContent() || TableContent() => BlankCell(block, id: block.id),
  ImageContent(:final boxes) when boxes.isNotEmpty => BlankCell(
    block,
    id: block.id,
  ),
  ImageContent() ||
  AudioContent() => PlacedCell(block, CellSide.front, id: block.id),
  final UnsupportedContent kept => UnknownCell(kept),
};

/// Whether [back] is the filled text photo import and a copy wrote beside a
/// blanked [front], the one back the frame drops (ADR 0140).
bool _isDerived(List<Content> front, List<Content> back) =>
    front.any(hasBlank) &&
    front.every(
      (block) =>
          block is TextContent ||
          block is ClozeContent ||
          block is TableContent,
    ) &&
    back.length == 1 &&
    back.single is TextContent &&
    (back.single as TextContent).text == plainText(front);

/// Encodes [cells] as [decodeCells] reads them, a 칸 of no id taking one from
/// [newId] so every block has one once written (ADR 0106); a 칸 this build
/// does not know is written as it was stored.
String encodeCells(List<Cell> cells, {required String Function() newId}) =>
    jsonEncode([
      for (final cell in cells)
        switch (cell) {
          TextCell(:final front, :final back, :final markup) => {
            'type': 'text',
            'v': markup ? _markupTextVersion : _frameVersions['text'],
            'id': cell.id ?? newId(),
            'payload': {'front': front, 'back': back},
          },
          WordCell(:final term, :final senses, :final ask) => {
            'type': 'senses',
            'v': _frameVersions['senses'],
            'id': cell.id ?? newId(),
            'payload': {
              'term': term,
              'senses':
                  (_encoded(SensesContent(senses))['payload']
                      as Map<String, Object?>)['senses'],
              'ask': ask.name,
            },
          },
          BlankCell(:final block) => _withFrameVersion(
            _encoded(block),
            cell,
            newId,
          ),
          PlacedCell(:final block, :final side) => _withFrameVersion(
            _encoded(block),
            cell,
            newId,
            side: side,
          ),
          UnknownCell(:final block) => _encoded(block),
        },
    ]);

/// [block] as one stored `{type, v, id, payload}` object.
Map<String, Object?> _encoded(Content block) =>
    (jsonDecode(encodeContent([block])) as List<Object?>).single
        as Map<String, Object?>;

/// [stored] as [cell] keeps it in a 칸 list: at the frame's version of its
/// type when it has one, with the 칸's id and its [side] when placed.
Map<String, Object?> _withFrameVersion(
  Map<String, Object?> stored,
  Cell cell,
  String Function() newId, {
  CellSide? side,
}) => {
  ...stored,
  'v': _frameVersions[stored['type']] ?? stored['v'],
  'id': cell.id ?? newId(),
  'payload': {
    ...stored['payload'] as Map<String, Object?>,
    'side': ?side?.name,
  },
};

/// A card's two side lists as its 칸 list, by the rule of ADR 0137 as amended
/// by ADR 0140; null when either holds a block this build does not know, which
/// stays as it is.
List<Cell>? cellsFromSides(List<Content> front, List<Content> back) {
  if ([...front, ...back].any((block) => block is UnsupportedContent)) {
    return null;
  }
  final cells = [for (final block in front) _frontCell(block)];
  if (_isDerived(front, back)) return cells;
  final words = cells.whereType<WordCell>().toList();
  if (back case [TextContent(:final text)] when words.length == 1) {
    final word = words.single;
    cells[cells.indexOf(word)] = WordCell(
      term: text,
      senses: word.senses,
      ask: WordAsk.meaning,
      id: word.id,
    );
    return cells;
  }
  final frontBlank = front.any(hasBlank);
  for (final block in back) {
    switch (block) {
      case TextContent(:final text):
        _addBackText(cells, text, block.id);
      case SensesContent(:final senses):
        _addBackSenses(cells, senses, block.id);
      case ClozeContent(:final filled) || TableContent(:final filled)
          when frontBlank:
        cells.add(TextCell(back: filled, id: block.id));
      case final ImageContent image when frontBlank && image.boxes.isNotEmpty:
        cells.addAll(_placedOnBack(image));
      case ClozeContent() || TableContent():
        cells.add(BlankCell(block, id: block.id));
      case ImageContent(:final boxes) when boxes.isNotEmpty:
        cells.add(BlankCell(block, id: block.id));
      case ImageContent() || AudioContent():
        cells.add(PlacedCell(block, CellSide.back, id: block.id));
      case UnsupportedContent():
        return null;
    }
  }
  return cells;
}

void _addBackText(List<Cell> cells, String text, String? id) {
  final index = cells.indexWhere(
    (cell) => cell is TextCell && cell.front.isNotEmpty && cell.back.isEmpty,
  );
  if (index < 0) {
    cells.add(TextCell(back: text, id: id));
    return;
  }
  final cell = cells[index] as TextCell;
  cells[index] = TextCell(front: cell.front, back: text, id: cell.id);
}

void _addBackSenses(List<Cell> cells, List<CardSense> senses, String? id) {
  if (cells case [TextCell(:final front, back: '', id: final textId)]) {
    cells[0] = WordCell(
      term: front,
      senses: senses,
      ask: WordAsk.term,
      id: textId,
    );
    return;
  }
  cells.add(WordCell(term: '', senses: senses, ask: WordAsk.term, id: id));
}

/// A boxed [image] beside a front blank: placed on the back without its
/// boxes, with their answers in a 글 of a back alone when it has any.
List<Cell> _placedOnBack(ImageContent image) {
  final answers = [for (final box in image.boxes) ?box.answer];
  return [
    PlacedCell(
      ImageContent(
        media: image.media,
        width: image.width,
        height: image.height,
        boxes: const [],
        rest: image.rest,
        id: image.id,
      ),
      CellSide.back,
      id: image.id,
    ),
    if (answers.isNotEmpty) TextCell(back: answers.join('\n')),
  ];
}

/// [card] as its 칸 list: the list it stores, or its sides converted; null
/// for a card of a later template or holding a block this build does not
/// know.
List<Cell>? cellsOf(Card card) =>
    card.cells ??
    (canEdit(card) ? cellsFromSides(card.front, card.back) : null);

/// The two side lists the current screens read, ADR 0137's projection: every
/// part shown before the reveal as the front, every part added by it as the
/// back, and a 칸 with blanks on the front.
({List<Content> front, List<Content> back}) sidesOf(List<Cell> cells) {
  final front = <Content>[];
  final back = <Content>[];
  for (final cell in cells) {
    switch (cell) {
      case TextCell(front: final text, back: final added, :final markup):
        if (text.isNotEmpty) front.add(TextContent(text, markup: markup));
        if (added.isNotEmpty) back.add(TextContent(added, markup: markup));
      case WordCell(:final term, :final senses, :final ask):
        final word = [if (term.isNotEmpty) TextContent(term)];
        final meanings = [SensesContent(senses)];
        front.addAll(ask == WordAsk.term ? word : meanings);
        back.addAll(ask == WordAsk.term ? meanings : word);
      case BlankCell(:final block):
        front.add(block);
      case PlacedCell(:final block, :final side):
        (side == CellSide.front ? front : back).add(block);
      case UnknownCell(:final block):
        front.add(block);
    }
  }
  return (front: front, back: back);
}

/// The key of a card of [cells]: the text shown before the reveal, every
/// blank filled, in 칸 order (ADR 0137).
CardKey frameKey(List<Cell> cells) =>
    CardKey.fromFront(plainText(sidesOf(cells).front));

/// Why a card of [cells] may not be saved.
enum FrameProblem { emptyText, nothingBefore, nothingAdded }

/// The first rule of ADR 0137 §Each 칸 type that [cells] breaks; null when
/// they hold. A 칸 with blanks counts for both parts.
FrameProblem? frameProblem(List<Cell> cells) {
  bool empty(TextCell cell) =>
      cell.front.trim().isEmpty && cell.back.trim().isEmpty;
  if (cells.whereType<TextCell>().any(empty)) return FrameProblem.emptyText;
  final sides = sidesOf(cells);
  final question = sides.front.any(
    (block) => hasBlank(block) || block is UnsupportedContent,
  );
  if (sides.front.isEmpty) return FrameProblem.nothingBefore;
  if (sides.back.isEmpty && !question) return FrameProblem.nothingAdded;
  return null;
}
