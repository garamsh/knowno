import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/src/markdown_paste.dart';
import 'package:knowno/deck/src/markup_editing.dart';

TextEditingValue _at(String text, int start, [int? end]) => TextEditingValue(
  text: text,
  selection: TextSelection(baseOffset: start, extentOffset: end ?? start),
);

void main() {
  group('the next free cloze number', () {
    test('is the smallest the text does not hold, read by the engine', () {
      expect(nextClozeNumber('no cloze'), 1);
      expect(nextClozeNumber('{{c1::a}} {{c2::b}}'), 3);
      expect(nextClozeNumber('{{c2::b}}'), 1, reason: 'a gap is free');
      expect(nextClozeNumber('{{c1::a}} {{c3::c}}'), 2);
      // Control: text that only looks like a cloze holds none.
      expect(nextClozeNumber('{{c1::}} and \\{{c1::a}}'), 1);
    });
  });

  group('hiding a selection', () {
    test('wraps it in the next free number, keeping it selected', () {
      final hidden = hideSelection(_at('The cat sat', 4, 7));
      expect(hidden.text, 'The {{c1::cat}} sat');
      expect(hidden.selection.textInside(hidden.text), 'cat');
      final again = hideSelection(_at(hidden.text, hidden.text.length - 3));
      expect(again.text, 'The {{c1::cat}} {{c2::}}sat', reason: 'a cursor');
      expect(again.selection.baseOffset, 22);
      final second = hideSelection(_at(hidden.text, 16, 19));
      expect(second.text, 'The {{c1::cat}} {{c2::sat}}');
    });

    test(
      'puts an empty cloze at the cursor, which is not one until typed in',
      () {
        final value = hideSelection(_at('abc', 1));
        expect(value.text, 'a{{c1::}}bc');
        expect(value.selection, const TextSelection.collapsed(offset: 7));
        expect(
          nextClozeNumber(value.text),
          1,
          reason: 'an empty answer is none',
        );
      },
    );
  });

  group('the cloze a cursor is in', () {
    const text = 'a {{c1::bc::hint}} d {{c2::e}}';

    test('is found with its answer, by a cursor or a selection inside it', () {
      final inside = clozeAt(text, const TextSelection.collapsed(offset: 9));
      expect(inside, (start: 2, end: 18, answer: 'bc'));
      expect(
        clozeAt(text, const TextSelection(baseOffset: 9, extentOffset: 11)),
        inside,
      );
      expect(
        clozeAt(text, const TextSelection.collapsed(offset: 25))?.answer,
        'e',
      );
    });

    test('is none outside any, or where a selection leaves it', () {
      expect(clozeAt(text, const TextSelection.collapsed(offset: 0)), isNull);
      expect(clozeAt(text, const TextSelection.collapsed(offset: 19)), isNull);
      expect(
        clozeAt(text, const TextSelection(baseOffset: 5, extentOffset: 22)),
        isNull,
      );
      // Delimiters that are not a cloze are none.
      expect(
        clozeAt('{{c1::}}', const TextSelection.collapsed(offset: 4)),
        isNull,
      );
    });

    test('turns back into its answer, the cursor after it', () {
      final at = clozeAt(text, const TextSelection.collapsed(offset: 9))!;
      final value = removeCloze(_at(text, 9), at);
      expect(value.text, 'a bc d {{c2::e}}');
      expect(value.selection, const TextSelection.collapsed(offset: 4));
    });
  });

  group('a list goes on as a line is broken', () {
    TextEditingValue typeNewline(String before) {
      final old = _at(before, before.length);
      final text = '$before\n';
      return const ListContinuation().formatEditUpdate(
        old,
        _at(text, text.length),
      );
    }

    test('a bulleted item starts the next', () {
      final value = typeNewline('- one');
      expect(value.text, '- one\n- ');
      expect(value.selection, const TextSelection.collapsed(offset: 8));
    });

    test('a numbered item starts the next number, and keeps its indent', () {
      expect(typeNewline('1. one').text, '1. one\n2. ');
      expect(typeNewline('  - sub').text, '  - sub\n  - ');
      expect(typeNewline('9. nine').text, '9. nine\n10. ');
    });

    test('an empty item ends the list', () {
      final value = typeNewline('- one\n- ');
      expect(value.text, '- one\n\n');
      expect(value.selection, const TextSelection.collapsed(offset: 7));
    });

    test('a line that is no item, and a paste, are left as typed', () {
      expect(typeNewline('plain').text, 'plain\n');
      expect(typeNewline('-no space').text, '-no space\n');
      final pasted = const ListContinuation().formatEditUpdate(
        _at('- a', 3),
        _at('- a\n- b\n- c', 11),
      );
      expect(pasted.text, '- a\n- b\n- c');
    });
  });

  group('a pasted Markdown text', () {
    test('without a table or a photo is one text', () {
      expect(splitPaste('hello'), hasLength(1));
      final parts = splitPaste('a **b**\n\n- c\n- d');
      expect(parts, hasLength(1));
      expect((parts.single as PasteText).text, 'a **b**\n\n- c\n- d');
    });

    test('has a table for a 표, its rows as wide as its headers', () {
      final parts = splitPaste(
        'before\n| 나라 | 수도 |\n|---|:--:|\n| 한국 | 서울 |\n| 일본 |\nafter',
      );
      expect(parts, hasLength(3));
      expect((parts[0] as PasteText).text, 'before');
      final table = parts[1] as PasteTable;
      expect(table.columns, ['나라', '수도']);
      expect(table.rows, [
        ['한국', '서울'],
        ['일본', ''],
      ]);
      expect((parts[2] as PasteText).text, 'after');
    });

    test('has an image on its own line, with an https address, for a 사진', () {
      final parts = splitPaste('see\n![a map](https://e.test/m.png)\nand\n');
      expect(parts, hasLength(3));
      expect((parts[1] as PasteImage).url, Uri.parse('https://e.test/m.png'));
      // Controls: another scheme, and an image inside a line, stay text.
      expect(splitPaste('![a](http://e.test/a.png)').single, isA<PasteText>());
      expect(
        splitPaste('x ![a](https://e.test/a.png) y').single,
        isA<PasteText>(),
      );
    });

    test('a table of headers alone stays text', () {
      expect(splitPaste('| a | b |\n|---|---|').single, isA<PasteText>());
    });

    test('is sent to the editor where the field was pasted into', () {
      final sent = <List<PastePart>>[];
      final formatter = PasteToBlocks(sent.add);
      final old = _at('', 0);
      const table = '| a | b |\n|---|---|\n| 1 | 2 |';
      final result = formatter.formatEditUpdate(old, _at(table, table.length));
      expect(result, old, reason: 'nothing goes into the field');
      // Control: typing, and a paste of text alone, go in.
      expect(formatter.formatEditUpdate(old, _at('ab', 2)).text, 'ab');
      expect(
        formatter.formatEditUpdate(old, _at('a\nb\nc', 5)).text,
        'a\nb\nc',
      );
    });
  });
}
