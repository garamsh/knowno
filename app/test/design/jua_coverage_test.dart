import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/theme.dart';

/// The code points [font] maps to a glyph, read from the cmap's format 4 and
/// format 12 subtables.
Set<int> _codePoints(String font) {
  final bytes = ByteData.sublistView(File(font).readAsBytesSync());
  var cmap = -1;
  for (var i = 0; i < bytes.getUint16(4); i++) {
    final record = 12 + i * 16;
    if (ascii.decode(bytes.buffer.asUint8List(record, 4)) == 'cmap') {
      cmap = bytes.getUint32(record + 8);
    }
  }
  final points = <int>{};
  for (var i = 0; i < bytes.getUint16(cmap + 2); i++) {
    final table = cmap + bytes.getUint32(cmap + 8 + i * 8);
    switch (bytes.getUint16(table)) {
      case 4:
        final count = bytes.getUint16(table + 6) ~/ 2;
        for (var s = 0; s < count; s++) {
          final end = bytes.getUint16(table + 14 + s * 2);
          final start = bytes.getUint16(table + 16 + (count + s) * 2);
          final delta = bytes.getInt16(table + 16 + (count * 2 + s) * 2);
          final offsetAt = table + 16 + (count * 3 + s) * 2;
          final offset = bytes.getUint16(offsetAt);
          for (var c = start; c <= end && c != 0xFFFF; c++) {
            final glyph = offset == 0
                ? (c + delta) & 0xFFFF
                : bytes.getUint16(offsetAt + offset + (c - start) * 2);
            if (glyph != 0) points.add(c);
          }
        }
      case 12:
        for (var g = 0; g < bytes.getUint32(table + 12); g++) {
          final group = table + 16 + g * 12;
          for (
            var c = bytes.getUint32(group);
            c <= bytes.getUint32(group + 4);
            c++
          ) {
            points.add(c);
          }
        }
    }
  }
  return points;
}

/// Everything we write in Korean: the app's strings and the web's source,
/// its tests left out. Text a user wrote is never in either, and never in
/// Jua (ADR 0147).
Map<String, String> _ourText() => {
  'lib/l10n/app_ko.arb':
      (jsonDecode(File('lib/l10n/app_ko.arb').readAsStringSync())
              as Map<String, dynamic>)
          .entries
          .where((entry) => !entry.key.startsWith('@'))
          .map((entry) => '${entry.value}')
          .join('\n'),
  for (final entity in Directory('../web/src').listSync(recursive: true))
    if (entity is File &&
        !entity.path.contains('__tests__') &&
        RegExp(r'\.tsx?$').hasMatch(entity.path))
      entity.path: entity.readAsStringSync(),
};

/// The characters of [text] outside ASCII that [covered] does not hold, but
/// for white space and joiners.
Set<String> _missing(String text, Set<int> covered) => {
  for (final rune in text.runes)
    if (rune > 0x7E &&
        !covered.contains(rune) &&
        !_blank.hasMatch(String.fromCharCode(rune)))
      String.fromCharCode(rune),
};

final _blank = RegExp(r'[\s​]');

/// The characters we write that Jua lacks, each drawn by Pretendard
/// ExtraBold, its fallback at the weight the Jua styles ask for.
const _allowed = {
  '·', '⋯', '←', '→', '…', '—', '–', '−', '×', '§', '「', '」', '✓', '’', //
  '•', '◦', //
};

void main() {
  final jua = _codePoints('assets/fonts/Jua-Regular.ttf');
  final pretendard = _codePoints('assets/fonts/Pretendard-ExtraBold.otf');

  test('a character the font lacks is reported, and one it holds is not', () {
    // Control: the parser reads Jua's table, and a syllable outside it is
    // reported, as a missing one in our strings would be.
    expect(jua.length, greaterThan(2000));
    expect(jua, contains('가'.runes.single));
    expect(_missing('가똠', jua), {'똠'});
    expect(_missing('가', jua), isEmpty);
    expect(pretendard, contains('똠'.runes.single));
  });

  test('Jua draws every character we write, or Pretendard ExtraBold does', () {
    final text = _ourText();
    // Control: the walk reaches the app's strings and the web's.
    expect(text.keys, contains('lib/l10n/app_ko.arb'));
    expect(text.keys, contains('../web/src/app/(shell)/_components/today.tsx'));

    final missing = {for (final page in text.values) ..._missing(page, jua)};

    expect(missing.difference(_allowed), isEmpty);
    expect(
      _allowed.difference({
        for (final character in _allowed)
          if (pretendard.contains(character.runes.single)) character,
      }),
      isEmpty,
    );
  });

  testWidgets(
    'Jua is drawn at its one face\'s weight, not thickened, and its fallback at ExtraBold',
    (tester) async {
      Future<ByteData> bytes(String path) async =>
          ByteData.sublistView(await File(path).readAsBytes());
      await tester.runAsync(() async {
        await (FontLoader(
          appDisplayFontFamily,
        )..addFont(bytes('assets/fonts/Jua-Regular.ttf'))).load();
        await (FontLoader(
          appDisplayFallbackFamily,
        )..addFont(bytes('assets/fonts/Pretendard-ExtraBold.otf'))).load();
      });
      Future<int> ink(String text, TextStyle style) async {
        await tester.pumpWidget(
          Directionality(
            textDirection: TextDirection.ltr,
            child: Center(
              child: RepaintBoundary(
                key: const Key('sample'),
                child: ColoredBox(
                  color: const Color(0xFFFFFFFF),
                  child: Text(
                    text,
                    style: style.copyWith(
                      fontSize: 64,
                      color: const Color(0xFF000000),
                    ),
                  ),
                ),
              ),
            ),
          ),
        );
        final dark = await tester.runAsync(() async {
          final image = await tester
              .renderObject<RenderRepaintBoundary>(
                find.byKey(const Key('sample')),
              )
              .toImage();
          final pixels = (await image.toByteData(
            format: ui.ImageByteFormat.rawRgba,
          ))!;
          return [
            for (var at = 0; at < pixels.lengthInBytes; at += 4)
              if (pixels.getUint8(at) < 128) at,
          ].length;
        });
        return dark!;
      }

      const word = '학습 완료';
      final styled = await ink(word, AppType.button);
      // Control: the same word at a heavier weight is thickened, so the
      // comparison can fail.
      expect(
        await ink(word, AppType.button.copyWith(fontWeight: FontWeight.w800)),
        greaterThan(styled),
      );
      for (final style in [
        AppType.display,
        AppType.title,
        AppType.deckTitle,
        AppType.figure,
        AppType.headline,
        AppType.label,
      ]) {
        expect(style.fontWeight, AppType.button.fontWeight);
        expect(style.fontFamilyFallback, [appDisplayFallbackFamily]);
      }
      // The fallback is one face: asked at Jua's weight it draws as at 800.
      expect(
        await ink('····', AppType.button),
        await ink('····', AppType.button.copyWith(fontWeight: FontWeight.w800)),
      );
    },
  );
}
