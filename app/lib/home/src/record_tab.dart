import 'package:flutter/material.dart';

import '../../deck/deck.dart';
import '../../design/screen_skeleton.dart';
import '../../l10n/app_localizations.dart';
import '../../study/study.dart';

/// The 기록 tab: `study`'s [StatsView] over every deck, in the tab's
/// `ScreenSkeleton`.
class RecordTab extends StatelessWidget {
  const RecordTab({super.key, required this.decks});

  final List<Deck> decks;

  @override
  Widget build(BuildContext context) {
    final all = DeckSelection.of([for (final deck in decks) deck.id]);
    return ScreenSkeleton(
      topLevel: true,
      title: AppLocalizations.of(context).tabRecord,
      body: [if (all != null) StatsView(decks: all)],
    );
  }
}
