import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// The sizes of the 기록 tab's charts, and the shades they derive from the
/// app theme's [AppColors]; no token is added for them.
abstract final class StatsStyle {
  /// The retention chart's height, its line's width and its last point.
  static const retentionHeight = 140.0;
  static const retentionLine = 2.5;
  static const retentionDot = 4.5;
  static const retentionDotRing = 2.0;

  /// The width of the scale's labels at the retention chart's left.
  static const scaleWidth = 36.0;

  /// The target line's dashes and gaps.
  static const targetDash = 5.0;

  /// The lowest share the retention chart's scale reaches down to.
  static const retentionFloor = 0.8;

  /// The recall bar's height, the gap between its bands and a legend swatch.
  static const recallHeight = 14.0;
  static const bandGap = 2.0;
  static const swatch = 8.0;

  /// The mastered bars' height at the most cards.
  static const masteredHeight = 84.0;

  /// The gap between two heatmap cells, and their corner.
  static const cellGap = AppSpace.s4;
  static const cellRadius = AppSpace.s4;

  /// The ring around today's heatmap cell.
  static const todayRing = 2.0;

  /// The recall bands, strong, fair and fading: 3:1 on the surface, and every
  /// two 1.5:1 apart in lightness, not by hue alone (ADR 0147).
  static (Color, Color, Color) bands(AppColors colors) =>
      (colors.accent, colors.chartQuiet, colors.chartFading);

  /// A heatmap cell at each level, from a day without a card to the busiest
  /// third: the hairline, then the ink at three alphas, each level 1.5:1
  /// from the next.
  static List<Color> heat(AppColors colors) => [
    colors.hairline,
    colors.ink.withValues(alpha: 0.35),
    colors.ink.withValues(alpha: 0.65),
    colors.ink,
  ];
}
