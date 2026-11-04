import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_search_field.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';

import 'harness.dart';

void main() {
  testWidgets('a search is shorter than a text field, its magnifier holding '
      'it at a tap target, and hands each change and its search key on', (
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
    // AppSize.search, raised to the magnifier's tap target (#645).
    expect(
      height('Search'),
      math.max(AppSize.search, kMinInteractiveDimension),
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
}
