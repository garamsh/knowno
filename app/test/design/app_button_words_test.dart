import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/theme.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';
import 'harness.dart';

void main() {
  setUpAll(loadAppFonts);

  // The width photo import's reading bar gives its retry: two thirds of a 390
  // wide phone's row, past the gutters and the gap.
  const retryWidth = (390 - 2 * AppSpace.gutter - AppSpace.s12) * 2 / 3;

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'at text scale $scale, in the bundled fonts, a Korean label as wide as '
      'the reading bar\'s retry breaks only between words, read as written, '
      'and a word wider than the button still wraps',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const label = '실패한 사진 다시 시도';
        // The control: one word, so it can break only inside itself.
        const word = '실패한사진다시시도실패한사진다시시도';
        for (final text in [label, word]) {
          await pumpComponent(
            tester,
            SizedBox(
              width: retryWidth,
              child: AppButton(
                label: text,
                size: AppButtonSize.cta,
                onPressed: () {},
              ),
            ),
          );
          if (text == word) {
            expectWrapsInsideWord(tester, word);
            continue;
          }
          expectBreaksBetweenWords(tester, label);
          expect(find.bySemanticsLabel(label), findsOneWidget);
        }
      },
    );
  }
}
