import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_chip.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';
import 'deck_screen.dart';
import 'new_deck_sheet.dart';
import 'progress_bar.dart';
import '../../design/word_break.dart';

/// The 노트 tab: "내 노트 n", a search by name, a row per deck with its progress
/// and today's count, then "새 노트 만들기", which opens the new-deck sheet, and
/// the public decks.
class DecksTab extends ConsumerStatefulWidget {
  const DecksTab({super.key, required this.decks, required this.counts});

  final List<Deck> decks;
  final Map<DeckId, int> counts;

  @override
  ConsumerState<DecksTab> createState() => _DecksTabState();
}

class _DecksTabState extends ConsumerState<DecksTab> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final sharing = ref.watch(sharingServiceProvider);
    final query = _query.trim().toLowerCase();
    final shown = [
      for (final deck in widget.decks)
        if (deck.name.toLowerCase().contains(query)) deck,
    ];
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: AppSize.cta + AppSpace.s8,
        titleSpacing: AppSpace.gutter,
        title: Semantics(
          header: true,
          child: Text(
            l10n.myDecks(widget.decks.length),
            style: AppType.deckTitle,
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s8,
          AppSpace.gutter,
          AppSpace.s16,
        ),
        children: [
          AppTextField(
            hint: l10n.searchDecks,
            prefixIcon: const Icon(LucideIcons.search),
            height: AppSize.search,
            onChanged: (query) => setState(() => _query = query),
          ),
          const SizedBox(height: AppSpace.s12),
          if (shown.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
              child: Text(
                keepWords(l10n.noDeckMatches),
                semanticsLabel: l10n.noDeckMatches,
                textAlign: TextAlign.center,
                style: AppType.body.copyWith(color: colors.muted),
              ),
            ),
          for (final deck in shown)
            DeckRow(
              deck: deck,
              cardCount: widget.counts[deck.id] ?? 0,
              onOpen: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
              ),
              today: TodayCounter(
                decks: DeckSelection(deck.id),
                builder: (context, count) => TodayChip(count: count),
              ),
              progress: ProgressCounter(
                decks: DeckSelection(deck.id),
                builder: (context, progress) => _DeckProgress(
                  progress: progress,
                  cardCount: widget.counts[deck.id] ?? 0,
                ),
              ),
            ),
          const SizedBox(height: AppSpace.s8),
          AppButton(
            label: l10n.newDeckTitle,
            variant: AppButtonVariant.secondary,
            onPressed: () => showNewDeckSheet(context, ref),
          ),
          if (sharing != null) ...[
            const SizedBox(height: AppSpace.s8),
            AppButton(
              label: l10n.browsePublicDecks,
              variant: AppButtonVariant.text,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => sharing.browseScreen()),
              ),
            ),
          ],
        ],
      ),
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
