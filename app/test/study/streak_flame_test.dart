import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/study/src/streak_flame.dart';

import '../design/harness.dart';

/// The flame of a streak of [days], at 16 square.
Widget _flame(int days) => StreakFlame(days: days, size: 16);

void main() {
  // The flame's own tests let it move; every other test holds it still.
  setUp(() => streakFlamesMove = true);
  tearDown(() => streakFlamesMove = false);

  test('a streak takes its stage at each boundary of days', () {
    for (final (days, stage) in [
      (1, FlameStage.ember),
      (2, FlameStage.ember),
      (3, FlameStage.kindling),
      (6, FlameStage.kindling),
      (7, FlameStage.steady),
      (13, FlameStage.steady),
      (14, FlameStage.blazing),
      (29, FlameStage.blazing),
      (30, FlameStage.roaring),
      (365, FlameStage.roaring),
    ]) {
      expect(FlameStage.of(days), stage, reason: '$days days');
    }
  });

  test('each stage burns brighter and moves more than the one before', () {
    final stages = FlameStage.values;
    for (var i = 1; i < stages.length; i++) {
      final (before, after) = (stages[i - 1], stages[i]);
      expect(after.fill, greaterThanOrEqualTo(before.fill), reason: '$after');
      expect(after.glow, greaterThanOrEqualTo(before.glow), reason: '$after');
      expect(after.motion, greaterThan(before.motion), reason: '$after');
      expect(after.period, lessThan(before.period), reason: '$after');
    }
    // An outline alone at first; a core and a glow from 14 days.
    expect(FlameStage.ember.fill, 0);
    expect(FlameStage.steady.core, isFalse);
    expect(FlameStage.blazing.core, isTrue);
    expect(FlameStage.blazing.glow, greaterThan(0));
  });

  for (final days in [1, 3, 7, 14, 30]) {
    testWidgets(
      'at $days days the flame burns, and holds one still frame under reduce motion',
      (tester) async {
        await pumpComponent(tester, _flame(days), settle: false);
        // It moves: its cycle keeps frames coming.
        expect(tester.hasRunningAnimations, isTrue);
        await tester.pump(const Duration(milliseconds: 300));
        expect(tester.hasRunningAnimations, isTrue);

        // Under reduce motion, no ticker runs and nothing is left to draw.
        await pumpComponent(
          tester,
          _flame(days),
          disableAnimations: true,
          settle: false,
        );
        expect(tester.hasRunningAnimations, isFalse);
        expect(tester.binding.hasScheduledFrame, isFalse);
      },
    );
  }

  testWidgets(
    'the flame stops while the app is in the background and burns again on return',
    (tester) async {
      await pumpComponent(tester, _flame(30), settle: false);
      expect(tester.hasRunningAnimations, isTrue);

      for (final state in [
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
        await tester.pump();
        expect(tester.hasRunningAnimations, isFalse, reason: '$state');
      }
      for (final state in [
        AppLifecycleState.hidden,
        AppLifecycleState.inactive,
        AppLifecycleState.resumed,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      await tester.pump();
      expect(tester.hasRunningAnimations, isTrue);
    },
  );

  testWidgets('the flame stops where its ticker mode is off', (tester) async {
    await pumpComponent(
      tester,
      TickerMode(enabled: false, child: _flame(30)),
      settle: false,
    );
    expect(tester.hasRunningAnimations, isFalse);
  });

  testWidgets('the flame is hidden from screen readers and repaints alone', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    await pumpComponent(tester, _flame(30), settle: false);
    final flame = find.byType(StreakFlame);
    expect(
      find.descendant(of: flame, matching: find.byType(ExcludeSemantics)),
      findsOneWidget,
    );
    expect(tester.getSemantics(flame).getSemanticsData().label, isEmpty);
    // Its frames repaint its own layer, not the screen around it.
    expect(
      find.descendant(of: flame, matching: find.byType(RepaintBoundary)),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('every test but the flame\'s own holds it still', (tester) async {
    streakFlamesMove = false;
    await pumpComponent(tester, _flame(30));
    expect(tester.hasRunningAnimations, isFalse);
  });
}
