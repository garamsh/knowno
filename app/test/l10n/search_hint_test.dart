import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/l10n/app_localizations_ko.dart';

void main() {
  test('a search placeholder names what it searches', () {
    final ko = AppLocalizationsKo();
    expect(ko.searchCards, '카드 검색');
    // Control: the notes' search names its own list.
    expect(ko.searchDecks, '노트 검색');
  });
}
