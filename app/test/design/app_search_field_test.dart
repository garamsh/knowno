import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_search_field.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';

import 'harness.dart';

void main() {
  testWidgets('a search is drawn at its token, a tap target high and shorter '
      'than a text field, and hands each change and its search key on', (
    tester,
  ) async {
    final changes = <String>[];
    final submitted = <String>[];
    await pumpComponent(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppSearchField(
            hint: 'Search',
            onChanged: changes.add,
            onSubmitted: submitted.add,
          ),
          const AppTextField(hint: 'Name'),
        ],
      ),
    );

    double height(String hint) => tester
        .getSize(
          find.ancestor(of: find.text(hint), matching: find.byType(TextField)),
        )
        .height;
    expect(height('Search'), AppSize.search, reason: 'drawn at its token');
    expect(
      height('Search'),
      greaterThanOrEqualTo(kMinInteractiveDimension),
      reason: 'the whole field is a tap target',
    );
    expect(height('Name'), AppSize.field, reason: 'control: a field');
    expect(height('Search'), lessThan(height('Name')));
    expect(find.byIcon(Icons.search), findsNothing);
    expect(
      find.descendant(
        of: find.byType(AppSearchField),
        matching: find.byType(Icon),
      ),
      findsOneWidget,
    );

    await tester.enterText(find.byType(TextField).first, 'cat');
    await tester.testTextInput.receiveAction(TextInputAction.search);
    expect(changes, ['cat']);
    expect(submitted, ['cat']);
  });

  testWidgets('a search draws its magnifier 20 wide 17 in and its hint 45 in, '
      'as the web does, at its token height; a field with no icon starts its '
      'hint at 20', (tester) async {
    await pumpComponent(
      tester,
      Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppSearchField(hint: 'Search', onChanged: (_) {}),
          const AppTextField(hint: 'Name'),
        ],
      ),
    );

    final field = find.ancestor(
      of: find.text('Search'),
      matching: find.byType(TextField),
    );
    final left = tester.getTopLeft(field).dx;
    final icon = tester.getRect(
      find.descendant(
        of: find.byType(AppSearchField),
        matching: find.byType(Icon),
      ),
    );
    expect(icon.left - left, closeTo(17, 0.5));
    expect(icon.width, 20);
    expect(tester.getTopLeft(find.text('Search')).dx - left, closeTo(45, 0.5));
    expect(tester.getSize(field).height, AppSize.search);
    expect(
      tester.getTopLeft(find.text('Name')).dx -
          tester.getTopLeft(find.byType(AppTextField).last).dx,
      closeTo(20, 0.5),
      reason: 'control: a field with no icon starts its hint at 20',
    );
  });
}
