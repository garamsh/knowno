import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/bottom_actions.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

/// Lays out a bottom pair of [secondary] and [primary] in Jua on a phone 390
/// wide at [scale], and returns how many lines each label takes.
Future<(int, int)> _lines(
  WidgetTester tester, {
  required String secondary,
  required String primary,
  required double scale,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: lightTheme,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: MediaQuery(
        data: MediaQueryData(
          size: const Size(390, 844),
          textScaler: TextScaler.linear(scale),
        ),
        child: Scaffold(
          bottomNavigationBar: BottomActions(
            secondary: AppButton(
              label: secondary,
              variant: AppButtonVariant.secondary,
              size: AppButtonSize.cta,
              onPressed: () {},
            ),
            primary: AppButton(
              label: primary,
              size: AppButtonSize.cta,
              onPressed: () {},
            ),
          ),
        ),
      ),
    ),
  );
  int lines(String label) => tester
      .renderObject<RenderParagraph>(
        find.descendant(of: find.text(label), matching: find.byType(RichText)),
      )
      .getBoxesForSelection(
        TextSelection(baseOffset: 0, extentOffset: label.length),
      )
      .map((box) => box.top)
      .toSet()
      .length;
  expect(tester.takeException(), isNull);
  return (lines(secondary), lines(primary));
}

void main() {
  setUpAll(() async {
    Future<ByteData> bytes(String path) async =>
        ByteData.sublistView(await File(path).readAsBytes());
    await (FontLoader(
      appDisplayFontFamily,
    )..addFont(bytes('assets/fonts/Jua-Regular.ttf'))).load();
    await (FontLoader(
      appDisplayFallbackFamily,
    )..addFont(bytes('assets/fonts/Pretendard-ExtraBold.otf'))).load();
  });

  testWidgets(
    'a bottom pair keeps each label on one line at 1.0 on a 390 wide phone, '
    'against a primary too long for any width',
    (tester) async {
      for (final primary in ['저장하고 카드 추가', '저장하고 다음 카드']) {
        expect(
          await _lines(tester, secondary: '저장', primary: primary, scale: 1),
          (1, 1),
          reason: primary,
        );
      }
      // The control: a label longer than the row wraps, so the count can
      // tell one line from two.
      final (_, long) = await _lines(
        tester,
        secondary: '저장',
        primary: '저장하고 카드 추가하고 다음 카드로 넘어가기',
        scale: 1,
      );
      expect(long, greaterThan(1));
    },
  );

  testWidgets('at 2.0 a bottom pair wraps inside its buttons, off nothing', (
    tester,
  ) async {
    final (secondary, primary) = await _lines(
      tester,
      secondary: '저장',
      primary: '저장하고 카드 추가',
      scale: 2,
    );
    expect(secondary, 1);
    expect(primary, greaterThanOrEqualTo(1));
  });
}
