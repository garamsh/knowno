import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_chip.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';
import 'harness.dart';

void main() {
  setUpAll(loadAppFonts);

  testWidgets(
    'in the bundled fonts a Korean chip too wide for its line breaks only '
    'between words and is read as written, and a word wider than the line '
    'still wraps',
    (tester) async {
      final semantics = tester.ensureSemantics();
      const label = '지난 일주일 동안 목표보다 2%p 높아요. 꾸준히 학습한 덕분에 기억이 오래 남고 있어요.';
      // The control: one word, so it can break only inside itself.
      const word = '지난일주일동안목표보다2%p높아요꾸준히학습한덕분에기억이오래남고있어요';
      await pumpComponent(
        tester,
        const SizedBox(
          width: 200,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AppChip(label: label, tone: AppChipTone.knowTint),
              AppChip(label: word),
            ],
          ),
        ),
      );

      expectBreaksBetweenWords(tester, label);
      expectWrapsInsideWord(tester, word);
      expect(tester.getSemantics(shownText(label)), isSemantics(label: label));
      semantics.dispose();
    },
  );
}
