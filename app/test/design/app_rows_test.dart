import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_section_label.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';
import '../word_breaks.dart';
import 'harness.dart';

/// The fill of the nearest [Material] around [finder].
Color? _fill(WidgetTester tester, Finder finder) => tester
    .widget<Material>(
      find.ancestor(of: finder, matching: find.byType(Material)).first,
    )
    .color;

void main() {
  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets(
      'in ${mode.name} a row is a surface on the ground, and on a sheet takes the ground',
      (tester) async {
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const AppSectionLabel('My decks 2'),
              AppListRow(title: 'French', subtitle: '3 cards', onTap: () {}),
              AppListRow(title: 'German', onTap: () {}),
            ],
          ),
          themeMode: mode,
        );

        expect(_fill(tester, find.text('French')), colors.surface);
        expect(_fill(tester, find.text('German')), colors.surface);
        expect(
          tester.getSemantics(find.text('My decks 2')),
          isSemantics(isHeader: true, label: 'My decks 2'),
        );
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );

    testWidgets(
      'in ${mode.name} a destructive row draws its title and icon in red, and a plain row in ink',
      (tester) async {
        await pumpComponent(
          tester,
          Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              AppListRow(
                title: 'Delete account',
                subtitle: 'This removes everything.',
                leading: const Icon(Icons.delete_forever_outlined),
                destructive: true,
                onTap: () {},
              ),
              AppListRow(
                title: 'Sign out',
                leading: const Icon(Icons.logout),
                onTap: () {},
              ),
            ],
          ),
          themeMode: mode,
        );

        Color? textColor(String text) => tester
            .renderObject<RenderParagraph>(
              find.descendant(
                of: shownText(text),
                matching: find.byType(RichText),
              ),
            )
            .text
            .style
            ?.color;
        Color? iconColor(IconData icon) => tester
            .renderObject<RenderParagraph>(
              find.descendant(
                of: find.byIcon(icon),
                matching: find.byType(RichText),
              ),
            )
            .text
            .style
            ?.color;
        expect(textColor('Delete account'), colors.dontKnowText);
        expect(iconColor(Icons.delete_forever_outlined), colors.dontKnowText);
        expect(textColor('This removes everything.'), colors.muted);
        expect(textColor('Sign out'), isNot(colors.dontKnowText));
        expect(iconColor(Icons.logout), isNot(colors.dontKnowText));
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
      },
    );

    testWidgets('in ${mode.name} every chip is one style: fully round, the '
        'section type, in its tone, a selected one in the brand tint', (
      tester,
    ) async {
      await pumpComponent(
        tester,
        Wrap(
          children: [
            const AppChip(label: 'Today 3', tone: AppChipTone.brand),
            const AppChip(label: 'Public'),
            const AppChip(label: 'Below', tone: AppChipTone.amber),
            const AppChip(label: 'Know', tone: AppChipTone.know),
            const AppChip(label: "Don't know", tone: AppChipTone.dontKnow),
            AppChip.action(label: 'Add row', onPressed: () {}),
            AppChip.action(label: 'Blank', selected: true, onPressed: () {}),
            AppChip.action(label: 'Noun', selected: false, onPressed: () {}),
          ],
        ),
        themeMode: mode,
      );

      /// The fill and shape [label]'s chip is drawn with.
      (Color?, ShapeBorder?) drawn(String label) {
        final box = find.ancestor(
          of: find.text(label),
          matching: find.byType(DecoratedBox),
        );
        if (box.evaluate().isNotEmpty) {
          final decoration =
              tester.widget<DecoratedBox>(box.first).decoration
                  as ShapeDecoration;
          return (decoration.color, decoration.shape);
        }
        final material = tester.widget<Material>(
          find
              .ancestor(of: find.text(label), matching: find.byType(Material))
              .first,
        );
        return (material.color, material.shape);
      }

      RoundedRectangleBorder shape(Color side) => RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.chip),
        side: BorderSide(color: side),
      );
      for (final (label, fill) in [
        ('Today 3', colors.brandTint),
        ('Public', colors.raised),
        ('Below', colors.tintAmber),
        ('Know', colors.know),
        ("Don't know", colors.dontKnowText),
        ('Add row', colors.raised),
        ('Blank', colors.brandTint),
        ('Noun', colors.raised),
      ]) {
        final outline = fill;
        expect(drawn(label), (fill, shape(outline)), reason: label);
        expect(
          tester.widget<Text>(find.text(label)).style?.fontSize,
          AppType.section.fontSize,
          reason: label,
        );
      }
      expect(
        tester.getSemantics(find.text('Blank')),
        matchesSemantics(
          label: 'Blank',
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          hasSelectedState: true,
          isSelected: true,
          hasTapAction: true,
          isFocusable: true,
          hasFocusAction: true,
        ),
      );
      await meetsGuidelines(tester);
      expectScreenTextReadable(tester);
    });
  }

  testWidgets('an action chip acts on a tap on it and in the space that makes '
      'up its tap target, and a disabled one is muted and does nothing', (
    tester,
  ) async {
    var presses = 0;
    await pumpComponent(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppChip.action(label: 'Add row', onPressed: () => presses++),
          const AppChip.action(label: 'Blank', onPressed: null),
        ],
      ),
    );
    final target = tester.getRect(find.byType(AppChip).first);
    final face = tester.getRect(
      find
          .ancestor(of: find.text('Add row'), matching: find.byType(Material))
          .first,
    );
    expect(target.height, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(face.height, lessThan(target.height), reason: 'a small chip');

    await tester.tap(find.text('Add row'));
    await tester.tapAt(Offset(face.center.dx, (target.top + face.top) / 2));
    expect(presses, 2);

    await tester.tap(find.text('Blank'));
    expect(presses, 2);
    expect(
      tester.widget<Text>(find.text('Blank')).style?.color,
      AppColors.light.muted,
    );
  });

  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets('in ${mode.name} a pressed row dims under the ink, with no '
        'splash', (tester) async {
      await pumpComponent(
        tester,
        AppGroup(
          children: [AppListRow(title: 'Theme', onTap: () {})],
        ),
        themeMode: mode,
      );
      final ink = tester.renderObject(
        find
            .ancestor(
              of: find.text('Theme'),
              matching: find.byWidgetPredicate(
                (widget) => widget.runtimeType.toString() == '_InkFeatures',
              ),
            )
            .first,
      );
      final gesture = await tester.startGesture(
        tester.getCenter(find.text('Theme')),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      // The highlight paints its colour at an 8-bit alpha.
      expect(
        ink,
        paints..rect(color: colors.ink.withAlpha((0.1 * 255).round())),
      );
      expect(ink, paintsExactlyCountTimes(#drawCircle, 0));
      await gesture.up();
      await tester.pumpAndSettle();
    });
  }

  for (final (name, group) in [
    (
      'a group',
      (List<Widget> rows) =>
          SingleChildScrollView(child: AppGroup(children: rows)),
    ),
    (
      'a sliver group',
      (List<Widget> rows) =>
          CustomScrollView(slivers: [SliverAppGroup(children: rows)]),
    ),
  ]) {
    testWidgets(
      'in $name the rows share one surface rounded at its ends, with no surface or gap of their own, split by a hairline under all but the first, where a row alone keeps its own',
      (tester) async {
        final colors = themeModes[ThemeMode.light]!;
        // Control: a row alone is its own rounded surface over the row gap.
        await pumpComponent(tester, AppListRow(title: 'Alone', onTap: () {}));
        final alone = tester.widget<Material>(
          find
              .ancestor(of: find.text('Alone'), matching: find.byType(Material))
              .first,
        );
        expect(alone.color, colors.surface);
        expect(alone.borderRadius, BorderRadius.circular(AppRadius.row));

        await pumpComponent(
          tester,
          group([
            AppListRow(title: 'First', onTap: () {}),
            AppListRow(title: 'Second', onTap: () {}),
            const AppRowSurface(child: Text('Third')),
          ]),
        );
        for (final (index, row) in ['First', 'Second', 'Third'].indexed) {
          final materials = tester
              .widgetList<Material>(
                find.ancestor(
                  of: find.text(row),
                  matching: find.byType(Material),
                ),
              )
              .toList();
          // The row's own is see-through; the group's share is the surface.
          expect(materials[0].type, MaterialType.transparency, reason: row);
          expect(materials[1].color, colors.surface, reason: row);
          expect(
            materials[1].borderRadius,
            BorderRadius.vertical(
              top: index == 0
                  ? const Radius.circular(AppRadius.group)
                  : Radius.zero,
              bottom: index == 2
                  ? const Radius.circular(AppRadius.group)
                  : Radius.zero,
            ),
            reason: row,
          );
        }
        final dividers = tester.widgetList<Divider>(find.byType(Divider));
        expect(dividers, hasLength(2));
        expect({for (final line in dividers) line.color}, {colors.hairline});
        final lines = [
          for (final element in find.byType(Divider).evaluate())
            tester.getRect(find.byWidget(element.widget)).center.dy,
        ];
        double top(String row) => tester.getRect(find.text(row)).top;
        double bottom(String row) => tester.getRect(find.text(row)).bottom;
        expect(lines[0], inExclusiveRange(bottom('First'), top('Second')));
        expect(lines[1], inExclusiveRange(bottom('Second'), top('Third')));
      },
    );
  }

  testWidgets(
    'a row reads as one node, answers a tap and a long press, and states selection',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final events = <String>[];
      await pumpComponent(
        tester,
        AppListRow(
          title: 'French',
          subtitle: '3 cards',
          selected: true,
          onTap: () => events.add('tap'),
          onLongPress: () => events.add('long'),
        ),
      );

      await tester.tap(find.text('French'));
      await tester.longPress(shownText('3 cards'));

      expect(events, ['tap', 'long']);
      expect(
        tester.getSemantics(find.text('French')),
        isSemantics(
          label: 'French\n3 cards',
          hasSelectedState: true,
          isSelected: true,
          hasTapAction: true,
          hasLongPressAction: true,
        ),
      );
      semantics.dispose();
    },
  );

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'on a 390 wide phone at text scale $scale a row\'s Korean subtitle breaks only between words and is read as written, and a word wider than the line still wraps',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        final semantics = tester.ensureSemantics();
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        const subtitle = '계정을 삭제하면 서버와 이 기기에 있는 카드와 기록이 모두 지워져요. 되돌릴 수 없어요.';
        // The control: one word, so it can break only inside itself.
        const word = '계정을삭제하면서버와이기기에있는카드와기록이모두지워져요되돌릴수없어요';
        await pumpComponent(
          tester,
          Column(
            children: [
              AppListRow(title: '계정 삭제', subtitle: subtitle, onTap: () {}),
              AppListRow(title: '제목', subtitle: word, onTap: () {}),
            ],
          ),
        );

        expectBreaksBetweenWords(tester, subtitle);
        expectWrapsInsideWord(tester, word);
        // A screen reader reads the row's title and subtitle as written.
        expect(
          tester.getSemantics(find.text('계정 삭제')),
          isSemantics(label: '계정 삭제\n$subtitle', hasTapAction: true),
        );
        semantics.dispose();
      },
    );
  }
}
