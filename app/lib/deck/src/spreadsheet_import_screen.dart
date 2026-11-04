import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_choice.dart';
import '../../design/app_list_row.dart';
import '../../design/app_section_label.dart';
import '../../design/app_sheet.dart';
import '../../design/bottom_actions.dart';
import '../../design/round_check.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'add_cards.dart';
import 'appearance_sheet.dart';
import 'card_frame.dart';
import 'card_list.dart';
import 'failure.dart';
import 'failure_message.dart';
import 'model.dart';
import 'name_sheet.dart';
import 'providers.dart';
import 'spreadsheet.dart';
import 'spreadsheet_alert.dart';
import 'spreadsheet_cards.dart';
import 'spreadsheet_pick.dart';

/// A file's cards before they are saved: its columns chosen, each card listed
/// and kept or left out, and only "카드 n장 추가" saving them, into [deck] or a
/// deck chosen here. Pops with the deck saved into.
class SpreadsheetImportScreen extends ConsumerStatefulWidget {
  const SpreadsheetImportScreen({super.key, required this.file, this.deck});

  final Spreadsheet file;

  /// The deck it was opened from; with none, the screen offers the choice.
  final DeckId? deck;

  @override
  ConsumerState<SpreadsheetImportScreen> createState() =>
      _SpreadsheetImportScreenState();
}

class _SpreadsheetImportScreenState
    extends ConsumerState<SpreadsheetImportScreen> {
  late Spreadsheet _file = widget.file;
  int _sheet = 0;
  late List<SheetRow> _rows;
  bool _header = false;
  SheetColumns _columns = const SheetColumns(front: 0, back: 1);
  late SheetCards _result;

  /// The rows left out, by number.
  final _excluded = <int>{};

  /// The deck chosen here, or null for a new one.
  Deck? _target;
  RowDuplicate? _duplicate;
  String? _message;
  bool _picking = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _show(0);
  }

  SheetRead get _read => _file.sheets[_sheet].read;

  int get _width => _rows.fold(
    0,
    (width, row) => row.cells.length > width ? row.cells.length : width,
  );

  List<RowCard> get _cards => _columns.distinct ? _result.cards : const [];

  List<RowCard> get _chosen => [
    for (final card in _cards)
      if (!_excluded.contains(card.row)) card,
  ];

  /// Opens sheet [index] with its defaults.
  void _show(int index) {
    _sheet = index;
    _rows = switch (_read) {
      SheetRows(:final rows) => rows,
      RefusedSheet() => const [],
    };
    _header = headerByDefault(_rows);
    _columns = SheetColumns(front: 0, back: _width > 1 ? 1 : 0);
    _excluded.clear();
    _map();
  }

  /// Makes the cards again from the columns and the header row.
  void _map() {
    _result = cardsOfRows(_rows, _columns, header: _header);
    _duplicate = null;
    _message = null;
  }

  void _toggle(int row) => setState(() {
    if (!_excluded.remove(row)) _excluded.add(row);
    _duplicate = null;
    _message = null;
  });

  void _toggleAll() => setState(() {
    if (_chosen.isEmpty) {
      _excluded.clear();
    } else {
      _excluded.addAll(_cards.map((card) => card.row));
    }
    _duplicate = null;
    _message = null;
  });

  /// Reads another file in place of this one; a refused one leaves this one
  /// as it was, saying why.
  Future<void> _anotherFile() async {
    final l10n = AppLocalizations.of(context);
    setState(() => _picking = true);
    final opened = await ref.read(spreadsheetPickProvider).pick();
    if (!mounted) return;
    setState(() {
      _picking = false;
      switch (opened) {
        case Spreadsheet():
          _file = opened;
          _show(0);
        case RefusedFile(:final refusal):
          _duplicate = null;
          _message = spreadsheetRefusalMessage(l10n, refusal);
        case null:
          break;
      }
    });
  }

  /// Closes the screen, once the user confirms discarding unsaved cards.
  Future<void> _leave() async {
    if (_saving) return;
    final l10n = AppLocalizations.of(context);
    final navigator = Navigator.of(context);
    if (_chosen.isNotEmpty) {
      final confirmed = await showAppConfirm(
        context,
        title: l10n.spreadsheetDiscardTitle,
        consequence: l10n.spreadsheetDiscardBody,
        confirmLabel: l10n.discardImport,
      );
      if (!confirmed) return;
    }
    navigator.pop();
  }

  Future<void> _chooseTarget(List<Deck> decks) async {
    final l10n = AppLocalizations.of(context);
    final target = _target;
    final chosen = await showAppChoice<Deck?>(
      context,
      title: l10n.photoTargetTitle,
      options: [
        for (final deck in decks) (title: deck.name, value: deck),
        (title: l10n.newDeck, value: null),
      ],
      current: (value: target),
    );
    if (chosen != null) setState(() => _target = chosen.value);
  }

  /// Saves the chosen cards in one transaction, or names the first that
  /// repeats a card, unless [allowDuplicate].
  Future<void> _save({bool allowDuplicate = false}) async {
    final l10n = AppLocalizations.of(context);
    final navigator = Navigator.of(context);
    final repository = ref.read(deckRepositoryProvider);
    final deck = widget.deck ?? _target?.id;
    final cards = _chosen;
    setState(() {
      _saving = true;
      _duplicate = null;
      _message = null;
    });
    try {
      if (!allowDuplicate) {
        final stored = deck == null
            ? const <Never>{}
            : await repository.listKeys(deck);
        final duplicate = firstDuplicate(cards, stored);
        if (duplicate != null) {
          if (mounted) setState(() => _duplicate = duplicate);
          return;
        }
      }
      final AddTarget target;
      if (deck != null) {
        target = AddToDeck(deck);
      } else {
        if (!mounted) return;
        setState(() => _saving = false);
        final name = await showNameSheet(
          context,
          title: l10n.newDeck,
          action: l10n.create,
        );
        if (name == null || !mounted) return;
        setState(() => _saving = true);
        target = AddToNewDeck(name);
      }
      final added = await repository.addCards(target, [
        for (final card in cards)
          IncomingCard.framed(card.cells, onDuplicate: DuplicateChoice.addNew),
      ], source: const FromFile());
      // A new deck is offered 노트 꾸미기 once it exists, as one made by hand is.
      if (target is AddToNewDeck && mounted) {
        setState(() => _saving = false);
        final chosen = await showDeckAppearanceSheet(context, deck: added.deck);
        if (chosen case (final icon, final color)) {
          await repository.setAppearance(added.deck.id, icon, color);
        }
      }
      navigator.pop(added.deck);
    } on DeckFailure catch (failure) {
      if (mounted) setState(() => _message = describeFailure(l10n, failure));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _rowList(AppLocalizations l10n, List<int> rows) {
    final named = rows.take(5).map(l10n.spreadsheetRow).join(', ');
    return rows.length > 5
        ? l10n.spreadsheetRowsMore(named, rows.length - 5)
        : named;
  }

  /// A column as a choice names it: its letter and the first row's text.
  String _columnName(int column) {
    final letter = _columnLetter(column);
    final first = _rows.firstOrNull?.cells;
    if (first == null || column >= first.length) return letter;
    final sample = first[column].text.split('\n').first;
    if (sample.isEmpty) return letter;
    return '$letter · ${String.fromCharCodes(sample.runes.take(16))}';
  }

  Future<void> _chooseColumn(
    String title,
    int? current,
    _NextColumns next, {
    required bool optional,
  }) async {
    final l10n = AppLocalizations.of(context);
    final chosen = await showAppChoice<int?>(
      context,
      title: title,
      options: [
        if (optional) (title: l10n.spreadsheetNoColumn, value: null),
        for (var column = 0; column < _width; column++)
          (title: _columnName(column), value: column),
      ],
      current: (value: current),
    );
    if (chosen == null) return;
    setState(() {
      _columns = next(chosen.value);
      _map();
    });
  }

  Future<void> _chooseSheet() async {
    final l10n = AppLocalizations.of(context);
    final chosen = await showAppChoice<int>(
      context,
      title: l10n.spreadsheetSheet,
      options: [
        for (final (index, sheet) in _file.sheets.indexed)
          (title: sheet.name, value: index),
      ],
      current: (value: _sheet),
    );
    if (chosen != null) setState(() => _show(chosen.value));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final cards = _cards;
    final chosen = _chosen;
    final distinct = _columns.distinct;
    final read = _read;
    final decks = widget.deck == null
        ? ref.watch(decksProvider).value ?? const <Deck>[]
        : const <Deck>[];
    const gutter = EdgeInsets.symmetric(horizontal: AppSpace.gutter);
    return PopScope(
      canPop: chosen.isEmpty && !_saving,
      onPopInvokedWithResult: (popped, _) {
        if (!popped) unawaited(_leave());
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            tooltip: l10n.close,
            icon: const Icon(LucideIcons.x),
            onPressed: _leave,
          ),
        ),
        body: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: gutter,
              sliver: SliverMainAxisGroup(
                slivers: [
                  SliverList.list(
                    children: [
                      Semantics(
                        header: true,
                        child: Text(
                          l10n.spreadsheetReviewTitle,
                          style: AppType.title.copyWith(
                            color: AppColors.of(context).ink,
                          ),
                        ),
                      ),
                      _FileLine(
                        name: _file.name,
                        onAnother: _picking || _saving ? null : _anotherFile,
                      ),
                      const SizedBox(height: AppSpace.s16),
                    ],
                  ),
                  _ColumnsGroup(
                    sheet: _file.sheets.length > 1
                        ? _file.sheets[_sheet].name
                        : null,
                    columns: _columns,
                    header: _header,
                    columnName: _columnName,
                    onChooseSheet: _saving ? null : _chooseSheet,
                    onChooseColumn: _saving || _width == 0
                        ? null
                        : _chooseColumn,
                    onHeader: _saving
                        ? null
                        : (header) => setState(() {
                            _header = header;
                            _map();
                          }),
                  ),
                  SliverList.list(
                    children: [
                      if (!distinct) ...[
                        const SizedBox(height: AppSpace.s8),
                        SpreadsheetAlert(l10n.spreadsheetDistinct),
                      ],
                      if (read case RefusedSheet(:final refusal)) ...[
                        const SizedBox(height: AppSpace.s8),
                        SpreadsheetAlert(
                          spreadsheetRefusalMessage(l10n, refusal),
                        ),
                      ],
                      if (cards.isNotEmpty && widget.deck == null) ...[
                        const SizedBox(height: AppSpace.s20),
                        AppGroup(
                          children: [
                            AppChoiceRow(
                              title: l10n.photoTargetTitle,
                              value: _target?.name ?? l10n.newDeck,
                              onTap: _saving
                                  ? null
                                  : () => _chooseTarget(decks),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                  if (distinct && read is SheetRows)
                    _RowsHeading(
                      count: cards.length,
                      noneChosen: chosen.isEmpty,
                      skipped: _result.skipped.length,
                      tooLong: _result.tooLong.isEmpty
                          ? null
                          : _rowList(l10n, _result.tooLong),
                      onToggleAll: _saving ? null : _toggleAll,
                    ),
                ],
              ),
            ),
            if (distinct && cards.isNotEmpty)
              SliverPadding(
                padding: gutter.copyWith(bottom: AppSpace.s16),
                sliver: SliverAppGroup(
                  children: [
                    for (final card in cards)
                      _CardRow(
                        key: ValueKey(card.row),
                        card: card,
                        selected: !_excluded.contains(card.row),
                        onToggle: _saving ? null : () => _toggle(card.row),
                      ),
                  ],
                ),
              ),
          ],
        ),
        bottomNavigationBar: cards.isEmpty && _message == null
            ? null
            : _SaveBar(
                duplicate: _duplicate,
                message: _message,
                chosen: cards.isEmpty ? null : chosen.length,
                saving: _saving,
                onLeaveOut: _toggle,
                onAddAnyway: () => _save(allowDuplicate: true),
                onSave: _save,
              ),
      ),
    );
  }
}

/// The file's name, cut to one line, and "다른 파일", which reads another in
/// its place; a null [onAnother] disables it.
class _FileLine extends StatelessWidget {
  const _FileLine({required this.name, required this.onAnother});

  final String name;
  final VoidCallback? onAnother;

  @override
  Widget build(BuildContext context) => Row(
    spacing: AppSpace.s8,
    children: [
      Expanded(
        child: Text(
          name,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppType.bodyStrong.copyWith(
            color: AppColors.of(context).muted,
          ),
        ),
      ),
      AppButton(
        label: AppLocalizations.of(context).spreadsheetAnother,
        variant: AppButtonVariant.text,
        onPressed: onAnother,
      ),
    ],
  );
}

/// How a column choice changes the columns: the columns with [chosen] in
/// that place, null for none.
typedef _NextColumns = SheetColumns Function(int? chosen);

/// The columns under "열", as a sliver: the [sheet] when the file has more than one, the
/// front, the back, the label and the example columns, each named by
/// [columnName], and the header switch. A null callback disables its row.
class _ColumnsGroup extends StatelessWidget {
  const _ColumnsGroup({
    required this.sheet,
    required this.columns,
    required this.header,
    required this.columnName,
    required this.onChooseSheet,
    required this.onChooseColumn,
    required this.onHeader,
  });

  /// The sheet shown, or null where the file holds one.
  final String? sheet;
  final SheetColumns columns;
  final bool header;
  final String Function(int column) columnName;
  final VoidCallback? onChooseSheet;
  final Future<void> Function(
    String title,
    int? current,
    _NextColumns next, {
    required bool optional,
  })?
  onChooseColumn;
  final ValueChanged<bool>? onHeader;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final sheet = this.sheet;
    final onChooseColumn = this.onChooseColumn;
    Widget column(
      String title,
      int? current,
      _NextColumns next, {
      bool optional = false,
    }) => AppChoiceRow(
      title: title,
      value: current == null ? l10n.spreadsheetNoColumn : columnName(current),
      onTap: onChooseColumn == null
          ? null
          : () => onChooseColumn(title, current, next, optional: optional),
    );
    return SliverList.list(
      children: [
        AppSectionLabel(l10n.spreadsheetColumns),
        AppGroup(
          children: [
            if (sheet != null)
              AppChoiceRow(
                title: l10n.spreadsheetSheet,
                value: sheet,
                onTap: onChooseSheet,
              ),
            column(
              l10n.cardFront,
              columns.front,
              (chosen) => columns.copyWith(front: chosen),
            ),
            column(
              l10n.cardBack,
              columns.back,
              (chosen) => columns.copyWith(back: chosen),
            ),
            column(
              l10n.spreadsheetLabelColumn,
              columns.label,
              (chosen) => columns.copyWith(label: (chosen,)),
              optional: true,
            ),
            column(
              l10n.spreadsheetExampleColumn,
              columns.example,
              (chosen) => columns.copyWith(example: (chosen,)),
              optional: true,
            ),
            _HeaderSwitch(value: header, onChanged: onHeader),
          ],
        ),
      ],
    );
  }
}

/// Over the cards, as a sliver: "카드 n장" with "모두 선택" or "모두 빼기" while there is a
/// card, then how many rows were [skipped] and the rows cut for a [tooLong]
/// cell, when there are any.
class _RowsHeading extends StatelessWidget {
  const _RowsHeading({
    required this.count,
    required this.noneChosen,
    required this.skipped,
    required this.tooLong,
    required this.onToggleAll,
  });

  final int count;
  final bool noneChosen;
  final int skipped;

  /// The rows left out for a cell past the limit, as a list names them.
  final String? tooLong;

  final VoidCallback? onToggleAll;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final tooLong = this.tooLong;
    return SliverList.list(
      children: [
        const SizedBox(height: AppSpace.s20),
        AppSectionLabel(
          l10n.cardCount(count),
          trailing: count == 0
              ? null
              : AppButton(
                  label: noneChosen
                      ? l10n.spreadsheetSelectAll
                      : l10n.spreadsheetExcludeAll,
                  variant: AppButtonVariant.text,
                  onPressed: onToggleAll,
                ),
        ),
        if (skipped > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpace.s8),
            child: Semantics(
              liveRegion: true,
              child: Text(
                keepWords(l10n.spreadsheetSkipped(skipped)),
                semanticsLabel: l10n.spreadsheetSkipped(skipped),
                style: AppType.secondary.copyWith(
                  color: AppColors.of(context).muted,
                ),
              ),
            ),
          ),
        if (tooLong != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpace.s8),
            child: SpreadsheetAlert(
              l10n.spreadsheetTooLong(tooLong, spreadsheetCellLimit),
            ),
          ),
      ],
    );
  }
}

/// The foot: the row a save stopped at with its two ways on, what failed,
/// and "카드 n장 추가" for the [chosen] cards while there is a card.
class _SaveBar extends StatelessWidget {
  const _SaveBar({
    required this.duplicate,
    required this.message,
    required this.chosen,
    required this.saving,
    required this.onLeaveOut,
    required this.onAddAnyway,
    required this.onSave,
  });

  final RowDuplicate? duplicate;
  final String? message;

  /// How many cards are chosen, or null where the file gave none.
  final int? chosen;

  final bool saving;
  final ValueChanged<int> onLeaveOut;
  final VoidCallback onAddAnyway;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    final chosen = this.chosen;
    return BottomActions(
      secondary: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        spacing: AppSpace.s8,
        children: [
          if (duplicate case final duplicate?)
            _DuplicateNotice(
              duplicate: duplicate,
              onLeaveOut: () => onLeaveOut(duplicate.row),
              onAddAnyway: onAddAnyway,
            ),
          if (message case final message?) SpreadsheetAlert(message),
          if (chosen != null)
            AppButton(
              label: AppLocalizations.of(context).importAdd(chosen),
              size: AppButtonSize.cta,
              loading: saving,
              onPressed: chosen == 0 ? null : onSave,
            ),
        ],
      ),
    );
  }
}

/// The row of the switch "첫 행은 머리글", read as one control.
class _HeaderSwitch extends StatelessWidget {
  const _HeaderSwitch({required this.value, required this.onChanged});

  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return MergeSemantics(
      child: AppRowSurface(
        onTap: switch (onChanged) {
          final onChanged? => () => onChanged(!value),
          null => null,
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSize.button),
          child: Padding(
            padding: const EdgeInsets.only(
              left: AppSpace.s16,
              right: AppSpace.s8,
            ),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.spreadsheetHeaderRow,
                    style: AppType.bodyStrong,
                  ),
                ),
                Switch(value: value, onChanged: onChanged),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A row's card: its round check, its sides and its sheet row.
class _CardRow extends StatelessWidget {
  const _CardRow({
    super.key,
    required this.card,
    required this.selected,
    required this.onToggle,
  });

  final RowCard card;
  final bool selected;
  final VoidCallback? onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final front = describeContent(l10n, sidesOf(card.cells).front);
    final row = l10n.spreadsheetRow(card.row);
    return Semantics(
      container: true,
      checked: selected,
      label: l10n.spreadsheetRowCard(card.row, front),
      excludeSemantics: true,
      onTap: onToggle,
      child: AppRowSurface(
        onTap: onToggle,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.s12,
            AppSpace.s12,
            AppSpace.s16,
            AppSpace.s12,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpace.s12,
            children: [
              RoundCheck(on: selected),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  spacing: AppSpace.s4,
                  children: [
                    Text(
                      keepWords(front),
                      style: AppType.bodyStrong.copyWith(
                        color: selected ? colors.ink : colors.muted,
                      ),
                    ),
                    Text(
                      keepWords(
                        describeContent(l10n, sidesOf(card.cells).back),
                      ),
                      style: AppType.secondary.copyWith(color: colors.muted),
                    ),
                  ],
                ),
              ),
              Text(row, style: AppType.caption.copyWith(color: colors.muted)),
            ],
          ),
        ),
      ),
    );
  }
}

/// The row a save stopped at, and the two ways on: leaving it out, or adding
/// it beside the card it repeats.
class _DuplicateNotice extends StatelessWidget {
  const _DuplicateNotice({
    required this.duplicate,
    required this.onLeaveOut,
    required this.onAddAnyway,
  });

  final RowDuplicate duplicate;
  final VoidCallback onLeaveOut;
  final VoidCallback onAddAnyway;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SpreadsheetAlert(switch (duplicate) {
          DuplicateOfStored(:final row) => l10n.spreadsheetDuplicateStored(row),
          DuplicateOfRow(:final row, :final earlier) =>
            l10n.spreadsheetDuplicateRow(row, earlier),
        }),
        Wrap(
          spacing: AppSpace.s8,
          children: [
            AppButton(
              label: l10n.spreadsheetLeaveOut(duplicate.row),
              variant: AppButtonVariant.text,
              onPressed: onLeaveOut,
            ),
            AppButton(
              label: l10n.spreadsheetAddAnyway,
              variant: AppButtonVariant.text,
              onPressed: onAddAnyway,
            ),
          ],
        ),
      ],
    );
  }
}

/// A column's letter, as the sheet names it: 0 is A, 26 is AA.
String _columnLetter(int column) {
  var name = '';
  for (var at = column + 1; at > 0; at = (at - 1) ~/ 26) {
    name = String.fromCharCode(65 + (at - 1) % 26) + name;
  }
  return name;
}
