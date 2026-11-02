import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/app_section_label.dart';
import '../../design/app_sheet.dart';
import '../../design/bottom_actions.dart';
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
import 'spreadsheet_cards.dart';

/// How the user picks a spreadsheet: the device's file picker, which a test
/// replaces. Resolves to null when the picker is cancelled.
abstract interface class SpreadsheetPick {
  Future<OpenedFile?> pick();
}

/// The device's file picker through `file_picker`.
final class DeviceSpreadsheetPick implements SpreadsheetPick {
  const DeviceSpreadsheetPick();

  @override
  Future<OpenedFile?> pick() async {
    try {
      final file = await FilePicker.pickFile(
        type: FileType.custom,
        allowedExtensions: const ['xlsx', 'csv'],
      );
      if (file == null) return null;
      return await openSpreadsheet(
        file.name,
        await file.length() ?? 0,
        file.readAsBytes,
      );
    } on PlatformException {
      return const RefusedFile(SpreadsheetRefusal.notRead);
    } on FileSystemException {
      return const RefusedFile(SpreadsheetRefusal.notRead);
    }
  }
}

/// How the user picks a spreadsheet.
final spreadsheetPickProvider = Provider<SpreadsheetPick>(
  (ref) => const DeviceSpreadsheetPick(),
);

/// Adds cards from a spreadsheet, into [deck] or, with none, a deck chosen on
/// the way: the sheet stating the limits, the device's picker, then the
/// review. Resolves to the deck saved into, or null when nothing was saved.
Future<Deck?> importFromSpreadsheet(BuildContext context, DeckId? deck) async {
  final navigator = Navigator.of(context);
  final file = await showAppSheet<Spreadsheet>(
    context,
    builder: (_) => const _StartSheet(),
  );
  if (file == null) return null;
  return navigator.push<Deck>(
    MaterialPageRoute(
      builder: (_) => SpreadsheetImportScreen(file: file, deck: deck),
    ),
  );
}

String _refusalMessage(AppLocalizations l10n, SpreadsheetRefusal refusal) =>
    switch (refusal) {
      SpreadsheetRefusal.wrongType => l10n.spreadsheetWrongType,
      SpreadsheetRefusal.tooLarge => l10n.spreadsheetTooLarge,
      SpreadsheetRefusal.notUtf8 => l10n.spreadsheetNotUtf8,
      SpreadsheetRefusal.unreadable => l10n.spreadsheetUnreadable,
      SpreadsheetRefusal.tooManyRows => l10n.spreadsheetTooManyRows,
      SpreadsheetRefusal.notRead => l10n.spreadsheetNotRead,
    };

/// A sentence in red, read out as it appears.
class _Alert extends StatelessWidget {
  const _Alert(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Text(
      keepWords(text),
      semanticsLabel: text,
      style: AppType.secondary.copyWith(
        color: AppColors.of(context).dontKnowText,
      ),
    ),
  );
}

/// The sheet that states the limits and picks the file; a refused file stays
/// on it, with why, and an opened one closes it.
class _StartSheet extends ConsumerStatefulWidget {
  const _StartSheet();

  @override
  ConsumerState<_StartSheet> createState() => _StartSheetState();
}

class _StartSheetState extends ConsumerState<_StartSheet> {
  bool _reading = false;
  SpreadsheetRefusal? _refusal;

  Future<void> _pick() async {
    setState(() {
      _reading = true;
      _refusal = null;
    });
    final opened = await ref.read(spreadsheetPickProvider).pick();
    if (!mounted) return;
    switch (opened) {
      case Spreadsheet():
        Navigator.of(context).pop(opened);
      case RefusedFile(:final refusal):
        setState(() {
          _reading = false;
          _refusal = refusal;
        });
      case null:
        setState(() => _reading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final refusal = _refusal;
    return AppSheet(
      title: l10n.spreadsheetStartTitle,
      body: l10n.spreadsheetStartBody,
      content: refusal == null ? null : _Alert(_refusalMessage(l10n, refusal)),
      actions: [
        AppButton(
          label: l10n.spreadsheetChoose,
          size: AppButtonSize.cta,
          loading: _reading,
          loadingLabel: l10n.spreadsheetReading,
          onPressed: _pick,
        ),
      ],
    );
  }
}

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
          _message = _refusalMessage(l10n, refusal);
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
    final chosen = await _showChoice<Deck?>(
      context,
      title: l10n.photoTargetTitle,
      options: [
        for (final deck in decks) (deck.name, deck),
        (l10n.newDeck, null),
      ],
      current: target,
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
      // A new deck is offered 덱 꾸미기 once it exists, as one made by hand is.
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
    SheetColumns Function(int? chosen) next, {
    required bool optional,
  }) async {
    final l10n = AppLocalizations.of(context);
    final chosen = await _showChoice<int?>(
      context,
      title: title,
      options: [
        if (optional) (l10n.spreadsheetNoColumn, null),
        for (var column = 0; column < _width; column++)
          (_columnName(column), column),
      ],
      current: current,
    );
    if (chosen == null) return;
    setState(() {
      _columns = next(chosen.value);
      _map();
    });
  }

  Future<void> _chooseSheet() async {
    final l10n = AppLocalizations.of(context);
    final chosen = await _showChoice<int>(
      context,
      title: l10n.spreadsheetSheet,
      options: [
        for (final (index, sheet) in _file.sheets.indexed) (sheet.name, index),
      ],
      current: _sheet,
    );
    if (chosen != null) setState(() => _show(chosen.value));
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final cards = _cards;
    final chosen = _chosen;
    final distinct = _columns.distinct;
    final read = _read;
    final decks = widget.deck == null
        ? ref.watch(decksProvider).value ?? const <Deck>[]
        : const <Deck>[];
    const gutter = EdgeInsets.symmetric(horizontal: AppSpace.gutter);
    final columns = _columns;
    Widget column(
      String title,
      int? current,
      SheetColumns Function(int? chosen) next, {
      bool optional = false,
    }) => _ChoiceRow(
      title: title,
      value: current == null ? l10n.spreadsheetNoColumn : _columnName(current),
      onTap: _saving || _width == 0
          ? null
          : () => _chooseColumn(title, current, next, optional: optional),
    );
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
              sliver: SliverList.list(
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      l10n.spreadsheetReviewTitle,
                      style: AppType.title.copyWith(color: colors.ink),
                    ),
                  ),
                  Row(
                    spacing: AppSpace.s8,
                    children: [
                      Expanded(
                        child: Text(
                          _file.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppType.bodyStrong.copyWith(
                            color: colors.muted,
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: _picking || _saving ? null : _anotherFile,
                        child: Text(l10n.spreadsheetAnother),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpace.s16),
                  AppSectionLabel(l10n.spreadsheetColumns),
                  AppGroup(
                    children: [
                      if (_file.sheets.length > 1)
                        _ChoiceRow(
                          title: l10n.spreadsheetSheet,
                          value: _file.sheets[_sheet].name,
                          onTap: _saving ? null : _chooseSheet,
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
                      _HeaderSwitch(
                        value: _header,
                        onChanged: _saving
                            ? null
                            : (header) => setState(() {
                                _header = header;
                                _map();
                              }),
                      ),
                    ],
                  ),
                  if (!distinct) ...[
                    const SizedBox(height: AppSpace.s8),
                    _Alert(l10n.spreadsheetDistinct),
                  ],
                  if (read case RefusedSheet(:final refusal)) ...[
                    const SizedBox(height: AppSpace.s8),
                    _Alert(_refusalMessage(l10n, refusal)),
                  ],
                  if (cards.isNotEmpty && widget.deck == null) ...[
                    const SizedBox(height: AppSpace.s20),
                    AppGroup(
                      children: [
                        _ChoiceRow(
                          title: l10n.photoTargetTitle,
                          value: _target?.name ?? l10n.newDeck,
                          onTap: _saving ? null : () => _chooseTarget(decks),
                        ),
                      ],
                    ),
                  ],
                  if (distinct && read is SheetRows) ...[
                    const SizedBox(height: AppSpace.s20),
                    AppSectionLabel(
                      l10n.cardCount(cards.length),
                      trailing: cards.isEmpty
                          ? null
                          : TextButton(
                              onPressed: _saving ? null : _toggleAll,
                              child: Text(
                                chosen.isEmpty
                                    ? l10n.spreadsheetSelectAll
                                    : l10n.spreadsheetExcludeAll,
                              ),
                            ),
                    ),
                    if (_result.skipped.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpace.s8),
                        child: Semantics(
                          liveRegion: true,
                          child: Text(
                            keepWords(
                              l10n.spreadsheetSkipped(_result.skipped.length),
                            ),
                            semanticsLabel: l10n.spreadsheetSkipped(
                              _result.skipped.length,
                            ),
                            style: AppType.secondary.copyWith(
                              color: colors.muted,
                            ),
                          ),
                        ),
                      ),
                    if (_result.tooLong.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpace.s8),
                        child: _Alert(
                          l10n.spreadsheetTooLong(
                            _rowList(l10n, _result.tooLong),
                            spreadsheetCellLimit,
                          ),
                        ),
                      ),
                  ],
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
            : BottomActions(
                secondary: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: AppSpace.s8,
                  children: [
                    if (_duplicate case final duplicate?)
                      _DuplicateNotice(
                        duplicate: duplicate,
                        onLeaveOut: () => _toggle(duplicate.row),
                        onAddAnyway: () => _save(allowDuplicate: true),
                      ),
                    if (_message case final message?) _Alert(message),
                    if (cards.isNotEmpty)
                      AppButton(
                        label: l10n.importAdd(chosen.length),
                        size: AppButtonSize.cta,
                        loading: _saving,
                        onPressed: chosen.isEmpty ? null : _save,
                      ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Opens a sheet titled [title] with a row for each of [options], its
/// [current] one checked. Resolves to the option tapped, in a record so that
/// a null option differs from a dismissal.
Future<({T value})?> _showChoice<T>(
  BuildContext context, {
  required String title,
  required List<(String, T)> options,
  required T current,
}) => showAppSheet<({T value})>(
  context,
  builder: (context) => AppSheet(
    title: title,
    content: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (name, value) in options)
          AppListRow(
            title: name,
            selected: value == current,
            trailing: value == current
                ? Icon(LucideIcons.check, color: AppColors.of(context).ink)
                : const SizedBox.shrink(),
            onTap: () => Navigator.of(context).pop((value: value)),
          ),
      ],
    ),
  ),
);

/// A group's row choosing one option: its [title], the [value] chosen, and a
/// chevron that leads to the choices.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({
    required this.title,
    required this.value,
    required this.onTap,
  });

  final String title;
  final String value;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return MergeSemantics(
      child: Semantics(
        button: true,
        child: AppRowSurface(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: AppSize.button),
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.s16,
                AppSpace.s8,
                AppSpace.s12,
                AppSpace.s8,
              ),
              child: Row(
                spacing: AppSpace.s12,
                children: [
                  Text(title, style: AppType.bodyStrong),
                  Expanded(
                    child: Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.end,
                      style: AppType.secondary.copyWith(color: colors.ink2),
                    ),
                  ),
                  Icon(LucideIcons.chevronRight, color: colors.muted),
                ],
              ),
            ),
          ),
        ),
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
              _RoundCheck(on: selected),
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

/// The round check photo import draws, filled in ink with a tick when on.
class _RoundCheck extends StatelessWidget {
  const _RoundCheck({required this.on});

  final bool on;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Container(
      width: AppSpace.s20 + AppSpace.s4,
      height: AppSpace.s20 + AppSpace.s4,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: on ? colors.ink : null,
        border: on ? null : Border.all(color: colors.muted, width: 1.5),
      ),
      child: on
          ? Icon(
              LucideIcons.check,
              size: AppSize.checkIcon,
              color: colors.onInk,
            )
          : null,
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
        _Alert(switch (duplicate) {
          DuplicateOfStored(:final row) => l10n.spreadsheetDuplicateStored(row),
          DuplicateOfRow(:final row, :final earlier) =>
            l10n.spreadsheetDuplicateRow(row, earlier),
        }),
        Wrap(
          spacing: AppSpace.s8,
          children: [
            TextButton(
              onPressed: onLeaveOut,
              child: Text(l10n.spreadsheetLeaveOut(duplicate.row)),
            ),
            TextButton(
              onPressed: onAddAnyway,
              child: Text(l10n.spreadsheetAddAnyway),
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
