import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../design/theme.dart';

/// Whether streak flames move. A seam: the tests set it false, so a screen
/// with a flame settles, and the flame's own tests set it back to true.
@visibleForTesting
bool streakFlamesMove = true;

/// How brightly a streak of some days burns (ADR 0104).
enum FlameStage {
  /// 1–2 days: an outline in the muted colour, flickering faintly and slowly.
  ember(fill: 0, core: false, glow: 0, motion: 0.35, period: 2400),

  /// 3–6 days: a light fill.
  kindling(fill: 0.35, core: false, glow: 0, motion: 0.5, period: 2000),

  /// 7–13 days: a fuller fill.
  steady(fill: 0.7, core: false, glow: 0, motion: 0.65, period: 1700),

  /// 14–29 days: solid, with a warm core and a faint glow.
  blazing(fill: 1, core: true, glow: 0.5, motion: 0.8, period: 1450),

  /// 30 days on: the brightest, with its glow and the liveliest flicker.
  roaring(fill: 1, core: true, glow: 1, motion: 1, period: 1200);

  const FlameStage({
    required this.fill,
    required this.core,
    required this.glow,
    required this.motion,
    required this.period,
  });

  /// How opaque the body's fill is, 0 for an outline alone.
  final double fill;

  /// Whether a warm core burns inside the body.
  final bool core;

  /// How strong the glow around the body is, 0 for none.
  final double glow;

  /// How far the flame moves, as a share of the liveliest stage's movement.
  final double motion;

  /// One cycle of the flame's movement, in milliseconds.
  final int period;

  /// The stage of a streak of [days].
  static FlameStage of(int days) => switch (days) {
    <= 2 => ember,
    <= 6 => kindling,
    <= 13 => steady,
    <= 29 => blazing,
    _ => roaring,
  };
}

/// A streak's flame, [size] square, burning at the [FlameStage] its [days]
/// give it: a small fire's flicker, sway and shifting tip, livelier as the
/// stage grows. It is decorative and hidden from screen readers; the text
/// beside it names the streak.
///
/// One animation controller drives it, repainting the flame alone. It holds
/// one still frame of its stage under reduce motion, and stops while the app
/// is not in the foreground or a [TickerMode] above it is off.
class StreakFlame extends StatefulWidget {
  const StreakFlame({super.key, required this.days, required this.size});

  final int days;
  final double size;

  @override
  State<StreakFlame> createState() => _StreakFlameState();
}

class _StreakFlameState extends State<StreakFlame>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final _cycle = AnimationController(vsync: this);
  var _foreground = true;

  FlameStage get _stage => FlameStage.of(widget.days);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    final state = WidgetsBinding.instance.lifecycleState;
    _foreground = state == null || state == AppLifecycleState.resumed;
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _run();
  }

  @override
  void didUpdateWidget(StreakFlame old) {
    super.didUpdateWidget(old);
    if (FlameStage.of(old.days) != _stage) _run();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _run();
  }

  /// Runs the cycle at the stage's pace, or holds it still.
  void _run() {
    final moves =
        streakFlamesMove &&
        _foreground &&
        !MediaQuery.disableAnimationsOf(context);
    if (!moves) {
      _cycle.stop();
      _cycle.value = 0;
      return;
    }
    final period = Duration(milliseconds: _stage.period);
    if (_cycle.isAnimating && _cycle.duration == period) return;
    _cycle.duration = period;
    _cycle.repeat();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _cycle.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ExcludeSemantics(
    child: RepaintBoundary(
      child: CustomPaint(
        size: Size.square(widget.size),
        painter: _FlamePainter(
          stage: _stage,
          colors: AppColors.of(context),
          cycle: _cycle,
        ),
      ),
    ),
  );
}

/// Paints the flame on a 24-unit square scaled to its size, posed at
/// [cycle]'s point in its movement.
class _FlamePainter extends CustomPainter {
  _FlamePainter({
    required this.stage,
    required this.colors,
    required this.cycle,
  }) : super(repaint: cycle);

  final FlameStage stage;
  final AppColors colors;
  final Animation<double> cycle;

  /// The icon grid the flame is drawn on.
  static const _grid = 24.0;

  @override
  void paint(Canvas canvas, Size size) {
    final unit = size.shortestSide / _grid;
    canvas.save();
    canvas.scale(unit);
    final turn = 2 * math.pi * cycle.value;
    final move = stage.motion;
    // A small fire: the tip sways and lifts, the body breathes.
    final sway = 1.3 * move * math.sin(turn);
    final lift = 1.1 * move * math.sin(2 * turn + 0.7);
    final breath = 0.45 * move * math.sin(3 * turn + 1.9);
    final body = _body(sway: sway, lift: lift, breath: breath);
    if (stage.glow > 0) {
      final pulse = 0.85 + 0.15 * math.sin(2 * turn);
      canvas.drawPath(
        body,
        Paint()
          ..color = colors.flameGlow.withValues(
            alpha: colors.flameGlow.a * stage.glow * pulse,
          )
          ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 2.5),
      );
    }
    if (stage.fill > 0) {
      canvas.drawPath(
        body,
        Paint()..color = colors.streak.withValues(alpha: stage.fill),
      );
    }
    if (stage.core) {
      canvas.drawPath(
        _flame(
          tip: Offset(12 + 0.6 * sway, 11 - 0.6 * lift),
          base: 20.5,
          half: 3.4 + 0.5 * breath,
        ),
        Paint()..color = colors.flameCore,
      );
    }
    canvas.drawPath(
      body,
      Paint()
        ..color = stage == FlameStage.ember
            ? colors.flameOutline
            : colors.streak
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round,
    );
    canvas.restore();
  }

  /// The flame's body: a round base, a tip that leans and sways by [sway]
  /// and rises by [lift], a small lick on its left side, and sides that
  /// breathe by [breath].
  static Path _body({
    required double sway,
    required double lift,
    required double breath,
  }) {
    final tip = Offset(12.6 + sway, 2 - lift);
    final lick = Offset(7.4 + 0.5 * sway, 9.2 + 0.6 * lift);
    final right = 18.9 + breath;
    final left = 5.1 - breath;
    return Path()
      ..moveTo(tip.dx, tip.dy)
      ..cubicTo(tip.dx + 1.2, 5.6, right - 0.4, 8.6, right, 13.6)
      ..cubicTo(right + 0.2, 18.7, 15.8, 22.5, 12, 22.5)
      ..cubicTo(8.2, 22.5, left, 19.4, left, 15.4)
      ..cubicTo(left, 12.7, lick.dx - 1.2, 10.6, lick.dx, lick.dy)
      ..cubicTo(lick.dx + 0.1, 11, lick.dx + 0.9, 12.4, lick.dx + 2.1, 12.9)
      ..cubicTo(lick.dx + 1.7, 9.1, tip.dx - 2.6, 5.4, tip.dx, tip.dy)
      ..close();
  }

  /// A teardrop, the flame's core: rounded at its [base], [half] wide each
  /// side, rising to a point at [tip].
  static Path _flame({
    required Offset tip,
    required double base,
    required double half,
  }) {
    final belly = base - half;
    return Path()
      ..moveTo(tip.dx, tip.dy)
      ..cubicTo(
        tip.dx + 1.5,
        tip.dy + (belly - tip.dy) * 0.4,
        12 + half,
        belly - half * 0.6,
        12 + half,
        belly,
      )
      ..cubicTo(12 + half, base - half * 0.45, 12 + half * 0.55, base, 12, base)
      ..cubicTo(
        12 - half * 0.55,
        base,
        12 - half,
        base - half * 0.45,
        12 - half,
        belly,
      )
      ..cubicTo(
        12 - half,
        belly - half * 0.5,
        tip.dx - 2,
        tip.dy + (belly - tip.dy) * 0.45,
        tip.dx,
        tip.dy,
      )
      ..close();
  }

  @override
  bool shouldRepaint(_FlamePainter old) =>
      old.stage != stage || old.colors != colors || old.cycle != cycle;
}
