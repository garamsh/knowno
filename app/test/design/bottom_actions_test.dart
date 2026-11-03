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
  // A run in the fallback font sits at another top on the same line, so a
  // line starts only at a box wholly below the line before.
  int lines(String label) {
    final boxes =
        tester
            .renderObject<RenderParagraph>(
              find.descendant(
                of: find.text(label),
                matching: find.byType(RichText),
              ),
            )
            .getBoxesForSelection(
              TextSelection(baseOffset: 0, extentOffset: label.length),
            )
            .toList()
          ..sort((a, b) => a.top.compareTo(b.top));
    var count = 0;
    var bottom = double.negativeInfinity;
    for (final box in boxes) {
      if (box.top >= bottom) count++;
      if (box.top >= bottom || box.bottom > bottom) bottom = box.bottom;
    }
    return count;
  }

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

  testWidgets(
    'at 2.0 a bottom pair lays out with no overflow, each label inside its button',
    (tester) async {
      final (secondary, primary) = await _lines(
        tester,
        secondary: '저장',
        primary: '저장하고 카드 추가',
        scale: 2,
      );
      expect(secondary, 1);
      expect(primary, greaterThanOrEqualTo(1));
    },
  );

  /// The rects of the two buttons, found by their labels.
  (Rect, Rect) rects(WidgetTester tester, String secondary, String primary) {
    Rect of(String label) => tester.getRect(
      find.ancestor(of: find.text(label), matching: find.byType(AppButton)),
    );
    return (of(secondary), of(primary));
  }

  testWidgets(
    "a pair whose labels both fit on one line stays in one row, the secondary at its label's width past half the row",
    (tester) async {
      expect(
        await _lines(
          tester,
          secondary: '엑셀·CSV 파일',
          primary: '직접 입력',
          scale: 1,
        ),
        (1, 1),
      );
      final (secondary, primary) = rects(tester, '엑셀·CSV 파일', '직접 입력');
      expect(secondary.top, primary.top, reason: 'one row');
      expect(secondary.right, lessThan(primary.left));
      expect(secondary.width, greaterThan(primary.width));
    },
  );

  testWidgets(
    'a pair whose labels do not both fit on one line stacks full width, the primary last, at 1.0 and at the largest text size',
    (tester) async {
      for (final (secondary, primary, scale) in [
        ('저장', '저장하고 카드 추가하고 다음 카드로 넘어가기', 1.0),
        ('엑셀·CSV 파일', '직접 입력', 3.12),
      ]) {
        await _lines(
          tester,
          secondary: secondary,
          primary: primary,
          scale: scale,
        );
        final (top, bottom) = rects(tester, secondary, primary);
        expect(bottom.top, greaterThan(top.bottom), reason: '$scale');
        expect(top.width, bottom.width, reason: '$scale');
        expect(top.width, 390 - 2 * AppSpace.gutter, reason: '$scale');
      }
    },
  );
}
