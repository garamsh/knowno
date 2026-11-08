import 'package:flutter/widgets.dart';

import 'markup.dart';

String _same(String text) => text;

/// What a cloze is drawn as in [markupSpan]: its answer's runs, filled in.
InlineSpan filledCloze(
  ClozeRun cloze, {
  String Function(String) wrap = _same,
}) => TextSpan(children: _runs(cloze.answer, wrap: wrap, cloze: null));

/// [blocks] as one span, each block on a line after the last (ADR 0208), a list item on a line
/// of its own after its marker, "• " or its number, and a nested item after
/// two spaces more. A bold run is bold, an italic one italic, and a code run
/// in [code]. [cloze] draws each cloze, as its answer filled in where it is
/// not given. [wrap] is applied to each piece of text, such as a line-breaking
/// rule.
InlineSpan markupSpan(
  List<MarkupBlock> blocks, {
  String Function(String text) wrap = _same,
  TextStyle code = const TextStyle(fontFamily: 'monospace'),
  InlineSpan Function(ClozeRun cloze)? cloze,
}) {
  final drawn = cloze ?? (run) => filledCloze(run, wrap: wrap);
  final children = <InlineSpan>[];
  for (final (index, block) in blocks.indexed) {
    if (index > 0) children.add(const TextSpan(text: '\n'));
    switch (block) {
      case ParagraphBlock(:final content):
        children.addAll(_runs(content, wrap: wrap, code: code, cloze: drawn));
      case ListBlock(:final ordered, :final items):
        for (final (at, item) in items.indexed) {
          if (at > 0) children.add(const TextSpan(text: '\n'));
          children
            ..add(TextSpan(text: _marker(ordered, at)))
            ..addAll(_runs(item.content, wrap: wrap, code: code, cloze: drawn));
          for (final sub in item.sublists) {
            for (final (subAt, line) in sub.items.indexed) {
              children
                ..add(
                  TextSpan(
                    text: '\n  ${_marker(sub.ordered, subAt, sub: true)}',
                  ),
                )
                ..addAll(_runs(line, wrap: wrap, code: code, cloze: drawn));
            }
          }
        }
    }
  }
  return TextSpan(children: children);
}

String _marker(bool ordered, int at, {bool sub = false}) =>
    ordered ? '${at + 1}. ' : (sub ? '◦ ' : '• ');

List<InlineSpan> _runs(
  List<MarkupInline> content, {
  required String Function(String) wrap,
  TextStyle code = const TextStyle(fontFamily: 'monospace'),
  required InlineSpan Function(ClozeRun cloze)? cloze,
}) => [
  for (final run in content)
    switch (run) {
      TextRun(:final text) => TextSpan(text: wrap(text)),
      LineBreakRun() => const TextSpan(text: '\n'),
      BoldRun(:final content) => TextSpan(
        style: const TextStyle(fontWeight: FontWeight.w700),
        children: _runs(content, wrap: wrap, code: code, cloze: cloze),
      ),
      ItalicRun(:final content) => TextSpan(
        style: const TextStyle(fontStyle: FontStyle.italic),
        children: _runs(content, wrap: wrap, code: code, cloze: cloze),
      ),
      CodeRun(:final text) => TextSpan(text: text, style: code),
      final ClozeRun cloze_ =>
        cloze == null
            ? TextSpan(
                children: _runs(
                  cloze_.answer,
                  wrap: wrap,
                  code: code,
                  cloze: null,
                ),
              )
            : cloze(cloze_),
      BlankRun() => const TextSpan(text: '___'),
    },
];

/// The answers of the clozes in [blocks], in the order of the text, each as
/// plain text.
List<String> clozeAnswers(List<MarkupBlock> blocks) {
  final answers = <String>[];
  markupSpan(
    blocks,
    cloze: (run) {
      answers.add(answerText(run));
      return const TextSpan();
    },
  );
  return answers;
}

/// A cloze's answer as plain text, its marks left out.
String answerText(ClozeRun cloze) =>
    markupPlain([ParagraphBlock(cloze.answer)]);

/// [blocks] as the plain text that measures them: as [markupSpan] lays them
/// out, each cloze as [cloze] says, its answer filled in where it is not given.
String markupPlain(
  List<MarkupBlock> blocks, {
  String Function(ClozeRun cloze)? cloze,
}) => markupSpan(
  blocks,
  cloze: cloze == null ? null : (run) => TextSpan(text: cloze(run)),
).toPlainText(includeSemanticsLabels: false);
