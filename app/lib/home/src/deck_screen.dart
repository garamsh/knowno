import 'dart:async';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../assistant/assistant.dart';
import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_choice.dart';
import '../../design/app_list_row.dart';
import '../../design/app_search_field.dart';
import '../../design/app_sheet.dart';
import '../../design/mascot.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import 'above_menu.dart';
import 'list_header.dart';
import 'open_assistant.dart';
import '../../l10n/app_localizations.dart';
import '../../photo_import/photo_import.dart';
import '../../sharing/sharing.dart';
import '../../study/study.dart';

/// A deck's page, above the menu: "+ 카드 추가" and "노트 설정" in the top
/// bar, the deck's name on its own line under it, then, while the deck holds
/// a card, the card search, "이 노트 학습", the screen's one primary, and its
/// cards, each whole, as one group under a pinned row of their count and the
/// mastered count. A tap opens a card for editing; 노트 설정
/// renames, decorates, publishes or deletes the deck. While the deck holds no
/// card there is nothing to study.
class DeckScreen extends ConsumerStatefulWidget {
  const DeckScreen({
    super.key,
    required this.deck,
    this.addingCard = false,
    this.assistantEdge = true,
  });

  final Deck deck;

  /// Whether the assistant's character is drawn on the screen: not where the
  /// screen was opened from the chat itself.
  final bool assistantEdge;

  /// Whether the screen opens on adding a card, as when the 오늘 tab's
  /// "카드 추가" opened it.
  final bool addingCard;

  @override
  ConsumerState<DeckScreen> createState() => _DeckScreenState();
}

/// The ways the add sheet offers to add a card.
enum _Add { byHand, camera, album, file }

class _DeckScreenState extends ConsumerState<DeckScreen> {
  /// The card search, kept as typed.
  var _query = '';

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
    // With an assistant, adding a card by hand is in the ⋯, behind 말랑이.
    final assistant = ref.watch(assistantClientProvider) != null;
    final current = _stored(ref.watch(deckProvider(widget.deck.id)));
    final public = current.visibility is PublicDeck;
    final empty = switch (cards) {
      AsyncData(:final value) => value.isEmpty,
      _ => false,
    };
    return Scaffold(
      appBar: AppBar(
        toolbarHeight: AppButton.barHeight(context),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: AppSpace.gutter),
            child: ListHeaderActions(
              label: assistant ? null : l10n.newCard,
              onPressed: assistant ? null : _addCard,
              menu: (
                tooltip: l10n.deckActions,
                items: [
                  if (assistant)
                    MenuItemButton(
                      onPressed: _addCard,
                      child: Text(l10n.assistantAddByHand),
                    ),
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
              ),
            ),
          ),
        ],
      ),
      body: _edge(
        assistant,
        CustomScrollView(
          slivers: [
            // The name has a line of its own, so every name stays readable
            // beside a labelled action at every text size.
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                0,
                AppSpace.gutter,
                AppSpace.s8,
              ),
              sliver: SliverToBoxAdapter(
                child: Semantics(
                  header: true,
                  child: Text(
                    keepWords(current.name),
                    semanticsLabel: current.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppType.deckName.copyWith(color: colors.ink),
                  ),
                ),
              ),
            ),
            ...switch (cards) {
              AsyncData(:final value) => [
                if (!empty)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpace.gutter,
                      AppSpace.s8,
                      AppSpace.gutter,
                      0,
                    ),
                    sliver: SliverToBoxAdapter(
                      child: AppSearchField(
                        hint: l10n.searchCards,
                        onChanged: (query) => setState(() => _query = query),
                      ),
                    ),
                  ),
                // While searching, the matches start under the search field;
                // with no card, the empty line is the screen's content.
                if (_query.trim().isEmpty && !empty)
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
              AsyncError(:final error, :final stackTrace) => [
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(AppSpace.gutter),
                      child: Text(
                        describeProviderError(l10n, error, stackTrace),
                      ),
                    ),
                  ),
                ),
              ],
              _ => [
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(child: CircularProgressIndicator()),
                ),
              ],
            },
            if (assistant && widget.assistantEdge)
              const SliverToBoxAdapter(child: SizedBox(height: edgeReserve)),
          ],
        ),
      ),
    );
  }

  /// [body] with the assistant's character at the screen's edge, in this
  /// note's name, where the app has an assistant and the screen draws it.
  Widget _edge(bool assistant, Widget body) =>
      !assistant || !widget.assistantEdge
      ? body
      : EdgeAssistant(
          onOpen: () => unawaited(
            openAssistant(
              context,
              note: (id: widget.deck.id.value, name: _name),
            ),
          ),
          hint: true,
          child: body,
        );

  /// The pinned row of the cards' count and how many are mastered, then, as
  /// one group, a row for each card whose studied text holds the search,
  /// ignoring case, each card whole. Every 칸 is searched, revealed, since
  /// none is hidden from study.
  List<Widget> _cardList(
    AppLocalizations l10n,
    List<Card> cards, {
    required bool public,
  }) {
    final query = _query.trim().toLowerCase();
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
    final choice = await showAppChoice<_Add>(
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
    switch (choice?.value) {
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
  /// saved into another deck, that deck's list replaces this one; when the
  /// user chose to add the cards another way instead, that way opens here.
  Future<void> _importPhoto(PhotoOrigin origin) async {
    final photoImport = ref.read(photoImportProvider);
    if (photoImport == null) return;
    final navigator = Navigator.of(context);
    final outcome = await photoImport(
      aboveMenu(context),
      widget.deck.id,
      origin,
    );
    if (!mounted) return;
    switch (outcome) {
      case PhotoImportSaved(:final deck) when deck.id != widget.deck.id:
        await navigator.pushReplacement(
          MaterialPageRoute<void>(builder: (_) => DeckScreen(deck: deck)),
        );
      case AddByHandInstead():
        await _open(null);
      case AddFromSpreadsheetInstead():
        await importFromSpreadsheet(aboveMenu(context), widget.deck.id);
      case PhotoImportSaved() || null:
        return;
    }
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
        preview: (cells) => CardPreviewScreen(cells: cells),
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
/// many are mastered once read and "공개" while the deck is published.
class _CardListHeader extends StatelessWidget {
  const _CardListHeader({
    required this.deck,
    required this.cards,
    required this.public,
  });

  final DeckId deck;
  final int cards;
  final bool public;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final quiet = AppType.secondary.copyWith(color: colors.ink2);
    return ColoredBox(
      color: colors.ground,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter + AppSpace.s4,
          AppSpace.s4,
          AppSpace.gutter,
          AppSpace.s4,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSize.tapTarget),
          child: Align(
            alignment: AlignmentDirectional.centerStart,
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
      ),
    );
  }
}
