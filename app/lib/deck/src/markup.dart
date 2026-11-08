/// A card text read by the engine's one parser: a Markdown subset and
/// Anki's cloze syntax (`engine.md` §Card text markup). The types mirror the
/// engine's document, which `engine/tests/fixtures/markup/` pins; the parser
/// is the bridge's, which `study` owns, so this domain reads it through
/// [MarkupEngine], installed at the composition site.
library;

/// A block of a parsed text: a paragraph or a list.
sealed class MarkupBlock {
  const MarkupBlock();
}

/// Lines of text up to a blank line or a list.
final class ParagraphBlock extends MarkupBlock {
  const ParagraphBlock(this.content);

  final List<MarkupInline> content;
}

/// A run of list items of one kind.
final class ListBlock extends MarkupBlock {
  const ListBlock({required this.ordered, required this.items});

  /// Numbered, counted from 1, rather than bulleted.
  final bool ordered;
  final List<MarkupItem> items;
}

/// An item of a list, with the lists nested under it.
final class MarkupItem {
  const MarkupItem(this.content, this.sublists);

  final List<MarkupInline> content;
  final List<MarkupSubList> sublists;
}

/// A list one level down.
final class MarkupSubList {
  const MarkupSubList({required this.ordered, required this.items});

  final bool ordered;
  final List<List<MarkupInline>> items;
}

/// Text inside a block.
sealed class MarkupInline {
  const MarkupInline();
}

final class TextRun extends MarkupInline {
  const TextRun(this.text);

  final String text;
}

/// A newline inside a paragraph.
final class LineBreakRun extends MarkupInline {
  const LineBreakRun();
}

final class BoldRun extends MarkupInline {
  const BoldRun(this.content);

  final List<MarkupInline> content;
}

final class ItalicRun extends MarkupInline {
  const ItalicRun(this.content);

  final List<MarkupInline> content;
}

final class CodeRun extends MarkupInline {
  const CodeRun(this.text);

  final String text;
}

/// `{{cN::answer}}` or `{{cN::answer::hint}}`.
final class ClozeRun extends MarkupInline {
  const ClozeRun({required this.number, required this.answer, this.hint});

  final int number;
  final List<MarkupInline> answer;
  final String? hint;
}

/// A cloze the engine hid.
final class BlankRun extends MarkupInline {
  const BlankRun({this.hint});

  final String? hint;
}

/// What the app asks of the engine's parser. `study` implements it over the
/// bridge, and the composition site installs it with [installMarkupEngine].
abstract interface class MarkupEngine {
  /// [text] as blocks. Total: no text is refused.
  List<MarkupBlock> parse(String text);

  /// The cloze numbers [text] holds, ascending, each once.
  List<int> clozeNumbers(String text);

  /// [text] with marks removed and every cloze filled: what a card key is
  /// made of.
  String plainText(String text);

  /// A version 1 cloze's [text] and [answers] as `{{ck::answer_k}}`, or null
  /// where it would not read back as the same text.
  String? clozeFromV1(String text, List<String> answers);
}

MarkupEngine? _engine;

/// Installs the parser every markup text is read with.
void installMarkupEngine(MarkupEngine engine) => _engine = engine;

/// The installed parser. Reading a markup text before one is installed is a
/// programming error, as the composition site installs it before the first
/// frame.
MarkupEngine get markupEngine =>
    _engine ??
    (throw StateError(
      'no MarkupEngine is installed: call installMarkupEngine',
    ));

/// Whether [blocks] hold anything a plain text would not show: a mark, a
/// list, a line break or a cloze.
bool hasFormatting(List<MarkupBlock> blocks) {
  bool inline(List<MarkupInline> content) =>
      content.any((run) => run is! TextRun);
  return blocks.length > 1 ||
      blocks.any(
        (block) => switch (block) {
          ParagraphBlock(:final content) => inline(content),
          ListBlock() => true,
        },
      );
}
