import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../l10n/app_localizations.dart';
import 'model.dart';
import 'spreadsheet.dart';
import 'spreadsheet_alert.dart';
import 'spreadsheet_import_screen.dart';
import 'spreadsheet_pick.dart';

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
      content: refusal == null
          ? null
          : SpreadsheetAlert(spreadsheetRefusalMessage(l10n, refusal)),
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
