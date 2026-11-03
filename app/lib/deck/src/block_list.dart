import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../design/app_chip.dart';
import '../../design/app_sheet.dart';
import '../../design/app_text_field.dart';
import '../../design/theme.dart';
import 'undo_snack_bar.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import '../../media/media.dart';
import 'audio_block.dart';
import 'card_frame.dart';
import 'cloze_block.dart';
import 'content.dart';
import 'editor_group.dart';
import 'image_block.dart';
import 'senses_block.dart';
import 'table_block.dart';

/// A block type the add sheet offers. A type whose block issue has not
/// landed is not one of them (ADR 0108).
enum BlockType {
  text,
  senses,
  cloze,
  table,
  image,
  audio;

  /// An empty block of this type: a 글 with no text, a 단어 with one empty
  /// meaning, a line with no blank, a table of two rows of two cells, a 사진
  /// with no photo yet, or a 소리 with no sound yet.
  BlockDraft draft() => switch (this) {
    text => TextBlockDraft(),
    senses => SensesBlockDraft(),
    cloze => ClozeBlockDraft(),
    table => TableBlockDraft(),
    image => ImageBlockDraft(),
    audio => AudioBlockDraft(),
  };

  String title(AppLocalizations l10n) => switch (this) {
    text => l10n.blockText,
    senses => l10n.blockSenses,
    cloze => l10n.blockCloze,
    table => l10n.blockTable,
    image => l10n.blockImage,
    audio => l10n.blockAudio,
  };

  /// The type's icon at the start of its row in the add sheet.
  IconData get icon => switch (this) {
    text => LucideIcons.type,
    senses => LucideIcons.bookA,
    cloze => LucideIcons.textCursorInput,
    table => LucideIcons.table,
    image => LucideIcons.image,
    audio => LucideIcons.audioLines,
  };

  /// The line under the type in the add sheet.
  String description(AppLocalizations l10n) => switch (this) {
    text => l10n.blockTextDescription,
    senses => l10n.blockSensesDescription,
    cloze => l10n.blockClozeDescription,
    table => l10n.blockTableDescription,
    image => l10n.blockImageDescription,
    audio => l10n.blockAudioDescription,
  };
}

/// A 칸 as a block list edits it.
sealed class BlockDraft {
  BlockDraft({this.id});

  /// A draft of [cell], or of a block this build cannot read, kept as it is.
  static BlockDraft of(Cell cell) => switch (cell) {
    TextCell() => TextBlockDraft(cell),
    WordCell() => SensesBlockDraft(cell),
    BlankCell(:final block, :final id) => _ofBlock(block, CellSide.front, id),
    PlacedCell(:final block, :final side, :final id) => _ofBlock(
      block,
      side,
      id,
    ),
    UnknownCell(:final block) => KeptBlockDraft(block),
  };

  static BlockDraft _ofBlock(Content block, CellSide side, String? id) =>
      switch (block) {
        TableContent() => TableBlockDraft(block, id),
        ClozeContent() => ClozeBlockDraft(block, id),
        ImageContent() => ImageBlockDraft(block, side, id),
        AudioContent() => AudioBlockDraft(block, side, id),
        _ => throw ArgumentError.value(
          block,
          'block',
          'holds no blank or side',
        ),
      };

  /// The stored block's id, kept across edits; a new 칸 takes one on saving.
  final String? id;

  /// The block's group, which keeps its fields' focus and state when it
  /// moves, and which the editor scrolls into view.
  final key = GlobalKey();

  /// The edits made in the block's group, which end an undo offered for what
  /// was taken out of it.
  final edits = GroupEdits();

  /// The field a new 칸 is typed in first; null for one with no text field.
  FocusNode? get entry => null;

  /// The field that keeps the block from being saved, once [isComplete] is
  /// false; null where no one field does.
  FocusNode? get problem => null;

  /// The block's type, or null for a block this build cannot read.
  BlockType? get type;

  /// The 칸 as saved, meaningful once [isComplete]; null while it holds
  /// nothing to save.
  Cell? get cell;

  /// The 칸 as the preview draws it, while it may still be incomplete.
  Cell? get preview => cell;

  /// Whether the block can be saved as it is.
  bool get isComplete;

  @mustCallSuper
  void dispose() => edits.dispose();
}

/// A 글: its front and its back as typed.
final class TextBlockDraft extends BlockDraft {
  TextBlockDraft([TextCell? cell])
    : front = TextEditingController(text: cell?.front),
      back = TextEditingController(text: cell?.back),
      super(id: cell?.id);

  final TextEditingController front;
  final TextEditingController back;

  /// The front field's focus, which a new card's first 글 takes.
  final focus = FocusNode();

  @override
  BlockType get type => BlockType.text;

  @override
  FocusNode get entry => focus;

  /// The 글, a part holding only spaces saved empty; null with both so, as
  /// the editor saves no 칸 for it.
  @override
  Cell? get cell {
    String part(TextEditingController field) =>
        field.text.trim().isEmpty ? '' : field.text;
    final (shown, added) = (part(front), part(back));
    if (shown.isEmpty && added.isEmpty) return null;
    return TextCell(front: shown, back: added, id: id);
  }

  @override
  bool get isComplete => true;

  @override
  void dispose() {
    front.dispose();
    back.dispose();
    focus.dispose();
    super.dispose();
  }
}

/// A 단어: its word, its senses, one empty meaning when new, and which shows
/// first.
final class SensesBlockDraft extends BlockDraft {
  SensesBlockDraft([WordCell? word])
    : term = TextEditingController(text: word?.term),
      ask = word?.ask ?? WordAsk.term,
      senses = word == null || word.senses.isEmpty
          ? [SenseDraft()]
          : [for (final sense in word.senses) SenseDraft(sense)],
      super(id: word?.id);

  final TextEditingController term;
  final List<SenseDraft> senses;

  /// The 단어 field's focus.
  final termFocus = FocusNode();

  /// Which part shows before the reveal.
  WordAsk ask;

  @override
  BlockType get type => BlockType.senses;

  @override
  FocusNode get entry => termFocus;

  @override
  FocusNode? get problem =>
      senses.where((sense) => sense.isBlank).firstOrNull?.meaningFocus;

  @override
  Cell get cell => WordCell(
    term: term.text.trim(),
    senses: [for (final sense in senses) sense.sense],
    ask: ask,
    id: id,
  );

  @override
  bool get isComplete => !senses.any((sense) => sense.isBlank);

  @override
  void dispose() {
    term.dispose();
    termFocus.dispose();
    for (final sense in senses) {
      sense.dispose();
    }
    super.dispose();
  }
}

/// A 표: its headers, cells and blanks.
final class TableBlockDraft extends BlockDraft {
  TableBlockDraft([TableContent? table, String? id])
    : table = table == null ? TableDraft() : TableDraft.of(table),
      super(id: id);

  final TableDraft table;

  @override
  BlockType get type => BlockType.table;

  @override
  FocusNode get entry => table.focusOf(table.columns.first);

  @override
  FocusNode? get problem => table.problemFocus;

  @override
  Cell get cell => BlankCell(table.table, id: id);

  @override
  bool get isComplete => table.problem == null;

  @override
  void dispose() {
    table.dispose();
    super.dispose();
  }
}

/// A 빈칸 문장: its line and blanks, kept as stored until either is edited, so
/// a blank inside a word survives an unchanged save.
final class ClozeBlockDraft extends BlockDraft {
  ClozeBlockDraft([ClozeContent? stored, String? id])
    : _stored = stored,
      cloze = stored == null ? ClozeDraft() : ClozeDraft.of(stored),
      super(id: id) {
    line = ClozeLineController(
      text: cloze.line,
      blanks: () => cloze.line == line.text ? cloze.blanks : const [],
    )..addListener(_sync);
  }

  final ClozeContent? _stored;
  final ClozeDraft cloze;
  late final ClozeLineController line;

  /// The line's focus, which shows the cloze's action above the keyboard.
  final focus = FocusNode();

  /// Whether the line or its blanks were changed since the block opened.
  bool edited = false;

  @override
  BlockType get type => BlockType.cloze;

  @override
  FocusNode get entry => focus;

  @override
  FocusNode get problem => focus;

  /// Keeps the blanks on the line as it is typed, and ends the blank "빈칸
  /// 넣기" opened once the cursor leaves it.
  void _sync() => cloze
    ..update(line.text)
    ..track(line.selection);

  @override
  Cell get cell => BlankCell(switch (_stored) {
    final stored? when !edited => stored,
    _ => cloze.content ?? cloze.preview,
  }, id: id);

  @override
  Cell get preview =>
      edited || _stored == null ? BlankCell(cloze.preview, id: id) : cell;

  @override
  bool get isComplete => (!edited && _stored != null) || cloze.content != null;

  @override
  void dispose() {
    line
      ..removeListener(_sync)
      ..dispose();
    focus.dispose();
    super.dispose();
  }
}

/// A 사진: its photo, once chosen, the boxes over it (ADR 0109), and the side
/// it sits on while it holds none.
final class ImageBlockDraft extends BlockDraft {
  ImageBlockDraft([ImageContent? image, this.side = CellSide.front, String? id])
    : image = ImageDraft(image),
      super(id: id);

  final ImageDraft image;
  CellSide side;

  @override
  BlockType get type => BlockType.image;

  /// Null while no photo is chosen, which [isComplete] refuses to save.
  @override
  Cell? get cell => switch (image.image) {
    null => null,
    final photo when photo.boxes.isNotEmpty => BlankCell(photo, id: id),
    final photo => PlacedCell(photo, side, id: id),
  };

  @override
  bool get isComplete => image.image != null;

  @override
  void dispose() {
    image.dispose();
    super.dispose();
  }
}

/// A 소리: its sound, once recorded or picked (ADR 0112), and its side.
final class AudioBlockDraft extends BlockDraft {
  AudioBlockDraft([AudioContent? audio, this.side = CellSide.front, String? id])
    : audio = AudioDraft(audio),
      super(id: id);

  final AudioDraft audio;
  CellSide side;

  @override
  BlockType get type => BlockType.audio;

  /// Null while no sound is in it, which [isComplete] refuses to save.
  @override
  Cell? get cell => switch (audio.audio) {
    final sound? => PlacedCell(sound, side, id: id),
    null => null,
  };

  @override
  bool get isComplete => audio.audio != null;
}

/// A block this build cannot read, kept and written back as it was stored.
final class KeptBlockDraft extends BlockDraft {
  KeptBlockDraft(this.block);

  final UnsupportedContent block;

  @override
  Cell get cell => UnknownCell(block);

  @override
  BlockType? get type => null;

  @override
  bool get isComplete => true;
}

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

/// The add sheet's one grouped list of block types, each row its icon, its
/// name and one line under it; a tap picks it.
class _TypeList extends StatelessWidget {
  const _TypeList();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final colors = AppColors.of(context);
    return Material(
      color: colors.ground,
      borderRadius: BorderRadius.circular(AppRadius.group),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (index, type) in BlockType.values.indexed) ...[
            if (index > 0) const Divider(height: 1, thickness: 1),
            MergeSemantics(
              child: InkWell(
                onTap: () => Navigator.of(context).pop(type),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minHeight: AppSize.tapTarget,
                  ),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpace.s16,
                      vertical: AppSpace.s12,
                    ),
                    child: Row(
                      spacing: AppSpace.s16,
                      children: [
                        Icon(type.icon, color: colors.ink2),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(type.title(l10n), style: AppType.bodyStrong),
                              Text(
                                keepWords(type.description(l10n)),
                                semanticsLabel: type.description(l10n),
                                style: AppType.caption.copyWith(
                                  color: colors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
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
    required this.onAction,
    required this.canMoveUp,
    required this.canMoveDown,
  });

  final BlockDraft block;
  final ValueChanged<MediaId> onMediaStored;
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
          onChanged: _edited,
        ),
        _NamedField(
          name: l10n.cardBack,
          controller: block.back,
          multiline: true,
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
        _ClozeFields(draft: block, showErrors: showErrors, onChanged: _edited),
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
  });

  final String name;
  final TextEditingController controller;
  final FocusNode? focusNode;
  final bool multiline;
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
          child: Semantics(
            label: name,
            child: AppTextField(
              controller: controller,
              focusNode: focusNode,
              maxLines: multiline ? null : 1,
              textInputAction: onNext == null ? null : TextInputAction.next,
              onSubmitted: onNext == null ? null : (_) => onNext?.call(),
              onChanged: (_) => onChanged(),
            ),
          ),
        ),
      ],
    ),
  );
}

/// A row of a group offering a choice of chips, after its [name] when it has
/// one.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({this.name, required this.choices});

  final String? name;
  final List<({String label, bool selected, VoidCallback onPressed})> choices;

  @override
  Widget build(BuildContext context) {
    final name = this.name;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: AppSpace.s20),
      child: Row(
        spacing: AppSpace.s8,
        children: [
          if (name != null)
            Expanded(
              child: Text(
                name,
                style: AppType.body.copyWith(
                  color: AppColors.of(context).muted,
                ),
              ),
            ),
          for (final choice in choices)
            AppChip.action(
              label: choice.label,
              selected: choice.selected,
              onPressed: choice.onPressed,
            ),
        ],
      ),
    );
  }
}

/// A 빈칸 문장's line, borderless in its group, and right under it, while the
/// line has focus, its one action as a small outlined chip that follows the
/// caret, "빈칸 넣기" or "빈칸 풀기" (ADR 0101, ADR 0117); then what keeps it
/// from being saved, with [showErrors].
class _ClozeFields extends StatelessWidget {
  const _ClozeFields({
    required this.draft,
    required this.showErrors,
    required this.onChanged,
  });

  final ClozeBlockDraft draft;
  final bool showErrors;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final draft = this.draft;
    return Padding(
      padding: const EdgeInsets.fromLTRB(groupInset, 0, groupInset, groupInset),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ClozeEmptyBlanks(
            controller: draft.line,
            child: AppTextField(
              controller: draft.line,
              focusNode: draft.focus,
              hint: l10n.blockClozeDescription,
              minLines: 2,
              maxLines: null,
              onChanged: (_) {
                draft.edited = true;
                onChanged();
              },
            ),
          ),
          if (draft.focus.hasFocus)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.s12),
              child: ListenableBuilder(
                listenable: draft.line,
                builder: (context, _) => ClozeAction(
                  draft: draft.cloze,
                  blank: draft.cloze.blankAt(draft.line.selection),
                  onInsert: () {
                    draft.cloze.insert(draft.line.selection);
                    draft.edited = true;
                    onChanged();
                  },
                  onUndo: (blank) {
                    draft.cloze.remove(blank);
                    draft.edited = true;
                    onChanged();
                  },
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.s16),
            child: ClozeProblemText(
              draft: draft.cloze,
              showError: showErrors && !draft.isComplete,
            ),
          ),
        ],
      ),
    );
  }
}
