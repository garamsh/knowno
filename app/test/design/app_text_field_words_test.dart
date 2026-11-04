import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_text_field.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';
import 'harness.dart';

void main() {
  setUpAll(loadAppFonts);

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'at text scale $scale, in the bundled fonts, a Korean label breaks only '
      'between words and the field is still read by the label as written',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final semantics = tester.ensureSemantics();
        const label = '카드 앞면에 적을 낱말과 뜻을 함께 입력하세요';
        await pumpComponent(
          tester,
          const SizedBox(width: 200, child: AppTextField(label: label)),
        );
        expectBreaksBetweenWords(tester, label);
        expect(
          tester.getSemantics(find.byType(EditableText)),
          isSemantics(isTextField: true, label: label),
        );
        semantics.dispose();
      },
    );
  }
}
