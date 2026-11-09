import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_search_field.dart';
import 'package:knowno/design/bottom_actions.dart';
import 'package:knowno/design/screen_skeleton.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../word_breaks.dart';

const _phone = Size(390, 844);

Future<void> _pump(
  WidgetTester tester, {
  bool topLevel = false,
  bool userTitle = false,
  bool actions = true,
  bool search = true,
  bool bottom = true,
  String name = 'Screen title',
  double scale = 1,
}) async {
  await tester.binding.setSurfaceSize(_phone);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      theme: lightTheme,
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context)
            .copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: ScreenSkeleton(
        title: name,
        topLevel: topLevel,
        userTitle: userTitle,
        actions: actions
            ? AppButton(
                label: 'Add',
                variant: AppButtonVariant.tonal,
                size: AppButtonSize.header,
                onPressed: () {},
              )
            : null,
        search: search ? AppSearchField(hint: 'Find', onChanged: (_) {}) : null,
        body: const [
          SliverToBoxAdapter(child: AppListRow(title: 'A row in the body')),
        ],
        bottom: bottom
            ? BottomActions(
                secondary: AppButton(
                  label: 'Save',
                  size: AppButtonSize.cta,
                  onPressed: () {},
                ),
              )
            : null,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Rect _rect(WidgetTester tester, Finder finder) => tester.getRect(finder);

void main() {
  final title = find.text('Screen title');
  final add = find.ancestor(
    of: shownText('Add'),
    matching: find.byType(AppButton),
  );
  final search = find.byType(AppSearchField);
  final row = find.byType(AppListRow);
  final save = find.ancestor(
    of: shownText('Save'),
    matching: find.byType(AppButton),
  );

  testWidgets(
    'a screen with a back bar holds the actions in the bar and, under it in order, the title, the search, the body and the primary at the foot',
    (tester) async {
      await _pump(tester);

      expect(find.byType(AppBar), findsOneWidget);
      expect(
        tester.getSize(find.byType(AppBar)).height,
        AppButton.barHeight(tester.element(find.byType(AppBar))),
      );
      final bar = _rect(tester, find.byType(AppBar));
      expect(_rect(tester, add).bottom, lessThanOrEqualTo(bar.bottom));
      final order = [title, search, row, save].map((f) => _rect(tester, f).top);
      expect(order.toList()..sort(), order.toList(), reason: 'slot order');
      expect(_rect(tester, title).top, greaterThanOrEqualTo(bar.bottom));
      expect(_rect(tester, search).height, AppSize.search);
      expect(
        tester.getSemantics(title),
        matchesSemantics(label: 'Screen title', isHeader: true),
      );
    },
  );

  testWidgets('the bar grows to the action\'s line at the largest text size', (
    tester,
  ) async {
    await _pump(tester, scale: 3.12);

    final height = tester.getSize(find.byType(AppBar)).height;
    expect(height, AppButton.barHeight(tester.element(find.byType(AppBar))));
    expect(height, greaterThan(kToolbarHeight));
  });

  testWidgets(
    'every slot sits between the gutters, the actions ending on the right one',
    (tester) async {
      await _pump(tester);

      const left = AppSpace.gutter;
      final right = _phone.width - AppSpace.gutter;
      expect(_rect(tester, title).left, left);
      expect(_rect(tester, search).left, left);
      expect(_rect(tester, search).right, right);
      expect(_rect(tester, row).left, left);
      expect(_rect(tester, row).right, right);
      expect(_rect(tester, save).left, left);
      expect(_rect(tester, save).right, right);
      expect(_rect(tester, add).right, right);
    },
  );

  testWidgets(
    'a top-level screen has no bar: the title and the actions share a line, the actions ending on the right gutter',
    (tester) async {
      await _pump(tester, topLevel: true, name: 'Tab');

      expect(find.byType(AppBar), findsNothing);
      final tab = find.text('Tab');
      expect(
        _rect(tester, tab).center.dy,
        moreOrLessEquals(_rect(tester, add).center.dy, epsilon: 1),
      );
      expect(_rect(tester, tab).left, AppSpace.gutter);
      expect(_rect(tester, add).right, _phone.width - AppSpace.gutter);
      expect(_rect(tester, search).left, AppSpace.gutter);
    },
  );

  testWidgets('a slot left out draws nothing, and the body stays', (
    tester,
  ) async {
    await _pump(tester, actions: false, search: false, bottom: false);

    expect(add, findsNothing);
    expect(search, findsNothing);
    expect(find.byType(BottomActions), findsNothing);
    expect(row, findsOneWidget);
    expect(_rect(tester, row).left, AppSpace.gutter);
  });

  testWidgets(
    'a title the user wrote is drawn in the name type, the screen\'s own in the title type',
    (tester) async {
      await _pump(tester);
      expect(
        tester.widget<Text>(title).style!.fontSize,
        AppType.deckTitle.fontSize,
      );
      expect(
        tester.widget<Text>(title).style!.fontFamily,
        AppType.deckTitle.fontFamily,
      );

      await _pump(tester, userTitle: true);
      final written = tester.widget<Text>(
        find.byWidgetPredicate(
          (w) => w is Text && w.semanticsLabel == 'Screen title',
        ),
      );
      expect(written.style!.fontFamily, AppType.deckName.fontFamily);
      expect(written.style!.fontWeight, AppType.deckName.fontWeight);
      expect(written.maxLines, 2);
    },
  );
}
