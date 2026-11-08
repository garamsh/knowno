/// A part of a pasted Markdown text, as the editor turns it into 칸.
sealed class PastePart {
  const PastePart();
}

/// Text for a 글: everything that is not a table or a photo.
final class PasteText extends PastePart {
  const PasteText(this.text);

  final String text;
}

/// A table for a 표: its column headers and its rows, each as many cells as
/// there are columns.
final class PasteTable extends PastePart {
  const PasteTable(this.columns, this.rows);

  final List<String> columns;
  final List<List<String>> rows;
}

/// A photo for a 사진: the https address of its image.
final class PasteImage extends PastePart {
  const PasteImage(this.url);

  final Uri url;
}

final _delimiter = RegExp(r'^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$');
final _image = RegExp(
  r'^\s*!\[[^\]]*\]\(\s*(https://[^\s)]+)(?:\s+"[^"]*")?\s*\)\s*$',
);

/// [text] as the parts the editor makes 칸 of, in order: a table (a row of
/// cells with `|`, then a delimiter row of dashes, then rows of cells) a 표,
/// a line that is an image with an https address a 사진, and the rest, kept
/// as written, 글. A text with neither is one [PasteText].
List<PastePart> splitPaste(String text) {
  final lines = text.replaceAll('\r\n', '\n').split('\n');
  final parts = <PastePart>[];
  final rest = <String>[];
  void flush() {
    final joined = rest.join('\n').trim();
    if (joined.isNotEmpty) parts.add(PasteText(joined));
    rest.clear();
  }

  List<String> cells(String line) {
    var row = line.trim();
    if (row.startsWith('|')) row = row.substring(1);
    if (row.endsWith('|')) row = row.substring(0, row.length - 1);
    return [for (final cell in row.split('|')) cell.trim()];
  }

  var at = 0;
  while (at < lines.length) {
    final line = lines[at];
    final image = _image.firstMatch(line);
    if (image != null) {
      flush();
      parts.add(PasteImage(Uri.parse(image.group(1)!)));
      at++;
      continue;
    }
    final isTable =
        line.contains('|') &&
        at + 1 < lines.length &&
        lines[at + 1].contains('-') &&
        _delimiter.hasMatch(lines[at + 1]) &&
        cells(line).length == cells(lines[at + 1]).length;
    if (isTable) {
      final columns = cells(line);
      final rows = <List<String>>[];
      var next = at + 2;
      while (next < lines.length && lines[next].contains('|')) {
        final row = cells(lines[next]);
        rows.add([
          for (var i = 0; i < columns.length; i++) i < row.length ? row[i] : '',
        ]);
        next++;
      }
      // A table of headers alone has no 표 to make: it stays text.
      if (rows.isNotEmpty) {
        flush();
        parts.add(PasteTable(columns, rows));
        at = next;
        continue;
      }
    }
    rest.add(line);
    at++;
  }
  flush();
  return parts;
}
