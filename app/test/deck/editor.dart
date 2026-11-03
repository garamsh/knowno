import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/block_list.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/deck/src/undo_snack_bar.dart';
import 'package:knowno/study/study.dart';

import '../home/deck_screens.dart';

/// The preview the shell hands the editor: study's (ADR 0168).
Widget studyPreview(List<Cell> cells) => CardPreviewScreen(cells: cells);

/// The card's column of 칸.
final blockList = find.byType(BlockList);

/// The [index]th text field of the column: a new card's 앞면 is the first and
/// its 뒷면 the second.
Finder blockField([int index = 0]) =>
    find.descendant(of: blockList, matching: find.byType(TextField)).at(index);

/// The text field labelled or hinted [label] in the column, found by its
/// decoration, so it is found once it holds text too.
Finder labelledField(String label) => find.descendant(
  of: blockList,
  matching: find.byWidgetPredicate(
    (widget) =>
        widget is TextField &&
        (widget.decoration?.labelText == label ||
            widget.decoration?.hintText == label),
  ),
);

/// The field of the [index]th row named [name] inline in the column, found
/// by what a screen reader reads for it.
Finder namedField(String name, [int index = 0]) => find
    .descendant(
      of: find.descendant(
        of: blockList,
        matching: find.byWidgetPredicate(
          (widget) => widget is Semantics && widget.properties.label == name,
        ),
      ),
      matching: find.byType(TextField),
    )
    .at(index);

/// The "+ 칸 추가" row after the last group, found by what a screen reader
/// reads for it.
final addRow = find.bySemanticsLabel('Add block');

/// Brings [finder] into view and taps it.
Future<void> tapVisible(DeckScreens screens, Finder finder) async {
  await screens.tester.ensureVisible(finder);
  await screens.tester.pumpAndSettle();
  await screens.tap(finder);
}

/// Types [text] into [field], brought into view first.
Future<void> typeInto(WidgetTester tester, Finder field, String text) async {
  await tester.ensureVisible(field);
  await tester.enterText(field, text);
  await tester.pump();
}

/// Types [text] into the [index]th text field of the column.
Future<void> typeBlock(WidgetTester tester, String text, [int index = 0]) =>
    typeInto(tester, blockField(index), text);

/// Whether the text field [field] finds holds the focus.
bool hasFocus(WidgetTester tester, Finder field) => tester
    .widget<EditableText>(
      find.descendant(of: field, matching: find.byType(EditableText)),
    )
    .focusNode
    .hasFocus;

/// Whether all of what [finder] finds lies inside the editor's scrolling
/// form as it is on screen.
bool inView(WidgetTester tester, Finder finder) {
  final form = tester.getRect(
    find
        .descendant(
          of: find.byType(CardEditorScreen),
          matching: find.byType(Scrollable),
        )
        .first,
  );
  final shown = tester.getRect(finder);
  return shown.top >= form.top &&
      shown.bottom <= form.bottom &&
      shown.left >= form.left &&
      shown.right <= form.right;
}

/// Adds a 칸 of [type] through "+ 칸 추가" and its sheet.
Future<void> addBlock(DeckScreens screens, String type) async {
  await tapVisible(screens, addRow);
  await screens.tap(find.text(type).last);
}

/// Chooses [action] in the menu of the [number]th 칸.
Future<void> actOnBlock(DeckScreens screens, int number, String action) async {
  await tapVisible(screens, find.byTooltip('Block $number menu'));
  await screens.tap(find.text(action).last);
}

/// Replaces the first 칸, a new card's empty Text, with a new one of [type].
/// The deletion's undo bar is let run out, so it is not what a test then
/// reads.
Future<void> replaceFirstBlock(DeckScreens screens, String type) async {
  await actOnBlock(screens, 1, 'Delete');
  await screens.tester.pump(undoDuration);
  await screens.tester.pumpAndSettle();
  await addBlock(screens, type);
}

/// Expects each button labelled in [labels] as wide as the one labelled
/// [full], and below the one before it.
void expectStackedFullWidth(
  WidgetTester tester,
  List<String> labels, {
  required String full,
}) {
  Rect button(String label) =>
      tester.getRect(find.widgetWithText(AppButton, label));
  var above = double.negativeInfinity;
  for (final label in labels) {
    expect(button(label).width, button(full).width, reason: label);
    expect(button(label).top, greaterThan(above), reason: label);
    above = button(label).top;
  }
}
