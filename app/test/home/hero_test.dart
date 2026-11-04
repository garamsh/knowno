import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';

void main() {
  for (final (name, colors) in [
    ('light', AppColors.light),
    ('dark', AppColors.dark),
  ]) {
    test(
      '$name: the white cards\' quiet text meets WCAG AA, and a progress bar 3:1 on its track',
      () {
        final card = colors.surface;
        // Text, at 4.5:1: the cards' quiet text on the white.
        expect(contrast(colors.muted, card), greaterThanOrEqualTo(4.5));
        // A bar, at 3:1: a deck's progress bar on its track.
        expect(contrast(colors.accent, colors.edge), greaterThanOrEqualTo(3));
        // Control: the hairline track itself is not a mark, and fails 3:1 on
        // the white, so the check can fail.
        expect(contrast(colors.hairline, card), lessThan(3));
      },
    );

    test(
      '$name: 홈\'s today label meets WCAG AA on the ground, where its dot, decoration beside it, need not',
      () {
        expect(
          contrast(colors.todayText, colors.ground),
          greaterThanOrEqualTo(4.5),
        );
        // Control: the dot's coral itself fails 4.5:1 on the light ground, so
        // the label cannot be drawn in it.
        if (name == 'light') {
          expect(contrast(colors.todayMark, colors.ground), lessThan(4.5));
        }
      },
    );
  }
}
