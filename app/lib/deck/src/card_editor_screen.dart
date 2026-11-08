import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart' hide Card;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_button.dart';
import '../../design/bottom_actions.dart';
import '../../design/app_sheet.dart';
import '../../design/theme.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'block_draft.dart';
import 'block_list.dart';
import 'card_frame.dart';
import 'card_preview.dart';
import 'content.dart';
import 'deck_repository.dart';
import 'failure_message.dart';
import 'image_download.dart';
import 'label_presets.dart';
import 'label_presets_screen.dart';
import 'model.dart';
import 'providers.dart';
import 'senses_block.dart';
import 'undo_snack_bar.dart';

/// Adds a card to [deck], or edits [card] when one is given. The card is a
/// column of groups, one per 칸, ending in "+ 칸 추가"; "미리보기" opens
/// [preview] over the card's 칸. A new card opens with one empty 글, and every
/// card, of whichever template it was made in, opens as its 칸 in order and is
/// written in the frame (ADR 0114, ADR 0117, ADR 0137).
class CardEditorScreen extends ConsumerStatefulWidget {
  const CardEditorScreen({
    super.key,
    required this.deck,
    this.card,
    required this.preview,
  });

  final Deck deck;
  final Card? card;

  /// The screen that shows [cells] as study draws them, which the caller
  /// takes from `study` (ADR 0168).
  final Widget Function(List<Cell> cells) preview;

  @override
  ConsumerState<CardEditorScreen> createState() => _CardEditorScreenState();
}

/// What the user chose on the duplicate sheet; dismissing it chooses neither.
enum _DuplicateChoice { saveAnyway, openExisting }

/// Where the editor goes once a card is saved.
enum _AfterSave { close, next }

class _CardEditorScreenState extends ConsumerState<CardEditorScreen> {
  /// The 칸 the card opens as: null for a card of a template or version this
  /// build does not know or holding a side block it cannot read, which the
  /// editor shows read-only and never writes (ADR 0106).
  late final _opened = switch (widget.card) {
    final card? => cellsOf(card),
    null => const <Cell>[TextCell(markup: true)],
  };

  /// The card's 칸.
  late final _blocks = [
    for (final cell in _opened ?? const <Cell>[]) BlockDraft.of(cell),
  ];

  bool _showRequired = false;

  /// The form's own snack bars, an undo among them.
  final _messenger = GlobalKey<ScaffoldMessengerState>();

  /// The height of the form's undo bar, 0 while none shows.
  final _undoBar = ValueNotifier<double>(0);

  /// The line under the column saying why the card as a whole cannot be
  /// saved.
  final _cardProblemKey = GlobalKey();

  bool get _isNew => widget.card == null;

  /// Whether anything was typed or chosen since the editor opened or last
  /// saved; leaving then asks first (issue #309).
  bool _edited = false;

  @override
  void initState() {
    super.initState();
    // The presets show while a label field has focus, and a 빈칸 문장's
    // action while its line has.
    FocusManager.instance.addListener(_focusChanged);
    if (_isNew) _focusFront();
  }

  void _focusChanged() => setState(() {});

  /// Puts the focus in the first 칸's 앞면 once it is built, where a new card
  /// is typed first, while that 칸 is a 글.
  void _focusFront() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted) return;
    if (_blocks.firstOrNull case final TextBlockDraft first) {
      first.focus.requestFocus();
    }
  });

  /// Marks the card changed and redraws.
  void _change([VoidCallback? change]) => setState(() {
    change?.call();
    _edited = true;
  });

  /// Asks before leaving with changes, and leaves once the user discards
  /// them.
  Future<void> _confirmLeave(bool didPop) async {
    if (didPop) return;
    final l10n = AppLocalizations.of(context);
    final discard = await showAppConfirm(
      context,
      title: l10n.discardCardTitle,
      consequence: l10n.discardCardBody,
      confirmLabel: l10n.discardCard,
      cancelLabel: l10n.keepWriting,
    );
    if (discard && mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    FocusManager.instance.removeListener(_focusChanged);
    _undoBar.dispose();
    for (final block in _blocks) {
      block.dispose();
    }
    // Photos and sounds stored here that no saved card holds, the card left
    // unsaved.
    for (final image in _picked) {
      unawaited(_media?.release(image));
    }
    super.dispose();
  }

  /// The photos 사진 blocks and the sounds 소리 blocks stored since the card
  /// was last saved; those the saved card does not hold are let go
  /// (ADR 0109, ADR 0112).
  final _picked = <MediaId>{};

  /// The store the files went to, read on the first, so an editor that
  /// stores none needs none.
  MediaStore? _media;

  void _mediaStored(MediaId image) {
    _media ??= ref.read(mediaStoreProvider);
    _picked.add(image);
  }

  /// Fetches the picture of an image link that was pasted into [draft], and
  /// stores it as a photo is picked; the 사진 stays empty, to be picked, where
  /// it cannot be had.
  Future<void> _pasteImage(ImageBlockDraft draft, Uri url) async {
    // Read before the waits: the fetch can end after the editor is left.
    final store = ref.read(mediaStoreProvider);
    final download = ref.read(imageDownloadProvider);
    final messenger = ScaffoldMessenger.of(context);
    final failed = AppLocalizations.of(context).pasteImageFailed;
    try {
      final bytes = await download(url);
      if (bytes == null) throw const MediaUnreadable('not an image');
      final picked = await prepareImage(bytes, ImageShape.whole);
      final media = await store.addImage(picked);
      if (!mounted) {
        await store.release(media);
        return;
      }
      _mediaStored(media);
      setState(() => draft.image.choose(media, picked));
    } on MediaUnreadable {
      messenger.showSnackBar(SnackBar(content: Text(failed)));
    }
  }

  /// Lets go of the files stored since the last save that [saved] does not
  /// hold.
  Future<void> _releaseUnsaved(Set<MediaId> saved) async {
    for (final image in _picked.difference(saved)) {
      await _media?.release(image);
    }
    _picked.clear();
  }

  /// The 칸 as saved: each as its type writes it, but for one holding nothing
  /// to save, such as a 글 left empty.
  List<Cell> get _cells => [for (final block in _blocks) ?block.cell];

  /// Whether every block can be saved, so the card as a whole is what is left
  /// to refuse.
  bool get _blocksComplete => _blocks.every((block) => block.isComplete);

  /// Why the card as a whole cannot be saved, null once it can; [_cells] holds
  /// no empty 글, so what shows nothing before the reveal says so.
  String? _cardProblem(AppLocalizations l10n) => switch (frameProblem(_cells)) {
    FrameProblem.emptyText ||
    FrameProblem.nothingBefore => l10n.cardNothingBefore,
    FrameProblem.nothingAdded => l10n.cardNothingAdded,
    null => null,
  };

  Future<void> _save(_AfterSave after, {bool allowDuplicate = false}) async {
    // A recording under way is ended and kept, rather than left out.
    for (final block in [..._blocks]) {
      if (block case AudioBlockDraft(:final audio)) {
        await audio.stopRecording?.call();
      }
    }
    if (!mounted) return;
    if (!_blocksComplete || frameProblem(_cells) != null) {
      setState(() => _showRequired = true);
      _revealProblem();
      return;
    }
    final repository = ref.read(deckRepositoryProvider);
    final card = widget.card;
    final cells = _cells;
    final (:front, :back) = sidesOf(cells);
    await reportingFailure(context, () async {
      final result = card == null
          ? await repository.addCard(
              widget.deck.id,
              front: front,
              back: back,
              cells: cells,
              allowDuplicate: allowDuplicate,
            )
          : await repository.editCard(
              card,
              front: front,
              back: back,
              cells: cells,
              allowDuplicate: allowDuplicate,
            );
      if (result is CardSaved) {
        HapticFeedback.lightImpact();
        await _releaseUnsaved(mediaOf([...front, ...back]));
      }
      if (!mounted) return;
      switch ((result, after)) {
        case (CardSaved(), _AfterSave.close):
          Navigator.of(context).pop();
        case (CardSaved(), _AfterSave.next):
          // An undo would put a 칸 of the saved card in the next one.
          _messenger.currentState?.hideCurrentSnackBar();
          setState(() {
            for (final block in _blocks) {
              block.dispose();
            }
            _blocks
              ..clear()
              ..add(TextBlockDraft());
            _showRequired = false;
            _edited = false;
          });
          _focusFront();
        case (DuplicateFront(:final existing), _):
          await _resolveDuplicate(existing, after);
      }
    });
  }

  /// Once the errors are built, scrolls to the first block that cannot be
  /// saved and puts the focus in the field to blame, or, with none, closes
  /// the keyboard; with every block complete, scrolls to the card's own
  /// error under the column.
  void _revealProblem() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (!mounted) return;
    final block = _blocks.where((block) => !block.isComplete).firstOrNull;
    final shown = (block?.key ?? _cardProblemKey).currentContext;
    if (shown != null) Scrollable.ensureVisible(shown);
    if (block?.problem case final field?) {
      field.requestFocus();
    } else {
      FocusManager.instance.primaryFocus?.unfocus();
    }
  });

  Future<void> _resolveDuplicate(Card existing, _AfterSave after) async {
    final choice = await showAppSheet<_DuplicateChoice>(
      context,
      builder: (_) => _DuplicateSheet(existing: existing, isNew: _isNew),
    );
    if (!mounted) return;
    switch (choice) {
      case _DuplicateChoice.saveAnyway:
        await _save(after, allowDuplicate: true);
      case _DuplicateChoice.openExisting:
        // Over the editor, so closing it returns to the card being typed.
        await Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => CardEditorScreen(
              deck: widget.deck,
              card: existing,
              preview: widget.preview,
            ),
          ),
        );
      case null:
        break;
    }
  }

  Future<void> _delete(Card card) async {
    final l10n = AppLocalizations.of(context);
    final confirmed = await showAppConfirm(
      context,
      title: l10n.deleteCardTitle,
      consequence: l10n.deleteCardBody,
      confirmLabel: l10n.delete,
    );
    if (!confirmed || !mounted) return;
    final repository = ref.read(deckRepositoryProvider);
    await reportingFailure(context, () async {
      await repository.deleteCard(card.id);
      if (mounted) Navigator.of(context).pop();
    });
  }

  /// The 단어 sense whose label field has focus.
  SenseDraft? _focusedSense() => [
    for (final block in _blocks)
      if (block case SensesBlockDraft(:final senses)) ...senses,
  ].where((sense) => sense.labelFocus.hasFocus).firstOrNull;

  /// Opens the card as study draws it.
  void _openPreview() {
    // As the editor holds them, empty blanks and incomplete blocks included.
    final cells = [for (final block in _blocks) ?block.preview];
    FocusManager.instance.primaryFocus?.unfocus();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        fullscreenDialog: true,
        builder: (_) => widget.preview(cells),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final presets = labelPresets(ref.read(deckStorageProvider));
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final card = widget.card;
    if (card != null && _opened == null) {
      return _ReadOnlyCard(card: card, onDelete: _delete);
    }
    return PopScope(
      canPop: !_edited,
      onPopInvokedWithResult: (didPop, _) => _confirmLeave(didPop),
      child: Scaffold(
        appBar: AppBar(
          toolbarHeight: AppButton.barHeight(context),
          leading: IconButton(
            tooltip: l10n.close,
            icon: const Icon(LucideIcons.x),
            onPressed: () => Navigator.of(context).maybePop(),
          ),
          title: Text(_isNew ? l10n.newCardTitle : l10n.editCard),
          actions: [
            AppButton(
              label: l10n.previewCard,
              variant: AppButtonVariant.text,
              onPressed: _openPreview,
            ),
            const SizedBox(width: AppSpace.s8),
          ],
        ),
        // The actions sit in the body under the form, not in the bottom bar, so
        // they stay above the keyboard, which shrinks the body (issue #307).
        body: CustomMultiChildLayout(
          delegate: _BodyLayout(undoBar: _undoBar),
          children: [
            LayoutId(
              id: _Part.form,
              // The form's own snack bars, an undo among them, which sit
              // over its foot rather than over the actions, and go with
              // the editor.
              child: UndoBarRoom(
                height: _undoBar,
                child: ScaffoldMessenger(
                  key: _messenger,
                  child: Scaffold(
                    resizeToAvoidBottomInset: false,
                    // A column, not a lazy list, so every block is built and its
                    // error shows wherever it scrolls.
                    body: SingleChildScrollView(
                      padding: const EdgeInsets.all(AppSpace.gutter),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          // The deck, in the form rather than the top bar, where a
                          // long name pushed the title out (issue #310).
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: AppSpace.s4,
                            ),
                            child: Text(
                              widget.deck.name,
                              semanticsLabel: l10n.cardDeck(widget.deck.name),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppType.caption.copyWith(
                                color: colors.muted,
                              ),
                            ),
                          ),
                          const SizedBox(height: AppSpace.s20),
                          BlockList(
                            blocks: _blocks,
                            showErrors: _showRequired,
                            error: _showRequired && _blocksComplete
                                ? _cardProblem(l10n)
                                : null,
                            errorKey: _cardProblemKey,
                            onChanged: _change,
                            onMediaStored: _mediaStored,
                            onPasteImage: _pasteImage,
                          ),
                          if (card != null) ...[
                            const SizedBox(height: AppSpace.sectionGap),
                            Align(
                              alignment: Alignment.centerLeft,
                              child: AppButton(
                                label: l10n.deleteCard,
                                variant: AppButtonVariant.destructive,
                                onPressed: () => _delete(card),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ),
            LayoutId(
              id: _Part.actions,
              child: SingleChildScrollView(
                primary: false,
                child: _isNew
                    ? BottomActions(
                        secondary: AppButton(
                          label: l10n.save,
                          variant: AppButtonVariant.secondary,
                          size: AppButtonSize.cta,
                          onPressed: () => _save(_AfterSave.close),
                        ),
                        primary: AppButton(
                          label: l10n.saveAndNext,
                          size: AppButtonSize.cta,
                          onPressed: () => _save(_AfterSave.next),
                        ),
                      )
                    : BottomActions(
                        secondary: AppButton(
                          label: l10n.save,
                          size: AppButtonSize.cta,
                          onPressed: () => _save(_AfterSave.close),
                        ),
                      ),
              ),
            ),
            if (_focusedSense() case final sense? when presets.isNotEmpty)
              LayoutId(
                id: _Part.strip,
                child: LabelPresetStrip(
                  presets: presets,
                  current: sense.label.text,
                  onPick: (label) => _change(() {
                    sense.label.value = TextEditingValue(
                      text: label,
                      selection: TextSelection.collapsed(offset: label.length),
                    );
                  }),
                  onManage: () => openPartOfSpeechPresets(context),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The parts of the editor's body, top to bottom.
enum _Part { form, actions, strip }

/// Lays out the form over the actions over the label presets, the presets
/// right above the keyboard. The actions take at most half the body, and
/// while an undo bar shows, at most what leaves the form its height; past
/// that they scroll.
class _BodyLayout extends MultiChildLayoutDelegate {
  _BodyLayout({required this.undoBar}) : super(relayout: undoBar);

  final ValueNotifier<double> undoBar;

  @override
  void performLayout(Size size) {
    final across = BoxConstraints.tightFor(width: size.width);
    final strip = hasChild(_Part.strip)
        ? layoutChild(
            _Part.strip,
            across.copyWith(maxHeight: size.height),
          ).height
        : 0.0;
    final cap = min(
      size.height / 2,
      max(0.0, size.height - strip - undoBar.value),
    );
    final actions = layoutChild(
      _Part.actions,
      across.copyWith(maxHeight: cap),
    ).height;
    final form = max(0.0, size.height - strip - actions);
    layoutChild(
      _Part.form,
      BoxConstraints.tightFor(width: size.width, height: form),
    );
    positionChild(_Part.actions, Offset(0, form));
    if (hasChild(_Part.strip)) {
      positionChild(_Part.strip, Offset(0, form + actions));
    }
  }

  @override
  bool shouldRelayout(_BodyLayout oldDelegate) =>
      undoBar != oldDelegate.undoBar;
}

/// A card whose template this build does not know: shown as it is, with a
/// line saying the app needs an update to edit it, and nothing to save; it
/// can still be deleted, by the red "카드 삭제" at the end (ADR 0106).
class _ReadOnlyCard extends StatelessWidget {
  const _ReadOnlyCard({required this.card, required this.onDelete});

  final Card card;
  final ValueChanged<Card> onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          tooltip: l10n.close,
          icon: const Icon(LucideIcons.x),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
        title: Text(l10n.editCard),
      ),
      body: ListView(
        padding: const EdgeInsets.all(AppSpace.gutter),
        children: [
          CardPreview(front: card.front, back: card.back),
          const SizedBox(height: AppSpace.s24),
          Text(
            l10n.cardNeedsUpdate,
            style: AppType.body.copyWith(color: AppColors.of(context).ink2),
          ),
          const SizedBox(height: AppSpace.sectionGap),
          Align(
            alignment: Alignment.centerLeft,
            child: AppButton(
              label: l10n.deleteCard,
              variant: AppButtonVariant.destructive,
              onPressed: () => onDelete(card),
            ),
          ),
        ],
      ),
    );
  }
}

/// The sheet shown when a save collides with [existing]: save anyway or open
/// the existing card; dismissing it does neither. Nothing is overwritten.
class _DuplicateSheet extends StatelessWidget {
  const _DuplicateSheet({required this.existing, required this.isNew});

  final Card existing;
  final bool isNew;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AppSheet(
      title: l10n.duplicateTitle,
      body: l10n.duplicateBody,
      content: CardPreview(front: existing.front, back: existing.back),
      actions: [
        AppButton(
          label: l10n.openExistingCard,
          variant: AppButtonVariant.secondary,
          size: AppButtonSize.cta,
          onPressed: () =>
              Navigator.of(context).pop(_DuplicateChoice.openExisting),
        ),
        AppButton(
          label: isNew ? l10n.addAnyway : l10n.saveAnyway,
          size: AppButtonSize.cta,
          onPressed: () =>
              Navigator.of(context).pop(_DuplicateChoice.saveAnyway),
        ),
      ],
    );
  }
}
