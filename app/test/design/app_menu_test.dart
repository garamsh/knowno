import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_menu.dart';
import 'package:knowno/design/theme.dart';

const _phone = Size(390, 844);

/// A ⋯ anchor at the top right, its edge on the gutter as a screen's header
/// puts it, opening a menu drawn by [menu] too wide to start at the anchor's
/// left and stay on the screen.
Future<void> _open(
  WidgetTester tester, {
  required Widget Function(List<Widget> items, MenuAnchorChildBuilder builder)
  menu,
  double textScale = 1,
}) async {
  tester.view.physicalSize = _phone * 3;
  tester.view.devicePixelRatio = 3;
  tester.platformDispatcher.textScaleFactorTestValue = textScale;
  addTearDown(tester.view.reset);
  addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
  await tester.pumpWidget(
    MaterialApp(
      theme: lightTheme,
      home: Scaffold(
        body: Align(
          alignment: Alignment.topRight,
          child: Padding(
            padding: const EdgeInsets.all(AppSpace.gutter),
            child: menu(
              [
                MenuItemButton(onPressed: () {}, child: const Text('Hide')),
                MenuItemButton(onPressed: () {}, child: const Text('Rename')),
              ],
              (context, controller, _) => SizedBox.square(
                key: const Key('anchor'),
                dimension: AppSize.tapTarget,
                child: IconButton(
                  tooltip: 'More',
                  icon: const Icon(Icons.more_horiz),
                  onPressed: controller.open,
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byTooltip('More'));
  await tester.pumpAndSettle();
}

/// The open menu's bounds across: its widest item's, which fills them.
Rect _menu(WidgetTester tester) =>
    tester.getRect(find.byType(MenuItemButton).last);

void main() {
  for (final scale in [1.0, 3.12]) {
    testWidgets('at text scale $scale a menu keeps the gutter from both '
        'sides of the screen, under its anchor, where a plain MenuAnchor '
        'reaches the edge', (tester) async {
      await _open(
        tester,
        textScale: scale,
        menu: (items, builder) => AppMenu(items: items, builder: builder),
      );
      final anchor = tester.getRect(find.byKey(const Key('anchor')));
      final menu = _menu(tester);
      // The anchor sits on the gutter, as a header's ⋯ does.
      expect(anchor.right, _phone.width - AppSpace.gutter);
      expect(menu.right, anchor.right);
      expect(menu.left, greaterThanOrEqualTo(AppSpace.gutter));
      expect(menu.top, greaterThanOrEqualTo(anchor.bottom));
      // The items and the anchor read in the screen's direction.
      for (final shown in [
        find.text('Hide'),
        find.text('Rename'),
        find.byTooltip('More'),
      ]) {
        expect(
          Directionality.of(tester.element(shown)),
          TextDirection.ltr,
          reason: '$shown',
        );
      }

      // Control: the same menu from a plain MenuAnchor reaches past the
      // gutter, so the case is one where the gutter has to be kept.
      await _open(
        tester,
        textScale: scale,
        menu: (items, builder) =>
            MenuAnchor(menuChildren: items, builder: builder),
      );
      expect(_menu(tester).right, greaterThan(_phone.width - AppSpace.gutter));
    });
  }
}
