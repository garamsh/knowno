import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/src/undo_snack_bar.dart';

import '../design/harness.dart';
import '../word_breaks.dart';

/// A button that offers an undo for "Gone", ended by [endOn].
class _Offer extends StatelessWidget {
  const _Offer({required this.onUndo, required this.onGone, this.endOn});

  final VoidCallback onUndo;
  final VoidCallback onGone;
  final Listenable? endOn;

  @override
  Widget build(BuildContext context) => TextButton(
    onPressed: () => showUndoSnackBar(
      context,
      message: 'Gone',
      onUndo: onUndo,
      onGone: onGone,
      endOn: endOn,
    ),
    child: const Text('Delete'),
  );
}

void main() {
  late int undone;
  late int gone;

  setUp(() {
    undone = 0;
    gone = 0;
  });

  Future<void> offer(
    WidgetTester tester, {
    Listenable? endOn,
    VoidCallback? onUndo,
  }) async {
    await pumpComponent(
      tester,
      _Offer(
        onUndo: onUndo ?? () => undone++,
        onGone: () => gone++,
        endOn: endOn,
      ),
    );
    await tester.tap(shownText('Delete'));
    await tester.pumpAndSettle();
    expect(shownText('Gone'), findsOneWidget);
  }

  /// Lets the whole offer's time pass, then its bar's exit.
  Future<void> outlast(WidgetTester tester) async {
    await tester.pump(undoDuration);
    await tester.pumpAndSettle();
  }

  testWidgets('the bar goes after its time, and is then let go', (
    tester,
  ) async {
    await offer(tester);
    await tester.pump(undoDuration - const Duration(milliseconds: 100));
    expect(shownText('Gone'), findsOneWidget);
    await outlast(tester);
    expect(shownText('Gone'), findsNothing);
    expect((undone, gone), (0, 1));
  });

  testWidgets(
    'the bar stays while a screen reader is on, and counts its time again once it is off',
    (tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(accessibleNavigation: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      await offer(tester);
      await outlast(tester);
      await outlast(tester);
      expect(shownText('Gone'), findsOneWidget);

      tester.platformDispatcher.clearAccessibilityFeaturesTestValue();
      await tester.pump();
      await outlast(tester);
      expect(shownText('Gone'), findsNothing);
      expect((undone, gone), (0, 1));
    },
  );

  testWidgets(
    'the bar stays while its Undo has the focus, and counts its time again once the focus leaves',
    (tester) async {
      await offer(tester);
      Focus.of(tester.element(find.text('Undo'))).requestFocus();
      await tester.pump();
      expect(Focus.of(tester.element(find.text('Undo'))).hasFocus, isTrue);
      await outlast(tester);
      await outlast(tester);
      expect(shownText('Gone'), findsOneWidget);

      Focus.of(tester.element(shownText('Delete'))).requestFocus();
      await tester.pump();
      await outlast(tester);
      expect(shownText('Gone'), findsNothing);
      expect((undone, gone), (0, 1));
    },
  );

  testWidgets('the bar goes at once on what it is ended by', (tester) async {
    final edits = ValueNotifier(0);
    addTearDown(edits.dispose);
    await offer(tester, endOn: edits);
    edits.value++;
    await tester.pumpAndSettle();
    expect(shownText('Gone'), findsNothing);
    expect((undone, gone), (0, 1));
  });

  testWidgets(
    'an undo whose own change notifies what ends the bar is not let go, with a screen reader on',
    (tester) async {
      // A screen reader takes the bar out at once, so whatever hides it first
      // names why it went.
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(accessibleNavigation: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );
      final edits = ValueNotifier(0);
      addTearDown(edits.dispose);
      await offer(
        tester,
        endOn: edits,
        onUndo: () {
          undone++;
          edits.value++;
        },
      );
      await tester.tap(find.text('Undo'));
      await tester.pumpAndSettle();
      expect(shownText('Gone'), findsNothing);
      expect((undone, gone), (1, 0));
    },
  );

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale the message sits beside Undo '
      'while both fit on a line, and otherwise above it, breaking only '
      'between words',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const message = '삭제한 칸을 되돌릴 수 있어요';
        await pumpComponent(
          tester,
          Builder(
            builder: (context) => TextButton(
              onPressed: () =>
                  showUndoSnackBar(context, message: message, onUndo: () {}),
              child: const Text('Delete'),
            ),
          ),
        );
        await tester.tap(find.text('Delete'));
        await tester.pumpAndSettle();

        final said = tester.getRect(shownText(message));
        final undo = tester.getRect(find.text('Undo'));
        if (scale == 1.0) {
          expect(undo.top, lessThan(said.bottom), reason: 'one line');
        } else {
          expect(undo.top, greaterThanOrEqualTo(said.bottom), reason: 'below');
          expectBreaksBetweenWords(tester, message);
        }
      },
    );
  }
}
