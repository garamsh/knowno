import 'package:unorm_dart/unorm_dart.dart' as unorm;

import 'card_frame.dart';
import 'card_key.dart';
import 'content.dart';
import 'label_presets.dart';
import 'spreadsheet.dart';

/// The most characters, in code points, a cell filling a card field may hold
/// (ADR 0125).
const spreadsheetCellLimit = 500;

/// Which column, from 0, fills each field; a label or example column is
/// optional.
final class SheetColumns {
  const SheetColumns({
    required this.front,
    required this.back,
    this.label,
    this.example,
  });

  final int front;
  final int back;
  final int? label;
  final int? example;

  /// These columns with the ones given replaced; a record so that an optional
  /// column can be cleared.
  SheetColumns copyWith({
    int? front,
    int? back,
    (int?,)? label,
    (int?,)? example,
  }) => SheetColumns(
    front: front ?? this.front,
    back: back ?? this.back,
    label: label == null ? this.label : label.$1,
    example: example == null ? this.example : example.$1,
  );

  /// Whether no two fields read the same column.
  bool get distinct {
    final used = [front, back, ?label, ?example];
    return used.toSet().length == used.length;
  }
}

/// A sheet row's card, named by the [row] it came from.
final class RowCard {
  const RowCard({required this.row, required this.cells});

  final int row;

  /// The card's 칸.
  final List<Cell> cells;
}

/// The cards a sheet's rows make, and the rows that make none: [skipped] as
/// empty, or refused as [tooLong].
final class SheetCards {
  const SheetCards({
    required this.cards,
    required this.skipped,
    required this.tooLong,
  });

  final List<RowCard> cards;
  final List<int> skipped;
  final List<int> tooLong;
}

/// Column names that mark a first row as a header, compared trimmed,
/// NFKC-normalized and case-folded.
const _headerNames = {
  '단어',
  '뜻',
  '의미',
  '앞면',
  '뒷면',
  '라벨',
  '예문',
  '품사',
  'front',
  'back',
  'word',
  'term',
  'meaning',
  'definition',
  'example',
  'label',
};

/// Whether the first row reads as a header by default: the sheet has another
/// row, and either a first-row cell is a common column name, or a first-row
/// cell of text heads a column whose non-empty cells below are all numbers,
/// dates or other values that are not text.
bool headerByDefault(List<SheetRow> rows) {
  if (rows.length < 2) return false;
  final below = rows.skip(1);
  return rows.first.cells.indexed.any((entry) {
    final (column, cell) = entry;
    if (cell.text.isEmpty || !cell.isText) return false;
    if (_headerNames.contains(unorm.nfkc(cell.text).trim().toLowerCase())) {
      return true;
    }
    final values = [
      for (final row in below)
        if (column < row.cells.length && row.cells[column].text.isNotEmpty)
          row.cells[column],
    ];
    return values.isNotEmpty && values.every((under) => !under.isText);
  });
}

/// The cards of [rows] under [columns], below the first row where [header]:
/// a row with an empty front or back is skipped, and one whose used cell is
/// longer than [spreadsheetCellLimit] refused.
SheetCards cardsOfRows(
  List<SheetRow> rows,
  SheetColumns columns, {
  required bool header,
}) {
  final cards = <RowCard>[];
  final skipped = <int>[];
  final tooLong = <int>[];
  String text(SheetRow row, int? column) =>
      column == null || column >= row.cells.length
      ? ''
      : row.cells[column].text;
  for (final row in rows.skip(header ? 1 : 0)) {
    final front = text(row, columns.front);
    final back = text(row, columns.back);
    final label = text(row, columns.label);
    final example = text(row, columns.example);
    if (front.isEmpty || back.isEmpty) {
      skipped.add(row.number);
    } else if ([
      front,
      back,
      label,
      example,
    ].any((cell) => cell.runes.length > spreadsheetCellLimit)) {
      tooLong.add(row.number);
    } else {
      cards.add(
        RowCard(
          row: row.number,
          cells: [_cellOf(columns, front, back, label, example)],
        ),
      );
    }
  }
  return SheetCards(cards: cards, skipped: skipped, tooLong: tooLong);
}

/// A row's 칸: a 글 of its [front] and [back] cells, or, with a label or an
/// example column mapped, a 단어 of [front] and one meaning, the [label]'s words
/// its labels and the [example]'s lines its examples, as direct entry writes
/// them.
Cell _cellOf(
  SheetColumns columns,
  String front,
  String back,
  String label,
  String example,
) => columns.label == null && columns.example == null
    ? TextCell.literal(front: front, back: back)
    : WordCell(
        term: front,
        senses: [
          CardSense(
            labels: labelsOf(label),
            meaning: back,
            examples: [
              for (final line in example.split('\n'))
                if (line.trim().isNotEmpty) line.trim(),
            ],
          ),
        ],
        ask: WordAsk.term,
      );

/// The first of a list of cards whose front repeats a card already stored or
/// an earlier one of the list.
sealed class RowDuplicate {
  const RowDuplicate(this.row);

  final int row;
}

/// [row] repeats a stored card.
final class DuplicateOfStored extends RowDuplicate {
  const DuplicateOfStored(super.row);
}

/// [row] repeats the earlier row [earlier].
final class DuplicateOfRow extends RowDuplicate {
  const DuplicateOfRow(super.row, this.earlier);

  final int earlier;
}

/// The first of [cards] whose key is in [stored] or an earlier card's, or
/// null when none is.
RowDuplicate? firstDuplicate(List<RowCard> cards, Set<CardKey> stored) {
  final earlier = <CardKey, int>{};
  for (final card in cards) {
    final key = frameKey(card.cells);
    if (stored.contains(key)) return DuplicateOfStored(card.row);
    if (earlier[key] case final row?) return DuplicateOfRow(card.row, row);
    earlier[key] = card.row;
  }
  return null;
}
