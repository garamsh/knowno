import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/design/app_choice.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/theme.dart';

import '../app_fonts.dart';
import '../word_breaks.dart';
import 'harness.dart';

void main() {
  setUpAll(loadAppFonts);

  for (final (language, title, value) in [
    ('English', 'Daily study time', '20 min'),
    ('Korean', '하루 학습 시간', '20분'),
  ]) {
    for (final scale in [1.0, 3.12]) {
      testWidgets(
        'on a 390 wide phone at text scale $scale, in the bundled fonts, a $language choice row '
        'keeps its title, value and chevron inside it, side by side at 1.0 '
        'and the value under the title at its end at 3.12',
        (tester) async {
          tester.view
            ..physicalSize = const Size(390, 844)
            ..devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          await pumpComponent(
            tester,
            AppChoiceRow(title: title, value: value, onTap: () {}),
          );

          expect(tester.takeException(), isNull, reason: 'nothing overflows');
          final row = tester.getRect(find.byType(AppChoiceRow));
          final named = tester.getRect(shownText(title));
          final chosen = tester.getRect(find.text(value));
          final chevron = tester.getRect(find.byType(Icon));
          for (final part in [named, chosen, chevron]) {
            expect(part.left, greaterThanOrEqualTo(row.left));
            expect(part.right, lessThanOrEqualTo(row.right));
            expect(part.bottom, lessThanOrEqualTo(row.bottom));
          }
          expect(
            chevron.right,
            moreOrLessEquals(row.right - AppListRow.inset.right, epsilon: 1),
            reason: "the chevron ends on the row's inset",
          );
          if (scale == 1.0) {
            expect(
              chosen.center.dy,
              moreOrLessEquals(named.center.dy, epsilon: 1),
              reason: 'one line',
            );
          } else {
            expect(chosen.top, greaterThanOrEqualTo(named.bottom));
          }
        },
      );
    }
  }

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale, a short title keeps the row\'s '
      'start when a long value goes under it, the value at the row\'s end',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const value =
            'A · a very long first cell of a sheet that goes on and on';
        await pumpComponent(
          tester,
          AppChoiceRow(title: '앞면', value: value, onTap: () {}),
        );

        expect(tester.takeException(), isNull);
        final row = tester.getRect(find.byType(AppChoiceRow));
        final named = tester.getRect(shownText('앞면'));
        final chosen = tester.getRect(find.text(value));
        final chevron = tester.getRect(find.byType(Icon));
        expect(
          chosen.top,
          greaterThanOrEqualTo(named.bottom),
          reason: 'setup: the value went under the title',
        );
        expect(
          named.left,
          moreOrLessEquals(row.left + AppListRow.inset.left, epsilon: 0.5),
          reason: "the title stays on the row's start",
        );
        expect(
          chevron.right,
          moreOrLessEquals(row.right - AppListRow.inset.right, epsilon: 0.5),
          reason: "the value's chevron ends on the row's end",
        );
      },
    );
  }

  testWidgets('a choice row with no action reads as disabled and draws its '
      'title and chevron muted, against an enabled one', (tester) async {
    final semantics = tester.ensureSemantics();
    await pumpComponent(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppChoiceRow(title: 'On', value: 'a', onTap: () {}),
          const AppChoiceRow(title: 'Off', value: 'b', onTap: null),
        ],
      ),
    );
    final colors = AppColors.light;
    Color? drawn(Finder text) => tester.widget<Text>(text).style?.color;
    Color? chevron(String title) => tester
        .widget<RichText>(
          find.descendant(
            of: find.ancestor(
              of: shownText(title),
              matching: find.byType(AppChoiceRow),
            ),
            matching: find.descendant(
              of: find.byType(Icon),
              matching: find.byType(RichText),
            ),
          ),
        )
        .text
        .style
        ?.color;

    expect(drawn(shownText('On')), isNot(colors.muted), reason: 'control');
    expect(chevron('On'), isNot(colors.muted), reason: 'control');
    expect(drawn(shownText('Off')), colors.muted);
    expect(drawn(find.text('b')), colors.muted);
    expect(chevron('Off'), colors.muted);
    expect(
      tester.getSemantics(
        find.ancestor(of: shownText('On'), matching: find.byType(AppChoiceRow)),
      ),
      isSemantics(isButton: true, hasEnabledState: true, isEnabled: true),
    );
    expect(
      tester.getSemantics(
        find.ancestor(
          of: shownText('Off'),
          matching: find.byType(AppChoiceRow),
        ),
      ),
      isSemantics(isButton: true, hasEnabledState: true, isEnabled: false),
    );
    semantics.dispose();
  });

  testWidgets(
    'on a 390 wide phone a value too long for its line is cut with an ellipsis, under '
    'the title, and the row reads as one button with its title and value',
    (tester) async {
      tester.view
        ..physicalSize = const Size(390, 844)
        ..devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      final semantics = tester.ensureSemantics();
      const value = 'A · a very long first cell of a sheet that goes on and on';
      await pumpComponent(
        tester,
        AppChoiceRow(title: 'Front', value: value, onTap: () {}),
      );

      expect(tester.takeException(), isNull);
      final row = tester.getRect(find.byType(AppChoiceRow));
      expect(tester.getRect(find.text(value)).right, lessThan(row.right));
      expect(
        tester.getRect(find.text(value)).top,
        greaterThanOrEqualTo(tester.getRect(shownText('Front')).bottom),
      );
      expect(
        tester.getSemantics(find.byType(AppChoiceRow)),
        isSemantics(label: 'Front\n$value', isButton: true, hasTapAction: true),
      );
      semantics.dispose();
    },
  );

  testWidgets('the choice sheet checks the current option, resolves to the '
      'one tapped, a null value included, and to null when dismissed', (
    tester,
  ) async {
    final results = <({String? value})?>[];
    await pumpComponent(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () async => results.add(
            await showAppChoice<String?>(
              context,
              title: 'Column',
              options: const [
                (title: 'None', value: null),
                (title: 'A', value: 'a'),
                (title: 'B', value: 'b'),
              ],
              current: (value: 'a'),
            ),
          ),
          child: const Text('open'),
        ),
      ),
    );
    Future<void> open() async {
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    await open();
    AppListRow row(String title) =>
        tester.widget<AppListRow>(find.widgetWithText(AppListRow, title));
    expect(
      [
        for (final title in ['None', 'A', 'B']) row(title).selected,
      ],
      [false, true, false],
    );
    expect(
      [
        for (final title in ['None', 'A', 'B'])
          find
              .descendant(
                of: find.widgetWithText(AppListRow, title),
                matching: find.byIcon(LucideIcons.check),
              )
              .evaluate()
              .isNotEmpty,
      ],
      [false, true, false],
      reason: 'the current one alone is checked',
    );
    await tester.tap(find.text('None'));
    await tester.pumpAndSettle();
    await open();
    await tester.tap(find.text('B'));
    await tester.pumpAndSettle();
    await open();
    await tester.tapAt(const Offset(8, 8));
    await tester.pumpAndSettle();

    expect(results, [(value: null), (value: 'b'), null]);
  });

  testWidgets('with no current option the sheet checks none and marks no row '
      'selectable', (tester) async {
    await pumpComponent(
      tester,
      Builder(
        builder: (context) => TextButton(
          onPressed: () => showAppChoice<int>(
            context,
            title: 'Add',
            options: const [(title: 'By hand', value: 1)],
          ),
          child: const Text('open'),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final row = tester.widget<AppListRow>(find.byType(AppListRow));
    expect((row.selected, row.trailing), (null, null));
  });
}
