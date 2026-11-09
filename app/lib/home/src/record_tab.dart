import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../assistant/assistant.dart';
import '../../deck/deck.dart';
import '../../design/screen_skeleton.dart';
import '../../l10n/app_localizations.dart';
import '../../study/study.dart';
import 'open_assistant.dart';

/// The 기록 tab: `study`'s [StatsView] over every deck, in the tab's
/// `ScreenSkeleton`.
class RecordTab extends ConsumerWidget {
  const RecordTab({super.key, required this.decks});

  final List<Deck> decks;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final all = DeckSelection.of([for (final deck in decks) deck.id]);
    final assistant = ref.watch(assistantClientProvider) != null;
    return ScreenSkeleton(
      topLevel: true,
      title: l10n.tabRecord,
      bottomReserve: assistant ? edgeReserve : 0,
      wrapBody: (body) => EdgeAssistant(
        onOpen: () => unawaited(openAssistant(context)),
        hint: all != null,
        child: body,
      ),
      body: [if (all != null) StatsView(decks: all)],
    );
  }
}
