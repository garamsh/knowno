import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';

void main() {
  group('a 글 of the frame', () {
    test('is stored at version 3', () {
      final stored = jsonDecode(
        encodeCells([const TextCell(front: 'a')], newId: () => 'id'),
      );
      expect((stored as List<Object?>).cast<Map<String, Object?>>().single, {
        'type': 'text',
        'v': 3,
        'id': 'id',
        'payload': {'front': 'a', 'back': ''},
      });
    });

    test('reads back as it was stored', () {
      const cell = TextCell(front: '**a**', back: 'b', id: 'x');
      expect(decodeCells(encodeCells([cell], newId: () => 'id')), [cell]);
    });

    test('is refused at version 3 with nothing in it', () {
      expect(
        () => decodeCells(
          jsonEncode([
            {
              'type': 'text',
              'v': 3,
              'payload': {'front': ' ', 'back': ''},
            },
          ]),
        ),
        throwsFormatException,
      );
    });

    test('of version 2 is kept as stored, unread, until the server converts '
        'it', () {
      const stored =
          '[{"type":"text","v":2,"id":"x","payload":{"front":"a","back":"b"}}]';
      final read = decodeCells(stored);
      expect(read.single, isA<UnknownCell>());
      expect(encodeCells(read, newId: () => 'id'), stored);
    });

    test('gives its sides to every screen as markup text', () {
      final sides = sidesOf(const [
        TextCell(front: '**a**', back: 'b'),
        TextCell(front: '**c**'),
      ]);
      expect(sides.front, const [
        TextContent('**a**', markup: true),
        TextContent('**c**', markup: true),
      ]);
      expect(sides.back, const [TextContent('b', markup: true)]);
    });

    test('has the key of its plain text, the marks of version 3 left out', () {
      expect(
        frameKey(const [TextCell(front: '**Apple** pie')]),
        CardKey.fromFront('apple pie'),
      );
      expect(
        frameKey(const [BlankCell(ClozeContent('A {{c1::pie}} ok'))]),
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
      expect(read.single, const ClozeContent('A {{c1::b::h}} {{c2::c}}'));
      expect((read.single as ClozeContent).numbers, [1, 2]);
      expect((read.single as ClozeContent).filled, 'A b c');
      expect(encodeContent(read), stored);
    });

    test('of version 1 is kept as stored, unread, until the server converts '
        'it', () {
      const stored =
          '[{"type":"cloze","v":1,"payload":{"text":"A ___","answers":["b"]}}]';
      final read = decodeContent(stored);
      expect(read.single, isA<UnsupportedContent>());
      expect(encodeContent(read), stored);
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
