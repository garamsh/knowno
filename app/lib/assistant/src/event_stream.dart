import 'dart:convert';

/// A server-sent event as it arrived: its [name], `message` where none was
/// given, and its [data].
typedef RawEvent = ({String name, String data});

/// The events of a `text/event-stream` [body], each yielded once its blank
/// line arrives, whatever chunks split it; an event cut off by the stream's
/// end is dropped, as a browser's EventSource drops it.
Stream<RawEvent> readEvents(Stream<List<int>> body) async* {
  var name = '';
  var data = <String>[];
  await for (final line
      in body.transform(utf8.decoder).transform(const LineSplitter())) {
    if (line.isEmpty) {
      if (data.isNotEmpty) {
        yield (name: name.isEmpty ? 'message' : name, data: data.join('\n'));
      }
      name = '';
      data = [];
    } else if (!line.startsWith(':')) {
      final colon = line.indexOf(':');
      final field = colon == -1 ? line : line.substring(0, colon);
      final raw = colon == -1 ? '' : line.substring(colon + 1);
      final value = raw.startsWith(' ') ? raw.substring(1) : raw;
      if (field == 'event') {
        name = value;
      } else if (field == 'data') {
        data.add(value);
      }
    }
  }
}
