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
/// rule. With [joined], each cloze is held to the non-space text directly
/// before and after it on its line, inside bold and italic runs too, by a
/// word joiner (U+2060) on that side, so no line breaks between them.
InlineSpan markupSpan(
  List<MarkupBlock> blocks, {
  String Function(String text) wrap = _same,
  TextStyle code = const TextStyle(fontFamily: 'monospace'),
  InlineSpan Function(ClozeRun cloze)? cloze,
  bool joined = false,
}) {
  final drawn = cloze ?? (run) => filledCloze(run, wrap: wrap);
  List<InlineSpan> runs(List<MarkupInline> content) => _runs(
    content,
    wrap: wrap,
    code: code,
    cloze: drawn,
    joins: joined ? _joins(content) : null,
  );
  final children = <InlineSpan>[];
  for (final (index, block) in blocks.indexed) {
    if (index > 0) children.add(const TextSpan(text: '\n'));
    switch (block) {
      case ParagraphBlock(:final content):
        children.addAll(runs(content));
      case ListBlock(:final ordered, :final items):
        for (final (at, item) in items.indexed) {
          if (at > 0) children.add(const TextSpan(text: '\n'));
          children
            ..add(TextSpan(text: _marker(ordered, at)))
            ..addAll(runs(item.content));
          for (final sub in item.sublists) {
            for (final (subAt, line) in sub.items.indexed) {
              children
                ..add(
                  TextSpan(
                    text: '\n  ${_marker(sub.ordered, subAt, sub: true)}',
                  ),
                )
                ..addAll(runs(line));
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
  Map<ClozeRun, ({bool before, bool after})>? joins,
}) => [
  for (final run in content)
    switch (run) {
      TextRun(:final text) => TextSpan(text: wrap(text)),
      LineBreakRun() => const TextSpan(text: '\n'),
      BoldRun(:final content) => TextSpan(
        style: const TextStyle(fontWeight: FontWeight.w700),
        children: _runs(
          content,
          wrap: wrap,
          code: code,
          cloze: cloze,
          joins: joins,
        ),
      ),
      ItalicRun(:final content) => TextSpan(
        style: const TextStyle(fontStyle: FontStyle.italic),
        children: _runs(
          content,
          wrap: wrap,
          code: code,
          cloze: cloze,
          joins: joins,
        ),
      ),
      CodeRun(:final text) => TextSpan(text: text, style: code),
      final ClozeRun cloze_ => switch ((cloze, joins?[cloze_])) {
        (null, _) => TextSpan(
          children: _runs(cloze_.answer, wrap: wrap, code: code, cloze: null),
        ),
        (final draw?, null) => draw(cloze_),
        (final draw?, final join?) => TextSpan(
          children: [
            if (join.before) const TextSpan(text: _joiner),
            draw(cloze_),
            if (join.after) const TextSpan(text: _joiner),
          ],
        ),
      },
      BlankRun() => const TextSpan(text: '___'),
    },
];

const _joiner = '\u2060';

/// Where each cloze of the line [content] needs a joiner: on a side that
/// touches non-space text, whatever bold or italic run it sits in. Two clozes
/// side by side are joined once, by the first's after.
Map<ClozeRun, ({bool before, bool after})> _joins(List<MarkupInline> content) {
  final leaves = <MarkupInline>[];
  void collect(List<MarkupInline> runs) {
    for (final run in runs) {
      switch (run) {
        case BoldRun(:final content) || ItalicRun(:final content):
          collect(content);
        case TextRun(:final text) || CodeRun(:final text):
          if (text.isNotEmpty) leaves.add(run);
        default:
          leaves.add(run);
      }
    }
  }

  collect(content);
  // Whether [leaf] has non-space text at its start, or at its end.
  bool touches(MarkupInline? leaf, {required bool start}) => switch (leaf) {
    TextRun(:final text) ||
    CodeRun(:final text) => text[start ? 0 : text.length - 1].trim().isNotEmpty,
    ClozeRun() || BlankRun() => true,
    LineBreakRun() || BoldRun() || ItalicRun() || null => false,
  };
  return Map.identity()..addEntries([
    for (final (at, leaf) in leaves.indexed)
      if (leaf case final ClozeRun cloze)
        MapEntry(cloze, (
          before:
              at > 0 &&
              leaves[at - 1] is! ClozeRun &&
              touches(leaves[at - 1], start: false),
          after: at < leaves.length - 1 && touches(leaves[at + 1], start: true),
        )),
  ]);
}

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
/// out, each cloze as [cloze] says, its answer filled in where it is not given,
/// and [joined] as [markupSpan] has it.
String markupPlain(
  List<MarkupBlock> blocks, {
  String Function(ClozeRun cloze)? cloze,
  bool joined = false,
}) => markupSpan(
  blocks,
  joined: joined,
  cloze: cloze == null ? null : (run) => TextSpan(text: cloze(run)),
).toPlainText(includeSemanticsLabels: false);
