import 'dart:convert';
import 'dart:io';

import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/markup_span.dart';

import 'markup_json.dart';

/// A fixture file of the engine's, read from the repository, not copied.
List<Map<String, Object?>> _fixture(String name) {
  final decoded = jsonDecode(
    File('../engine/tests/fixtures/markup/$name.json').readAsStringSync(),
  );
  return [
    for (final one in decoded as List<Object?>) one! as Map<String, Object?>,
  ];
}

/// [span]'s text with the list markers `markupSpan` draws left out, so it
/// reads as the engine's plain text does.
String _unmarked(InlineSpan span, List<MarkupBlock> blocks) {
  final drawn = span.toPlainText(includeSemanticsLabels: false);
  // A text with no list has no marker of ours to leave out: a line that
  // reads like one is literal.
  if (!blocks.any((block) => block is ListBlock)) return drawn;
  return drawn.replaceAllMapped(
    RegExp(r'^( {2})?(• |◦ |\d+\. )', multiLine: true),
    (_) => '',
  );
}

void main() {
  final parse = _fixture('parse');
  final cloze = _fixture('cloze');
  final plain = _fixture('plain');
  final v1 = _fixture('v1');
  final escape = _fixture('escape');

  test('the fixtures are read from the repository, and there are some', () {
    expect(parse.length, greaterThan(20));
    expect(cloze, isNotEmpty);
    expect(plain, isNotEmpty);
    expect(v1, isNotEmpty);
  });

  group('the bridge reads the text as the fixture says', () {
    for (final one in parse) {
      test('parse: ${one['name']}', () {
        expect(
          blocksJson(markupEngine.parse(one['input']! as String)),
          one['document'],
        );
      });
    }
    for (final one in cloze) {
      test('cloze numbers: ${one['name']}', () {
        expect(
          markupEngine.clozeNumbers(one['input']! as String),
          one['numbers'],
        );
      });
    }
    for (final one in plain) {
      test('plain text: ${one['name']}', () {
        expect(
          markupEngine.plainText(one['input']! as String),
          one['plainText'],
        );
      });
    }
    for (final one in v1) {
      test('version 1: ${one['name']}', () {
        expect(
          markupEngine.clozeFromV1(one['text']! as String, [
            ...(one['answers']! as List<Object?>).cast<String>(),
          ]),
          one['source'],
        );
      });
    }
  });

  group('the renderer draws the fixture\'s documents', () {
    for (final one in plain) {
      test('filled in, it reads as the plain text: ${one['name']}', () {
        final blocks = markupEngine.parse(one['input']! as String);
        final text = _unmarked(markupSpan(blocks), blocks);
        expect(text, one['plainText']);
      });
    }
    for (final one in parse) {
      test(
        'every fixture document draws what its parse draws: ${one['name']}',
        () {
          final fromFixture = markupSpan(blocksOf(one['document']));
          final fromEngine = markupSpan(
            markupEngine.parse(one['input']! as String),
          );
          expect(
            fromFixture.toPlainText(includeSemanticsLabels: false),
            fromEngine.toPlainText(includeSemanticsLabels: false),
          );
        },
      );
    }
    for (final one in cloze) {
      final hidden = (one['hidden']! as Map<String, Object?>).entries;
      for (final MapEntry(key: number, value: document) in hidden) {
        test('cloze $number hidden: ${one['name']}', () {
          // The engine's hidden document, drawn, is the text with that cloze a
          // blank and every other cloze its answer.
          final expected = markupSpan(blocksOf(document))
              .toPlainText(includeSemanticsLabels: false);
          final drawn = markupSpan(
            markupEngine.parse(one['input']! as String),
            cloze: (run) => run.number == int.parse(number)
                ? const TextSpan(text: '___')
                : filledCloze(run),
          ).toPlainText(includeSemanticsLabels: false);
          expect(drawn, expected);
        });
      }
      test('filled in: ${one['name']}', () {
        final expected = markupSpan(blocksOf(one['filled']))
            .toPlainText(includeSemanticsLabels: false);
        final drawn = markupSpan(markupEngine.parse(one['input']! as String))
            .toPlainText(includeSemanticsLabels: false);
        expect(drawn, expected);
      });
    }
  });

  group('the escape the bridge writes is the fixture\'s', () {
    test('every text is escaped as it says, and reads back as the text', () {
      expect(escape, isNotEmpty);
      for (final one in escape) {
        final text = one['text']! as String;
        final escaped = one['escaped']! as String;
        expect(
          markupEngine.escapeLiteral(text),
          escaped,
          reason: '${one['name']}',
        );
        expect(
          markupEngine.plainText(escaped),
          text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
          reason: '${one['name']}: it means what was typed',
        );
      }
    });
  });
}
