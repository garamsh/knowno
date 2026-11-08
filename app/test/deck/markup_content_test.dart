import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';

void main() {
  group('a 글 of the frame', () {
    test('is stored at version 3 when it is markup, and at 2 when it is not', () {
      String versionOf(TextCell cell) =>
          '${(jsonDecode(encodeCells([cell], newId: () => 'id')) as List<Object?>).cast<Map<String, Object?>>().single['v']}';
      expect(versionOf(const TextCell(front: 'a', markup: true)), '3');
      expect(versionOf(const TextCell(front: 'a')), '2');
    });

    test('reads back with the version it was stored at', () {
      for (final markup in [true, false]) {
        final cell = TextCell(
          front: '**a**',
          back: 'b',
          markup: markup,
          id: 'x',
        );
        final read = decodeCells(encodeCells([cell], newId: () => 'id'));
        expect(read, [cell]);
        expect((read.single as TextCell).markup, markup);
      }
    });

    test('is refused at version 3 with nothing in it, as at version 2', () {
      for (final version in [2, 3]) {
        expect(
          () => decodeCells(
            jsonEncode([
              {
                'type': 'text',
                'v': version,
                'payload': {'front': ' ', 'back': ''},
              },
            ]),
          ),
          throwsFormatException,
          reason: 'v$version',
        );
      }
    });

    test('gives its sides to every screen as markup text or as written', () {
      final sides = sidesOf(const [
        TextCell(front: '**a**', back: 'b', markup: true),
        TextCell(front: '**c**'),
      ]);
      expect(sides.front, const [
        TextContent('**a**', markup: true),
        TextContent('**c**'),
      ]);
      expect(sides.back, const [TextContent('b', markup: true)]);
    });

    test('has the key of its plain text, the marks of version 3 left out', () {
      expect(
        frameKey(const [TextCell(front: '**Apple** pie', markup: true)]),
        CardKey.fromFront('apple pie'),
      );
      expect(
        frameKey(const [TextCell(front: '**Apple** pie')]),
        CardKey.fromFront('**apple** pie'),
        reason: 'control: a version 2 text is as written',
      );
      expect(
        frameKey(const [BlankCell(ClozeContent.markup('A {{c1::pie}} ok'))]),
        CardKey.fromFront('A pie ok'),
        reason: 'a cloze is its text filled in',
      );
    });
  });

  group('a cloze block', () {
    test('of version 2 is Anki text, read and written at v2', () {
      const stored =
          '[{"type":"cloze","v":2,"id":"b","payload":{"text":"A {{c1::b::h}} {{c2::c}}"}}]';
      final read = decodeContent(stored);
      expect(
        read.single,
        const ClozeContent.markup('A {{c1::b::h}} {{c2::c}}'),
      );
      expect((read.single as ClozeContent).numbers, [1, 2]);
      expect((read.single as ClozeContent).filled, 'A b c');
      expect(encodeContent(read), stored);
    });

    test('of version 1 is read and written as before', () {
      const stored =
          '[{"type":"cloze","v":1,"payload":{"text":"A ___","answers":["b"]}}]';
      expect(decodeContent(stored).single, const ClozeContent('A ___', ['b']));
      expect(encodeContent(decodeContent(stored)), stored);
      expect(
        const ClozeContent.markup('{{c1::a}}') ==
            const ClozeContent('{{c1::a}}', []),
        isFalse,
        reason: 'the two versions are not the same block',
      );
    });

    test(
      'of version 2 that holds no cloze is kept as it was stored, unread',
      () {
        for (final payload in [
          '{"text":"A ___","answers":["b"]}',
          '{"text":"no cloze"}',
          '{"text":"{{c1::}}"}',
          '{"text":7}',
        ]) {
          final stored = '[{"type":"cloze","v":2,"payload":$payload}]';
          final read = decodeContent(stored);
          expect(read.single, isA<UnsupportedContent>(), reason: payload);
          expect(encodeContent(read), stored, reason: payload);
        }
      },
    );
  });

  test('a markup text is not written outside the frame', () {
    expect(
      () => encodeContent(const [TextContent('a', markup: true)]),
      throwsStateError,
    );
    expect(encodeContent(const [TextContent('a')]), contains('"v":1'));
  });
}
