import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';

void main() {
  for (final (name, colors) in [
    ('light', AppColors.light),
    ('dark', AppColors.dark),
  ]) {
    test(
      '$name: the white cards\' quiet text meets WCAG AA, and their marks and bars 3:1',
      () {
        final card = colors.surface;
        // Text, at 4.5:1: the cards' quiet text on the white.
        expect(contrast(colors.muted, card), greaterThanOrEqualTo(4.5));
        // Marks and bars, at 3:1: the streak's flame on the white, the today
        // card's bar on its track, and a quiet bar on the white.
        for (final (mark, ground) in [
          (colors.streak, card),
          (colors.accent, colors.edge),
        ]) {
          expect(
            contrast(mark, ground),
            greaterThanOrEqualTo(3),
            reason: '$mark on $ground',
          );
        }
        // A quiet day's bar is carried by its count, and stays 1.5:1 from
        // today's.
        expect(
          contrast(colors.chartOther, colors.accent),
          greaterThanOrEqualTo(1.5),
        );
        // Control: the hairline track itself is not a mark, and fails 3:1 on
        // the white, so the check can fail.
        expect(contrast(colors.hairline, card), lessThan(3));
      },
    );
  }
}
