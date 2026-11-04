import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/label_presets.dart';
import 'package:knowno/deck/src/label_presets_screen.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../contrast.dart';
import '../study/study_storage.dart';
import '../word_breaks.dart';

/// The 라벨 row on a settings screen of its own, over device storage in
/// memory.
Future<SharedPreferencesWithCache> _open(
  WidgetTester tester, {
  ThemeMode themeMode = ThemeMode.light,
}) async {
  final storage = await openStudyStorage(tester);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [deckStorageProvider.overrideWithValue(storage)],
      child: MaterialApp(
        theme: lightTheme,
        darkTheme: darkTheme,
        themeMode: themeMode,
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: const Scaffold(body: PartOfSpeechPresetsRow()),
      ),
    ),
  );
  await tester.tap(find.text('Labels'));
  await tester.pumpAndSettle();
  return storage;
}

List<String> _shown(WidgetTester tester) => [
  for (final row in tester.widgetList<Semantics>(
    find.byWidgetPredicate(
      (widget) =>
          widget is Semantics &&
          (widget.properties.label?.startsWith('Edit ') ?? false),
    ),
  ))
    row.properties.label!,
];

/// How many presets the screen lists, those scrolled out of view included.
int _count(WidgetTester tester) => tester
    .widget<ReorderableListView>(find.byType(ReorderableListView))
    .itemCount;

/// The screen's list, apart from any field's own scrolling.
final _list = find
    .descendant(
      of: find.byType(ReorderableListView),
      matching: find.byType(Scrollable),
    )
    .first;

/// The drag handle of the [index]th preset.
Finder _handle(int index) => find.byIcon(LucideIcons.gripVertical).at(index);

/// Chooses [action] in the menu of the preset [label].
Future<void> _act(WidgetTester tester, String label, String action) async {
  await tester.tap(find.byTooltip('$label menu'));
  await tester.pumpAndSettle();
  await tester.tap(find.text(action).last);
  await tester.pumpAndSettle();
}

List<String> _stored(SharedPreferencesWithCache storage) => [
  for (final preset in labelPresets(storage, const []))
    '${preset.label}:${preset.name}',
];

void main() {
  testWidgets(
    'the row opens the screen, which starts from the fourteen short forms with their names',
    (tester) async {
      await _open(tester);
      expect(find.byType(PartOfSpeechPresetsScreen), findsOneWidget);
      expect(_count(tester), 14);
      final shown = _shown(tester);
      expect(shown.first, 'Edit 명 noun');
      expect(shown[1], 'Edit 동 verb');
    },
  );

  testWidgets(
    'a preset is added, renamed and removed, each change stored on the device at once',
    (tester) async {
      final storage = await _open(tester);
      expect(_stored(storage), isEmpty, reason: 'nothing stored yet');

      await tester.scrollUntilVisible(find.bySemanticsLabel('Add label'), 200);
      await tester.tap(find.bySemanticsLabel('Add label'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(AppTextField, 'Label'), '숙어');
      await tester.enterText(
        find.widgetWithText(AppTextField, 'Name (optional)'),
        'idiom',
      );
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(_stored(storage).length, 15);
      expect(_stored(storage).last, '숙어:idiom');

      await tester.scrollUntilVisible(
        find.bySemanticsLabel('Edit 숙어 idiom'),
        200,
      );
      await tester.tap(find.bySemanticsLabel('Edit 숙어 idiom'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(AppTextField, 'Label'), '관용');
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(_stored(storage).last, '관용:idiom');

      await _act(tester, '관용', 'Delete');
      expect(_stored(storage).length, 14);
      expect(_stored(storage), isNot(contains('관용:idiom')));
    },
  );

  testWidgets(
    "the editing row draws each field's label inside the row, above its "
    'field, not over its border',
    (tester) async {
      await _open(tester);
      await tester.scrollUntilVisible(find.bySemanticsLabel('Add label'), 200);
      await tester.tap(find.bySemanticsLabel('Add label'));
      await tester.pumpAndSettle();
      for (final (index, label) in ['Label', 'Name (optional)'].indexed) {
        final field = find.byType(InputDecorator).at(index);
        final row = tester.getRect(
          find.ancestor(of: field, matching: find.byType(Row)).first,
        );
        final text = tester.getRect(find.text(label));
        final border = tester.getRect(field);
        expect(text.top, greaterThanOrEqualTo(row.top), reason: label);
        expect(text.bottom, lessThanOrEqualTo(border.top), reason: label);
      }
    },
  );

  testWidgets(
    'an empty label is refused with a message, and an added row left empty goes',
    (tester) async {
      final storage = await _open(tester);
      await tester.tap(find.bySemanticsLabel('Edit 명 noun'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(AppTextField, 'Label'), ' ');
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Write a label'), findsOneWidget);
      expect(_stored(storage), isEmpty, reason: 'nothing stored');

      await tester.enterText(find.widgetWithText(AppTextField, 'Label'), '명');
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Write a label'), findsNothing, reason: 'control');

      await tester.scrollUntilVisible(find.bySemanticsLabel('Add label'), 200);
      await tester.tap(find.bySemanticsLabel('Add label'));
      await tester.pumpAndSettle();
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(find.text('Write a label'), findsNothing);
      expect(_count(tester), 14, reason: 'the empty row went');
    },
  );

  testWidgets(
    'a preset moves up or down through its menu, without a drag, and the order is stored',
    (tester) async {
      final storage = await _open(tester);
      await _act(tester, '동', 'Move up');
      expect(_shown(tester).take(2), ['Edit 동 verb', 'Edit 명 noun']);
      expect(_stored(storage).take(2), ['동:verb', '명:noun']);

      await tester.tap(find.byTooltip('동 menu'));
      await tester.pumpAndSettle();
      expect(
        tester
            .widget<PopupMenuItem<dynamic>>(
              find.byWidgetPredicate(
                (widget) =>
                    widget is PopupMenuItem &&
                    (widget.child as Text?)?.data == 'Move up',
              ),
            )
            .enabled,
        isFalse,
        reason: 'the first cannot move up',
      );
      await tester.tap(find.text('Move down'));
      await tester.pumpAndSettle();
      expect(_stored(storage).take(2), ['명:noun', '동:verb']);
    },
  );

  testWidgets(
    'a preset moves by a drag on its handle, and the order is stored',
    (tester) async {
      final storage = await _open(tester);
      final handle = _handle(1);
      final gesture = await tester.startGesture(tester.getCenter(handle));
      for (var step = 0; step < 6; step++) {
        await gesture.moveBy(const Offset(0, -20));
        await tester.pump(const Duration(milliseconds: 50));
      }
      await gesture.up();
      await tester.pumpAndSettle();
      expect(_stored(storage).take(2), ['동:verb', '명:noun']);
    },
  );

  testWidgets(
    'while a preset is added or edited, no other preset moves or goes, so nothing half-typed is stored',
    (tester) async {
      final storage = await _open(tester);
      PopupMenuButton<Object?> menu(String label) => tester.widget(
        find.ancestor(
          of: find.byTooltip('$label menu'),
          matching: find.byWidgetPredicate(
            (widget) => widget is PopupMenuButton,
          ),
        ),
      );
      expect(menu('명').enabled, isTrue, reason: 'control: idle');

      await tester.scrollUntilVisible(
        find.bySemanticsLabel('Add label'),
        200,
        scrollable: _list,
      );
      await tester.tap(find.bySemanticsLabel('Add label'));
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(
        find.byTooltip('명 menu'),
        -200,
        scrollable: _list,
      );
      expect(menu('명').enabled, isFalse);
      // A drag on a handle moves nothing either.
      final gesture = await tester.startGesture(tester.getCenter(_handle(1)));
      for (var step = 0; step < 6; step++) {
        await gesture.moveBy(const Offset(0, -20));
        await tester.pump(const Duration(milliseconds: 50));
      }
      await gesture.up();
      await tester.pumpAndSettle();
      expect(_stored(storage), isEmpty, reason: 'nothing stored meanwhile');

      await tester.scrollUntilVisible(
        shownText('Done'),
        200,
        scrollable: _list,
      );
      await tester.enterText(find.widgetWithText(AppTextField, 'Label'), '숙어');
      await tester.tap(shownText('Done'));
      await tester.pumpAndSettle();
      expect(_stored(storage).last, '숙어:');
      expect(_stored(storage).take(2), [
        '명:noun',
        '동:verb',
      ], reason: 'the drag moved nothing');
      expect(
        _stored(storage).where((preset) => preset.startsWith(':')),
        isEmpty,
        reason: 'no empty preset',
      );
      await tester.scrollUntilVisible(
        find.byTooltip('명 menu'),
        -200,
        scrollable: _list,
      );
      expect(menu('명').enabled, isTrue, reason: 'done, it can go');
    },
  );

  for (final scale in [1.0, 3.12]) {
    testWidgets(
      'at text scale $scale on a 390 wide phone the label being edited shows '
      'whole in its field, which keeps its 64 at the default size',
      (tester) async {
        tester.view
          ..physicalSize = const Size(390, 844)
          ..devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        await _open(tester);
        await tester.tap(find.bySemanticsLabel('Edit 명 noun'));
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        final field = find.widgetWithText(AppTextField, 'Label');
        final editable = tester
            .state<EditableTextState>(
              find.descendant(of: field, matching: find.byType(EditableText)),
            )
            .renderEditable;
        expect(editable.text?.toPlainText(), '명');
        expect(
          editable.getMaxIntrinsicWidth(double.infinity),
          lessThanOrEqualTo(editable.size.width),
        );
        if (scale == 1.0) {
          // Control: at the default size the field is as wide as before.
          expect(tester.getSize(field).width, 64);
        }
      },
    );
  }

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the screen meets the tap target, label and contrast guidelines, a preset being edited included',
      (tester) async {
        await _open(tester, themeMode: mode);
        await tester.tap(find.bySemanticsLabel('Edit 명 noun'));
        await tester.pumpAndSettle();
        final handle = tester.ensureSemantics();
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        handle.dispose();
      },
    );
  }
}
