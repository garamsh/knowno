import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_list_row.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/bottom_actions.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import 'above_menu.dart';
import 'option_sheet.dart';
import '../../l10n/app_localizations.dart';
import '../../photo_import/photo_import.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';
import '../../design/word_break.dart';

/// A deck's page, above the menu: its name in the top bar with "카드 검색"
/// and "노트 설정", "이 노트 학습" at the top, then its cards as one group under
/// a pinned row of their count, the mastered count and the "뒷면 보기" switch,
/// and "카드 추가" fixed at the foot. A tap opens a card for editing; 노트 설정
/// renames, decorates, publishes or deletes the deck. While the deck holds no
/// card, adding one is its one primary action and there is nothing to
/// study.
class DeckScreen extends ConsumerStatefulWidget {
  const DeckScreen({super.key, required this.deck, this.addingCard = false});

  final Deck deck;

  /// Whether the screen opens on adding a card, as when the 오늘 tab's
  /// "카드 추가" opened it.
  final bool addingCard;

  @override
  ConsumerState<DeckScreen> createState() => _DeckScreenState();
}

/// The ways the add sheet offers to add a card.
enum _Add { byHand, camera, album, file }

class _DeckScreenState extends ConsumerState<DeckScreen> {
  /// The card search, or null while it is closed.
  String? _query;

  /// The "뒷면 보기" switch, off each time the page opens.
  bool _showAll = false;

  @override
  void initState() {
    super.initState();
    if (widget.addingCard) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_addCard());
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final cards = ref.watch(cardsProvider(widget.deck.id));
    final sharing = ref.watch(sharingServiceProvider);
    final online = switch (ref.watch(onlineProvider)) {
      AsyncData(:final value) => value,
      _ => false,
    };
    final current = _stored(ref.watch(deckProvider(widget.deck.id)));
    final public = current.visibility is PublicDeck;
    final empty = switch (cards) {
      AsyncData(:final value) => value.isEmpty,
      _ => false,
    };
    final query = _query;
    // An open search closes on the back, and a second back leaves.
    return PopScope(
      canPop: query == null,
      onPopInvokedWithResult: (popped, _) {
        if (!popped) setState(() => _query = null);
      },
      child: Scaffold(
        appBar: AppBar(
          title: query == null
              ? Semantics(
                  header: true,
                  child: Text(current.name, style: AppType.deckName),
                )
              : AppTextField(
                  hint: l10n.searchCards,
                  prefixIcon: const Icon(LucideIcons.search),
                  height: AppSize.search,
                  autofocus: true,
                  onChanged: (query) => setState(() => _query = query),
                ),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: AppSpace.s8),
              child: query == null
                  ? RaisedIconButton(
                      tooltip: l10n.searchCardsAction,
                      icon: LucideIcons.search,
                      onPressed: () => setState(() => _query = ''),
                    )
                  : RaisedIconButton(
                      tooltip: l10n.closeSearch,
                      icon: LucideIcons.x,
                      onPressed: () => setState(() => _query = null),
                    ),
            ),
            Padding(
              padding: const EdgeInsets.only(right: AppSpace.gutter),
              child: MenuAnchor(
                alignmentOffset: const Offset(0, AppSpace.s4),
                menuChildren: [
                  MenuItemButton(onPressed: _rename, child: Text(l10n.rename)),
                  MenuItemButton(
                    onPressed: () => _customize(current),
                    child: Text(l10n.deckAppearance),
                  ),
                  if (sharing != null)
                    MenuItemButton(
                      onPressed: online
                          ? () => public
                                ? sharing.unpublish(aboveMenu(context), current)
                                : sharing.publish(aboveMenu(context), current)
                          : null,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(public ? l10n.unpublish : l10n.publish),
                          if (!online)
                            Text(
                              l10n.publishNeedsNetwork,
                              style: AppType.caption.copyWith(
                                color: colors.muted,
                              ),
                            ),
                        ],
                      ),
                    ),
                  MenuItemButton(
                    onPressed: _delete,
                    child: Text(
                      l10n.deleteDeck,
                      style: TextStyle(color: colors.dontKnowText),
                    ),
                  ),
                ],
                builder: (context, menu, _) => RaisedIconButton(
                  tooltip: l10n.deckActions,
                  icon: LucideIcons.ellipsis,
                  onPressed: () => menu.isOpen ? menu.close() : menu.open(),
                ),
              ),
            ),
          ],
        ),
        body: switch (cards) {
          AsyncData(:final value) => CustomScrollView(
            slivers: [
              // While searching, the matches start under the top bar; with no
              // card, the empty line and "카드 추가" are the screen's content.
              if (query == null && !empty)
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpace.gutter,
                    AppSpace.s8,
                    AppSpace.gutter,
                    AppSpace.s16,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: TodayCounter(
                      decks: DeckSelection(widget.deck.id),
                      builder: (context, count) => AppButton(
                        label: switch (count) {
                          TodayCounted(:final total) => l10n.studyThisDeck(
                            total,
                          ),
                          _ => l10n.studyThisDeckPlain,
                        },
                        size: AppButtonSize.cta,
                        onPressed: _study,
                      ),
                    ),
                  ),
                ),
              if (value.isEmpty)
                SliverPadding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.gutter,
                    vertical: AppSpace.s40,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: Column(
                      spacing: AppSpace.s16,
                      children: [
                        const Mascot(
                          expression: MascotExpression.sleepy,
                          size: AppSize.mascotMedium,
                        ),
                        Text(
                          keepWords(l10n.noCards),
                          semanticsLabel: l10n.noCards,
                          textAlign: TextAlign.center,
                          style: AppType.body.copyWith(color: colors.muted),
                        ),
                      ],
                    ),
                  ),
                )
              else
                ..._cardList(l10n, value, public: public),
            ],
          ),
          AsyncError(:final error, :final stackTrace) => Center(
            child: Padding(
              padding: const EdgeInsets.all(AppSpace.gutter),
              child: Text(describeProviderError(l10n, error, stackTrace)),
            ),
          ),
          _ => const Center(child: CircularProgressIndicator()),
        },
        bottomNavigationBar: BottomActions(
          secondary: AppButton(
            label: l10n.newCard,
            // With no card, adding one is the screen's one primary action.
            variant: empty
                ? AppButtonVariant.primary
                : AppButtonVariant.secondary,
            size: AppButtonSize.cta,
            onPressed: _addCard,
          ),
        ),
      ),
    );
  }

  /// The pinned row of the cards' count, how many are mastered and the
  /// "뒷면 보기" switch, then, as one group, a
  /// row for each card whose studied text holds the search, ignoring case,
  /// its back shown as the switch is. Every 칸 is searched, revealed, since
  /// none is hidden from study.
  List<Widget> _cardList(
    AppLocalizations l10n,
    List<Card> cards, {
    required bool public,
  }) {
    final query = (_query ?? '').trim().toLowerCase();
    final rows = [
      for (final card in cards)
        if ([card.front, card.back].any(
          (side) => describeContent(l10n, side).toLowerCase().contains(query),
        ))
          card,
    ];
    const gutter = EdgeInsets.symmetric(horizontal: AppSpace.gutter);
    return [
      PinnedHeaderSliver(
        child: _CardListHeader(
          deck: widget.deck.id,
          cards: cards.length,
          public: public,
          showAll: _showAll,
          onShowAll: (show) => setState(() => _showAll = show),
        ),
      ),
      SliverPadding(
        padding: gutter.copyWith(bottom: AppSpace.s16),
        sliver: rows.isEmpty
            ? SliverPadding(
                padding: const EdgeInsets.symmetric(vertical: AppSpace.s32),
                sliver: SliverToBoxAdapter(
                  child: Text(
                    keepWords(l10n.noMatches),
                    semanticsLabel: l10n.noMatches,
                    textAlign: TextAlign.center,
                    style: AppType.body.copyWith(
                      color: AppColors.of(context).muted,
                    ),
                  ),
                ),
              )
            : SliverAppGroup(
                children: [
                  for (final card in rows)
                    CardBackRow(
                      key: ValueKey(card.id),
                      front: card.front,
                      back: card.back,
                      cells: card.cells,
                      shown: _showAll,
                      onOpen: () => _open(card),
                    ),
                ],
              ),
      ),
    ];
  }

  /// Offers the ways to add a card over the menu, each its name alone: by
  /// hand, with photo import from a photo taken with the camera or picked
  /// from the album, or from a spreadsheet.
  Future<void> _addCard() async {
    final l10n = AppLocalizations.of(context);
    final photoImport = ref.read(photoImportProvider);
    final choice = await showOptionSheet<_Add>(
      aboveMenu(context),
      title: l10n.newCard,
      options: [
        (title: l10n.createManually, value: _Add.byHand),
        if (photoImport != null) ...[
          (title: l10n.photoCamera, value: _Add.camera),
          (title: l10n.photoAlbum, value: _Add.album),
        ],
        (title: l10n.spreadsheetPick, value: _Add.file),
      ],
    );
    if (!mounted) return;
    switch (choice) {
      case _Add.byHand:
        await _open(null);
      case _Add.camera:
        await _importPhoto(PhotoOrigin.camera);
      case _Add.album:
        await _importPhoto(PhotoOrigin.album);
      case _Add.file:
        await importFromSpreadsheet(aboveMenu(context), widget.deck.id);
      case null:
        return;
    }
  }

  /// Starts photo import for this deck from a photo by [origin]. When it
  /// saved into another deck, that deck's list replaces this one.
  Future<void> _importPhoto(PhotoOrigin origin) async {
    final photoImport = ref.read(photoImportProvider);
    if (photoImport == null) return;
    final navigator = Navigator.of(context);
    final deck = await photoImport(aboveMenu(context), widget.deck.id, origin);
    if (deck == null || deck.id == widget.deck.id || !mounted) return;
    await navigator.pushReplacement(
      MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
    );
  }

  /// The deck as [stored] holds it now, so a rename or a publish made here
  /// or synced in shows; the deck the screen opened on until it is read.
  Deck _stored(AsyncValue<Deck?> stored) => switch (stored) {
    AsyncData(value: final deck?) => deck,
    _ => widget.deck,
  };

  /// The deck's name as stored now.
  String get _name => _stored(ref.read(deckProvider(widget.deck.id))).name;

  void _study() =>
      unawaited(openStudy(aboveMenu(context), DeckSelection(widget.deck.id)));

  Future<void> _open(Card? card) => Navigator.of(aboveMenu(context)).push(
    MaterialPageRoute<void>(
      builder: (_) => CardEditorScreen(
        deck: Deck(
          id: widget.deck.id,
          name: _name,
          createdAt: widget.deck.createdAt,
          updatedAt: widget.deck.updatedAt,
        ),
        card: card,
      ),
    ),
  );

  Future<void> _rename() async {
    final repository = ref.read(deckRepositoryProvider);
    final l10n = AppLocalizations.of(context);
    final name = await showNameSheet(
      aboveMenu(context),
      title: l10n.renameDeck,
      action: l10n.save,
      initial: _name,
    );
    if (name == null || !mounted) return;
    await reportingFailure(context, () async {
      await repository.renameDeck(widget.deck.id, name);
    });
  }

  /// Opens 노트 꾸미기 on [deck] as stored now, and stores the pair chosen.
  Future<void> _customize(Deck deck) async {
    final repository = ref.read(deckRepositoryProvider);
    final chosen = await showDeckAppearanceSheet(
      aboveMenu(context),
      deck: deck,
    );
    if (chosen == null || !mounted) return;
    final (icon, color) = chosen;
    await reportingFailure(context, () async {
      await repository.setAppearance(deck.id, icon, color);
    });
  }

  Future<void> _delete() async {
    final repository = ref.read(deckRepositoryProvider);
    await reportingFailure(context, () async {
      final cardCount = await repository.countCards(widget.deck.id);
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      final confirmed = await showAppConfirm(
        aboveMenu(context),
        title: l10n.deleteDeckTitle(_name),
        titleWritten: true,
        consequence: l10n.deleteDeckBody(cardCount),
        confirmLabel: l10n.delete,
      );
      if (!confirmed) return;
      await repository.deleteDeck(widget.deck.id);
      if (mounted) Navigator.of(context).pop();
    });
  }
}

/// The row pinned above the card list: "카드 n", read as a heading, with how
/// many are mastered once read and "공개" while the deck is published, and the
/// "뒷면 보기" switch, whose label stays while the switch shows its state.
class _CardListHeader extends StatelessWidget {
  const _CardListHeader({
    required this.deck,
    required this.cards,
    required this.public,
    required this.showAll,
    required this.onShowAll,
  });

  final DeckId deck;
  final int cards;
  final bool public;
  final bool showAll;
  final ValueChanged<bool> onShowAll;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final quiet = AppType.secondary.copyWith(color: colors.ink2);
    // At the right, the switch's own margin brings its track to the gutter.
    return ColoredBox(
      color: colors.ground,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.s4,
          AppSpace.s16,
          AppSpace.s4,
        ),
        child: Row(
          children: [
            Expanded(
              child: Padding(
                padding: const EdgeInsets.only(left: AppSpace.s4),
                child: Wrap(
                  spacing: AppSpace.s8,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Semantics(
                      header: true,
                      child: Text(
                        l10n.cardsHeading(cards),
                        style: AppType.label.copyWith(color: colors.ink),
                      ),
                    ),
                    ProgressCounter(
                      decks: DeckSelection(deck),
                      builder: (context, progress) => Text(
                        [
                          if (progress != null)
                            l10n.deckMasteredShort(progress.mastered),
                          if (public) l10n.publicChip,
                        ].join(' · '),
                        style: quiet,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            MergeSemantics(
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => onShowAll(!showAll),
                    child: Text(l10n.showMeanings, style: quiet),
                  ),
                  Switch(value: showAll, onChanged: onShowAll),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
