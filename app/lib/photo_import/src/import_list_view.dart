import 'package:flutter/material.dart' hide Card;
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../deck/deck.dart';
import '../../design/app_button.dart';
import '../../design/app_choice.dart';
import '../../design/app_menu.dart';
import '../../design/round_check.dart';
import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'card_edit_sheet.dart';
import 'import_list.dart';
import 'photo_viewer.dart';

/// The cards made from the photo, as one list in sections by topic: each row
/// included or left out by its check or a swipe left, and edited in a sheet
/// on a tap; each section's cards take the form its menu sets. The button
/// adds every included row's cards.
class ImportListView extends StatefulWidget {
  const ImportListView({
    super.key,
    required this.list,
    required this.photos,
    required this.decks,
    required this.target,
    required this.onTarget,
    required this.saving,
    required this.onChanged,
    required this.onCancel,
    required this.onRetake,
    required this.retakeLabel,
    required this.onAddPhotos,
    required this.onSave,
  });

  final ImportList list;

  /// The photos the rows come from, in the list's order.
  final List<ImageProvider> photos;
  final List<Deck> decks;

  /// The deck the cards go into; null for a new deck.
  final Deck? target;

  /// Chooses the deck the cards go into; null for a new deck.
  final ValueChanged<DeckId?> onTarget;

  final bool saving;

  /// Called after [list] changed in place.
  final VoidCallback onChanged;

  final VoidCallback onCancel;

  /// Takes another photo in place of the one there is; null with several.
  final VoidCallback? onRetake;

  /// What the retake is called: "다시 찍기", or "다시 선택" for a photo
  /// from the album.
  final String retakeLabel;

  /// Adds more photos to the import; null once it holds as many as it can.
  final VoidCallback? onAddPhotos;

  final VoidCallback onSave;

  @override
  State<ImportListView> createState() => _ImportListViewState();
}

class _ImportListViewState extends State<ImportListView> {
  ImportList get _list => widget.list;

  /// The photos whose groups are collapsed, counted from 0.
  final _collapsed = <int>{};

  void _change(VoidCallback change) {
    setState(change);
    widget.onChanged();
  }

  /// Opens [row]'s edit sheet. The row keeps the state it had, so an edit
  /// whose front the deck holds is not left out: it merges back when saved.
  Future<void> _edit(ImportRow row) async {
    final included = _list.isIncluded(row);
    if (await showCardEditSheet(context, row)) {
      _change(() => row.included ??= included);
    }
  }

  /// A section's header and its rows.
  List<Widget> _section(ImportSection section) {
    final colors = AppColors.of(context);
    return [
      const SizedBox(height: AppSpace.s20),
      _SectionHeader(
        list: _list,
        section: section,
        onChanged: () => _change(() {}),
      ),
      const SizedBox(height: AppSpace.s8),
      DecoratedBox(
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.circular(AppRadius.field),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(AppRadius.field),
          child: Column(
            children: [
              for (final (i, row) in section.rows.indexed)
                _RowTile(
                  key: ObjectKey(row),
                  sides: sidesOf(row.cards(section.form).first),
                  wholeFront: row.wholeFront,
                  included: _list.isIncluded(row),
                  inDeck: _list.isDuplicate(row),
                  first: i == 0,
                  onCheck: row.savable
                      ? () =>
                            _change(() => row.included = !_list.isIncluded(row))
                      : null,
                  onExclude: () => _change(() => row.included = false),
                  // A table or cloze row cannot be edited yet.
                  onEdit: row.wholeFront == null ? () => _edit(row) : null,
                ),
            ],
          ),
        ),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final count = _list.cardCount;
    final rows = _list.rows.length;
    return Scaffold(
      // × closes, as every other screen's top bar does; the retake waits in
      // ⋯, so the bar holds no words.
      appBar: AppBar(
        leading: IconButton(
          tooltip: l10n.close,
          icon: const Icon(LucideIcons.x),
          onPressed: widget.onCancel,
        ),
        actions: [
          if (widget.onRetake case final onRetake?)
            PopupMenuButton<VoidCallback>(
              tooltip: l10n.importActions,
              icon: const Icon(LucideIcons.ellipsisVertical),
              onSelected: (action) => action(),
              itemBuilder: (_) => [
                PopupMenuItem(value: onRetake, child: Text(widget.retakeLabel)),
              ],
            ),
        ],
      ),
      body: Stack(
        children: [
          ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpace.gutter,
              0,
              AppSpace.gutter,
              AppSize.cta + AppSize.cta + AppSpace.s40,
            ),
            children: [
              Semantics(
                header: true,
                child: Text(
                  _list.allVocabulary
                      ? l10n.importTitleWords
                      : l10n.importTitleCards(rows),
                  style: AppType.title.copyWith(color: colors.ink),
                ),
              ),
              _DeckLine(
                name: widget.target?.name,
                onTap: () => _chooseTarget(context),
              ),
              if (_list.photoCount <= 1)
                for (final section in _list.sections) ..._section(section)
              else
                for (var photo = 0; photo < _list.photoCount; photo++) ...[
                  const SizedBox(height: AppSpace.s28),
                  _PhotoHeader(
                    number: photo + 1,
                    photos: widget.photos,
                    rows: _list
                        .sectionsOf(photo)
                        .fold(
                          0,
                          (count, section) => count + section.rows.length,
                        ),
                    expanded: !_collapsed.contains(photo),
                    onToggle: () => setState(
                      () => _collapsed.contains(photo)
                          ? _collapsed.remove(photo)
                          : _collapsed.add(photo),
                    ),
                  ),
                  if (!_collapsed.contains(photo))
                    for (final section in _list.sectionsOf(photo))
                      ..._section(section),
                ],
              if (widget.onAddPhotos case final onAddPhotos?) ...[
                const SizedBox(height: AppSpace.s24),
                AppButton(
                  label: AppLocalizations.of(context).addPhotos,
                  icon: LucideIcons.imagePlus,
                  variant: AppButtonVariant.secondary,
                  onPressed: onAddPhotos,
                ),
              ],
            ],
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [colors.ground.withValues(alpha: 0), colors.ground],
                  stops: const [0, 0.3],
                ),
              ),
              child: SafeArea(
                top: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpace.gutter,
                    AppSpace.s24,
                    AppSpace.gutter,
                    AppSpace.s16,
                  ),
                  child: AppButton(
                    label: l10n.importAdd(count),
                    size: AppButtonSize.cta,
                    loading: widget.saving,
                    onPressed: count == 0 ? null : widget.onSave,
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _chooseTarget(BuildContext context) async {
    final l10n = AppLocalizations.of(context);
    final chosen = await showAppChoice<DeckId?>(
      context,
      title: l10n.photoTargetTitle,
      options: [
        for (final deck in widget.decks) (title: deck.name, value: deck.id),
        (title: l10n.newDeck, value: null),
      ],
      current: (value: widget.target?.id),
    );
    if (chosen != null) widget.onTarget(chosen.value);
  }
}

/// "노트 '`name`'에 추가돼요", or "새 노트에 추가돼요" while no deck is chosen, the
/// name a button that opens the deck chooser.
class _DeckLine extends StatelessWidget {
  const _DeckLine({required this.name, required this.onTap});

  /// The chosen deck's name, or null for a new deck made on saving.
  final String? name;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    // The localized line, split around the name it holds.
    const marker = '\u0000';
    final name = this.name;
    final [
      before,
      after,
    ] = (name == null ? l10n.importNewDeck(marker) : l10n.importDeck(marker))
        .split(marker);
    final style = AppType.bodyStrong.copyWith(color: colors.muted);
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (before.isNotEmpty) Text(before, style: style),
        TextButton(
          onPressed: onTap,
          style: TextButton.styleFrom(
            padding: EdgeInsets.zero,
            minimumSize: const Size(0, AppSize.tapTarget),
            tapTargetSize: MaterialTapTargetSize.padded,
            foregroundColor: colors.ink,
            textStyle: AppType.bodyStrong.copyWith(
              fontWeight: FontWeight.w600,
              decoration: TextDecoration.underline,
            ),
          ),
          child: Text(name ?? l10n.newDeck),
        ),
        if (after.isNotEmpty) Text(after, style: style),
      ],
    );
  }
}

/// A section's topic and row count, and the menu of its cards' form.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.list,
    required this.section,
    required this.onChanged,
  });

  final ImportList list;
  final ImportSection section;

  /// Called after the section's form or rows changed.
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final topic = section.topic;
    final title = section.identify ? l10n.importIdentifySection(topic) : topic;
    final form = section.form;
    final formLabel = switch (form) {
      VocabularyForm(direction: Direction.forward) => l10n.importForward,
      VocabularyForm(direction: Direction.backward) => l10n.importBackward,
      VocabularyForm(direction: Direction.both) => l10n.importBothShort,
      NoteForm(swapped: false) => l10n.importNoteForward,
      NoteForm(swapped: true) => l10n.importNoteSwapped,
    };
    void set(SectionForm next) {
      section.form = next;
      onChanged();
    }

    /// A menu item that does [onTap]: a choice, read as checked or not, when
    /// [checked] is given, else a plain action.
    Widget item(String label, {bool? checked, required VoidCallback onTap}) {
      final button = MenuItemButton(
        onPressed: onTap,
        leadingIcon: SizedBox(
          width: AppSize.smallIcon,
          child: checked == true
              ? const Icon(LucideIcons.check, size: AppSize.smallIcon)
              : null,
        ),
        child: Text(label),
      );
      // One node, so a screen reader hears a choice's state with its label.
      return checked == null
          ? button
          : MergeSemantics(
              child: Semantics(checked: checked, child: button),
            );
    }

    // The heavier rule between a menu's groups.
    final separator = Divider(
      height: AppSpace.s4,
      thickness: AppSpace.s4,
      color: colors.hairline,
    );
    final anyIncluded = section.rows.any(list.isIncluded);
    final pronunciations = section.rows.any((row) => row.pronunciation != null);
    final extras = section.rows.any((row) => row.extras.isNotEmpty);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(
              left: AppSpace.s4,
              bottom: AppSpace.s12,
            ),
            child: Text(
              l10n.importSection(title, section.rows.length),
              style: AppType.caption.copyWith(color: colors.muted),
            ),
          ),
        ),
        AppMenu(
          items: [
            if (form case final VocabularyForm vocabulary) ...[
              for (final (direction, label) in [
                (Direction.forward, l10n.importForward),
                (Direction.backward, l10n.importBackward),
                (Direction.both, l10n.importBoth),
              ])
                item(
                  label,
                  checked: vocabulary.direction == direction,
                  onTap: () => set(vocabulary.copyWith(direction: direction)),
                ),
              separator,
              item(
                l10n.importFirstSense,
                checked: vocabulary.firstSenseOnly,
                onTap: () => set(
                  vocabulary.copyWith(
                    firstSenseOnly: !vocabulary.firstSenseOnly,
                  ),
                ),
              ),
              item(
                l10n.importShowPos,
                checked: vocabulary.showPos,
                onTap: () =>
                    set(vocabulary.copyWith(showPos: !vocabulary.showPos)),
              ),
              if (pronunciations)
                item(
                  l10n.importShowPronunciation,
                  checked: vocabulary.showPronunciation,
                  onTap: () => set(
                    vocabulary.copyWith(
                      showPronunciation: !vocabulary.showPronunciation,
                    ),
                  ),
                ),
              if (extras)
                item(
                  l10n.importShowExtras,
                  checked: vocabulary.showExtras,
                  onTap: () => set(
                    vocabulary.copyWith(showExtras: !vocabulary.showExtras),
                  ),
                ),
            ],
            if (form case NoteForm(:final swapped)
                when section.rows.any((row) => row.wholeFront == null))
              item(
                l10n.importSwap,
                checked: swapped,
                onTap: () => set(NoteForm(swapped: !swapped)),
              ),
            separator,
            item(
              anyIncluded ? l10n.importDropSection : l10n.importKeepSection,
              onTap: () {
                list.toggleSection(section);
                onChanged();
              },
            ),
          ],
          builder: (context, controller, _) => Semantics(
            container: true,
            button: true,
            label: l10n.importFormMenu(title, formLabel),
            excludeSemantics: true,
            child: TextButton(
              onPressed: () =>
                  controller.isOpen ? controller.close() : controller.open(),
              style: TextButton.styleFrom(
                foregroundColor: colors.ink,
                minimumSize: const Size(AppSize.tapTarget, AppSize.tapTarget),
                padding: const EdgeInsets.symmetric(horizontal: AppSpace.s4),
                textStyle: AppType.caption.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                spacing: AppSpace.s4,
                children: [
                  Text(formLabel),
                  const Icon(LucideIcons.chevronDown, size: AppSpace.s12),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/// One row: its check, its front at 44% and its back one line per sense, or
/// a table or cloze card's front with its blanks filled, "이미 노트에 있어요"
/// under it when the deck holds it. A tap edits it, but for a table or cloze
/// card, and a swipe left leaves it out.
class _RowTile extends StatelessWidget {
  const _RowTile({
    super.key,
    required this.sides,
    required this.wholeFront,
    required this.included,
    required this.inDeck,
    required this.first,
    required this.onCheck,
    required this.onExclude,
    required this.onEdit,
  });

  final CardSides sides;

  /// A table or cloze card's front, drawn whole in place of [sides].
  final List<Content>? wholeFront;

  final bool included;
  final bool inDeck;

  /// Whether it is the section's first row, with no separator above it.
  final bool first;

  /// Includes or leaves out the row; null while it has nothing to save.
  final VoidCallback? onCheck;

  final VoidCallback onExclude;

  /// Opens the edit sheet; null for a row that cannot be edited.
  final VoidCallback? onEdit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final onCheck = this.onCheck;
    final wholeFront = this.wholeFront;
    final spokenFront = wholeFront == null
        ? describeContent(l10n, sides.front)
        : spokenContent(l10n, wholeFront, revealed: false);
    final tile = DecoratedBox(
      decoration: BoxDecoration(
        border: first
            ? null
            : Border(top: BorderSide(color: colors.hairline, width: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            container: true,
            checked: included,
            label: l10n.importInclude(spokenFront),
            excludeSemantics: true,
            onTap: onCheck,
            child: InkResponse(
              onTap: onCheck,
              radius: AppSize.tapTarget / 2,
              child: SizedBox(
                width: AppSize.tapTarget + AppSpace.s4,
                height: AppSize.tapTarget + AppSpace.s4,
                child: Center(child: RoundCheck(on: included)),
              ),
            ),
          ),
          Expanded(
            child: Semantics(
              container: true,
              button: onEdit != null,
              label: wholeFront == null
                  ? l10n.importRow(
                      spokenFront,
                      describeContent(l10n, sides.back),
                    )
                  : spokenContent(l10n, wholeFront, revealed: true),
              excludeSemantics: true,
              onTap: onEdit,
              child: InkWell(
                onTap: onEdit,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    0,
                    AppSpace.s12,
                    AppSpace.s16,
                    AppSpace.s12,
                  ),
                  child: LayoutBuilder(
                    builder: (context, constraints) => Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      spacing: AppSpace.s4,
                      children: [
                        if (wholeFront != null)
                          WholeCardView(
                            wholeFront,
                            revealed: true,
                            style: AppType.bodyStrong.copyWith(
                              color: included ? colors.ink : colors.muted,
                            ),
                          )
                        else
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            spacing: AppSpace.s12,
                            children: [
                              SizedBox(
                                width: constraints.maxWidth * 0.44,
                                child: Text.rich(
                                  contentSpan(
                                    l10n,
                                    sides.front,
                                    wrap: keepWords,
                                  ),
                                  style: AppType.bodyStrong.copyWith(
                                    color: included ? colors.ink : colors.muted,
                                  ),
                                ),
                              ),
                              Expanded(
                                child: Text.rich(
                                  contentSpan(
                                    l10n,
                                    sides.back,
                                    wrap: keepWords,
                                  ),
                                  style: AppType.secondary.copyWith(
                                    color: included
                                        ? colors.ink2
                                        : colors.muted,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        if (inDeck)
                          Text(
                            l10n.importInDeck,
                            style: AppType.caption.copyWith(
                              color: colors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
    return Dismissible(
      key: key ?? UniqueKey(),
      direction: included ? DismissDirection.endToStart : DismissDirection.none,
      confirmDismiss: (_) async {
        onExclude();
        return false;
      },
      background: ColoredBox(
        color: colors.dontKnowText,
        child: Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.only(right: AppSpace.gutter),
            child: Text(
              l10n.importRemove,
              style: AppType.label.copyWith(color: colors.onDontKnowText),
            ),
          ),
        ),
      ),
      child: Material(type: MaterialType.transparency, child: tile),
    );
  }
}

/// One photo's group: its thumbnail, "사진 n" as a heading and its card
/// count, and a chevron; a tap collapses or expands the photo's sections.
class _PhotoHeader extends StatelessWidget {
  const _PhotoHeader({
    required this.number,
    required this.photos,
    required this.rows,
    required this.expanded,
    required this.onToggle,
  });

  final int number;

  /// Every photo of the import in pick order; this group's is [number]'s.
  final List<ImageProvider> photos;
  final int rows;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final header = Semantics(
      header: true,
      button: true,
      expanded: expanded,
      label: '${l10n.photoNumber(number)}, ${l10n.cardCount(rows)}',
      excludeSemantics: true,
      onTap: onToggle,
      child: InkWell(
        onTap: onToggle,
        borderRadius: BorderRadius.circular(AppRadius.field),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: AppSize.tapTarget),
          child: Row(
            spacing: AppSpace.s12,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.photoNumber(number),
                      style: AppType.bodyStrong.copyWith(color: colors.ink),
                    ),
                    Text(
                      l10n.cardCount(rows),
                      style: AppType.secondary.copyWith(color: colors.ink2),
                    ),
                  ],
                ),
              ),
              Icon(
                expanded ? LucideIcons.chevronUp : LucideIcons.chevronDown,
                size: AppSize.smallIcon,
                color: colors.ink2,
              ),
            ],
          ),
        ),
      ),
    );
    return Row(
      spacing: AppSpace.s8,
      children: [
        PhotoThumbnail(
          photos: photos,
          index: number - 1,
          width: 48,
          height: 56,
        ),
        Expanded(child: header),
      ],
    );
  }
}
