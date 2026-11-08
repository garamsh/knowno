import 'dart:convert';
import 'dart:ui' show Rect, Size;

import '../../media/media.dart';
import 'markup.dart';

/// A typed block of card content: text, a cloze, a table, a vocabulary
/// entry's senses, an image or a sound. A block's kind is its stored `type`, and its
/// version its `v` (ADR 0106). A new kind adds a subclass and a discriminator value, and
/// stored rows keep their encoding.
///
/// Two blocks are equal when their kind and content are; their [id]s are not
/// compared.
sealed class Content {
  const Content({this.id});

  /// The block's own id, kept across edits so a later block or an edit can
  /// name it; null until the block is first written (ADR 0106).
  final String? id;
}

/// A block of text: plain, or, when [markup], a Markdown subset the engine
/// reads (ADR 0202), which only a 글 of the 칸 frame's version 3 is.
final class TextContent extends Content {
  const TextContent(this.text, {this.markup = false, super.id});

  final String text;

  /// Whether [text] is read as markup, where a plain text shows as written.
  final bool markup;

  /// What [text] reads as without its marks: the text itself, or, for
  /// markup, the plain text the engine gives.
  String get plain => markup ? markupEngine.plainText(text) : text;

  @override
  bool operator ==(Object other) =>
      other is TextContent && other.text == text && other.markup == markup;

  @override
  int get hashCode => Object.hash(text, markup);
}

/// How a cloze's [ClozeContent.text] writes each blank.
const clozeBlank = '___';

/// A line or sentence with blanks. Version 1 writes each blank in its [text]
/// as [clozeBlank], and [answers] fill them in order, one each (ADR 0068).
/// Version 2, [ClozeContent.markup], holds [text] in Anki's syntax,
/// `{{c1::answer}}` or `{{c1::answer::hint}}`, read by the engine (ADR 0202),
/// and no answers.
final class ClozeContent extends Content {
  const ClozeContent(this.text, this.answers, {super.id}) : markup = false;

  /// A cloze of version 2: [source] in Anki's syntax.
  const ClozeContent.markup(String source, {super.id})
    : text = source,
      answers = const [],
      markup = true;

  final String text;
  final List<String> answers;

  /// Whether [text] is Anki's syntax, version 2, rather than `___`.
  final bool markup;

  /// The cloze numbers a version 2 text holds, ascending.
  List<int> get numbers => markup ? markupEngine.clozeNumbers(text) : const [];

  /// [text] with each blank filled by its answer.
  String get filled {
    if (markup) return markupEngine.plainText(text);
    final parts = text.split(clozeBlank);
    return [
      for (final (index, part) in parts.indexed) ...[
        part,
        if (index < answers.length) answers[index],
      ],
    ].join();
  }

  @override
  bool operator ==(Object other) =>
      other is ClozeContent &&
      other.markup == markup &&
      jsonEncode(_payload(other)) == jsonEncode(_payload(this));

  @override
  int get hashCode => jsonEncode(_payload(this)).hashCode;
}

/// A cell of a [TableContent]'s rows to recall whole: its row and column,
/// each counted from 0.
typedef TableBlank = ({int row, int column});

/// A run of a [TableContent] cell's text to recall: the cell's row and
/// column, each counted from 0, and the run's [start] and [end] in the
/// cell's UTF-16 code units, as a cloze blank is a run of its line
/// (ADR 0110).
typedef CellSpan = ({int row, int column, int start, int end});

/// A part of a table cell's text, and whether it is a blank.
typedef CellRun = ({String text, bool blank});

/// A table as the page prints it: its column headers, its rows of cells, each
/// as many as there are columns and starting with the row's header, the
/// cells to recall whole (ADR 0068), and the runs of cells' text to recall
/// (ADR 0110). A cell is a whole blank or holds spans, never both.
final class TableContent extends Content {
  const TableContent({
    required this.columns,
    required this.rows,
    required this.blanks,
    this.spans = const [],
    super.id,
  });

  final List<String> columns;
  final List<List<String>> rows;
  final List<TableBlank> blanks;
  final List<CellSpan> spans;

  /// The cell at [row] and [column] as runs of its text, in order: one blank
  /// run when it is a whole blank, its text split around its spans when it
  /// holds any, and otherwise one plain run.
  List<CellRun> cellRuns(int row, int column) {
    final text = rows[row][column];
    if (blanks.contains((row: row, column: column))) {
      return [(text: text, blank: true)];
    }
    final inCell = [
      for (final span in spans)
        if (span.row == row && span.column == column) span,
    ]..sort((a, b) => a.start.compareTo(b.start));
    final runs = <CellRun>[];
    var at = 0;
    for (final span in inCell) {
      if (at < span.start) {
        runs.add((text: text.substring(at, span.start), blank: false));
      }
      runs.add((text: text.substring(span.start, span.end), blank: true));
      at = span.end;
    }
    if (at < text.length || runs.isEmpty) {
      runs.add((text: text.substring(at), blank: false));
    }
    return runs;
  }

  /// The table as text, every cell shown: the headers on the first line, then
  /// a line per row, cells joined by " | ", as the function composes a table
  /// card's answer.
  String get filled =>
      [columns, ...rows].map((cells) => cells.join(' | ')).join('\n');

  @override
  bool operator ==(Object other) =>
      other is TableContent &&
      jsonEncode(_payload(other)) == jsonEncode(_payload(this));

  @override
  int get hashCode => jsonEncode(_payload(this)).hashCode;
}

/// A part of speech a sense's label names, with the fixed short form every
/// card shows it as, whatever the book prints (ADR 0075).
enum PartOfSpeech {
  noun('명'),
  verb('동'),
  adjective('형'),
  adverb('부'),
  pronoun('대'),
  preposition('전'),
  conjunction('접'),
  interjection('감'),
  determiner('관'),
  numeral('수'),
  particle('조'),
  auxiliary('조동'),
  classifier('양'),
  phrase('구');

  const PartOfSpeech(this.short);

  /// The short form a card shows in brackets, as `[명]`.
  final String short;
}

/// A label the page prints for a sense: a part of speech, or any other label
/// such as a semantic class, a register or a gender. [text] is as printed,
/// without the brackets the page encloses it in.
sealed class SenseLabel {
  const SenseLabel(this.text);

  final String text;

  /// What a card shows inside the label's brackets: a part of speech's short
  /// form, or another label as printed.
  String get shown;
}

final class PartOfSpeechLabel extends SenseLabel {
  const PartOfSpeechLabel(this.category, super.text);

  final PartOfSpeech category;

  @override
  String get shown => category.short;
}

final class OtherLabel extends SenseLabel {
  const OtherLabel(super.text);

  @override
  String get shown => text;
}

/// One meaning of a vocabulary entry, a translation or a definition as
/// printed, with the labels the page prints for it, in order, and its own
/// examples.
final class CardSense {
  const CardSense({
    this.labels = const [],
    required this.meaning,
    this.examples = const [],
  });

  final List<SenseLabel> labels;
  final String meaning;
  final List<String> examples;

  /// The sense as one line of text: each label in brackets, then the
  /// meaning, one space apart, as `[명] 사과`.
  String get line =>
      [for (final label in labels) '[${label.shown}]', meaning].join(' ');

  @override
  bool operator ==(Object other) =>
      other is CardSense &&
      jsonEncode(_senseJson(other)) == jsonEncode(_senseJson(this));

  @override
  int get hashCode => jsonEncode(_senseJson(this)).hashCode;
}

/// A vocabulary entry's senses, one or more, in the page's order (ADR 0075).
final class SensesContent extends Content {
  const SensesContent(this.senses, {super.id});

  final List<CardSense> senses;

  /// One line per sense: the text a search, a screen reader and a merged back
  /// read.
  String get lines => senses.map((sense) => sense.line).join('\n');

  @override
  bool operator ==(Object other) =>
      other is SensesContent &&
      jsonEncode(_payload(other)) == jsonEncode(_payload(this));

  @override
  int get hashCode => jsonEncode(_payload(this)).hashCode;
}

/// A box over an image block's photo, a blank to recall: its left [x], top
/// [y], width [w] and height [h] as fractions, from 0 to 1, of the stored
/// image's own width and height, never of a screen, so it covers the same
/// part of the photo at every size and aspect ratio it is drawn at
/// (ADR 0109). Its [id] is unique in its block; its [answer], when given, is
/// shown in it once revealed. [rest] holds the fields this build does not
/// know, written back as they were read.
final class ImageBox {
  const ImageBox({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.answer,
    this.rest = const {},
  });

  final String id;
  final double x;
  final double y;
  final double w;
  final double h;
  final String? answer;
  final Map<String, Object?> rest;

  /// The part of an image drawn at [size] that the box covers: the one
  /// transform, a scale to [size] from the image's origin, that places the
  /// image places the box.
  Rect rectIn(Size size) => Rect.fromLTWH(
    x * size.width,
    y * size.height,
    w * size.width,
    h * size.height,
  );

  /// The box with its place, size or answer changed, its id and unknown
  /// fields kept.
  ImageBox copyWith({
    double? x,
    double? y,
    double? w,
    double? h,
    String? Function()? answer,
  }) => ImageBox(
    id: id,
    x: x ?? this.x,
    y: y ?? this.y,
    w: w ?? this.w,
    h: h ?? this.h,
    answer: answer == null ? this.answer : answer(),
    rest: rest,
  );
}

/// A photo the `media` domain stores, named by its [media] id, with its
/// intrinsic [width] and [height] in pixels, so its aspect ratio is known
/// before the file is read, and the [boxes] over it to recall (ADR 0109).
/// [rest] holds the payload's fields this build does not know, written back
/// as they were read.
final class ImageContent extends Content {
  const ImageContent({
    required this.media,
    required this.width,
    required this.height,
    this.boxes = const [],
    this.rest = const {},
    super.id,
  });

  final MediaId media;
  final int width;
  final int height;
  final List<ImageBox> boxes;
  final Map<String, Object?> rest;

  /// The image's width over its height.
  double get aspectRatio => width / height;

  /// The block with [boxes] in place of its own.
  ImageContent withBoxes(List<ImageBox> boxes) => ImageContent(
    media: media,
    width: width,
    height: height,
    boxes: boxes,
    rest: rest,
    id: id,
  );

  @override
  bool operator ==(Object other) =>
      other is ImageContent &&
      jsonEncode(_payload(other)) == jsonEncode(_payload(this));

  @override
  int get hashCode => jsonEncode(_payload(this)).hashCode;
}

/// A recording or an audio file the `media` domain stores, named by its
/// [media] id, never a URL, with how long it plays, so its length shows
/// before the file is read (ADR 0112). [rest] holds the payload's fields
/// this build does not know, written back as they were read.
final class AudioContent extends Content {
  const AudioContent({
    required this.media,
    required this.duration,
    this.rest = const {},
    super.id,
  });

  final MediaId media;
  final Duration duration;
  final Map<String, Object?> rest;

  @override
  bool operator ==(Object other) =>
      other is AudioContent &&
      jsonEncode(_payload(other)) == jsonEncode(_payload(this));

  @override
  int get hashCode => jsonEncode(_payload(this)).hashCode;
}

/// A stored block this build cannot read: a type it does not know, or a
/// known type at a version above the one it writes. It is kept intact,
/// [stored] written back as it was read, so saving the card again does not
/// lose it, and it is shown as needing an update.
final class UnsupportedContent extends Content {
  const UnsupportedContent(this.type, this.payload, {this.stored});

  final String type;
  final Object? payload;

  /// The whole stored block as it was read, written back unchanged; null for
  /// a block made in this build.
  final Map<String, Object?>? stored;
}

/// Whether [block] is one that holds blanks to recall: a cloze or a table,
/// each stored with one or more, or an image with a box over it
/// (ADR 0109); a cloze still being written before its first blank counts,
/// so the editor's preview draws it as it will be.
bool hasBlank(Content block) => switch (block) {
  ClozeContent() || TableContent() => true,
  ImageContent(:final boxes) => boxes.isNotEmpty,
  TextContent() ||
  SensesContent() ||
  AudioContent() ||
  UnsupportedContent() => false,
};

/// The media ids of the images and sounds in [blocks], in order, those of
/// a later version's image or sound among them (ADR 0137), since a file is
/// released once no block names it.
Set<MediaId> mediaOf(List<Content> blocks) => {
  for (final block in blocks)
    if (block case ImageContent(:final media) || AudioContent(:final media))
      media
    else if (block case UnsupportedContent(
      type: _imageType || _audioType,
      payload: {'media': final String media},
    ))
      MediaId(media),
};

/// The sounds in [blocks], in order (ADR 0112).
List<AudioContent> audioOf(List<Content> blocks) =>
    blocks.whereType<AudioContent>().toList();

const _textType = 'text';
const _clozeType = 'cloze';
const _tableType = 'table';
const _sensesType = 'senses';
const _imageType = 'image';
const _audioType = 'audio';
const _partOfSpeechKind = 'part_of_speech';
const _otherKind = 'other';

Map<String, Object?> _senseJson(CardSense sense) => {
  'labels': [
    for (final label in sense.labels)
      switch (label) {
        PartOfSpeechLabel(:final category, :final text) => {
          'kind': _partOfSpeechKind,
          'category': category.name,
          'text': text,
        },
        OtherLabel(:final text) => {
          'kind': _otherKind,
          'category': null,
          'text': text,
        },
      },
  ],
  'meaning': sense.meaning,
  'examples': sense.examples,
};

String _type(Content block) => switch (block) {
  TextContent() => _textType,
  ClozeContent() => _clozeType,
  TableContent() => _tableType,
  SensesContent() => _sensesType,
  ImageContent() => _imageType,
  AudioContent() => _audioType,
  UnsupportedContent(:final type) => type,
};

/// The steps that upgrade each known type's payload, one per version: the
/// first turns a v1 payload into a v2 one, and so on. The version a type is
/// written at is one more than its steps: a table at v2, every other type
/// at v1.
const Map<String, List<Object? Function(Object? payload)>> blockUpcasters = {
  _textType: [],
  _clozeType: [_unchanged],
  _tableType: [_tableWithSpans],
  _sensesType: [],
  _imageType: [],
  _audioType: [],
};

/// A step that leaves the payload as it is: a version 2 cloze is read by its
/// version, not upgraded from version 1.
Object? _unchanged(Object? payload) => payload;

/// A v1 table's payload as v2's: its blanks stay whole cells, and it holds
/// no span (ADR 0110). A payload that is not an object is left to fail
/// decoding.
Object? _tableWithSpans(Object? payload) => switch (payload) {
  final Map<String, Object?> fields => {...fields, 'spans': const <Object?>[]},
  _ => payload,
};

/// The version [block] is written at: a version 2 cloze at 2, any other
/// cloze at 1, and otherwise the version this build writes its type at. A
/// markup text is written only in the 칸 frame, at its version 3.
int _writtenVersion(Content block) => switch (block) {
  TextContent(markup: true) => throw StateError(
    'a markup text is written only as a 글 of the 칸 frame',
  ),
  ClozeContent(markup: true) => 2,
  ClozeContent() => 1,
  _ => blockVersion(_type(block)),
};

/// The version this build writes a block of [type] at.
int blockVersion(
  String type, {
  Map<String, List<Object? Function(Object?)>> steps = blockUpcasters,
}) => (steps[type]?.length ?? 0) + 1;

/// [payload], stored at [version] of [type], upgraded step by step to the
/// version this build writes; [version] must not be above it.
Object? upcastPayload(
  String type,
  int version,
  Object? payload, {
  Map<String, List<Object? Function(Object?)>> steps = blockUpcasters,
}) {
  var upgraded = payload;
  final typeSteps = steps[type] ?? const [];
  for (var step = version - 1; step < typeSteps.length; step++) {
    upgraded = typeSteps[step](upgraded);
  }
  return upgraded;
}

/// [block] given [id], its content unchanged; a block this build cannot read
/// is returned as it is, since it is written back unchanged.
Content withBlockId(Content block, String id) => switch (block) {
  TextContent(:final text, :final markup) => TextContent(
    text,
    markup: markup,
    id: id,
  ),
  ClozeContent(:final text, markup: true) => ClozeContent.markup(text, id: id),
  ClozeContent(:final text, :final answers) => ClozeContent(
    text,
    answers,
    id: id,
  ),
  TableContent(:final columns, :final rows, :final blanks, :final spans) =>
    TableContent(
      columns: columns,
      rows: rows,
      blanks: blanks,
      spans: spans,
      id: id,
    ),
  SensesContent(:final senses) => SensesContent(senses, id: id),
  ImageContent() => ImageContent(
    media: block.media,
    width: block.width,
    height: block.height,
    boxes: block.boxes,
    rest: block.rest,
    id: id,
  ),
  AudioContent(:final media, :final duration, :final rest) => AudioContent(
    media: media,
    duration: duration,
    rest: rest,
    id: id,
  ),
  UnsupportedContent() => block,
};

Object? _payload(Content block) => switch (block) {
  TextContent(:final text) => {'text': text},
  ClozeContent(:final text, markup: true) => {'text': text},
  ClozeContent(:final text, :final answers) => {
    'text': text,
    'answers': answers,
  },
  TableContent(:final columns, :final rows, :final blanks, :final spans) => {
    'columns': columns,
    'rows': rows,
    'blanks': [
      for (final (:row, :column) in blanks) {'row': row, 'column': column},
    ],
    'spans': [
      for (final (:row, :column, :start, :end) in spans)
        {'row': row, 'column': column, 'start': start, 'end': end},
    ],
  },
  SensesContent(:final senses) => {
    'senses': [for (final sense in senses) _senseJson(sense)],
  },
  ImageContent(:final media, :final width, :final height, :final boxes) => {
    ...block.rest,
    'media': media.value,
    'width': width,
    'height': height,
    'boxes': [
      for (final box in boxes)
        {
          ...box.rest,
          'id': box.id,
          'x': box.x,
          'y': box.y,
          'w': box.w,
          'h': box.h,
          'answer': ?box.answer,
        },
    ],
  },
  AudioContent(:final media, :final duration) => {
    ...block.rest,
    'media': media.value,
    'duration_ms': duration.inMilliseconds,
  },
  UnsupportedContent(:final payload) => payload,
};

/// Encodes [blocks] as a JSON array of `{type, v, id, payload}` objects,
/// each at the version this build writes and `id` only when the block has
/// one; a block this build cannot read is written as it was stored.
String encodeContent(List<Content> blocks) => jsonEncode([
  for (final block in blocks)
    switch (block) {
      UnsupportedContent(:final stored?) => stored,
      UnsupportedContent(:final type, :final payload) => {
        'type': type,
        'payload': payload,
      },
      _ => {
        'type': _type(block),
        'v': _writtenVersion(block),
        'id': ?block.id,
        'payload': _payload(block),
      },
    },
]);

/// Decodes what [encodeContent] wrote, and the blocks of earlier builds: a
/// block with no `v` is read as v1, and an older `v` is upgraded through
/// [upcastPayload]. An unknown `type`, or a `v` above what this build
/// writes, becomes [UnsupportedContent]; input that is not that shape at
/// all, a `v` that is not a positive integer, an `id` that is not text, or a
/// known block whose payload breaks its shape, throws [FormatException].
List<Content> decodeContent(String encoded) {
  final decoded = jsonDecode(encoded);
  if (decoded is! List<Object?>) {
    throw FormatException('content is not a list', encoded);
  }
  return [for (final block in decoded) decodeBlock(block, encoded)];
}

/// One stored block as [decodeContent] reads it, named [source] in a
/// [FormatException].
Content decodeBlock(Object? block, String source) {
  if (block is! Map<String, Object?>) {
    throw FormatException('content block is not an object', source);
  }
  final type = block['type'];
  if (type is! String) {
    throw FormatException('content block has no string type', source);
  }
  final version = block['v'] ?? 1;
  if (version is! int || version < 1) {
    throw FormatException('a $type block has no positive version', source);
  }
  final id = block['id'];
  if (id != null && id is! String) {
    throw FormatException('a $type block has an id that is not text', source);
  }
  if (!blockUpcasters.containsKey(type) || version > blockVersion(type)) {
    return UnsupportedContent(type, block['payload'], stored: block);
  }
  final payload = upcastPayload(type, version, block['payload']);
  // A version 2 cloze that is not Anki's syntax, such as a version 1 payload
  // marked 2, is a block this build cannot read, kept as stored.
  if (type == _clozeType &&
      version >= 2 &&
      payload is Map<String, Object?> &&
      _decodeClozeMarkup(payload) == null) {
    return UnsupportedContent(type, block['payload'], stored: block);
  }
  final decoded = switch ((type, payload)) {
    (_textType, {'text': final String text}) => TextContent(text),
    (_clozeType, final Map<String, Object?> fields) =>
      version >= 2 ? _decodeClozeMarkup(fields) : _decodeCloze(fields),
    (_tableType, final Map<String, Object?> fields) => _decodeTable(fields),
    (_sensesType, {'senses': final List<Object?> senses}) => _decodeSenses(
      senses,
    ),
    (_imageType, final Map<String, Object?> fields) => _decodeImage(fields),
    (_audioType, final Map<String, Object?> fields) => _decodeAudio(fields),
    _ => null,
  };
  if (decoded == null) {
    throw FormatException('a $type block breaks its shape', source);
  }
  return id is String ? withBlockId(decoded, id) : decoded;
}

/// A cloze of version 2: a text in Anki's syntax holding at least one cloze;
/// null otherwise.
ClozeContent? _decodeClozeMarkup(Map<String, Object?> fields) =>
    switch (fields) {
      {'text': final String text}
          when markupEngine.clozeNumbers(text).isNotEmpty =>
        ClozeContent.markup(text),
      _ => null,
    };

/// A cloze of text with one or more blanks, each with a non-empty answer;
/// null otherwise.
ClozeContent? _decodeCloze(Map<String, Object?> fields) {
  if (fields
      case {'text': final String text, 'answers': final List<Object?> answers}
      when answers.isNotEmpty &&
          answers.every(
            (answer) => answer is String && answer.trim().isNotEmpty,
          ) &&
          text.split(clozeBlank).length - 1 == answers.length) {
    return ClozeContent(text, answers.cast<String>());
  }
  return null;
}

/// A table of one or more columns and rows, each row as many cells as there
/// are columns, and one or more blanks inside it, whole cells and spans
/// together: each whole cell distinct and holding text, and each span a run
/// of a cell's text holding more than whitespace, overlapping no other span
/// and in no whole cell (ADR 0110); null otherwise.
TableContent? _decodeTable(Map<String, Object?> fields) {
  List<String>? strings(Object? value) =>
      value is List<Object?> && value.every((cell) => cell is String)
      ? value.cast<String>()
      : null;
  if (fields case {
    'columns': final Object? columnsValue,
    'rows': final List<Object?> rowsValue,
    'blanks': final List<Object?> blanksValue,
    'spans': final List<Object?> spansValue,
  }) {
    final columns = strings(columnsValue);
    final rows = [for (final row in rowsValue) strings(row)];
    final blanks = [
      for (final blank in blanksValue)
        if (blank case {'row': final int row, 'column': final int column})
          (row: row, column: column),
    ];
    final spans = [
      for (final span in spansValue)
        if (span case {
          'row': final int row,
          'column': final int column,
          'start': final int start,
          'end': final int end,
        })
          (row: row, column: column, start: start, end: end),
    ];
    if (columns == null ||
        columns.isEmpty ||
        rows.isEmpty ||
        rows.any((row) => row == null || row.length != columns.length) ||
        blanks.isEmpty && spans.isEmpty ||
        blanks.length != blanksValue.length ||
        spans.length != spansValue.length ||
        blanks.toSet().length != blanks.length) {
      return null;
    }
    final cells = rows.cast<List<String>>();
    bool inTable(int row, int column) =>
        row >= 0 &&
        row < cells.length &&
        column >= 0 &&
        column < columns.length;
    final blanksHold = blanks.every(
      (blank) =>
          inTable(blank.row, blank.column) &&
          cells[blank.row][blank.column].trim().isNotEmpty,
    );
    bool overlap(CellSpan a, CellSpan b) =>
        a.row == b.row &&
        a.column == b.column &&
        a.start < b.end &&
        b.start < a.end;
    final spansHold = [
      for (final (index, span) in spans.indexed)
        inTable(span.row, span.column) &&
            !blanks.contains((row: span.row, column: span.column)) &&
            span.start >= 0 &&
            span.start < span.end &&
            span.end <= cells[span.row][span.column].length &&
            cells[span.row][span.column]
                .substring(span.start, span.end)
                .trim()
                .isNotEmpty &&
            !spans.skip(index + 1).any((other) => overlap(span, other)),
    ].every((holds) => holds);
    return blanksHold && spansHold
        ? TableContent(
            columns: columns,
            rows: cells,
            blanks: blanks,
            spans: spans,
          )
        : null;
  }
  return null;
}

/// How far past 1 a box's far edge may fall, for a fraction's rounding.
const _boxTolerance = 1e-9;

/// An image of a non-empty media id, a positive whole width and height, and
/// boxes, each [_decodeBox]'s, their ids distinct; null otherwise. Fields it
/// does not know are kept.
ImageContent? _decodeImage(Map<String, Object?> fields) {
  if (fields
      case {
        'media': final String media,
        'width': final int width,
        'height': final int height,
        'boxes': final List<Object?> boxesValue,
      }
      when media.isNotEmpty && width > 0 && height > 0) {
    final boxes = [
      for (final box in boxesValue)
        box is Map<String, Object?> ? _decodeBox(box) : null,
    ];
    if (boxes.contains(null)) return null;
    final decoded = boxes.cast<ImageBox>();
    if (decoded.map((box) => box.id).toSet().length != decoded.length) {
      return null;
    }
    return ImageContent(
      media: MediaId(media),
      width: width,
      height: height,
      boxes: decoded,
      rest: {...fields}
        ..remove('media')
        ..remove('width')
        ..remove('height')
        ..remove('boxes'),
    );
  }
  return null;
}

/// A box of a non-empty id, an optional text answer, and a left and top at
/// or above 0 and a width and height above 0 whose far edges fall inside
/// the image; null otherwise. Fields it does not know are kept.
ImageBox? _decodeBox(Map<String, Object?> box) {
  if (box
      case {
        'id': final String id,
        'x': final num x,
        'y': final num y,
        'w': final num w,
        'h': final num h,
      }
      when id.isNotEmpty &&
          x >= 0 &&
          y >= 0 &&
          w > 0 &&
          h > 0 &&
          x + w <= 1 + _boxTolerance &&
          y + h <= 1 + _boxTolerance) {
    final String? answer;
    switch (box['answer']) {
      case null:
        answer = null;
      case final String text:
        answer = text;
      default:
        return null;
    }
    return ImageBox(
      id: id,
      x: x.toDouble(),
      y: y.toDouble(),
      w: w.toDouble(),
      h: h.toDouble(),
      answer: answer,
      rest: {...box}
        ..remove('id')
        ..remove('x')
        ..remove('y')
        ..remove('w')
        ..remove('h')
        ..remove('answer'),
    );
  }
  return null;
}

/// A sound of a non-empty media id and a positive whole `duration_ms`; null
/// otherwise. Fields it does not know are kept.
AudioContent? _decodeAudio(Map<String, Object?> fields) {
  if (fields
      case {'media': final String media, 'duration_ms': final int durationMs}
      when media.isNotEmpty && durationMs > 0) {
    return AudioContent(
      media: MediaId(media),
      duration: Duration(milliseconds: durationMs),
      rest: {...fields}
        ..remove('media')
        ..remove('duration_ms'),
    );
  }
  return null;
}

/// One or more senses, each [decodeSense]'s; null otherwise.
SensesContent? _decodeSenses(List<Object?> senses) {
  final decoded = [for (final sense in senses) decodeSense(sense)];
  return decoded.isEmpty || decoded.contains(null)
      ? null
      : SensesContent(decoded.cast<CardSense>());
}

/// A sense as the `senses` block and the extraction function write it:
/// `{labels, meaning, examples}`, its meaning non-empty text, its examples
/// text, and each label `{kind, category, text}`, a `part_of_speech` with a
/// [PartOfSpeech] name or an `other` with a null category, its text
/// non-empty; null otherwise (ADR 0075).
CardSense? decodeSense(Object? sense) {
  if (sense
      case {
        'labels': final List<Object?> labels,
        'meaning': final String meaning,
        'examples': final List<Object?> examples,
      }
      when meaning.trim().isNotEmpty && examples.every((e) => e is String)) {
    final decoded = [for (final label in labels) _decodeLabel(label)];
    if (decoded.contains(null)) return null;
    return CardSense(
      labels: decoded.cast<SenseLabel>(),
      meaning: meaning,
      examples: examples.cast<String>(),
    );
  }
  return null;
}

SenseLabel? _decodeLabel(Object? label) => switch (label) {
  {
    'kind': _partOfSpeechKind,
    'category': final String category,
    'text': final String text,
  }
      when text.trim().isNotEmpty =>
    switch (PartOfSpeech.values.where((p) => p.name == category).firstOrNull) {
      final category? => PartOfSpeechLabel(category, text),
      null => null,
    },
  {'kind': _otherKind, 'category': null, 'text': final String text}
      when text.trim().isNotEmpty =>
    OtherLabel(text),
  _ => null,
};

/// The text of [blocks], joined by newlines: a text block's text, a cloze's
/// and a table's filled form, and an image's media id followed by its boxes'
/// answers, so two photos never share a card key, and a sound's media id,
/// so two sounds never do either. The card key and a merged back read it.
String plainText(List<Content> blocks) => [
  for (final block in blocks)
    switch (block) {
      TextContent(:final plain) => plain,
      ClozeContent(:final filled) || TableContent(:final filled) => filled,
      SensesContent(:final lines) => lines,
      ImageContent(:final media, :final boxes) => [
        media.value,
        for (final box in boxes) ?box.answer,
      ].join('\n'),
      AudioContent(:final media) => media.value,
      UnsupportedContent() => null,
    },
].nonNulls.join('\n');
