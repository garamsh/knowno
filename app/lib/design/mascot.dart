import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

import 'theme.dart';

part 'mascot_drawings.dart';

/// Whether mascots move. A seam: the tests set it false, so a screen with a
/// mascot settles, and the mascot's own tests set it back to true.
@visibleForTesting
bool mascotsMove = true;

/// The moods of the mascot, each the same drawing (ADR 0141).
enum MascotExpression {
  /// Looking up, a hand at its chin: the mark itself, and a photo being read.
  thinking,

  /// Eyes shut in a smile, arms up: study done, and the first deck made.
  happy,

  /// Eyes wet, hands together: a failed photo, or a photo with no cards.
  sad,

  /// Dozing: nothing to study today, and an empty deck.
  sleepy;

  /// Whether its eyes are open in the drawing, so it can blink.
  bool get blinks => _drawings[this]!.any((shape) => shape.move == _Move.eye);
}

/// How much a mascot moves at its size (ADR 0152, ADR 0193).
enum _Motion {
  /// Blinks, and a thinking one glances about: from 41 to 127 across.
  blink,

  /// Blinks and breathes, or wobbles, or dozes: 128 across and more.
  full;

  /// What a mascot of [expression] [size] across does, or null if it holds
  /// still: at 40 or less, and where it has nothing to move at its size.
  static _Motion? of(MascotExpression expression, double size) {
    if (size >= 128) return full;
    if (size > 40 && expression.blinks) return blink;
    return null;
  }
}

/// The mascot, [size] across, on no ground of its own, decorative and hidden
/// from screen readers.
///
/// It moves inside its own layer, drawn from the parts `make brand` writes
/// (ADR 0152): at 128 and more it blinks and breathes, the happy one wobbles
/// (ADR 0185) and the sleepy one dozes; from 41 to 127 it only blinks. At 40
/// or less, under reduce motion, and where its expression has nothing to move
/// at its size, it is the still image.
class Mascot extends StatelessWidget {
  const Mascot({super.key, required this.expression, required this.size});

  final MascotExpression expression;
  final double size;

  @override
  Widget build(BuildContext context) {
    final motion = _Motion.of(expression, size);
    return ExcludeSemantics(
      child:
          motion == null ||
              !mascotsMove ||
              MediaQuery.disableAnimationsOf(context)
          ? Image.asset(
              AppBrand.mascot(expression.name),
              width: size,
              height: size,
            )
          : _MovingMascot(
              key: ValueKey((expression, motion)),
              expression: expression,
              size: size,
              motion: motion,
            ),
    );
  }
}

/// A moment's turn the mascot takes between its loops: a blink or a glance.
@visibleForTesting
sealed class MascotGesture {
  const MascotGesture();

  /// How long it takes, start to end.
  Duration get length;

  /// The gesture a mascot of [expression] makes next, drawn from [random]: a
  /// double blink one time in five, a thinking one's glance about one in
  /// eight, and a single blink otherwise; a sad one makes none in place of a
  /// glance. A sad blink holds longer.
  static MascotGesture? next(MascotExpression expression, math.Random random) {
    final hold = Duration(
      milliseconds: expression == MascotExpression.sad ? 160 : 110,
    );
    final roll = random.nextDouble();
    if (roll < 0.2) return MascotBlink(hold: hold, twice: true);
    if (roll >= 0.32) return MascotBlink(hold: hold, twice: false);
    if (expression != MascotExpression.thinking) return null;
    return MascotGlance(
      Offset(
        (random.nextDouble() * 2 - 1) * 22,
        (random.nextDouble() * 2 - 1) * 14,
      ),
    );
  }
}

/// The eyes shut for [hold] and open again, [twice] with a beat between.
@visibleForTesting
final class MascotBlink extends MascotGesture {
  const MascotBlink({required this.hold, required this.twice});

  final Duration hold;
  final bool twice;

  /// From the eyes opening to the second blink's start.
  static const beat = Duration(milliseconds: 170);

  /// How long the eyes take to open again.
  static const opening = Duration(milliseconds: 60);

  @override
  Duration get length => twice ? hold * 2 + beat + opening : hold + opening;
}

/// The pupils move [to] and back, in units of the 1024 drawing.
@visibleForTesting
final class MascotGlance extends MascotGesture {
  const MascotGlance(this.to);

  final Offset to;

  /// How long the pupils take to move there, and back.
  static const move = Duration(milliseconds: 260);

  /// When they start back.
  static const back = Duration(milliseconds: 1400);

  @override
  Duration get length => back + move;
}

/// Where the mascot's moving parts are at one moment, in units of the 1024
/// drawing.
@visibleForTesting
final class MascotPose {
  const MascotPose({
    this.width = 1,
    this.height = 1,
    this.feet = _feet,
    this.armsTurn = 0,
    this.zz = Offset.zero,
    this.zzOpacity = 1,
    this.eyeHeight = 1,
    this.eyesOpen = true,
    this.lid = 0,
    this.glance = Offset.zero,
  });

  /// The drawing as it stands still.
  static const still = MascotPose();

  /// The drawing's scale about [feet], all but its ground.
  final double width, height;

  /// The point, in units of the 1024 drawing, the drawing scales about.
  final Offset feet;

  /// The happy mascot's left arm's turn in radians about its shoulder; the
  /// right arm turns the other way.
  final double armsTurn;

  /// The sleepy mascot's Z's: how far they have drifted, and how opaque they
  /// are.
  final Offset zz;
  final double zzOpacity;

  /// Each open eye's height about its centre, and whether it is drawn at all.
  final double eyeHeight;
  final bool eyesOpen;

  /// How opaque the closed lids are.
  final double lid;

  /// How far the pupils have moved.
  final Offset glance;

  /// The pose of a mascot of [expression], [time] into its loop when it
  /// moves [full]y, [since] into its [gesture], if any.
  factory MascotPose.at(
    MascotExpression expression, {
    required bool full,
    required Duration time,
    MascotGesture? gesture,
    Duration since = Duration.zero,
  }) {
    final seconds = time.inMicroseconds / Duration.microsecondsPerSecond;
    final (width, height, feet, armsTurn, zz, zzOpacity) = full
        ? _loop(expression, seconds)
        : (1.0, 1.0, _feet, 0.0, Offset.zero, 1.0);
    final ms = since.inMicroseconds / Duration.microsecondsPerMillisecond;
    final (eyeHeight, eyesOpen, lid) = switch (gesture) {
      MascotBlink(:final hold, :final twice) => _blink(
        twice && ms >= _ms(hold + MascotBlink.beat)
            ? ms - _ms(hold + MascotBlink.beat)
            : ms,
        _ms(hold),
      ),
      _ => (1.0, true, 0.0),
    };
    final glance = switch (gesture) {
      MascotGlance(:final to) => to * _glance(ms),
      _ => Offset.zero,
    };
    return MascotPose(
      width: width,
      height: height,
      feet: feet,
      armsTurn: armsTurn,
      zz: zz,
      zzOpacity: zzOpacity,
      eyeHeight: eyeHeight,
      eyesOpen: eyesOpen,
      lid: lid,
      glance: glance,
    );
  }
}

double _ms(Duration duration) =>
    duration.inMicroseconds / Duration.microsecondsPerMillisecond;

/// The share of the way through [length] ms that [ms] is, eased by [curve].
double _eased(double ms, double length, Curve curve) =>
    curve.transform((ms / length).clamp(0, 1));

/// One blink [ms] in, shut for [hold] ms: the eyes close to 0.05 high in
/// 70 ms and vanish at 60, the lids fading in over 40; then they open in 60 ms
/// and the lids fade out over 40.
(double, bool, double) _blink(double ms, double hold) {
  if (ms < hold) {
    return (
      1 - 0.95 * _eased(ms, 70, Curves.easeIn),
      ms < 60,
      _eased(ms, 40, Curves.ease),
    );
  }
  final opening = ms - hold;
  return (
    0.05 + 0.95 * _eased(opening, 60, Curves.easeIn),
    true,
    1 - _eased(opening, 40, Curves.ease),
  );
}

const _glanceCurve = Cubic(0.3, 0.7, 0.3, 1);

/// How far along its way out a glance [ms] in has the pupils.
double _glance(double ms) {
  final there = _ms(MascotGlance.move);
  final back = _ms(MascotGlance.back);
  return ms < back
      ? _eased(ms, there, _glanceCurve)
      : 1 - _eased(ms - back, there, _glanceCurve);
}

/// The value at [at], a share of a loop, between [keys] of (share, value),
/// eased by [curve] between each two.
double _keyed(double at, List<(double, double)> keys, Curve curve) {
  for (var i = 1; i < keys.length; i++) {
    final (end, to) = keys[i];
    if (at <= end) {
      final (start, from) = keys[i - 1];
      return from + (to - from) * curve.transform((at - start) / (end - start));
    }
  }
  return keys.last.$2;
}

/// The value at [at], a share of a loop, between [keys] of (share, value,
/// curve), each eased by its own curve to the next, as CSS eases between
/// keyframes.
double _keyedEach(double at, List<(double, double, Curve)> keys) {
  for (var i = 1; i < keys.length; i++) {
    final (end, to, _) = keys[i];
    if (at <= end) {
      final (start, from, curve) = keys[i - 1];
      return from + (to - from) * curve.transform((at - start) / (end - start));
    }
  }
  return keys.last.$2;
}

/// A breath to [width] by [height] and back over [period] seconds.
(double, double) _breath(
  double seconds,
  double period,
  double width,
  double height,
) {
  final at = seconds % period / period;
  return (
    _keyed(at, [(0, 1), (0.5, width), (1, 1)], Curves.easeInOut),
    _keyed(at, [(0, 1), (0.5, height), (1, 1)], Curves.easeInOut),
  );
}

/// Where a breath scales the drawing about: under its feet.
const _feet = Offset(512, 960);

/// Where the happy drawing's wobble scales it about: under its feet, the foot
/// of its tilted body's box in the 1024 drawing.
const _happyFeet = Offset(502.8, 860.8);

/// The happy wobble's curves, the reference's cubic-bezier()s: a settle in
/// and out, and the spring out of the squash.
const _settle = Cubic(0.45, 0, 0.55, 1);
const _spring = Cubic(0.2, 0.9, 0.3, 1.25);
const _armSpring = Cubic(0.2, 0.9, 0.3, 1.3);

/// Each expression's loop [seconds] in: a breath, the happy one's wobble with
/// its arms swinging, and the sleepy one's deeper breath with its Z's drifting
/// up.
(double, double, Offset, double, Offset, double) _loop(
  MascotExpression expression,
  double seconds,
) {
  switch (expression) {
    case MascotExpression.thinking || MascotExpression.sad:
      final (width, height) = _breath(seconds, 3, 1.012, 0.982);
      return (width, height, _feet, 0, Offset.zero, 1);
    case MascotExpression.sleepy:
      final (width, height) = _breath(seconds, 4.2, 1.02, 0.97);
      final at = seconds % 4.2 / 4.2;
      final drift = Curves.easeInOut.transform(at);
      return (
        width,
        height,
        _feet,
        0,
        Offset.lerp(const Offset(-20, 30), const Offset(10, -40), drift)!,
        _keyed(at, [(0, 0), (0.3, 1), (0.7, 1), (1, 0)], Curves.easeInOut),
      );
    case MascotExpression.happy:
      final at = seconds % 1.8 / 1.8;
      double wobble(List<double> values) => _keyedEach(at, [
        (0, values[0], _settle),
        (0.11, values[1], _spring),
        (0.26, values[2], _settle),
        (0.37, values[3], _settle),
        (0.46, values[4], _settle),
        (0.54, values[5], _settle),
        (0.61, 1, Curves.ease),
        (1, 1, Curves.ease),
      ]);
      final degrees = _keyedEach(at, [
        (0, 0, _settle),
        (0.12, -10, _armSpring),
        (0.28, 14, _settle),
        (0.4, -4, _settle),
        (0.52, 2, Curves.ease),
        (0.62, 0, Curves.ease),
        (1, 0, Curves.ease),
      ]);
      return (
        wobble([1, 1.12, 0.91, 1.06, 0.97, 1.015]),
        wobble([1, 0.85, 1.11, 0.95, 1.03, 0.99]),
        _happyFeet,
        degrees * math.pi / 180,
        Offset.zero,
        1,
      );
  }
}

/// A mascot that moves: one ticker, running throughout at full motion and
/// only through a gesture at blink, repainting its own layer alone. It stops
/// while the app is not in the foreground or a [TickerMode] above it is off,
/// and its gestures with it.
class _MovingMascot extends StatefulWidget {
  const _MovingMascot({
    super.key,
    required this.expression,
    required this.size,
    required this.motion,
  });

  final MascotExpression expression;
  final double size;
  final _Motion motion;

  @override
  State<_MovingMascot> createState() => _MovingMascotState();
}

class _MovingMascotState extends State<_MovingMascot>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final Ticker _ticker = createTicker(_tick);
  final _pose = ValueNotifier(MascotPose.still);
  final _random = math.Random();
  Timer? _next;
  MascotGesture? _gesture;
  Duration _gestureAt = Duration.zero;
  Duration _now = Duration.zero;
  var _foreground = true;
  var _enabled = true;

  bool get _full => widget.motion == _Motion.full;

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
    _enabled = TickerMode.valuesOf(context).enabled;
    _run();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    _run();
  }

  /// Runs the loop and schedules the gestures, or stops both and stands still.
  void _run() {
    if (!_foreground || !_enabled) {
      _ticker.stop();
      _next?.cancel();
      _next = null;
      _gesture = null;
      _pose.value = MascotPose.still;
      return;
    }
    if (_full && !_ticker.isActive) _ticker.start();
    if (widget.expression.blinks && _next == null) _schedule();
  }

  /// The next gesture, 3 to 7 s from now.
  void _schedule() => _next = Timer(
    Duration(milliseconds: 3000 + _random.nextInt(4000)),
    _gestureNow,
  );

  void _gestureNow() {
    _schedule();
    final gesture = MascotGesture.next(widget.expression, _random);
    if (gesture == null) return;
    _gesture = gesture;
    if (_ticker.isActive) {
      _gestureAt = _now;
    } else {
      _gestureAt = Duration.zero;
      _ticker.start();
    }
  }

  void _tick(Duration elapsed) {
    _now = elapsed;
    final since = elapsed - _gestureAt;
    if (_gesture case final gesture? when since >= gesture.length) {
      _gesture = null;
      if (!_full) {
        _ticker.stop();
        _pose.value = MascotPose.still;
        return;
      }
    }
    _pose.value = MascotPose.at(
      widget.expression,
      full: _full,
      time: elapsed,
      gesture: _gesture,
      since: since,
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _next?.cancel();
    _ticker.dispose();
    _pose.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => RepaintBoundary(
    child: CustomPaint(
      size: Size.square(widget.size),
      painter: _MascotPainter(_drawings[widget.expression]!, _pose),
    ),
  );
}

/// What moves a shape of the drawing, as its class names it in
/// `tools/brand/`.
enum _Move { ground, eye, pupil, lid, arms, zz }

/// One shape of the drawing, as `make brand` writes it: an oval or a path of
/// absolute M, L, H, V, C, Q and Z commands, filled, stroked or both, under
/// its groups' [transform], moved as [move] says, an eye's parts about the
/// centre of their [eye].
class _Shape {
  const _Shape({
    this.d,
    this.oval,
    this.fill,
    this.stroke,
    this.width = 1,
    this.cap = StrokeCap.butt,
    this.join = StrokeJoin.miter,
    this.transform,
    this.move,
    this.eye,
  });

  /// The path data, or the oval's centre and radii.
  final String? d;
  final (double, double, double, double)? oval;
  final Color? fill;
  final Color? stroke;
  final double width;
  final StrokeCap cap;
  final StrokeJoin join;
  final String? transform;
  final _Move? move;
  final Offset? eye;
}

/// Each shape's path and transform, built once.
final _built = <_Shape, (Path, Matrix4?)>{};

(Path, Matrix4?) _build(_Shape shape) => _built[shape] ??= (
  switch ((shape.d, shape.oval)) {
    (final d?, _) => _path(d),
    (_, (final cx, final cy, final rx, final ry)?) =>
      Path()..addOval(
        Rect.fromCenter(center: Offset(cx, cy), width: rx * 2, height: ry * 2),
      ),
    _ => throw StateError('a shape is an oval or a path'),
  },
  switch (shape.transform) {
    final transform? => _matrix(transform),
    null => null,
  },
);

/// The path SVG path data [d] draws, in its absolute commands.
Path _path(String d) {
  final tokens = [
    for (final match in RegExp(r'[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)').allMatches(d))
      match[0]!,
  ];
  final path = Path();
  var at = 0;
  String? command;
  var (x, y) = (0.0, 0.0);
  double next() => double.parse(tokens[at++]);
  while (at < tokens.length) {
    if (double.tryParse(tokens[at]) == null) command = tokens[at++];
    switch (command) {
      case 'M':
        path.moveTo(x = next(), y = next());
        command = 'L';
      case 'L':
        path.lineTo(x = next(), y = next());
      case 'H':
        path.lineTo(x = next(), y);
      case 'V':
        path.lineTo(x, y = next());
      case 'C':
        path.cubicTo(next(), next(), next(), next(), x = next(), y = next());
      case 'Q':
        path.quadraticBezierTo(next(), next(), x = next(), y = next());
      case 'Z':
        path.close();
        command = null;
      default:
        throw FormatException('not an absolute M, L, H, V, C, Q or Z', d);
    }
  }
  return path;
}

/// The matrix of an SVG transform list of translate, rotate and scale.
Matrix4 _matrix(String transform) {
  final matrix = Matrix4.identity();
  for (final match in RegExp(r'(\w+)\(([^)]*)\)').allMatches(transform)) {
    final a = [
      for (final n in match[2]!.trim().split(RegExp(r'[\s,]+')))
        double.parse(n),
    ];
    switch (match[1]) {
      case 'translate':
        matrix.translateByDouble(a[0], a.length > 1 ? a[1] : 0, 0, 1);
      case 'scale':
        matrix.scaleByDouble(a[0], a.length > 1 ? a[1] : a[0], 1, 1);
      case 'rotate':
        final (cx, cy) = a.length == 3 ? (a[1], a[2]) : (0.0, 0.0);
        matrix
          ..translateByDouble(cx, cy, 0, 1)
          ..rotateZ(a[0] * math.pi / 180)
          ..translateByDouble(-cx, -cy, 0, 1);
      default:
        throw FormatException('not a translate, rotate or scale', transform);
    }
  }
  return matrix;
}

/// Paints [shapes] on a 1024 square scaled to its size, posed as [pose] says.
class _MascotPainter extends CustomPainter {
  _MascotPainter(this.shapes, this.pose) : super(repaint: pose);

  final List<_Shape> shapes;
  final ValueListenable<MascotPose> pose;

  /// Where the happy one's left and right arm turn: 92% and 8% across each
  /// arm's own box and 79% down it, as the web's `transform-origin`s.
  static const _shoulders = [
    Offset(151.258, 703.374),
    Offset(872.742, 703.374),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    final now = pose.value;
    final feet = now.feet;
    var arm = 0;
    canvas
      ..save()
      ..scale(size.width / 1024);
    for (final shape in shapes) {
      final (path, matrix) = _build(shape);
      var opacity = 1.0;
      canvas.save();
      // The ground stays put while the drawing above it moves.
      if (shape.move != _Move.ground) {
        canvas
          ..translate(feet.dx, feet.dy)
          ..scale(now.width, now.height)
          ..translate(-feet.dx, -feet.dy);
      }
      if (matrix != null) canvas.transform(matrix.storage);
      switch (shape.move) {
        case _Move.eye || _Move.pupil:
          if (!now.eyesOpen) {
            canvas.restore();
            continue;
          }
          final eye = shape.eye!;
          canvas
            ..translate(eye.dx, eye.dy)
            ..scale(1, now.eyeHeight)
            ..translate(-eye.dx, -eye.dy);
          if (shape.move == _Move.pupil) {
            canvas.translate(now.glance.dx, now.glance.dy);
          }
        case _Move.lid:
          opacity = now.lid;
        case _Move.arms:
          final shoulder = _shoulders[arm];
          canvas
            ..translate(shoulder.dx, shoulder.dy)
            ..rotate(arm == 0 ? now.armsTurn : -now.armsTurn)
            ..translate(-shoulder.dx, -shoulder.dy);
          arm++;
        case _Move.zz:
          canvas.translate(now.zz.dx, now.zz.dy);
          opacity = now.zzOpacity;
        case _Move.ground || null:
      }
      if (opacity > 0) {
        if (shape.fill case final fill?) {
          canvas.drawPath(
            path,
            Paint()..color = fill.withValues(alpha: opacity),
          );
        }
        if (shape.stroke case final stroke?) {
          canvas.drawPath(
            path,
            Paint()
              ..style = PaintingStyle.stroke
              ..color = stroke.withValues(alpha: opacity)
              ..strokeWidth = shape.width
              ..strokeCap = shape.cap
              ..strokeJoin = shape.join,
          );
        }
      }
      canvas.restore();
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_MascotPainter old) =>
      old.shapes != shapes || old.pose != pose;
}
