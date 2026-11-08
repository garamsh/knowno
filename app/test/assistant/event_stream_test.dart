import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/assistant/src/event_stream.dart';

Stream<List<int>> _chunks(List<String> parts) =>
    Stream.fromIterable([for (final part in parts) utf8.encode(part)]);

void main() {
  test('reads events whatever chunks split them', () async {
    final events = await readEvents(
      _chunks([
        'event: te',
        'xt\ndata: {"a":',
        '1}\n\nevent: usage\nda',
        'ta: 2\n\n',
      ]),
    ).toList();
    expect(events, [
      (name: 'text', data: '{"a":1}'),
      (name: 'usage', data: '2'),
    ]);
  });

  test('reads CRLF line ends, one split between chunks', () async {
    final events = await readEvents(
      _chunks(['event: text\r', '\ndata: x\r\n\r', '\n']),
    ).toList();
    expect(events, [(name: 'text', data: 'x')]);
  });

  test(
    'joins data lines, skips comments and names an event with none message',
    () async {
      final events = await readEvents(_chunks([': ping\ndata: a\ndata: b\n\n']))
          .toList();
      expect(events, [(name: 'message', data: 'a\nb')]);
    },
  );

  test('drops an event the stream ended in the middle of', () async {
    final events = await readEvents(
      _chunks(['event: text\ndata: whole\n\nevent: text\ndata: cut']),
    ).toList();
    expect(events, [(name: 'text', data: 'whole')]);
  });

  test('reads a Korean character split between chunks', () async {
    final bytes = utf8.encode('data: 말랑이\n\n');
    final events = await readEvents(
      Stream.fromIterable([bytes.sublist(0, 8), bytes.sublist(8)]),
    ).toList();
    expect(events, [(name: 'message', data: '말랑이')]);
  });
}
