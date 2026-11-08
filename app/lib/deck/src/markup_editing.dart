import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../design/theme.dart';
import '../../design/word_break.dart';
import '../../l10n/app_localizations.dart';
import 'markdown_paste.dart';
import 'markup.dart';
import 'markup_span.dart';

/// The smallest cloze number from 1 that [text] does not hold: the next free
/// one, read by the engine.
int nextClozeNumber(String text) {
  final used = markupEngine.clozeNumbers(text).toSet();
  var number = 1;
  while (used.contains(number)) {
    number++;
  }
  return number;
}

/// [value] with its selection made a cloze of the next free number,
/// `{{cN::selection}}`: a cursor with nothing selected becomes
/// `{{cN::}}` with the cursor inside, which reads as a cloze once an answer
/// is typed.
TextEditingValue hideSelection(TextEditingValue value) {
  final selection = value.selection;
  final start = selection.isValid ? selection.start : value.text.length;
  final end = selection.isValid ? selection.end : value.text.length;
  final number = nextClozeNumber(value.text);
  final open = '{{c$number::';
  final chosen = value.text.substring(start, end);
  final text = value.text.replaceRange(start, end, '$open$chosen}}');
  return TextEditingValue(
    text: text,
    selection: chosen.isEmpty
        ? TextSelection.collapsed(offset: start + open.length)
        : TextSelection(
            baseOffset: start + open.length,
            extentOffset: start + open.length + chosen.length,
          ),
  );
}

/// A cloze of a text: the characters it spans, and its answer as written.
typedef ClozeAt = ({int start, int end, String answer});

/// The cloze of [text] the [selection] is in, which "가리기" offers to
/// remove; null where it is in none. The delimiters around the selection
/// are found by scanning, and the engine decides that they hold exactly one
/// cloze.
ClozeAt? clozeAt(String text, TextSelection selection) {
  if (!selection.isValid) return null;
  final open = text.lastIndexOf('{{c', selection.start);
  if (open < 0) return null;
  final close = text.indexOf('}}', open);
  if (close < 0 || selection.end > close + 2) return null;
  final found = text.substring(open, close + 2);
  final blocks = markupEngine.parse(found);
  final single = switch (blocks) {
    [ParagraphBlock(content: [ClozeRun()])] => true,
    _ => false,
  };
  if (!single) return null;
  final inner = found.substring(found.indexOf('::') + 2, found.length - 2);
  return (start: open, end: close + 2, answer: inner.split('::').first);
}

/// [value] with the cloze [at] turned back into its answer, the cursor
/// after it.
TextEditingValue removeCloze(TextEditingValue value, ClozeAt at) =>
    TextEditingValue(
      text: value.text.replaceRange(at.start, at.end, at.answer),
      selection: TextSelection.collapsed(offset: at.start + at.answer.length),
    );

/// Continues a list as a line is broken: a newline typed at the end of an
/// item, `- text` or `1. text`, starts the next item, and one typed in an
/// empty item ends the list. Anything else is left as typed.
final class ListContinuation extends TextInputFormatter {
  const ListContinuation();

  static final _item = RegExp(r'^(\s*)(-|\d+\.) (.*)$');

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final caret = newValue.selection.baseOffset;
    final typedNewline =
        newValue.selection.isCollapsed &&
        caret > 0 &&
        newValue.text.length == oldValue.text.length + 1 &&
        newValue.text[caret - 1] == '\n' &&
        newValue.text.replaceRange(caret - 1, caret, '') == oldValue.text;
    if (!typedNewline) return newValue;
    final before = newValue.text.substring(0, caret - 1);
    final lineStart = before.lastIndexOf('\n') + 1;
    final match = _item.firstMatch(before.substring(lineStart));
    if (match == null) return newValue;
    final after = newValue.text.substring(caret);
    if (match.group(3)!.isEmpty) {
      // An empty item ends the list: its marker goes and the line is empty.
      return TextEditingValue(
        text: '${before.substring(0, lineStart)}\n$after',
        selection: TextSelection.collapsed(offset: lineStart + 1),
      );
    }
    final marker = match.group(2)!;
    final next = marker == '-'
        ? '-'
        : '${int.parse(marker.substring(0, marker.length - 1)) + 1}.';
    final inserted = '\n${match.group(1)}$next ';
    return TextEditingValue(
      text: '$before$inserted$after',
      selection: TextSelection.collapsed(
        offset: before.length + inserted.length,
      ),
    );
  }
}

/// Sends a pasted Markdown text's parts to [onParts] where they hold a table
/// or an image, taking nothing into the field; any other change is left as
/// typed. A paste is an insertion of lines that the field did not hold.
final class PasteToBlocks extends TextInputFormatter {
  const PasteToBlocks(this.onParts);

  final ValueChanged<List<PastePart>>? onParts;

  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) {
    final onParts = this.onParts;
    final grew = newValue.text.length - oldValue.text.length;
    if (onParts == null || grew < 3 || !newValue.selection.isCollapsed) {
      return newValue;
    }
    final end = newValue.selection.baseOffset;
    final start = end - grew;
    if (start < 0 ||
        newValue.text.replaceRange(start, end, '') != oldValue.text) {
      return newValue;
    }
    final parts = splitPaste(newValue.text.substring(start, end));
    if (!parts.any((part) => part is! PasteText)) return newValue;
    // After this edit is done, so the field and the list are not changed
    // under it.
    scheduleMicrotask(() => onParts(parts));
    return oldValue;
  }
}

/// A text's markup as the engine reads it, drawn under its field while it
/// holds a mark, a list or a line break; nothing while it reads as written.
class MarkupPreview extends StatelessWidget {
  const MarkupPreview(this.controller, {super.key, this.cloze});

  final TextEditingController controller;

  /// How a cloze is drawn; its answer filled in where not given.
  final InlineSpan Function(ClozeRun cloze)? cloze;

  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: controller,
    builder: (context, _) {
      final blocks = markupEngine.parse(controller.text);
      if (!hasFormatting(blocks)) return const SizedBox.shrink();
      final l10n = AppLocalizations.of(context);
      return Semantics(
        label: l10n.markupPreview,
        container: true,
        child: Padding(
          padding: const EdgeInsets.only(
            left: AppSpace.s16,
            right: AppSpace.s16,
            bottom: AppSpace.s8,
          ),
          child: Text.rich(
            markupSpan(
              blocks,
              wrap: keepWords,
              cloze: cloze,
              code: TextStyle(
                fontFamily: 'monospace',
                backgroundColor: AppColors.of(context).raised,
              ),
            ),
            style: AppType.body.copyWith(color: AppColors.of(context).ink),
          ),
        ),
      );
    },
  );
}
