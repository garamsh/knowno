import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';

/// A dashed outline in [color] around [child]'s box, inside its edge and
/// rounded by [borderRadius]: a line [width] wide in dashes [dash] long with
/// gaps as long between them. It fills nothing, so what it outlines never
/// reads as a solid object: 홈's day bar still to come and study's place for
/// the previous card.
class DashedOutline extends StatelessWidget {
  const DashedOutline({
    super.key,
    required this.color,
    required this.borderRadius,
    required this.width,
    required this.dash,
    this.child,
  });

  final Color color;
  final BorderRadius borderRadius;
  final double width;
  final double dash;
  final Widget? child;

  @override
  Widget build(BuildContext context) => CustomPaint(
    painter: _DashedOutlinePainter(
      color: color,
      borderRadius: borderRadius,
      width: width,
      dash: dash,
    ),
    child: child,
  );
}

class _DashedOutlinePainter extends CustomPainter {
  const _DashedOutlinePainter({
    required this.color,
    required this.borderRadius,
    required this.width,
    required this.dash,
  });

  final Color color;
  final BorderRadius borderRadius;
  final double width;
  final double dash;

  @override
  void paint(Canvas canvas, Size size) {
    final outline = Path()
      ..addRRect(borderRadius.toRRect((Offset.zero & size).deflate(width / 2)));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = width;
    for (final PathMetric metric in outline.computeMetrics()) {
      for (var at = 0.0; at < metric.length; at += dash * 2) {
        canvas.drawPath(metric.extractPath(at, at + dash), paint);
      }
    }
  }

  @override
  bool shouldRepaint(_DashedOutlinePainter old) =>
      old.color != color ||
      old.borderRadius != borderRadius ||
      old.width != width ||
      old.dash != dash;
}
