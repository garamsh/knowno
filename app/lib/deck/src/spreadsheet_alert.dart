import 'package:flutter/material.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'spreadsheet.dart';

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
