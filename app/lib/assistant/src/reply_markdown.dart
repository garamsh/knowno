import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;

import '../../design/theme.dart';
import '../../design/word_break.dart';

/// The Markdown 말랑이's reply is read as: CommonMark with GFM's tables,
/// strikethrough, fenced code and bare links. Raw HTML has no syntax here, so
/// it stays text; footnotes and task boxes are not read (ADR 0225).
final _extensions = md.ExtensionSet(
  [const md.FencedCodeBlockSyntax(), const md.TableSyntax()],
  [md.StrikethroughSyntax(), md.AutolinkExtensionSyntax()],
);

List<md.Node> _parse(String text) => md.Document(
  extensionSet: _extensions,
  encodeHtml: false,
).parseLines(text.replaceAll('\r\n', '\n').split('\n'));

/// [text] without its marks, as a screen reader reads it: each block on a
/// line, a table row on a line with its cells apart, an image as its alt text.
String replyPlainText(String text) {
  try {
    return _plainBlocks(_parse(text)).trim();
  } on Object {
    return text;
  }
}

String _plainBlocks(List<md.Node> nodes) {
  final lines = <String>[];
  final run = StringBuffer();
  void flush() {
    if (run.isNotEmpty) lines.add(run.toString());
    run.clear();
  }

  for (final node in nodes) {
    if (node is md.Element && _blockTags.contains(node.tag)) {
      flush();
      lines.add(switch (node.tag) {
        'tr' => [
          for (final cell in node.children ?? const <md.Node>[])
            _plainInline([cell]),
        ].join(' '),
        'ul' ||
        'ol' ||
        'table' ||
        'thead' ||
        'tbody' => _plainBlocks(node.children ?? const []),
        'hr' => '',
        _ => _plainBlocks(node.children ?? const []),
      });
    } else {
      run.write(_plainInline([node]));
    }
  }
  flush();
  return lines.where((line) => line.isNotEmpty).join('\n');
}

String _plainInline(List<md.Node> nodes) => [
  for (final node in nodes)
    switch (node) {
      md.Text(:final text) => text,
      md.Element(tag: 'br') => '\n',
      md.Element(tag: 'img') => node.attributes['alt'] ?? '',
      md.Element(:final children) => _plainInline(children ?? const []),
      _ => '',
    },
].join();

const _blockTags = {
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'thead',
  'tbody',
  'tr',
  'hr',
};

/// 말랑이's reply text drawn from its Markdown with the design tokens. A link
/// is handed to [onLink] and nothing is fetched: an image shows as its alt
/// text. A text that cannot be read is drawn as typed.
class ReplyMarkdown extends StatefulWidget {
  const ReplyMarkdown(this.text, {super.key, required this.onLink});

  final String text;
  final void Function(Uri uri) onLink;

  @override
  State<ReplyMarkdown> createState() => _ReplyMarkdownState();
}

class _ReplyMarkdownState extends State<ReplyMarkdown> {
  final _recognizers = <TapGestureRecognizer>[];

  @override
  void dispose() {
    _disposeRecognizers();
    super.dispose();
  }

  void _disposeRecognizers() {
    for (final one in _recognizers) {
      one.dispose();
    }
    _recognizers.clear();
  }

  @override
  Widget build(BuildContext context) {
    _disposeRecognizers();
    final colors = AppColors.of(context);
    final body = AppType.body.copyWith(color: colors.ink);
    try {
      return _Builder(
        colors: colors,
        body: body,
        recognizers: _recognizers,
        onLink: widget.onLink,
      ).blocks(_parse(widget.text), body);
    } on Object {
      return Text(keepWords(widget.text), style: body);
    }
  }
}

class _Builder {
  _Builder({
    required this.colors,
    required this.body,
    required this.recognizers,
    required this.onLink,
  });

  final AppColors colors;
  final TextStyle body;
  final List<TapGestureRecognizer> recognizers;
  final void Function(Uri uri) onLink;

  late final _code = TextStyle(
    fontFamily: 'monospace',
    backgroundColor: colors.ground,
  );

  Widget blocks(List<md.Node> nodes, TextStyle style) {
    final children = <Widget>[];
    final run = <md.Node>[];
    void flush() {
      if (run.isEmpty) return;
      final span = _inline(List.of(run), style);
      run.clear();
      if (span.toPlainText().trim().isEmpty) return;
      children.add(Text.rich(span, style: style));
    }

    for (final node in nodes) {
      if (node is md.Element && _blockTags.contains(node.tag)) {
        flush();
        children.add(_block(node, style));
      } else {
        run.add(node);
      }
    }
    flush();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      spacing: AppSpace.s8,
      children: children,
    );
  }

  Widget _block(md.Element node, TextStyle style) {
    final children = node.children ?? const <md.Node>[];
    switch (node.tag) {
      case 'p':
        return Text.rich(_inline(children, style), style: style);
      case 'h1' || 'h2' || 'h3' || 'h4' || 'h5' || 'h6':
        final heading =
            (node.tag == 'h1' || node.tag == 'h2'
                    ? AppType.headline
                    : AppType.bodyStrong)
                .copyWith(color: colors.ink);
        return Text.rich(_inline(children, heading), style: heading);
      case 'ul' || 'ol':
        final start = int.tryParse(node.attributes['start'] ?? '') ?? 1;
        var at = start;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          spacing: AppSpace.s4,
          children: [
            for (final item in children.whereType<md.Element>())
              if (item.tag == 'li')
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsetsDirectional.only(
                        end: AppSpace.s8,
                      ),
                      child: Text(
                        node.tag == 'ol' ? '${at++}.' : '•',
                        style: style,
                      ),
                    ),
                    Expanded(child: blocks(item.children ?? const [], style)),
                  ],
                ),
          ],
        );
      case 'blockquote':
        return DecoratedBox(
          decoration: BoxDecoration(
            border: BorderDirectional(
              start: BorderSide(color: colors.outline, width: 3),
            ),
          ),
          child: Padding(
            padding: const EdgeInsetsDirectional.only(start: AppSpace.s12),
            child: blocks(children, style.copyWith(color: colors.ink2)),
          ),
        );
      case 'pre':
        final code = _plainInline(children).replaceFirst(RegExp(r'\n$'), '');
        return DecoratedBox(
          decoration: BoxDecoration(
            color: colors.ground,
            borderRadius: BorderRadius.circular(AppSpace.s8),
          ),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.all(AppSpace.s12),
            child: Text(code, style: style.copyWith(fontFamily: 'monospace')),
          ),
        );
      case 'table':
        return _table(node, style);
      case 'hr':
        return Divider(height: AppSpace.s16, color: colors.hairline);
      default:
        return blocks(children, style);
    }
  }

  Widget _table(md.Element node, TextStyle style) {
    final rows = <TableRow>[];
    for (final section in _elements(node)) {
      final head = section.tag == 'thead';
      for (final row in _elements(section)) {
        rows.add(
          TableRow(
            decoration: head ? BoxDecoration(color: colors.ground) : null,
            children: [
              for (final cell in _elements(row))
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.s8,
                    vertical: AppSpace.s4,
                  ),
                  child: () {
                    final cellStyle = head
                        ? style.copyWith(fontWeight: FontWeight.w700)
                        : style;
                    return Text.rich(
                      _inline(cell.children ?? const [], cellStyle),
                      style: cellStyle,
                      textAlign: switch (cell.attributes['style']) {
                        'text-align: right' => TextAlign.end,
                        'text-align: center' => TextAlign.center,
                        _ => TextAlign.start,
                      },
                    );
                  }(),
                ),
            ],
          ),
        );
      }
    }
    if (rows.isEmpty) return const SizedBox.shrink();
    // A table wider than the bubble scrolls sideways inside it.
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Table(
        defaultColumnWidth: const IntrinsicColumnWidth(),
        border: TableBorder.all(color: colors.hairline),
        children: rows,
      ),
    );
  }

  InlineSpan _inline(List<md.Node> nodes, TextStyle style) => TextSpan(
    children: [
      for (final node in nodes)
        switch (node) {
          md.Text(:final text) => TextSpan(text: keepWords(text)),
          md.Element(tag: 'br') => const TextSpan(text: '\n'),
          md.Element(tag: 'strong') => TextSpan(
            style: const TextStyle(fontWeight: FontWeight.w700),
            children: [_inline(node.children ?? const [], style)],
          ),
          md.Element(tag: 'em') => TextSpan(
            style: const TextStyle(fontStyle: FontStyle.italic),
            children: [_inline(node.children ?? const [], style)],
          ),
          md.Element(tag: 'del') => TextSpan(
            style: const TextStyle(decoration: TextDecoration.lineThrough),
            children: [_inline(node.children ?? const [], style)],
          ),
          md.Element(tag: 'code') => TextSpan(
            text: _plainInline(node.children ?? const []),
            style: _code,
          ),
          md.Element(tag: 'img') => TextSpan(
            text: keepWords(node.attributes['alt'] ?? ''),
          ),
          md.Element(tag: 'a') => _link(node, style),
          md.Element(:final children) => _inline(children ?? const [], style),
          _ => const TextSpan(),
        },
    ],
  );

  InlineSpan _link(md.Element node, TextStyle style) {
    final uri = Uri.tryParse(node.attributes['href'] ?? '');
    final inner = _inline(node.children ?? const [], style);
    if (uri == null ||
        !const {'http', 'https', 'mailto'}.contains(uri.scheme)) {
      return inner;
    }
    final tap = TapGestureRecognizer()..onTap = () => onLink(uri);
    recognizers.add(tap);
    return TextSpan(
      style: TextStyle(
        color: colors.primaryEdge,
        decoration: TextDecoration.underline,
      ),
      recognizer: tap,
      children: [inner],
    );
  }
}

Iterable<md.Element> _elements(md.Element node) =>
    node.children?.whereType<md.Element>() ?? const <md.Element>[];
