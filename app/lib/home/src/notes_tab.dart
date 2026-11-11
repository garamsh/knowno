import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_chip.dart';
import '../../design/app_search_field.dart';
import '../../design/screen_skeleton.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';
import 'above_menu.dart';
import 'deck_screen.dart';
import 'list_header.dart';
import 'new_deck.dart';
import 'progress_bar.dart';

/// The 노트 tab, the first screen of its own navigator: "노트" with "새 노트"
/// and, with sharing, a ⋯ that opens the public decks; the 노트 검색 field,
/// which keeps the decks whose name holds it, ignoring case; and every
/// deck's row, which opens its screen above the menu.
class NotesTab extends ConsumerStatefulWidget {
  const NotesTab({super.key});

  @override
  ConsumerState<NotesTab> createState() => _NotesTabState();
}

class _NotesTabState extends ConsumerState<NotesTab> {
  var _query = '';

  /// Opens [deck]'s screen on this tab's navigator.
  void _open(Deck deck, {bool addingCard = false}) =>
      Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => DeckScreen(deck: deck, addingCard: addingCard),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final sharing = ref.watch(sharingServiceProvider);
    final decks = ref.watch(decksProvider).value ?? const <Deck>[];
    final counts = ref.watch(cardCountsProvider).value ?? const {};
    final query = _query.trim().toLowerCase();
    final shown = [
      for (final deck in decks)
        if (deck.name.toLowerCase().contains(query)) deck,
    ];
    return ScreenSkeleton(
      topLevel: true,
      title: l10n.tabNotes,
      actions: ListHeaderActions(
        label: l10n.newDeck,
        onPressed: () => openNewDeck(context, _open),
        menu: sharing == null
            ? null
            : (
                tooltip: l10n.notesActions,
                items: [
                  MenuItemButton(
                    onPressed: () => Navigator.of(aboveMenu(context)).push(
                      MaterialPageRoute<void>(
                        builder: (_) => sharing.browseScreen(),
                      ),
                    ),
                    child: Text(l10n.browsePublicDecks),
                  ),
                ],
              ),
      ),
      search: decks.isEmpty
          ? null
          : AppSearchField(
              hint: l10n.searchDecks,
              onChanged: (query) => setState(() => _query = query),
            ),
      body: [
        if (shown.isEmpty && query.isNotEmpty)
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
              child: Text(
                keepWords(l10n.noDeckMatches),
                semanticsLabel: l10n.noDeckMatches,
                textAlign: TextAlign.center,
                style: AppType.body.copyWith(color: colors.muted),
              ),
            ),
          ),
        SliverList.list(
          children: [
            for (final deck in shown)
              DeckRow(
                deck: deck,
                cardCount: counts[deck.id] ?? 0,
                onOpen: () => _open(deck),
                today: TodayCounter(
                  decks: DeckSelection(deck.id),
                  builder: (context, count) => TodayChip(count: count),
                ),
                progress: ProgressCounter(
                  decks: DeckSelection(deck.id),
                  builder: (context, progress) => _DeckProgress(
                    progress: progress,
                    cardCount: counts[deck.id] ?? 0,
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}

/// A brand-tint "오늘 n" when a session over the deck would study any card
/// now, and the reason when the count cannot be read.
class TodayChip extends StatelessWidget {
  const TodayChip({super.key, required this.count});

  final TodayCount count;

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return switch (count) {
      TodayCounted(:final total) when total > 0 => AppChip(
        label: AppLocalizations.of(context).todayChip(total),
        tone: AppChipTone.brand,
      ),
      TodayUnavailable(:final message) => Tooltip(
        message: message,
        child: Icon(
          LucideIcons.circleAlert,
          color: colors.muted,
          semanticLabel: message,
        ),
      ),
      TodayCounted() || TodayPending() => const SizedBox.shrink(),
    };
  }
}

/// A deck row's "n장 중 m장 익힘" over its progress bar, whose label carries
/// the mastered, learning and new counts; "n장" alone while the progress is
/// read, and for a deck with no card, which has nothing to draw.
class _DeckProgress extends StatelessWidget {
  const _DeckProgress({required this.progress, required this.cardCount});

  final DeckProgress? progress;
  final int cardCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final quiet = AppType.caption.copyWith(color: AppColors.of(context).muted);
    final progress = this.progress;
    if (progress == null || progress.total == 0) {
      return Text(l10n.deckRowCards(cardCount), style: quiet);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s4,
      children: [
        Text(
          l10n.deckMastered(progress.total, progress.mastered),
          style: quiet,
        ),
        ProgressBar(progress: progress),
      ],
    );
  }
}
