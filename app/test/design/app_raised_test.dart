import 'package:flutter/material.dart';
import 'package:flutter/gestures.dart' show kPressTimeout;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/theme.dart';

import 'harness.dart';

/// How far the object holding [label] sits below its place.
double _sunk(WidgetTester tester, String label) => tester
    .widget<Transform>(
      find
          .ancestor(of: find.text(label), matching: find.byType(Transform))
          .first,
    )
    .transform
    .getTranslation()
    .y;

/// The hard edge under the object holding [label], or null with none.
BoxShadow? _edge(WidgetTester tester, String label) {
  final boxes = find.ancestor(
    of: find.text(label),
    matching: find.byType(DecoratedBox),
  );
  for (final element in boxes.evaluate()) {
    final decoration = (element.widget as DecoratedBox).decoration;
    if (decoration is BoxDecoration && decoration.boxShadow != null) {
      return decoration.boxShadow!.single;
    }
  }
  return null;
}

void main() {
  testWidgets('a primary button sits on a hard edge of its own darker colour', (
    tester,
  ) async {
    await pumpComponent(tester, AppButton(label: 'Save', onPressed: () {}));

    final edge = _edge(tester, 'Save')!;
    expect(edge.color, AppColors.light.primaryEdge);
    expect(edge.offset, const Offset(0, AppSize.edgeButton));
    expect(edge.blurRadius, 0);
    expect(_sunk(tester, 'Save'), 0);
  });

  testWidgets(
    'a press moves a button down onto its edge, and a release lifts it',
    (tester) async {
      await pumpComponent(tester, AppButton(label: 'Save', onPressed: () {}));

      final press = await tester.startGesture(
        tester.getCenter(find.text('Save')),
      );
      await tester.pump();
      expect(_sunk(tester, 'Save'), AppSize.edgeButton - AppSize.edgePressed);
      expect(_edge(tester, 'Save')!.offset.dy, AppSize.edgePressed);

      await press.up();
      await tester.pump();
      expect(_sunk(tester, 'Save'), 0);
      expect(_edge(tester, 'Save')!.offset.dy, AppSize.edgeButton);
    },
  );

  testWidgets('under reduce motion a press leaves a button in place', (
    tester,
  ) async {
    await pumpComponent(
      tester,
      AppButton(label: 'Save', onPressed: () {}),
      disableAnimations: true,
    );

    final press = await tester.startGesture(
      tester.getCenter(find.text('Save')),
    );
    await tester.pump();
    // Control: the press landed: the button's own state says so.
    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.statesController!.value, contains(WidgetState.pressed));

    expect(_sunk(tester, 'Save'), 0);
    expect(_edge(tester, 'Save')!.offset.dy, AppSize.edgeButton);
    await press.up();
  });

  testWidgets('a disabled button has no edge and does not move', (
    tester,
  ) async {
    await pumpComponent(
      tester,
      const AppButton(label: 'Save', onPressed: null),
    );

    expect(_edge(tester, 'Save'), isNull);
    final press = await tester.startGesture(
      tester.getCenter(find.text('Save')),
    );
    await tester.pump();
    expect(
      find.ancestor(of: find.text('Save'), matching: find.byType(Transform)),
      findsNothing,
    );
    await press.up();
  });

  testWidgets('a row moves down onto its edge, and a scroll lifts it again', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: lightTheme,
        home: Scaffold(
          body: ListView(
            children: [
              for (final name in ['First', 'Second'])
                AppRowSurface(
                  onTap: () {},
                  child: SizedBox(height: AppSize.tabBar, child: Text(name)),
                ),
              const SizedBox(height: 2000),
            ],
          ),
        ),
      ),
    );

    final press = await tester.startGesture(
      tester.getCenter(find.text('First')),
    );
    await tester.pump(kPressTimeout);
    expect(_sunk(tester, 'First'), AppSize.edgeRow - AppSize.edgePressed);
    // Control: the other row stays.
    expect(_sunk(tester, 'Second'), 0);

    await press.moveBy(const Offset(0, -100));
    await tester.pump();
    expect(_sunk(tester, 'First'), 0);
    await press.up();
  });
}
