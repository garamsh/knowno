import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// The strings of the ARB file at [path], by key, without its metadata.
Map<String, String> _strings(String path) => {
  for (final MapEntry(:key, :value) in (jsonDecode(
    File(path).readAsStringSync(),
  ) as Map<String, Object?>).entries)
    if (!key.startsWith('@') && value is String) key: value,
};

/// "니다" or "니까" ending a sentence, the string, or a plural or select
/// branch, with the syllable before it.
final _ending = RegExp(r'(.)(니다|니까)(?=[.?!}]|\s|$)');

/// Whether [text] ends a sentence in 합쇼체: "…ㅂ니다" or "…ㅂ니까", the
/// syllable before carrying a final ㅂ (습, 입, 됩), unlike a verb such as
/// "다니다".
bool _formal(String text) => _ending.allMatches(text).any((match) {
  final syllable = match.group(1)!.codeUnitAt(0) - 0xAC00;
  const finalB = 17;
  return syllable >= 0 && syllable < 11172 && syllable % 28 == finalB;
});

void main() {
  test('every Korean string is written in 해요체, with no 합쇼체 ending', () {
    expect(
      [
        '아직 노트가 없습니다. 새 노트를 만들어 시작하세요.',
        '=0{이 노트에는 카드가 없습니다.} other{카드 {count}장도 함께 삭제됩니다.}',
        '내용을 공개하지 않겠습니다',
        '삭제하시겠습니까?',
      ].where(_formal),
      hasLength(4),
      reason: 'the check finds each 합쇼체 ending',
    );
    // Control: the same sentences in 해요체 pass, as do labels and 하세요.
    expect(
      [
        '아직 노트가 없어요. 새 노트를 만들어 시작해 보세요.',
        '=0{이 노트에는 카드가 없어요.} other{카드 {count}장도 함께 삭제돼요.}',
        '이름을 입력하세요',
        '다니다 보면',
        '로그아웃',
      ].where(_formal),
      isEmpty,
    );

    final korean = _strings('lib/l10n/app_ko.arb');
    // Control: the scan reads the template's strings, not an empty file.
    expect(korean, containsPair('signOut', '로그아웃'));

    expect({
      for (final MapEntry(:key, :value) in korean.entries)
        if (_formal(value)) key: value,
    }, isEmpty);
  });

  test('no English string has an exclamation mark', () {
    final english = _strings('lib/l10n/app_en.arb');
    // Control: the scan reads every key the Korean template has.
    expect(english.keys.toSet(), _strings('lib/l10n/app_ko.arb').keys.toSet());

    expect({
      for (final MapEntry(:key, :value) in english.entries)
        if (value.contains('!')) key: value,
    }, isEmpty);
  });
}
