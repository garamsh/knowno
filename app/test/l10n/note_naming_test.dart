import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The string values of the ARB file at [path], by key, without its metadata.
Map<String, String> _strings(String path) => {
  for (final MapEntry(:key, :value) in (jsonDecode(
    File(path).readAsStringSync(),
  ) as Map<String, Object?>).entries)
    if (!key.startsWith('@') && value is String) key: value,
};

/// Keys whose value may still say 덱 or deck. None does: a deck is a 노트 in
/// every string a user reads (ADR 0148).
const _allowedKeys = <String>{};

/// The keys of [strings] whose value calls a deck 덱 in Korean, or a deck in
/// English, outside [allowed]. A `{deck}` placeholder is not the word.
List<String> _deckWording(
  Map<String, String> strings, {
  required RegExp word,
  Set<String> allowed = _allowedKeys,
}) => [
  for (final MapEntry(:key, :value) in strings.entries)
    if (!allowed.contains(key) && word.hasMatch(value)) key,
];

final _korean = RegExp('덱');
final _english = RegExp(r'(?<![{\w])decks?\b', caseSensitive: false);

void main() {
  test('app_ko.arb has no 덱 in any value, a deck being a 노트', () {
    final strings = _strings('lib/l10n/app_ko.arb');
    expect(strings, isNotEmpty);
    expect(_deckWording(strings, word: _korean), isEmpty);
  });

  test('app_en.arb has no deck in any value, a deck being a note', () {
    final strings = _strings('lib/l10n/app_en.arb');
    expect(strings, isNotEmpty);
    expect(_deckWording(strings, word: _english), isEmpty);
  });

  test('the scan finds a 덱 or a deck and passes a 노트, a note and a {deck} '
      'placeholder', () {
    final korean = {
      'planted': '새 덱 만들기',
      'particle': '덱을 삭제할까요?',
      'fixed': '새 노트 만들기',
      'placeholder': '{deck} 노트',
    };
    expect(_deckWording(korean, word: _korean), ['planted', 'particle']);

    final english = {
      'planted': 'New deck',
      'plural': 'Public decks',
      'capital': 'Deck {deck}',
      'fixed': 'New note',
      'placeholder': 'Added to "{deck}"',
    };
    expect(_deckWording(english, word: _english), [
      'planted',
      'plural',
      'capital',
    ]);
  });

  test('an allowed key is skipped, and only that key', () {
    final strings = {'a': '새 덱', 'b': '내 덱'};
    expect(_deckWording(strings, word: _korean, allowed: {'a'}), ['b']);
  });
}
