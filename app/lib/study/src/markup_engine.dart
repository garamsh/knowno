import '../../deck/deck.dart' as deck;
import 'rust/api/markup.dart' as bridge;

/// The card text parser of `deck`'s [deck.MarkupEngine], over the bridge to
/// the engine's one parser (ADR 0202). The composition site installs it,
/// after the engine library is loaded.
final class BridgeMarkupEngine implements deck.MarkupEngine {
  const BridgeMarkupEngine();

  @override
  List<deck.MarkupBlock> parse(String text) =>
      _blocks(bridge.parseMarkup(text: text));

  @override
  List<int> clozeNumbers(String text) =>
      bridge.clozeNumbers(text: text).toList();

  @override
  String plainText(String text) => bridge.plainText(text: text);

  @override
  String escapeLiteral(String text) => bridge.escapeLiteral(text: text);

  @override
  String? clozeFromV1(String text, List<String> answers) =>
      bridge.clozeFromV1(text: text, answers: answers);
}

List<deck.MarkupBlock> _blocks(List<bridge.MarkupBlock> blocks) => [
  for (final block in blocks)
    switch (block) {
      bridge.MarkupBlock_Paragraph(:final content) => deck.ParagraphBlock(
        _inlines(content),
      ),
      bridge.MarkupBlock_List(:final ordered, :final items) => deck.ListBlock(
        ordered: ordered,
        items: [
          for (final item in items)
            deck.MarkupItem(_inlines(item.content), [
              for (final sub in item.sublists)
                deck.MarkupSubList(
                  ordered: sub.ordered,
                  items: [for (final line in sub.items) _inlines(line)],
                ),
            ]),
        ],
      ),
    },
];

List<deck.MarkupInline> _inlines(List<bridge.MarkupInline> content) => [
  for (final run in content)
    switch (run) {
      bridge.MarkupInline_Text(:final text) => deck.TextRun(text),
      bridge.MarkupInline_LineBreak() => const deck.LineBreakRun(),
      bridge.MarkupInline_Bold(:final content) => deck.BoldRun(
        _inlines(content),
      ),
      bridge.MarkupInline_Italic(:final content) => deck.ItalicRun(
        _inlines(content),
      ),
      bridge.MarkupInline_Code(:final text) => deck.CodeRun(text),
      bridge.MarkupInline_Cloze(:final number, :final answer, :final hint) =>
        deck.ClozeRun(number: number, answer: _inlines(answer), hint: hint),
      bridge.MarkupInline_Blank(:final hint) => deck.BlankRun(hint: hint),
    },
];
