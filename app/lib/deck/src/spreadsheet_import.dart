import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../design/app_button.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'model.dart';
import 'spreadsheet.dart';
import 'spreadsheet_import_screen.dart';

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

/// Why a file or a sheet was refused, as the import says it.
String spreadsheetRefusalMessage(
  AppLocalizations l10n,
  SpreadsheetRefusal refusal,
) => switch (refusal) {
  SpreadsheetRefusal.wrongType => l10n.spreadsheetWrongType,
  SpreadsheetRefusal.tooLarge => l10n.spreadsheetTooLarge,
  SpreadsheetRefusal.notUtf8 => l10n.spreadsheetNotUtf8,
  SpreadsheetRefusal.unreadable => l10n.spreadsheetUnreadable,
  SpreadsheetRefusal.tooManyRows => l10n.spreadsheetTooManyRows,
  SpreadsheetRefusal.notRead => l10n.spreadsheetNotRead,
};

/// A sentence in red, read out as it appears: what stops the import.
class SpreadsheetAlert extends StatelessWidget {
  const SpreadsheetAlert(this.text, {super.key});

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
