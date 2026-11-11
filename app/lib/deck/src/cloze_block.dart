import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// A run of a line's characters: where it starts and where it ends.
typedef Span = ({int start, int end});

/// A line and its blanks, each a span of the line's characters, as a table
/// cell's text is edited (ADR 0092, ADR 0101).
class ClozeDraft {
  ClozeDraft._(this._line, this._blanks);

  /// An empty line with no blank.
  ClozeDraft() : this._('', []);

  String _line;

  /// The blanks in the order of the line, none overlapping another.
  final List<Span> _blanks;

  /// The blank "빈칸 넣기" opened at the cursor, which grows with what is
  /// typed at its end until the cursor leaves it.
  Span? _open;

  /// The blanks in the order of the line.
  List<Span> get blanks => List.unmodifiable(_blanks);

  /// The line the blanks are spans of.
  String get line => _line;

  /// The text of [span] in the line.
  String textOf(Span span) => _line.substring(span.start, span.end);

  /// Takes [line] as the line. A blank stays where the edit leaves it whole:
  /// the text before and after the changed part is unchanged, so a blank
  /// there is the same text, moved. Text typed at the end of the open blank
  /// becomes part of it.
  void update(String line) {
    if (line == _line) return;
    final shorter = line.length < _line.length ? line.length : _line.length;
    var before = 0;
    while (before < shorter && line[before] == _line[before]) {
      before++;
    }
    var after = 0;
    while (after < shorter - before &&
        line[line.length - 1 - after] == _line[_line.length - 1 - after]) {
      after++;
    }
    final shift = line.length - _line.length;
    final open = _open;
    // Typed into the open blank: an insertion at its end, nothing removed.
    final grows =
        open != null &&
        shift > 0 &&
        before + after == _line.length &&
        before == open.end;
    final kept = [
      for (final blank in _blanks)
        if (grows && blank == open)
          (start: blank.start, end: blank.end + shift)
        else if (blank.end <= before && !(blank.end == before && grows))
          blank
        else if (blank.start >= _line.length - after)
          (start: blank.start + shift, end: blank.end + shift),
    ];
    _open = grows ? (start: open.start, end: open.end + shift) : null;
    _blanks
      ..clear()
      ..addAll(kept);
    _line = line;
  }

  /// Makes [selection] a blank: exactly its characters when it holds any,
  /// replacing the blanks it overlaps; otherwise an empty blank at the
  /// cursor, open to what is typed next. A cursor in a blank adds none.
  void insert(TextSelection selection) {
    final start = selection.isValid ? selection.start : _line.length;
    final end = selection.isValid ? selection.end : _line.length;
    if (start < end) {
      _blanks.removeWhere((blank) => blank.start < end && start < blank.end);
      _place((start: start, end: end));
      _open = null;
      return;
    }
    if (_blanks.any((blank) => _holdsCaret(blank, start))) return;
    _closeOpen();
    final blank = (start: start, end: start);
    _place(blank);
    _open = blank;
  }

  /// Ends the open blank once [selection] leaves it, dropping it when nothing
  /// was typed into it.
  void track(TextSelection selection) {
    final open = _open;
    if (open == null) return;
    if (selection.isCollapsed && _holdsCaret(open, selection.start)) return;
    _closeOpen();
  }

  void _closeOpen() {
    final open = _open;
    if (open == null) return;
    if (open.start == open.end) _blanks.remove(open);
    _open = null;
  }

  /// The blank [selection] is in, which "빈칸 풀기" acts on: the blank that
  /// holds the whole selection, the open blank while the caret is in it, or
  /// one the caret is in, at either end included; null elsewhere.
  Span? blankAt(TextSelection selection) {
    if (!selection.isValid) return null;
    final (start, end) = (selection.start, selection.end);
    final open = _open;
    if (selection.isCollapsed && open != null && _holdsCaret(open, start)) {
      return open;
    }
    for (final blank in _blanks) {
      final inside = selection.isCollapsed
          ? _holdsCaret(blank, start)
          : blank.start <= start && end <= blank.end;
      if (inside) return blank;
    }
    return null;
  }

  /// Whether a caret at [offset] is in [blank]: between its ends or at
  /// either, so a tap on a blank of one character, which leaves the caret
  /// on one side of it, reaches it.
  static bool _holdsCaret(Span blank, int offset) =>
      blank.start <= offset && offset <= blank.end;

  /// Turns [blank] back into text.
  void remove(Span blank) {
    _blanks.remove(blank);
    if (blank == _open) _open = null;
  }

  void _place(Span blank) {
    _blanks
      ..add(blank)
      ..sort((a, b) => a.start.compareTo(b.start));
  }
}

/// The line's controller, which draws each blank of [blanks] as a block in
/// the line: its text on `brandTint`, in ink.
class ClozeLineController extends TextEditingController {
  ClozeLineController({super.text, required this.blanks});

  /// The blanks to draw, each within the text, or none while the line is
  /// not a cloze's.
  final List<Span> Function() blanks;

  @override
  TextSpan buildTextSpan({
    required BuildContext context,
    TextStyle? style,
    required bool withComposing,
  }) {
    final blanks = this.blanks();
    if (blanks.isEmpty) {
      return super.buildTextSpan(
        context: context,
        style: style,
        withComposing: withComposing,
      );
    }
    final colors = AppColors.of(context);
    final block = TextStyle(
      backgroundColor: colors.brandTint,
      color: colors.ink,
      fontWeight: FontWeight.w600,
    );
    final children = <TextSpan>[];
    var at = 0;
    for (final blank in blanks) {
      final before = text.substring(at, blank.start);
      if (blank.start == blank.end && before.isNotEmpty) {
        // The character before an empty blank is spaced out by the gap the
        // blank is drawn in, so no character is added to the line.
        final last = before.length > 1 && _trails(before) ? 2 : 1;
        final split = before.length - last;
        children
          ..add(TextSpan(text: before.substring(0, split)))
          ..add(
            TextSpan(
              text: before.substring(split),
              style: const TextStyle(letterSpacing: emptyBlankWidth),
            ),
          );
      } else {
        children.add(TextSpan(text: before));
      }
      children.add(
        TextSpan(text: text.substring(blank.start, blank.end), style: block),
      );
      at = blank.end;
    }
    children.add(TextSpan(text: text.substring(at)));
    return TextSpan(style: style, children: children);
  }

  /// Whether [text] ends in the second half of a surrogate pair.
  static bool _trails(String text) =>
      text.codeUnitAt(text.length - 1) & 0xFC00 == 0xDC00;
}

/// How wide an empty blank is drawn in the line: its gap. At the line's
/// start, where no character makes room, the gap is the field's own inset.
const emptyBlankWidth = AppSpace.s12;
