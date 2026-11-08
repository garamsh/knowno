import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../assistant/assistant.dart';
import '../../deck/deck.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../study/study.dart';
import 'open_assistant.dart';

/// The 기록 tab: `study`'s [StatsView] over every deck, under the tab's
/// title.
class RecordTab extends ConsumerWidget {
  const RecordTab({super.key, required this.decks});

  final List<Deck> decks;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final all = DeckSelection.of([for (final deck in decks) deck.id]);
    final assistant = ref.watch(assistantClientProvider) != null;
    return Scaffold(
      body: EdgeAssistant(
        onOpen: () => unawaited(openAssistant(context)),
        hint: all != null,
        child: SafeArea(
          bottom: false,
          child: all == null
              ? const SizedBox.shrink()
              : StatsView(
                  decks: all,
                  bottomInset: assistant ? edgeReserve : 0,
                  title: Semantics(
                    header: true,
                    child: Text(
                      l10n.tabRecord,
                      style: AppType.deckTitle.copyWith(color: colors.ink),
                    ),
                  ),
                ),
        ),
      ),
    );
  }
}
