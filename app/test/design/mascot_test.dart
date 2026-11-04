import 'dart:io';
import 'dart:math';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';

import 'harness.dart';

const _ms = Duration(milliseconds: 1);

/// The asset the still mascot draws, or null where it is painted instead.
String? _asset(WidgetTester tester) {
  final images = find.descendant(
    of: find.byType(Mascot),
    matching: find.byType(Image),
  );
  if (images.evaluate().isEmpty) return null;
  return (tester.widget<Image>(images).image as AssetImage).assetName;
}

/// What the repaint boundary [key] holds, as [tester] painted it.
Future<img.Image> _painted(WidgetTester tester, Key key) async {
  final boundary =
      tester.renderObject(find.byKey(key)) as RenderRepaintBoundary;
  final bytes = await tester.runAsync(() async {
    final image = await boundary.toImage();
    final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
    image.dispose();
    return data!;
  });
  return img.Image.fromBytes(
    width: boundary.size.width.round(),
    height: boundary.size.height.round(),
    bytes: bytes!.buffer,
    numChannels: 4,
    order: img.ChannelOrder.rgba,
  );
}

/// The mean difference per channel, out of 255, between [a] and [b] over
/// white.
double _difference(img.Image a, img.Image b) {
  final white = img.ColorRgb8(255, 255, 255);
  img.Image flat(img.Image image) => img.compositeImage(
    img.Image(
      width: image.width,
      height: image.height,
      numChannels: 3,
      backgroundColor: white,
    ),
    image,
  );
  final (left, right) = (flat(a), flat(b));
  var total = 0.0;
  for (final pixel in left) {
    final other = right.getPixel(pixel.x, pixel.y);
    total +=
        (pixel.r - other.r).abs() +
        (pixel.g - other.g).abs() +
        (pixel.b - other.b).abs();
  }
  return total / (left.width * left.height * 3);
}

void main() {
  // The mascot's own tests let it move; every other test holds it still.
  setUp(() => mascotsMove = true);
  tearDown(() => mascotsMove = false);

  for (final expression in MascotExpression.values) {
    test('${expression.name} is bundled at every density', () {
      for (final density in ['', '2.0x/', '3.0x/']) {
        final file = File(
          'assets/brand/${density}knowno-${expression.name}.png',
        );
        expect(file.existsSync(), isTrue, reason: file.path);
      }
    });

    testWidgets('${expression.name} at 40 is its own still file, unread by a '
        'screen reader', (tester) async {
      final semantics = tester.ensureSemantics();
      await pumpComponent(
        tester,
        Mascot(expression: expression, size: 40),
        settle: false,
      );

      expect(_asset(tester), 'assets/brand/knowno-${expression.name}.png');
      expect(
        find.descendant(
          of: find.byType(Mascot),
          matching: find.byType(ExcludeSemantics),
        ),
        findsOneWidget,
      );
      await tester.pump(const Duration(seconds: 10));
      expect(tester.hasRunningAnimations, isFalse);
      semantics.dispose();
    });

    testWidgets('${expression.name} at 200 under reduce motion is its still '
        'file, and nothing moves or waits to', (tester) async {
      await pumpComponent(
        tester,
        Mascot(expression: expression, size: 200),
        disableAnimations: true,
        settle: false,
      );
      expect(_asset(tester), 'assets/brand/knowno-${expression.name}.png');
      expect(tester.hasRunningAnimations, isFalse);

      // Past the longest wait for a blink, no blink has started.
      await tester.pump(const Duration(seconds: 8));
      expect(tester.hasRunningAnimations, isFalse);
      expect(tester.binding.hasScheduledFrame, isFalse);

      // Control: with reduce motion off, the same mascot moves.
      await pumpComponent(
        tester,
        Mascot(expression: expression, size: 200),
        settle: false,
      );
      expect(_asset(tester), isNull);
      expect(tester.hasRunningAnimations, isTrue);
    });

    testWidgets('${expression.name} at rest paints its still file', (
      tester,
    ) async {
      const key = Key('mascot');
      // A muted ticker holds the moving mascot at rest.
      await pumpComponent(
        tester,
        TickerMode(
          enabled: false,
          child: RepaintBoundary(
            key: key,
            child: Mascot(expression: expression, size: 200),
          ),
        ),
        settle: false,
      );
      expect(_asset(tester), isNull);
      final painted = await _painted(tester, key);
      img.Image file(MascotExpression expression) => img.copyResize(
        img.decodePng(
          File('assets/brand/3.0x/knowno-${expression.name}.png')
              .readAsBytesSync(),
        )!,
        width: painted.width,
        height: painted.height,
        interpolation: img.Interpolation.average,
      );

      expect(_difference(painted, file(expression)), lessThan(2));
      // Control: the comparison tells one expression from another.
      final other = MascotExpression.values[(expression.index + 1) % 4];
      expect(_difference(painted, file(other)), greaterThan(2));
    });
  }

  testWidgets('from 41 to 199 a mascot with open eyes blinks, ticking only '
      'through a blink', (tester) async {
    await pumpComponent(
      tester,
      const Mascot(
        expression: MascotExpression.thinking,
        size: AppSize.mascotMedium,
      ),
      settle: false,
    );
    expect(_asset(tester), isNull);
    expect(tester.hasRunningAnimations, isFalse);

    // A gesture starts within 7 s and is over within 1.7 s.
    await tester.pump(const Duration(seconds: 7));
    expect(tester.hasRunningAnimations, isTrue);
    await tester.pump(const Duration(milliseconds: 1700));
    expect(tester.hasRunningAnimations, isFalse);
  });

  for (final expression in [MascotExpression.happy, MascotExpression.sleepy]) {
    testWidgets('below 200, ${expression.name}, with no open eyes, is still', (
      tester,
    ) async {
      await pumpComponent(
        tester,
        Mascot(expression: expression, size: 199),
        settle: false,
      );
      expect(_asset(tester), 'assets/brand/knowno-${expression.name}.png');
      // Control: at 200 it moves.
      await pumpComponent(
        tester,
        Mascot(expression: expression, size: 200),
        settle: false,
      );
      expect(_asset(tester), isNull);
    });
  }

  testWidgets('a moving mascot repaints its own layer alone', (tester) async {
    await pumpComponent(
      tester,
      const Mascot(expression: MascotExpression.thinking, size: 200),
      settle: false,
    );
    expect(
      find.descendant(
        of: find.byType(Mascot),
        matching: find.byType(RepaintBoundary),
      ),
      findsOneWidget,
    );
  });

  testWidgets('the ticker and the next gesture go when the mascot does', (
    tester,
  ) async {
    await pumpComponent(
      tester,
      const Mascot(expression: MascotExpression.thinking, size: 200),
      settle: false,
    );
    expect(tester.hasRunningAnimations, isTrue);

    await pumpComponent(tester, const SizedBox(), settle: false);
    expect(tester.hasRunningAnimations, isFalse);
    // A blink left scheduled would fire here, and the test would also fail
    // on a timer pending after the tree is disposed.
    await tester.pump(const Duration(seconds: 8));
    expect(tester.binding.hasScheduledFrame, isFalse);
  });

  testWidgets('a mascot stops where its ticker mode is off, and moves again '
      'where it is on', (tester) async {
    Widget mascot(bool enabled) => TickerMode(
      enabled: enabled,
      child: const Mascot(expression: MascotExpression.thinking, size: 200),
    );
    await pumpComponent(tester, mascot(false), settle: false);
    expect(tester.hasRunningAnimations, isFalse);
    await tester.pump(const Duration(seconds: 8));
    expect(tester.binding.hasScheduledFrame, isFalse);

    await pumpComponent(tester, mascot(true), settle: false);
    expect(tester.hasRunningAnimations, isTrue);
  });

  testWidgets('a mascot starts no blink while its ticker mode is off', (
    tester,
  ) async {
    Widget mascot(bool enabled) => TickerMode(
      enabled: enabled,
      child: const Mascot(
        expression: MascotExpression.thinking,
        size: AppSize.mascotMedium,
      ),
    );
    await pumpComponent(tester, mascot(false), settle: false);
    // Past the longest wait for a blink.
    await tester.pump(const Duration(seconds: 8));

    // Back on, a blink left from the wait would tick at once.
    await pumpComponent(tester, mascot(true), settle: false);
    expect(tester.hasRunningAnimations, isFalse);
    // Control: on, it blinks within its wait.
    await tester.pump(const Duration(seconds: 7));
    expect(tester.hasRunningAnimations, isTrue);
  });

  testWidgets('a mascot stops while the app is in the background', (
    tester,
  ) async {
    await pumpComponent(
      tester,
      const Mascot(expression: MascotExpression.thinking, size: 200),
      settle: false,
    );
    expect(tester.hasRunningAnimations, isTrue);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(tester.hasRunningAnimations, isFalse);
    await tester.pump(const Duration(seconds: 8));
    expect(tester.binding.hasScheduledFrame, isFalse);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(tester.hasRunningAnimations, isTrue);
  });

  group('a blink', () {
    MascotPose blink(Duration since, {int hold = 110, bool twice = false}) =>
        MascotPose.at(
          MascotExpression.thinking,
          full: false,
          time: Duration.zero,
          gesture: MascotBlink(
            hold: Duration(milliseconds: hold),
            twice: twice,
          ),
          since: since,
        );

    test('shuts the eyes within 70 ms behind the lids, and opens them '
        'again 60 ms after its hold', () {
      expect(blink(Duration.zero).eyeHeight, 1);
      expect(blink(Duration.zero).lid, 0);
      final shut = blink(_ms * 70);
      expect(shut.eyeHeight, closeTo(0.05, 1e-9));
      expect(shut.eyesOpen, isFalse);
      expect(shut.lid, 1);
      expect(blink(_ms * 100).eyesOpen, isFalse);
      final open = blink(_ms * 170);
      expect(open.eyeHeight, 1);
      expect(open.eyesOpen, isTrue);
      expect(open.lid, 0);
      expect(MascotBlink(hold: _ms * 110, twice: false).length, _ms * 170);
    });

    test('twice shuts the eyes again after a beat', () {
      expect(blink(_ms * 250, twice: true).eyesOpen, isTrue);
      expect(blink(_ms * 350, twice: true).eyesOpen, isFalse);
      expect(blink(_ms * 450, twice: true).eyeHeight, 1);
      expect(MascotBlink(hold: _ms * 110, twice: true).length, _ms * 450);
    });

    test('of a sad mascot holds 160 ms', () {
      final random = Random(1);
      for (var i = 0; i < 200; i++) {
        final gesture = MascotGesture.next(MascotExpression.sad, random);
        if (gesture is MascotBlink) expect(gesture.hold, _ms * 160);
        expect(gesture, isNot(isA<MascotGlance>()));
      }
      expect(blink(_ms * 150, hold: 160).eyesOpen, isFalse);
    });
  });

  test('about one gesture in five is a double blink, and a thinking '
      'mascot glances at most 22 across and 14 up or down', () {
    final random = Random(7);
    const draws = 10000;
    var twice = 0;
    var glances = 0;
    for (var i = 0; i < draws; i++) {
      switch (MascotGesture.next(MascotExpression.thinking, random)) {
        case MascotBlink(twice: true):
          twice++;
        case MascotGlance(:final to):
          glances++;
          expect(to.dx.abs(), lessThanOrEqualTo(22));
          expect(to.dy.abs(), lessThanOrEqualTo(14));
        case _:
      }
    }
    expect(twice / draws, closeTo(0.2, 0.02));
    expect(glances / draws, closeTo(0.12, 0.02));
  });

  test('a glance moves the pupils out in 260 ms and back from 1.4 s', () {
    MascotPose at(int ms) => MascotPose.at(
      MascotExpression.thinking,
      full: false,
      time: Duration.zero,
      gesture: const MascotGlance(Offset(20, -10)),
      since: _ms * ms,
    );
    expect(at(0).glance, Offset.zero);
    expect(at(260).glance, const Offset(20, -10));
    expect(at(1400).glance, const Offset(20, -10));
    expect(at(1660).glance, Offset.zero);
  });

  test('each loop breathes about the feet within its spec, and comes round '
      'to the drawing', () {
    MascotPose at(MascotExpression expression, double seconds) => MascotPose.at(
      expression,
      full: true,
      time: Duration(microseconds: (seconds * 1e6).round()),
    );
    for (final (expression, period, width, height) in [
      (MascotExpression.thinking, 3.0, 1.012, 0.982),
      (MascotExpression.sad, 3.0, 1.012, 0.982),
      (MascotExpression.sleepy, 4.2, 1.02, 0.97),
    ]) {
      expect(at(expression, 0).height, 1, reason: '$expression');
      final deepest = at(expression, period / 2);
      expect(deepest.width, closeTo(width, 1e-9), reason: '$expression');
      expect(deepest.height, closeTo(height, 1e-9), reason: '$expression');
      expect(at(expression, period).height, closeTo(1, 1e-9));
    }
    final sleepy = at(MascotExpression.sleepy, 0);
    expect(sleepy.zzOpacity, 0);
    expect(at(MascotExpression.sleepy, 2.1).zzOpacity, 1);
  });

  test('the happy one wobbles on 1.8 s: squashed, stretched, settling by '
      '0.61 and still to the loop\'s end, its arms swinging after', () {
    MascotPose at(double share) => MascotPose.at(
      MascotExpression.happy,
      full: true,
      time: Duration(microseconds: (share * 1.8 * 1e6).round()),
    );
    for (final (share, width, height) in [
      (0.0, 1.0, 1.0),
      (0.11, 1.12, 0.85),
      (0.26, 0.91, 1.11),
      (0.37, 1.06, 0.95),
      (0.46, 0.97, 1.03),
      (0.54, 1.015, 0.99),
      (0.61, 1.0, 1.0),
      (0.8, 1.0, 1.0),
      (1.0, 1.0, 1.0),
    ]) {
      final pose = at(share);
      expect(pose.width, closeTo(width, 1e-6), reason: 'width at $share');
      expect(pose.height, closeTo(height, 1e-6), reason: 'height at $share');
    }
    for (final (share, degrees) in [
      (0.0, 0.0),
      (0.12, -10.0),
      (0.28, 14.0),
      (0.4, -4.0),
      (0.52, 2.0),
      (0.62, 0.0),
      (0.9, 0.0),
    ]) {
      expect(
        at(share).armsTurn,
        closeTo(degrees * pi / 180, 1e-3),
        reason: 'arms at $share',
      );
    }
    // Between keys it follows the reference's curves: the stretch out of
    // the squash overshoots on cubic-bezier(.2, .9, .3, 1.25).
    expect(
      at(0.11 + 0.15 * 0.8).height,
      greaterThan(1.11),
      reason: 'the stretch overshoots before it settles at 0.26',
    );
  });

  testWidgets('the happy one\'s ground ticks stay still while it squashes, '
      'against its body, which moves', (tester) async {
    const key = Key('happy');
    await pumpComponent(
      tester,
      const RepaintBoundary(
        key: key,
        child: Mascot(expression: MascotExpression.happy, size: 400),
      ),
      settle: false,
    );
    expect(_asset(tester), isNull, reason: 'setup: it moves');
    final rest = await _painted(tester, key);
    // The deepest squash, 0.11 into the 1.8 s loop.
    await tester.pump(const Duration(milliseconds: 198));
    final squashed = await _painted(tester, key);

    img.Image crop(img.Image image, Rect units) {
      final scale = image.width / 1024;
      return img.copyCrop(
        image,
        x: (units.left * scale).round(),
        y: (units.top * scale).round(),
        width: (units.width * scale).round(),
        height: (units.height * scale).round(),
      );
    }

    for (final ticks in [
      const Rect.fromLTRB(190, 896, 274, 978),
      const Rect.fromLTRB(758, 900, 842, 982),
    ]) {
      expect(
        _difference(crop(rest, ticks), crop(squashed, ticks)),
        0,
        reason: 'the ticks at $ticks stay still',
      );
    }
    const body = Rect.fromLTRB(300, 120, 720, 300);
    expect(
      _difference(crop(rest, body), crop(squashed, body)),
      greaterThan(1),
      reason: 'control: the body squashes',
    );
  });
}
