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
/// text. The parser reads every text, so none is refused.
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
    return _Builder(
      colors: colors,
      body: body,
      recognizers: _recognizers,
      onLink: widget.onLink,
    ).blocks(_parse(widget.text), body);
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

  /// [nodes] as spans. Inside a link, [tap] is on each span that holds text,
  /// for a screen reader reads a link from the span that carries its tap.
  InlineSpan _inline(
    List<md.Node> nodes,
    TextStyle style, {
    TapGestureRecognizer? tap,
  }) {
    final link = tap == null
        ? null
        : TextStyle(
            color: colors.primaryEdge,
            decoration: TextDecoration.underline,
          );
    InlineSpan inner(md.Element node) =>
        _inline(node.children ?? const [], style, tap: tap);
    return TextSpan(
      children: [
        for (final node in nodes)
          switch (node) {
            md.Text(:final text) => TextSpan(
              text: keepWords(text),
              style: link,
              recognizer: tap,
            ),
            md.Element(tag: 'br') => const TextSpan(text: '\n'),
            md.Element(tag: 'strong') => TextSpan(
              style: const TextStyle(fontWeight: FontWeight.w700),
              children: [inner(node)],
            ),
            md.Element(tag: 'em') => TextSpan(
              style: const TextStyle(fontStyle: FontStyle.italic),
              children: [inner(node)],
            ),
            md.Element(tag: 'del') => TextSpan(
              style: const TextStyle(decoration: TextDecoration.lineThrough),
              children: [inner(node)],
            ),
            md.Element(tag: 'code') => TextSpan(
              text: _plainInline(node.children ?? const []),
              style: _code.merge(link),
              recognizer: tap,
            ),
            md.Element(tag: 'img') => TextSpan(
              text: keepWords(node.attributes['alt'] ?? ''),
              style: link,
              recognizer: tap,
            ),
            md.Element(tag: 'a') => _link(node, style, tap),
            md.Element() => inner(node),
            _ => const TextSpan(),
          },
      ],
    );
  }

  InlineSpan _link(
    md.Element node,
    TextStyle style,
    TapGestureRecognizer? tap,
  ) {
    final uri = Uri.tryParse(node.attributes['href'] ?? '');
    if (uri == null ||
        !const {'http', 'https', 'mailto'}.contains(uri.scheme)) {
      return _inline(node.children ?? const [], style, tap: tap);
    }
    final own = TapGestureRecognizer()..onTap = () => onLink(uri);
    recognizers.add(own);
    return _inline(node.children ?? const [], style, tap: own);
  }
}

Iterable<md.Element> _elements(md.Element node) =>
    node.children?.whereType<md.Element>() ?? const <md.Element>[];
