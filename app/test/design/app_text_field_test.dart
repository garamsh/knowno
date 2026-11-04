import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';
import 'harness.dart';
import '../word_breaks.dart';

void main() {
  for (final MapEntry(key: mode, value: colors) in themeModes.entries) {
    testWidgets(
      'in ${mode.name} the label sits above the field, the hint inside and the error below',
      (tester) async {
        final semantics = tester.ensureSemantics();
        await pumpComponent(
          tester,
          const AppTextField(
            label: 'Name',
            hint: 'A short name',
            errorText: 'Enter a name',
          ),
          themeMode: mode,
        );

        final field = tester.getRect(find.byType(TextField));
        expect(tester.getRect(shownText('Name')).bottom, lessThan(field.top));
        expect(find.text('A short name'), findsOneWidget);
        expect(
          tester.getRect(find.text('Enter a name')).top,
          greaterThan(tester.getRect(find.text('A short name')).bottom),
        );
        expect(field.height, greaterThanOrEqualTo(AppSize.field));
        expect(
          tester.widget<Text>(find.text('Enter a name')).style?.color ??
              DefaultTextStyle.of(tester.element(find.text('Enter a name')))
                  .style
                  .color,
          colors.dontKnowText,
        );
        // The label, the field and its error are read as one text field.
        expect(
          tester.getSemantics(find.byType(EditableText)),
          isSemantics(
            isTextField: true,
            label: 'Name\nA short name\nEnter a name',
          ),
        );
        await meetsGuidelines(tester);
        expectScreenTextReadable(tester);
        semantics.dispose();
      },
    );
  }

  testWidgets('a limit shows a counter, and no limit shows none', (
    tester,
  ) async {
    await pumpComponent(
      tester,
      const Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          AppTextField(label: 'Limited', maxLength: 20),
          AppTextField(label: 'Free'),
        ],
      ),
    );

    expect(find.text('0/20'), findsOneWidget);
    await tester.enterText(find.byType(TextField).first, 'abc');
    await tester.pump();
    expect(find.text('3/20'), findsOneWidget);
    expect(find.textContaining('/'), findsOneWidget);
  });

  testWidgets('typing reports each change, and Enter submits', (tester) async {
    final changes = <String>[];
    final submits = <String>[];
    await pumpComponent(
      tester,
      AppTextField(
        label: 'Name',
        onChanged: changes.add,
        onSubmitted: submits.add,
      ),
    );

    await tester.enterText(find.byType(TextField), 'French');
    await tester.testTextInput.receiveAction(TextInputAction.done);

    expect(changes, ['French']);
    expect(submits, ['French']);
  });
}
