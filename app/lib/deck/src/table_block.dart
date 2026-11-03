import 'package:flutter/material.dart';

import '../../design/app_chip.dart';
import 'undo_snack_bar.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'cloze_block.dart';
import 'content.dart';
import 'editor_group.dart';

/// A body cell as a 표 block edits it: its field's controller, which
/// draws each span as a block in the text, and the spans, kept through an
/// edit as a cloze line's blanks are (ADR 0110).
class TableCellDraft {
  TableCellDraft([String text = '', Iterable<Span> spans = const []]) {
    _spans.update(text);
    for (final span in spans) {
      _spans.insert(
        TextSelection(baseOffset: span.start, extentOffset: span.end),
      );
    }
    controller = ClozeLineController(text: text, blanks: () => _spans.blanks);
    // Before the field rebuilds, so the spans drawn are the text's.
    controller.addListener(() => _spans.update(controller.text));
  }

  final _spans = ClozeDraft();
  late final ClozeLineController controller;

  /// The spans, in the order of the text.
  List<Span> get spans => _spans.blanks;

  /// The span [selection] lies inside, or null.
  Span? spanAt(TextSelection selection) =>
      selection.isCollapsed ? null : _spans.blankAt(selection);

  /// Makes [selection] a span, replacing the spans it overlaps, when it
  /// holds more than whitespace; whether it did.
  bool addSpan(TextSelection selection) {
    if (controller.text
        .substring(selection.start, selection.end)
        .trim()
        .isEmpty) {
      return false;
    }
    _spans.insert(selection);
    return true;
  }

  void removeSpan(Span span) => _spans.remove(span);

  void clearSpans() {
    for (final span in spans) {
      _spans.remove(span);
    }
  }

  void dispose() => controller.dispose();
}

/// A table as a 표 block edits it: its column headers, its rows of
/// cells, each as many as there are columns and starting with the row's
/// header, its whole-cell blanks, in the order they were chosen, and each
/// cell's spans.
class TableDraft {
  TableDraft._(this.columns, this.rows, this.blanks);

  /// Two columns and two rows, every cell empty, with no blank.
  TableDraft() : this._(_headers(2), [_cells(2), _cells(2)], {});

  /// The columns, rows, blanks and spans of [table].
  factory TableDraft.of(TableContent table) => TableDraft._(
    [for (final text in table.columns) TextEditingController(text: text)],
    [
      for (final (row, cells) in table.rows.indexed)
        [
          for (final (column, text) in cells.indexed)
            TableCellDraft(text, [
              for (final span in table.spans)
                if (span.row == row && span.column == column)
                  (start: span.start, end: span.end),
            ]),
        ],
    ],
    {...table.blanks},
  );

  final List<TextEditingController> columns;
  final List<List<TableCellDraft>> rows;

  /// The cells chosen as blanks whole; a set keeps the order they were added
  /// in.
  final Set<TableBlank> blanks;

  /// Each header's and cell's focus, by its field, so it moves with a row or
  /// column removed before it.
  final _focus = <TextEditingController, FocusNode>{};

  /// The focus of the header or cell edited in [field].
  FocusNode focusOf(TextEditingController field) =>
      _focus.putIfAbsent(field, FocusNode.new);

  void addRow() => rows.add(_cells(columns.length));

  void addColumn() {
    columns.add(TextEditingController());
    for (final row in rows) {
      row.add(TableCellDraft());
    }
  }

  /// Removes the row at [index], its blanks with it, and returns what puts
  /// it back, its blanks included.
  Removal removeRow(int index) {
    final removed = rows.removeAt(index);
    final before = {...blanks};
    _moveBlanks(
      (blank) => switch (blank.row) {
        final row when row == index => null,
        final row when row > index => (row: row - 1, column: blank.column),
        _ => blank,
      },
    );
    return (
      undo: () {
        rows.insert(index, removed);
        _restore(before);
      },
      forget: () {
        for (final cell in removed) {
          cell.dispose();
        }
      },
    );
  }

  /// Removes the column at [index], its blanks with it, and returns what
  /// puts it back, as [removeRow] does.
  Removal removeColumn(int index) {
    final header = columns.removeAt(index);
    final removed = [for (final row in rows) row.removeAt(index)];
    final before = {...blanks};
    _moveBlanks(
      (blank) => switch (blank.column) {
        final column when column == index => null,
        final column when column > index => (
          row: blank.row,
          column: column - 1,
        ),
        _ => blank,
      },
    );
    return (
      undo: () {
        columns.insert(index, header);
        for (final (row, cell) in removed.indexed) {
          rows[row].insert(index, cell);
        }
        _restore(before);
      },
      forget: () {
        header.dispose();
        for (final cell in removed) {
          cell.dispose();
        }
      },
    );
  }

  void _restore(Set<TableBlank> kept) => blanks
    ..clear()
    ..addAll(kept);

  void _moveBlanks(TableBlank? Function(TableBlank blank) move) {
    final moved = [for (final blank in blanks) move(blank)].nonNulls.toList();
    blanks
      ..clear()
      ..addAll(moved);
  }

  /// What "빈칸" does on [cell] with [selection] in its field: with
  /// characters selected, turns the span they lie inside back into text, or
  /// makes them a span, the cell no longer a whole blank; with none, makes
  /// the whole cell a blank, its spans dropped, or a plain cell again
  /// (ADR 0110).
  void toggle(TableBlank cell, TextSelection selection) {
    final draft = rows[cell.row][cell.column];
    if (selection.isValid && !selection.isCollapsed) {
      switch (draft.spanAt(selection)) {
        case final span?:
          draft.removeSpan(span);
        case null when draft.addSpan(selection):
          blanks.remove(cell);
        case null:
      }
      return;
    }
    if (!blanks.remove(cell)) {
      blanks.add(cell);
      draft.clearSpans();
    }
  }

  /// Whether "빈칸" shows on for [cell] with [selection] in its field: the
  /// selection lies inside a span, or, with none, the cell is a whole blank.
  bool isOn(TableBlank cell, TextSelection selection) =>
      selection.isValid && !selection.isCollapsed
      ? rows[cell.row][cell.column].spanAt(selection) != null
      : blanks.contains(cell);

  /// The text of [cell], trimmed.
  String textAt(TableBlank cell) =>
      rows[cell.row][cell.column].controller.text.trim();

  /// The table as typed, every cell trimmed, with its blanks and its spans,
  /// each moved with its cell's trim and cut to it.
  TableContent get table {
    final spans = <CellSpan>[];
    for (final (row, cells) in rows.indexed) {
      for (final (column, cell) in cells.indexed) {
        final text = cell.controller.text;
        final lead = text.length - text.trimLeft().length;
        final trimmed = text.trim();
        for (final span in cell.spans) {
          final start = (span.start - lead).clamp(0, trimmed.length);
          final end = (span.end - lead).clamp(0, trimmed.length);
          if (trimmed.substring(start, end).trim().isNotEmpty) {
            spans.add((row: row, column: column, start: start, end: end));
          }
        }
      }
    }
    return TableContent(
      columns: [for (final header in columns) header.text.trim()],
      rows: [
        for (final row in rows)
          [for (final cell in row) cell.controller.text.trim()],
      ],
      blanks: blanks.toList(),
      spans: spans,
    );
  }

  /// Why the table cannot be saved yet: no blank, whole or span, or a whole
  /// blank on an empty cell; null once it can.
  TableProblem? get problem =>
      blanks.isEmpty && rows.every((row) => row.every((c) => c.spans.isEmpty))
      ? TableProblem.noBlank
      : blanks.any((blank) => textAt(blank).isEmpty)
      ? TableProblem.emptyBlank
      : null;

  /// The field [problem] names, an empty blank's cell; null without one, as
  /// a table with no blank names no field.
  FocusNode? get problemFocus {
    if (problem != TableProblem.emptyBlank) return null;
    final blank = blanks.firstWhere((blank) => textAt(blank).isEmpty);
    return focusOf(rows[blank.row][blank.column].controller);
  }

  void dispose() {
    for (final node in _focus.values) {
      node.dispose();
    }
    for (final header in columns) {
      header.dispose();
    }
    for (final cell in rows.expand((row) => row)) {
      cell.dispose();
    }
  }
}

/// Why a table cannot be saved yet.
enum TableProblem { noBlank, emptyBlank }

List<TextEditingController> _headers(int count) => [
  for (var i = 0; i < count; i++) TextEditingController(),
];

List<TableCellDraft> _cells(int count) => [
  for (var i = 0; i < count; i++) TableCellDraft(),
];

/// A cell of the grid: a row of the table, or -1 for the header row, and a
/// column.
typedef _Cell = ({int row, int column});

/// What "삭제" removes: the selected cell's row or its column.
enum _Remove { row, column }

/// A 표 block's fields: a toolbar over the table, "행 추가", "열 추가", "빈칸" and
/// "삭제", which act on the selected cell, and the table in a grid that
/// scrolls sideways, each header and cell edited in place, a whole blank
/// tinted `brandTint` and a span a block on it in its cell's text. A tap on a
/// cell selects it and edits it; the keyboard's next moves to the next cell.
/// "빈칸" makes the selected text a span, or, with none selected, toggles the
/// whole cell. With [showErrors], what keeps it from being saved shows under
/// it (ADR 0102, ADR 0110).
class TableFields extends StatefulWidget {
  const TableFields({
    super.key,
    required this.draft,
    required this.showErrors,
    required this.onChanged,
    required this.edits,
  });

  final TableDraft draft;
  final bool showErrors;

  /// Called after every change, which this widget makes on [draft].
  final VoidCallback onChanged;

  /// The edits in this 칸's group, which end an undo offered for what this
  /// widget took out.
  final Listenable edits;

  @override
  State<TableFields> createState() => _TableFieldsState();
}

class _TableFieldsState extends State<TableFields> {
  /// The cell the toolbar acts on: the last one tapped or moved to, kept
  /// while a toolbar button is pressed.
  _Cell? _selected;

  /// A cell's width, so that a column lines up from row to row.
  static const _cellWidth = 136.0;

  TableDraft get _draft => widget.draft;

  void _change(VoidCallback change) {
    setState(change);
    widget.onChanged();
  }

  /// The selected cell when it is a body cell, the only kind a blank can be,
  /// and still in the table: a focus change can name a cell a removal just
  /// moved past the end.
  TableBlank? get _selectedBody => switch (_selected) {
    (:final row, :final column)
        when row >= 0 &&
            row < _draft.rows.length &&
            column < _draft.columns.length =>
      (row: row, column: column),
    _ => null,
  };

  /// Runs [add], then, once it is built, puts the focus in [field] of what it
  /// added and scrolls that whole into view, the grid sideways too: the focus
  /// alone shows only the caret.
  void _add(VoidCallback add, TextEditingController Function() field) {
    _change(add);
    final node = _draft.focusOf(field());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      node.requestFocus();
      if (node.context case final shown?) {
        Scrollable.ensureVisible(
          shown,
          alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
        );
      }
    });
  }

  /// Removes the selected cell's row or column at once, and offers to put it
  /// back.
  void _remove(_Remove what) {
    final cell = _selected;
    if (cell == null) return;
    final l10n = AppLocalizations.of(context);
    late final Removal removal;
    _change(() {
      removal = switch (what) {
        _Remove.row => _draft.removeRow(cell.row),
        _Remove.column => _draft.removeColumn(cell.column),
      };
      _selected = null;
    });
    showUndoSnackBar(
      context,
      message: switch (what) {
        _Remove.row => l10n.deletedRow(cell.row + 1),
        _Remove.column => l10n.deletedColumn(cell.column + 1),
      },
      onUndo: () {
        if (mounted) _change(removal.undo);
      },
      onGone: removal.forget,
      endOn: widget.edits,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final problem = widget.showErrors ? _draft.problem : null;
    final selected = _selected;
    final body = _selectedBody;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        Semantics(
          label: l10n.tableToolbar,
          container: true,
          child: Wrap(
            spacing: AppSpace.s4,
            runSpacing: AppSpace.s4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              AppChip.action(
                label: l10n.addRow,
                onPressed: () => _add(
                  _draft.addRow,
                  () => _draft.rows.last.first.controller,
                ),
              ),
              AppChip.action(
                label: l10n.addColumn,
                onPressed: () =>
                    _add(_draft.addColumn, () => _draft.columns.last),
              ),
              _BlankToggle(
                field: body == null
                    ? null
                    : _draft.rows[body.row][body.column].controller,
                selected: (selection) =>
                    body != null && _draft.isOn(body, selection),
                onToggle: body == null
                    ? null
                    : (selection) =>
                          _change(() => _draft.toggle(body, selection)),
              ),
              PopupMenuButton<_Remove>(
                tooltip: l10n.tableRemove,
                enabled: selected != null,
                onSelected: _remove,
                itemBuilder: (_) => [
                  if (selected != null && selected.row >= 0)
                    PopupMenuItem(
                      value: _Remove.row,
                      enabled: _draft.rows.length > 1,
                      child: Text(l10n.deleteRow(selected.row + 1)),
                    ),
                  if (selected != null)
                    PopupMenuItem(
                      value: _Remove.column,
                      enabled: _draft.columns.length > 1,
                      child: Text(l10n.deleteColumn(selected.column + 1)),
                    ),
                ],
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: AppSize.tapTarget,
                    minWidth: AppSize.tapTarget,
                  ),
                  child: Center(
                    widthFactor: 1,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpace.s12,
                      ),
                      child: Text(
                        l10n.tableRemove,
                        style: AppType.bodyStrong.copyWith(
                          color: selected == null ? colors.muted : colors.ink,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Table(
            defaultColumnWidth: const FixedColumnWidth(_cellWidth),
            defaultVerticalAlignment: TableCellVerticalAlignment.top,
            children: [
              TableRow(
                children: [
                  for (final (column, header) in _draft.columns.indexed)
                    _field(header, (row: -1, column: column), l10n),
                ],
              ),
              for (final (row, cells) in _draft.rows.indexed)
                TableRow(
                  children: [
                    for (final (column, cell) in cells.indexed)
                      _field(
                        cell.controller,
                        (row: row, column: column),
                        l10n,
                        problem: problem,
                      ),
                  ],
                ),
            ],
          ),
        ),
        if (problem != null)
          Text(
            keepWords(switch (problem) {
              TableProblem.noBlank => l10n.tableBlankRequired,
              TableProblem.emptyBlank => l10n.tableBlankEmpty,
            }),
            semanticsLabel: switch (problem) {
              TableProblem.noBlank => l10n.tableBlankRequired,
              TableProblem.emptyBlank => l10n.tableBlankEmpty,
            },
            style: AppType.caption.copyWith(color: colors.dontKnowText),
          ),
      ],
    );
  }

  /// A header or a cell, edited in place: a header and each row's first cell
  /// bold, a blank tinted, the selected cell outlined in ink, and a blank
  /// with no text outlined in red once the save is refused.
  Widget _field(
    TextEditingController controller,
    _Cell cell,
    AppLocalizations l10n, {
    TableProblem? problem,
  }) {
    final colors = AppColors.of(context);
    final body = cell.row >= 0 ? (row: cell.row, column: cell.column) : null;
    final blank = body != null && _draft.blanks.contains(body);
    final spans =
        body != null && _draft.rows[body.row][body.column].spans.isNotEmpty;
    final error =
        problem == TableProblem.emptyBlank &&
        blank &&
        _draft.textAt(body).isEmpty;
    final selected = _selected == cell;
    OutlineInputBorder border(Color color, double width) => OutlineInputBorder(
      borderRadius: BorderRadius.zero,
      borderSide: BorderSide(color: color, width: width),
    );
    return Semantics(
      label: [
        if (cell.row < 0)
          l10n.tableHeaderCell(cell.column + 1)
        else
          l10n.tableCell(cell.row + 1, cell.column + 1),
        if (blank || spans) l10n.blank,
      ].join(', '),
      child: Focus(
        // Not a stop of its own: it hears the field inside gain focus.
        canRequestFocus: false,
        skipTraversal: true,
        onFocusChange: (focused) {
          if (focused) setState(() => _selected = cell);
        },
        child: TextField(
          controller: controller,
          focusNode: _draft.focusOf(controller),
          maxLines: null,
          textInputAction: TextInputAction.next,
          style: AppType.body.copyWith(
            color: colors.ink,
            fontWeight: cell.row < 0 || cell.column == 0
                ? FontWeight.w700
                : null,
          ),
          onChanged: (_) => widget.onChanged(),
          decoration: InputDecoration(
            filled: true,
            fillColor: blank
                ? colors.brandTint
                : cell.row < 0
                ? colors.ground
                : colors.surface,
            contentPadding: const EdgeInsets.all(AppSpace.s12),
            enabledBorder: error
                ? border(colors.dontKnowText, 2)
                : selected
                ? border(colors.ink, 2)
                : border(colors.outline, 1),
            focusedBorder: border(error ? colors.dontKnowText : colors.ink, 2),
          ),
        ),
      ),
    );
  }
}

/// "빈칸", a toggle on the selected body cell's [field], or disabled with
/// none: on while [selected] says so of the field's selection, which it
/// follows, and [onToggle] given that selection when pressed.
class _BlankToggle extends StatelessWidget {
  const _BlankToggle({
    required this.field,
    required this.selected,
    required this.onToggle,
  });

  final TextEditingController? field;
  final bool Function(TextSelection selection) selected;
  final ValueChanged<TextSelection>? onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final field = this.field;
    final onToggle = this.onToggle;
    Widget chip(TextSelection selection) => AppChip.action(
      label: l10n.tableBlankToggle,
      selected: field != null && selected(selection),
      onPressed: onToggle == null ? null : () => onToggle(selection),
    );
    if (field == null) return chip(const TextSelection.collapsed(offset: -1));
    return ListenableBuilder(
      listenable: field,
      builder: (context, _) => chip(field.selection),
    );
  }
}
