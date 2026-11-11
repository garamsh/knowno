import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../l10n/app_localizations.dart';
import 'audio_block.dart';
import 'card_frame.dart';
import 'content.dart';
import 'editor_group.dart';
import 'image_block.dart';
import 'markup.dart';
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

/// A 글: its front and its back as typed, read as the Markdown subset the
/// engine parses (ADR 0202).
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

/// A 빈칸 문장: its text in Anki's syntax, `{{c1::answer}}`, as typed
/// (ADR 0202).
final class ClozeBlockDraft extends BlockDraft {
  ClozeBlockDraft([ClozeContent? stored, String? id])
    : source = TextEditingController(text: stored?.text),
      super(id: id);

  final TextEditingController source;

  /// The text's focus, which shows "가리기" above the keyboard.
  final focus = FocusNode();

  @override
  BlockType get type => BlockType.cloze;

  @override
  FocusNode get entry => focus;

  @override
  FocusNode get problem => focus;

  /// The cloze numbers the text holds now.
  List<int> get numbers => markupEngine.clozeNumbers(source.text);

  @override
  Cell? get cell =>
      isComplete ? BlankCell(ClozeContent(source.text), id: id) : null;

  @override
  Cell get preview => BlankCell(ClozeContent(source.text), id: id);

  @override
  bool get isComplete => numbers.isNotEmpty;

  @override
  void dispose() {
    source.dispose();
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
