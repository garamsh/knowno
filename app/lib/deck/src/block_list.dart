import 'package:flutter/material.dart';

import '../../design/app_chip.dart';
import '../../design/app_list_row.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import 'undo_snack_bar.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'audio_block.dart';
import 'block_draft.dart';
import 'card_frame.dart';
import 'content.dart';
import 'editor_group.dart';
import 'image_block.dart';
import 'markdown_paste.dart';
import 'markup_editing.dart';
import 'markup_span.dart';
import 'senses_block.dart';
import 'table_block.dart';

/// A card's [blocks], one white group per 칸 headed by its type, each with a
/// ⋯ menu that moves it up or down or deletes it, a non-drag way to reorder
/// (WCAG 2.2 dragging). "+ 칸 추가" after the last opens the sheet "칸 추가"
/// of the types (ADR 0137). With [showErrors], what keeps a block from being
/// saved shows under it, and [error], why the card as a whole cannot be
/// saved, under the column.
class BlockList extends StatelessWidget {
  const BlockList({
    super.key,
    required this.blocks,
    required this.showErrors,
    required this.onChanged,
    required this.onMediaStored,
    required this.onPasteImage,
    this.error,
    this.errorKey,
  });

  final List<BlockDraft> blocks;
  final bool showErrors;
  final String? error;

  /// The key of [error]'s line, which the editor scrolls into view.
  final Key? errorKey;

  /// Called after every change, which this widget makes in place.
  final VoidCallback onChanged;

  /// Called with each photo a 사진 block and each sound a 소리 block stores,
  /// so the editor can let go of one the card is not saved with.
  final ValueChanged<MediaId> onMediaStored;

  /// Called with the new 사진 a pasted image link made and the link, whose
  /// picture the editor fetches into it.
  final void Function(ImageBlockDraft draft, Uri url) onPasteImage;

  /// Makes 칸 of the [parts] a text 글 was pasted: a table a 표, an image
  /// link a 사진 and the rest a 글, after [block], or in its place where
  /// it holds nothing.
  void _paste(BlockDraft block, List<PastePart> parts) {
    final made = <BlockDraft>[];
    for (final part in parts) {
      switch (part) {
        case PasteText(:final text):
          made.add(TextBlockDraft(TextCell(front: text)));
        case PasteTable(:final columns, :final rows):
          made.add(
            TableBlockDraft(
              TableContent(
                columns: columns,
                rows: rows,
                blanks: const <TableBlank>[],
              ),
            ),
          );
        case PasteImage(:final url):
          final image = ImageBlockDraft();
          made.add(image);
          onPasteImage(image, url);
      }
    }
    final index = blocks.indexOf(block);
    if (index < 0) return;
    final empty =
        block is TextBlockDraft &&
        block.front.text.trim().isEmpty &&
        block.back.text.trim().isEmpty;
    if (empty) {
      blocks.removeAt(index);
      block.dispose();
    }
    blocks.insertAll(empty ? index : index + 1, made);
    onChanged();
  }

  void _act(BuildContext context, int index, RowAction action) {
    switch (action) {
      case RowAction.up:
        blocks.insert(index - 1, blocks.removeAt(index));
      case RowAction.down:
        blocks.insert(index + 1, blocks.removeAt(index));
      case RowAction.delete:
        final removed = blocks.removeAt(index);
        showUndoSnackBar(
          context,
          message: AppLocalizations.of(context).deletedBlock,
          onUndo: () {
            blocks.insert(index.clamp(0, blocks.length), removed);
            onChanged();
          },
          onGone: removed.dispose,
        );
    }
    onChanged();
  }

  Future<void> _add(BuildContext context) async {
    final type = await showAppSheet<BlockType>(
      context,
      builder: (context) => AppSheet(
        title: AppLocalizations.of(context).addBlock,
        content: const _TypeList(),
      ),
    );
    if (type == null) return;
    final block = type.draft();
    blocks.add(block);
    onChanged();
    // Once it is built: the focus in its first field, which scrolls it into
    // view, or, with none, the keyboard closed and the 칸 scrolled into view.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (block.entry case final entry?) {
        entry.requestFocus();
      } else {
        FocusManager.instance.primaryFocus?.unfocus();
        if (block.key.currentContext case final group?) {
          Scrollable.ensureVisible(
            group,
            alignmentPolicy: ScrollPositionAlignmentPolicy.keepVisibleAtEnd,
          );
        }
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final error = this.error;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpace.s12,
      children: [
        for (final (index, block) in blocks.indexed)
          _Block(
            key: block.key,
            block: block,
            menuLabel: l10n.blockMenu(index + 1),
            showErrors: showErrors,
            onChanged: onChanged,
            onMediaStored: onMediaStored,
            onPaste: (parts) => _paste(block, parts),
            onAction: (action) => _act(context, index, action),
            canMoveUp: index > 0,
            canMoveDown: index < blocks.length - 1,
          ),
        GroupAddRow(
          label: l10n.addBlock,
          semanticsLabel: l10n.addBlock,
          color: colors.ink2,
          onPressed: () => _add(context),
        ),
        if (error != null)
          Semantics(
            key: errorKey,
            liveRegion: true,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.s4),
              child: Text(
                keepWords(error),
                semanticsLabel: error,
                style: AppType.caption.copyWith(color: colors.dontKnowText),
              ),
            ),
          ),
      ],
    );
  }
}

/// The add sheet's one group of block types, each row its icon, its name and
/// one line under it; a tap picks it.
class _TypeList extends StatelessWidget {
  const _TypeList();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return AppGroup(
      children: [
        for (final type in BlockType.values)
          AppListRow(
            leading: Icon(type.icon, color: colors.ink2),
            title: type.title(l10n),
            subtitle: type.description(l10n),
            onTap: () => Navigator.of(context).pop(type),
          ),
      ],
    );
  }
}

/// One 칸's group: its type and menu over its fields, each further row parted
/// by a hairline, or, for a block this build cannot read, its placeholder
/// line and menu with no field.
class _Block extends StatelessWidget {
  const _Block({
    super.key,
    required this.block,
    required this.menuLabel,
    required this.showErrors,
    required this.onChanged,
    required this.onMediaStored,
    required this.onPaste,
    required this.onAction,
    required this.canMoveUp,
    required this.canMoveDown,
  });

  final BlockDraft block;
  final ValueChanged<MediaId> onMediaStored;
  final ValueChanged<List<PastePart>> onPaste;
  final String menuLabel;
  final bool showErrors;
  final VoidCallback onChanged;
  final ValueChanged<RowAction> onAction;
  final bool canMoveUp;
  final bool canMoveDown;

  /// Tells the group's listeners and then the editor of an edit in it.
  void _edited() {
    block.edits.edited();
    onChanged();
  }

  /// The two chips of a side, the one [selected] tinted.
  Widget _sideRow(
    AppLocalizations l10n,
    CellSide selected,
    ValueChanged<CellSide> onSelected,
  ) => _ChoiceRow(
    choices: [
      for (final side in CellSide.values)
        (
          label: switch (side) {
            CellSide.front => l10n.cardFront,
            CellSide.back => l10n.cardBack,
          },
          selected: side == selected,
          onPressed: () {
            onSelected(side);
            _edited();
          },
        ),
    ],
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    final block = this.block;
    final title = switch (block) {
      KeptBlockDraft(block: final kept) => l10n.unsupportedContent(kept.type),
      TextBlockDraft(:final type) ||
      SensesBlockDraft(:final type) ||
      TableBlockDraft(:final type) ||
      ClozeBlockDraft(:final type) ||
      ImageBlockDraft(:final type) ||
      AudioBlockDraft(:final type) => type.title(l10n),
    };
    const fieldInset = EdgeInsets.fromLTRB(
      AppSpace.s16,
      0,
      AppSpace.s16,
      AppSpace.s16,
    );
    final rows = switch (block) {
      KeptBlockDraft() => const <Widget>[],
      TextBlockDraft() => [
        _NamedField(
          name: l10n.cardFront,
          controller: block.front,
          focusNode: block.focus,
          multiline: true,
          markup: true,
          onPaste: onPaste,
          onChanged: _edited,
        ),
        _NamedField(
          name: l10n.cardBack,
          controller: block.back,
          multiline: true,
          markup: true,
          onPaste: onPaste,
          onChanged: _edited,
        ),
      ],
      SensesBlockDraft(:final senses, :final ask) => [
        _NamedField(
          name: l10n.wordTerm,
          controller: block.term,
          focusNode: block.termFocus,
          // The group names 뜻 right after it.
          onNext: () => senses.first.meaningFocus.requestFocus(),
          onChanged: _edited,
        ),
        SenseFields(
          senses: senses,
          showErrors: showErrors,
          onChanged: _edited,
          edits: block.edits,
        ),
        _ChoiceRow(
          name: l10n.wordAskFirst,
          choices: [
            for (final (value, label) in [
              (WordAsk.term, l10n.wordTerm),
              (WordAsk.meaning, l10n.senseMeaning),
            ])
              (
                label: label,
                selected: ask == value,
                onPressed: () {
                  block.ask = value;
                  _edited();
                },
              ),
          ],
        ),
      ],
      TableBlockDraft(:final table) => [
        Padding(
          padding: fieldInset,
          child: TableFields(
            draft: table,
            showErrors: showErrors,
            onChanged: _edited,
            edits: block.edits,
          ),
        ),
      ],
      ClozeBlockDraft() => [
        _ClozeFields(
          draft: block,
          showErrors: showErrors,
          onChanged: _edited,
          onPaste: onPaste,
        ),
      ],
      ImageBlockDraft(:final image, :final side) => [
        Padding(
          padding: fieldInset,
          child: ImageBlockFields(
            draft: image,
            showErrors: showErrors,
            onChanged: _edited,
            edits: block.edits,
            onPicked: onMediaStored,
          ),
        ),
        if (image.boxes.isEmpty)
          _sideRow(l10n, side, (side) => block.side = side),
      ],
      AudioBlockDraft(:final audio, :final side) => [
        Padding(
          padding: fieldInset,
          child: AudioBlockFields(
            draft: audio,
            showErrors: showErrors,
            onChanged: _edited,
            edits: block.edits,
            onStored: onMediaStored,
          ),
        ),
        _sideRow(l10n, side, (side) => block.side = side),
      ],
    };
    final heading = Padding(
      padding: const EdgeInsets.only(right: groupInset),
      child: Row(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(left: AppSpace.s20),
              child: Text(
                title,
                style: AppType.caption.copyWith(color: colors.muted),
              ),
            ),
          ),
          RowMenu(
            label: menuLabel,
            upLabel: l10n.moveUp,
            downLabel: l10n.moveDown,
            deleteLabel: l10n.deleteBlock,
            canMoveUp: canMoveUp,
            canMoveDown: canMoveDown,
            onAction: onAction,
          ),
        ],
      ),
    );
    return EditorGroup(
      children: [
        // The heading stands over the first row, no hairline between them.
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [heading, ?rows.firstOrNull],
        ),
        ...rows.skip(1),
      ],
    );
  }
}

/// A row of a group holding one field, named [name] inline in muted text so
/// the name stays once the field holds text, and read by that name.
class _NamedField extends StatelessWidget {
  const _NamedField({
    required this.name,
    required this.controller,
    required this.onChanged,
    this.focusNode,
    this.multiline = false,
    this.onNext,
    this.markup = false,
    this.onPaste,
  });

  final String name;
  final TextEditingController controller;
  final FocusNode? focusNode;
  final bool multiline;

  /// Whether the field's text is markup: a list goes on as a line is
  /// broken, a pasted table or image becomes 칸 through [onPaste], and the
  /// text is shown formatted under the field.
  final bool markup;
  final ValueChanged<List<PastePart>>? onPaste;
  final VoidCallback onChanged;

  /// Where a single-line field's action key goes on to, as "next"; without
  /// it, the key closes the keyboard.
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(
      AppSpace.s20,
      groupInset,
      groupInset,
      groupInset,
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.baseline,
      textBaseline: TextBaseline.alphabetic,
      children: [
        ExcludeSemantics(
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minWidth: kMinInteractiveDimension,
            ),
            child: Text(
              name,
              style: AppType.body.copyWith(color: AppColors.of(context).muted),
            ),
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Semantics(
                label: name,
                child: AppTextField(
                  controller: controller,
                  focusNode: focusNode,
                  maxLines: multiline ? null : 1,
                  textInputAction: onNext == null ? null : TextInputAction.next,
                  inputFormatters: markup
                      ? [const ListContinuation(), PasteToBlocks(onPaste)]
                      : null,
                  onSubmitted: onNext == null ? null : (_) => onNext?.call(),
                  onChanged: (_) => onChanged(),
                ),
              ),
              if (markup) MarkupPreview(controller),
            ],
          ),
        ),
      ],
    ),
  );
}

/// A row of a group offering a choice of chips, after its [name] when it has
/// one, the chips at the row's end; where the name and the chips do not fit
/// one line, as at a large text size, the chips go under the name.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({this.name, required this.choices});

  final String? name;
  final List<({String label, bool selected, VoidCallback onPressed})> choices;

  @override
  Widget build(BuildContext context) {
    final name = this.name;
    final chips = Wrap(
      spacing: AppSpace.s8,
      children: [
        for (final choice in choices)
          AppChip.action(
            label: choice.label,
            selected: choice.selected,
            onPressed: choice.onPressed,
          ),
      ],
    );
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.s20),
      child: name == null
          ? chips
          : OverflowBar(
              spacing: AppSpace.s8,
              alignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  keepWords(name),
                  semanticsLabel: name,
                  style: AppType.body.copyWith(
                    color: AppColors.of(context).muted,
                  ),
                ),
                chips,
              ],
            ),
    );
  }
}

/// A 빈칸 문장: its text in Anki's syntax, borderless in its
/// group, and under it, while the text has focus, its one action as a small
/// outlined chip that follows the caret, "가리기" or, in a cloze, "가리기 풀기";
/// then the text as study draws it, each cloze a blank with its hint, and what
/// keeps it from being saved, with [showErrors].
class _ClozeFields extends StatelessWidget {
  const _ClozeFields({
    required this.draft,
    required this.showErrors,
    required this.onChanged,
    required this.onPaste,
  });

  final ClozeBlockDraft draft;
  final bool showErrors;
  final VoidCallback onChanged;
  final ValueChanged<List<PastePart>> onPaste;

  void _set(TextEditingValue value) {
    draft.source.value = value;
    onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(groupInset, 0, groupInset, groupInset),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AppTextField(
            controller: draft.source,
            focusNode: draft.focus,
            hint: l10n.clozeMarkupHint,
            minLines: 2,
            maxLines: null,
            inputFormatters: [const ListContinuation(), PasteToBlocks(onPaste)],
            onChanged: (_) => onChanged(),
          ),
          ListenableBuilder(
            listenable: Listenable.merge([draft.focus, draft.source]),
            builder: (context, _) {
              if (!draft.focus.hasFocus) return const SizedBox.shrink();
              final value = draft.source.value;
              final inside = clozeAt(value.text, value.selection);
              return Align(
                alignment: AlignmentDirectional.centerStart,
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: AppSpace.s12),
                  child: AppChip.action(
                    label: inside == null ? l10n.clozeHide : l10n.clozeHideUndo,
                    onPressed: () => _set(
                      inside == null
                          ? hideSelection(value)
                          : removeCloze(value, inside),
                    ),
                  ),
                ),
              );
            },
          ),
          MarkupPreview(
            draft.source,
            cloze: (run) => TextSpan(
              text: ' ${run.hint ?? answerText(run)} ',
              style: TextStyle(
                backgroundColor: colors.brandTint,
                color: run.hint == null ? colors.ink : colors.ink2,
              ),
            ),
          ),
          if (showErrors && !draft.isComplete)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.s16),
              child: Text(
                l10n.clozeBlankRequired,
                style: AppType.caption.copyWith(color: colors.dontKnowText),
              ),
            ),
        ],
      ),
    );
  }
}
