import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// The sizes of the 기록 tab's charts, and the shades they take from the app
/// theme's [AppColors] (ADR 0151).
abstract final class StatsStyle {
  /// The retention chart's height, its line's width, its soft fill's alpha,
  /// and today's ring: its radius and its line.
  static const retentionHeight = 110.0;
  static const retentionLine = 3.0;
  static const retentionArea = 0.1;
  static const todayDot = 7.0;
  static const todayDotRing = 3.0;

  /// The target line's width, and its dashes and gaps.
  static const targetLine = 1.5;
  static const targetDash = 5.0;

  /// The lowest share the retention chart's scale reaches down to.
  static const retentionFloor = 0.8;

  /// The recall bar's height, the gap between its bands and their corner,
  /// and a tile's swatch with its corner.
  static const recallHeight = 22.0;
  static const bandGap = 3.0;
  static const bandRadius = AppSpace.s8;
  static const swatch = 10.0;
  static const swatchRadius = AppSpace.s4;

  /// The mastered bars' height at the most cards, and their top and bottom
  /// corners.
  static const masteredHeight = 96.0;
  static const barTop = AppSpace.s8;
  static const barBottom = AppSpace.s4;

  /// The gap between two heatmap cells, and their corner.
  static const cellGap = AppSpace.s4;
  static const cellRadius = AppSpace.s4;

  /// The outline around today's heatmap cell, and the space inside it.
  static const todayRing = 2.0;
  static const todayRingGap = 1.0;

  /// The recall bands, strong, fair and fading, in three hues, each beside
  /// its count (ADR 0147).
  static (Color, Color, Color) bands(AppColors colors) =>
      (colors.recallStrong, colors.recallFair, colors.recallFading);

  /// A heatmap cell at each level, from a day without a card to the busiest
  /// third: four cobalt steps, each 1.5:1 from the next (ADR 0151).
  static List<Color> heat(AppColors colors) => [
    colors.heat0,
    colors.heat1,
    colors.heat2,
    colors.heat3,
  ];
}
