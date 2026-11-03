import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/study.dart' show CardPreviewScreen;
import 'package:knowno/deck/src/table_block.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/theme.dart';

import '../contrast.dart';
import '../home/deck_screens.dart';
import 'editor.dart';
import 'whole_cards.dart';
import '../word_breaks.dart';

/// The front's first block, a Text block holding the table's name.
final _name = blockField();

/// The Table block's [index]th field: the headers, then the cells row by row.
Finder _cell(int index) => find
    .descendant(of: find.byType(TableFields), matching: find.byType(TextField))
    .at(index);

/// The stored card, front and back.
Future<Card> _stored(DeckScreens screens) async =>
    (await screens.cards()).single;

const _capitals = TableContent(
  columns: ['Country', 'Capital'],
  rows: [
    ['France', 'Paris'],
    ['Japan', 'Tokyo'],
  ],
  blanks: [(row: 0, column: 1), (row: 1, column: 1)],
);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  /// A new card's editor of a Text for the table's name, then a Table.
  Future<DeckScreens> openTable(WidgetTester tester, {DeckScreens? on}) async {
    final screens = on ?? await DeckScreens.open(tester);
    await screens.push(
      (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
    );
    await addBlock(screens, 'Table');
    return screens;
  }

  Future<void> enter(WidgetTester tester, Finder field, String text) async {
    await tester.ensureVisible(field);
    await tester.enterText(field, text);
    await tester.pump();
  }

  /// Taps [finder] once it is scrolled into view.
  Future<void> tap(DeckScreens screens, Finder finder) async {
    await screens.tester.ensureVisible(finder);
    await screens.tester.pumpAndSettle();
    await screens.tap(finder);
  }

  Future<void> save(DeckScreens screens) => tap(screens, find.text('Save'));

  /// Types the name and [_capitals]' cells into a new table, its two rows
  /// already there.
  Future<void> typeCapitals(DeckScreens screens) async {
    final tester = screens.tester;
    await enter(tester, _name, 'Capitals');
    final cells = [
      ..._capitals.columns,
      ..._capitals.rows.expand((row) => row),
    ];
    for (final (index, text) in cells.indexed) {
      await enter(tester, _cell(index), text);
    }
  }

  /// Taps the [index]th field, which selects it.
  Future<void> select(DeckScreens screens, int index) =>
      tap(screens, _cell(index));

  /// The toolbar's "빈칸" chip.
  AppChip blankChip(WidgetTester tester) =>
      tester.widget<AppChip>(find.widgetWithText(AppChip, 'Blank'));

  /// Toggles the selected cell as a blank.
  Future<void> toggleBlank(DeckScreens screens) =>
      tap(screens, find.widgetWithText(AppChip, 'Blank'));

  /// Removes the selected cell's row or column through "삭제", read as
  /// [item] in its menu.
  Future<void> remove(DeckScreens screens, String item) async {
    await tap(screens, find.byTooltip('Delete'));
    await screens.tap(find.text(item));
  }

  /// The blanks the preview screen draws once a tap turns its card to show
  /// them; then back to the editor.
  Future<Map<String, bool>> previewedBlanks(DeckScreens screens) async {
    await screens.tap(find.text('Preview'));
    await screens.tap(find.byType(CardPreviewScreen));
    final blanks = blanksUnder(find.byType(CardPreviewScreen));
    await screens.tap(find.byTooltip('Close'));
    return blanks;
  }

  testWidgets(
    'a table saves its name, a table block of its cells and the blanks toggled on the selected cells, and reopens with them, unchanged when saved as it was',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await select(screens, 3);
      await toggleBlank(screens);
      await select(screens, 4);
      await toggleBlank(screens);
      await toggleBlank(screens);
      await select(screens, 5);
      await toggleBlank(screens);
      expect(await previewedBlanks(screens), {
        'Paris': true,
        'Tokyo': true,
      }, reason: 'the preview draws the table whole, filled');

      await save(screens);
      final card = await _stored(screens);
      expect(card.front, [const TextContent('Capitals'), _capitals]);
      expect(card.back, isEmpty, reason: 'a back is the blocks listed on it');

      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(tester.widget<TextField>(_cell(3)).controller!.text, 'Paris');
      await save(screens);
      final saved = await _stored(screens);
      expect(saved.front, card.front, reason: 'a round trip');
      expect(saved.back, card.back);
      await screens.close();
    },
  );

  testWidgets(
    'a tap edits a cell in place, the keyboard\'s next moves to the next cell keeping the edit, and a blank is drawn tinted',
    (tester) async {
      final screens = await openTable(tester);
      await select(screens, 2);
      expect(tester.widget<TextField>(_cell(2)).focusNode, isNull);
      await tester.enterText(_cell(2), 'France');
      expect(
        tester.widget<TextField>(_cell(2)).textInputAction,
        TextInputAction.next,
        reason: 'the keyboard offers next',
      );
      await tester.testTextInput.receiveAction(TextInputAction.next);
      await tester.pumpAndSettle();
      final focused = FocusManager.instance.primaryFocus;
      expect(focused, isNot(isNull), reason: 'a cell has the focus after next');
      expect(
        find.descendant(
          of: _cell(3),
          matching: find.byWidgetPredicate(
            (widget) => widget is EditableText && widget.focusNode == focused,
          ),
        ),
        findsOneWidget,
        reason: 'the next cell',
      );
      await tester.enterText(_cell(3), 'Paris');
      expect(tester.widget<TextField>(_cell(2)).controller!.text, 'France');
      expect(tester.widget<TextField>(_cell(3)).controller!.text, 'Paris');

      await toggleBlank(screens);
      final colors = AppColors.of(tester.element(_cell(3)));
      expect(
        tester.widget<TextField>(_cell(3)).decoration!.fillColor,
        colors.brandTint,
      );
      expect(
        tester.widget<TextField>(_cell(2)).decoration!.fillColor,
        isNot(colors.brandTint),
        reason: 'control: a cell that is not a blank',
      );
      await screens.close();
    },
  );

  testWidgets(
    'the toolbar adds rows and columns and removes the selected cell\'s row or column, a blank moving with its cell, a table keeping one of each, and asks first when text would go',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await tap(screens, find.text('Add row'));
      await tap(screens, find.text('Add column'));
      // The headers, then three rows of three cells.
      expect(_cell(3 + 3 * 3 - 1), findsOneWidget);
      await enter(tester, _cell(2), 'Continent');
      await enter(tester, _cell(5), 'Europe');
      await enter(tester, _cell(9), 'Egypt');
      await enter(tester, _cell(10), 'Cairo');
      await select(screens, 7);
      await toggleBlank(screens);
      await select(screens, 10);
      await toggleBlank(screens);

      // Row 1 holds text: it asks first, and cancelling keeps it.
      await select(screens, 3);
      await remove(screens, 'Delete row 1');
      expect(shownText('Delete row 1?'), findsOneWidget);
      await screens.tap(find.text('Cancel'));
      expect(tester.widget<TextField>(_cell(3)).controller!.text, 'France');
      await remove(screens, 'Delete row 1');
      await screens.tap(find.text('Delete').last);
      await select(screens, 0);
      await remove(screens, 'Delete column 1');
      await screens.tap(find.text('Delete').last);
      await save(screens);
      expect(
        (await _stored(screens)).front.last,
        const TableContent(
          columns: ['Capital', 'Continent'],
          rows: [
            ['Tokyo', ''],
            ['Cairo', ''],
          ],
          blanks: [(row: 0, column: 0), (row: 1, column: 0)],
        ),
      );

      // An empty row or column goes without asking; one of each stays.
      await openTable(tester, on: screens);
      await select(screens, 5);
      await remove(screens, 'Delete row 2');
      expect(shownText('Delete row 2?'), findsNothing, reason: 'it was empty');
      await select(screens, 3);
      await remove(screens, 'Delete column 2');
      // One heading and one cell are left.
      await select(screens, 1);
      await tap(screens, find.byTooltip('Delete'));
      PopupMenuItem<Object?> item(String text) => tester.widget(
        find.ancestor(
          of: find.text(text),
          matching: find.byWidgetPredicate((widget) => widget is PopupMenuItem),
        ),
      );
      expect(item('Delete row 1').enabled, isFalse, reason: 'one row');
      expect(item('Delete column 1').enabled, isFalse, reason: 'one column');
      await tester.tapAt(Offset.zero);
      await tester.pumpAndSettle();
      await tap(screens, find.text('Add row'));
      await tap(screens, find.byTooltip('Delete'));
      expect(
        item('Delete row 1').enabled,
        isTrue,
        reason: 'control: with two rows, either can go',
      );
      await screens.close();
    },
  );

  testWidgets(
    'a table with no blank, or with a blank on an empty cell, is refused with a message under it, and saves once both are fixed',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await save(screens);
      expect(shownText('Choose at least one cell as a blank'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect(await screens.cards(), isEmpty);

      await select(screens, 3);
      await toggleBlank(screens);
      await enter(tester, _cell(3), '  ');
      await save(screens);
      expect(shownText('Fill in each cell chosen as a blank'), findsOneWidget);
      expect(shownText('Choose at least one cell as a blank'), findsNothing);
      expect(await screens.cards(), isEmpty);

      await enter(tester, _cell(3), 'Paris');
      await save(screens);
      expect(
        (await _stored(screens)).front.last,
        const TableContent(
          columns: ['Country', 'Capital'],
          rows: [
            ['France', 'Paris'],
            ['Japan', 'Tokyo'],
          ],
          blanks: [(row: 0, column: 1)],
        ),
        reason: 'control: fixed, it saves',
      );
      await screens.close();
    },
  );

  testWidgets(
    'a screen reader reads each cell with its place and whether it is a blank, and the toolbar\'s Blank with its state, offered on a body cell alone',
    (tester) async {
      final screens = await openTable(tester);
      expect(blankChip(tester).onPressed, isNull, reason: 'nothing selected');
      await typeCapitals(screens);
      final handle = tester.ensureSemantics();
      expect(find.bySemanticsLabel('Row 1, column 2'), findsOneWidget);
      expect(find.bySemanticsLabel('Column 1 heading'), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              widget.properties.label == 'Table tools' &&
              widget.container,
        ),
        findsOneWidget,
      );

      await select(screens, 0);
      expect(blankChip(tester).onPressed, isNull, reason: 'a heading');
      await select(screens, 3);
      expect(blankChip(tester).selected, isFalse);
      await toggleBlank(screens);
      expect(blankChip(tester).selected, isTrue, reason: 'its state');
      expect(find.bySemanticsLabel('Row 1, column 2, blank'), findsOneWidget);
      handle.dispose();
      await screens.close();
    },
  );

  testWidgets(
    'a Table block has no mode switch: no segmented bar, and no mode to type cells or choose blanks',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      expect(find.byType(SegmentedButton), findsNothing);
      expect(find.byType(ChoiceChip), findsNothing);
      for (final mode in ['Type cells', 'Choose blanks', 'Table editing']) {
        expect(find.text(mode), findsNothing, reason: mode);
      }
      await screens.close();
    },
  );

  testWidgets(
    'a stored table card opens with a Text block holding its name and a Table block, and still deletes',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [const TextContent('Capitals'), _capitals],
          back: [TextContent(_capitals.filled)],
        ),
      );
      final card = await _stored(screens);
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(tester.widget<TextField>(_name).controller!.text, 'Capitals');
      expect(
        find.descendant(of: blockList, matching: find.byType(TableFields)),
        findsOneWidget,
      );
      expect(await previewedBlanks(screens), {'Paris': true, 'Tokyo': true});
      await tap(screens, find.text('Delete card'));
      // The confirmation's final button, over the table toolbar's Delete.
      await screens.tap(find.text('Delete').last);
      expect(await screens.cards(), isEmpty);
      await screens.close();
    },
  );

  testWidgets(
    'a stored table card saved unchanged keeps a back that differs from the filled text, as the editor wrote it before #311, drops one equal to it, as photo import writes it, and an edited name leaves the back as it is',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const importedFront = [TextContent('Capitals'), _capitals];
      const oldEditorFront = [TextContent('Old capitals'), _capitals];
      // The control, photo import's back: the name line, then the table.
      final imported = (
        front: importedFront,
        back: [TextContent(plainText(importedFront))],
      );
      // The editor's back before #311: the filled table, without the name.
      final oldEditor = (
        front: oldEditorFront,
        back: [TextContent(_capitals.filled)],
      );
      expect(imported.back.single.text, startsWith('Capitals\n'));
      expect(oldEditor.back.single.text, isNot(contains('Old capitals')));
      await tester.runAsync(
        () => screens.repository.addCards(AddToDeck(screens.deck.id), [
          IncomingCard(
            front: imported.front,
            back: imported.back,
            onDuplicate: DuplicateChoice.mergeBack,
          ),
        ]),
      );
      final added = await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: oldEditor.front,
          back: oldEditor.back,
        ),
      );
      expect(added, isA<CardSaved>());

      for (final ((:front, :back), kept) in [
        (imported, const <Content>[]),
        (oldEditor, oldEditor.back),
      ]) {
        Future<Card> stored() async => (await screens.cards()).singleWhere(
          (card) => card.front.first == front.first,
        );
        final card = await stored();
        expect(card.back, back, reason: 'the setup stores the back asked');
        await screens.push(
          (deck) =>
              CardEditorScreen(preview: studyPreview, deck: deck, card: card),
        );
        await save(screens);
        final saved = await stored();
        expect(saved.front, front);
        expect(
          saved.back,
          kept,
          reason: '${plainText([front.first])} saved unchanged',
        );
      }

      // Its name edited, the old editor's card keeps the back it holds, a
      // block of its own.
      final card = (await screens.cards()).singleWhere(
        (card) => card.front.first == oldEditor.front.first,
      );
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      await enter(tester, _name, 'New capitals');
      await save(screens);
      final renamed = (await screens.cards()).singleWhere(
        (saved) => saved.id == card.id,
      );
      expect(renamed.front, [const TextContent('New capitals'), _capitals]);
      expect(renamed.back, oldEditor.back);
      await screens.close();
    },
  );

  testWidgets(
    'a table whose name and cells are already a card opens the duplicate sheet',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [const TextContent('Capitals'), _capitals],
          back: [TextContent(_capitals.filled)],
        ),
      );
      await openTable(tester, on: screens);
      await typeCapitals(screens);
      await select(screens, 2);
      await toggleBlank(screens);
      await save(screens);
      expect(find.text('Add anyway'), findsOneWidget);
      expect((await screens.cards()).length, 1);
      await screens.close();
    },
  );

  /// The [index]th field's controller.
  TextEditingController controllerOf(WidgetTester tester, int index) =>
      tester.widget<TextField>(_cell(index)).controller!;

  /// The runs of the [index]th field's text drawn on a fill, its spans.
  List<String> spansDrawnIn(WidgetTester tester, int index) {
    final drawn = <String>[];
    final editable = tester.widget<EditableText>(
      find.descendant(of: _cell(index), matching: find.byType(EditableText)),
    );
    editable.controller
        .buildTextSpan(
          context: tester.element(_cell(index)),
          style: editable.style,
          withComposing: false,
        )
        .visitChildren((span) {
          if (span is TextSpan && span.style?.backgroundColor != null) {
            drawn.add(span.text!);
          }
          return true;
        });
    return drawn;
  }

  testWidgets(
    'text selected in a cell and "Blank" make that span a blank, drawn as a block in the cell and filled in the preview, kept through an edit elsewhere in the cell and saved at v2 beside a whole-cell blank made with no selection; selected again it turns back into text',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await enter(tester, _cell(2), 'France, in Europe');
      await select(screens, 2);
      final france = controllerOf(tester, 2);
      france.selection = const TextSelection(baseOffset: 0, extentOffset: 6);
      await tester.pump();
      expect(blankChip(tester).selected, isFalse, reason: 'no span yet');
      await toggleBlank(screens);
      expect(blankChip(tester).selected, isTrue, reason: 'inside the span');
      expect(spansDrawnIn(tester, 2), ['France']);
      final colors = AppColors.of(tester.element(_cell(2)));
      expect(
        tester.widget<TextField>(_cell(2)).decoration!.fillColor,
        isNot(colors.brandTint),
        reason: 'a cell holding a span is not tinted whole',
      );

      // An edit after the span keeps it.
      await enter(tester, _cell(2), 'France, in Europe!');
      expect(spansDrawnIn(tester, 2), ['France']);

      // With no selection, "Blank" toggles the whole cell, as before.
      await select(screens, 5);
      expect(controllerOf(tester, 5).selection.isCollapsed, isTrue);
      await toggleBlank(screens);
      expect(
        tester.widget<TextField>(_cell(5)).decoration!.fillColor,
        colors.brandTint,
      );
      expect(spansDrawnIn(tester, 5), isEmpty, reason: 'whole, not a span');
      expect(await previewedBlanks(screens), {
        'France': true,
        'Tokyo': true,
      }, reason: 'the preview draws the span in its cell, filled');

      await save(screens);
      final card = await _stored(screens);
      expect(
        card.front.last,
        const TableContent(
          columns: ['Country', 'Capital'],
          rows: [
            ['France, in Europe!', 'Paris'],
            ['Japan', 'Tokyo'],
          ],
          blanks: [(row: 1, column: 1)],
          spans: [(row: 0, column: 0, start: 0, end: 6)],
        ),
      );
      expect(
        encodeContent(card.front),
        contains('"type":"table","v":2,'),
        reason: 'written at v2',
      );

      // Reopened, the span is where the card has it; selected again, it goes.
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(spansDrawnIn(tester, 2), ['France']);
      await select(screens, 2);
      controllerOf(tester, 2).selection = const TextSelection(
        baseOffset: 1,
        extentOffset: 4,
      );
      await tester.pump();
      expect(blankChip(tester).selected, isTrue);
      await toggleBlank(screens);
      expect(spansDrawnIn(tester, 2), isEmpty);
      await save(screens);
      final saved = (await _stored(screens)).front.last as TableContent;
      expect(saved.spans, isEmpty);
      expect(saved.blanks, [(row: 1, column: 1)], reason: 'control: kept');
      await screens.close();
    },
  );

  testWidgets(
    'a span trimmed with its cell moves with the trim, a selection of whitespace makes no span, and a whole-cell blank and spans replace each other in a cell',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await enter(tester, _cell(2), '  France ');
      await select(screens, 2);
      controllerOf(tester, 2).selection = const TextSelection(
        baseOffset: 0,
        extentOffset: 2,
      );
      await tester.pump();
      await toggleBlank(screens);
      expect(spansDrawnIn(tester, 2), isEmpty, reason: 'whitespace alone');

      controllerOf(tester, 2).selection = const TextSelection(
        baseOffset: 2,
        extentOffset: 8,
      );
      await tester.pump();
      await toggleBlank(screens);
      expect(spansDrawnIn(tester, 2), ['France']);

      // The caret alone makes the cell whole, dropping its span ...
      controllerOf(tester, 2).selection = const TextSelection.collapsed(
        offset: 0,
      );
      await tester.pump();
      await toggleBlank(screens);
      expect(spansDrawnIn(tester, 2), isEmpty);
      final draft = tester.widget<TableFields>(find.byType(TableFields)).draft;
      expect(draft.table.blanks, [(row: 0, column: 0)]);
      expect(draft.table.spans, isEmpty);

      // ... and a span made in a whole cell makes it a cell of spans.
      controllerOf(tester, 2).selection = const TextSelection(
        baseOffset: 2,
        extentOffset: 8,
      );
      await tester.pump();
      await toggleBlank(screens);
      expect(draft.table.blanks, isEmpty);
      expect(draft.table.spans, [(row: 0, column: 0, start: 0, end: 6)]);
      expect(draft.table.rows.first.first, 'France', reason: 'trimmed');
      await screens.close();
    },
  );

  testWidgets(
    'a table whose name is left empty saves its Table block alone, its empty Text dropped',
    (tester) async {
      final screens = await openTable(tester);
      await typeCapitals(screens);
      await enter(tester, _name, '');
      await select(screens, 3);
      await toggleBlank(screens);
      await save(screens);
      expect(find.text('Write something'), findsNothing);
      final card = await _stored(screens);
      expect(card.front, [
        TableContent(
          columns: _capitals.columns,
          rows: _capitals.rows,
          blanks: const [(row: 0, column: 1)],
        ),
      ]);
      expect(card.back, isEmpty);
      await screens.close();
    },
  );

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme a Table block meets the tap target, label and contrast guidelines, a blank selected and the save refused',
      (tester) async {
        final screens = await DeckScreens.open(tester, themeMode: mode);
        await openTable(tester, on: screens);
        await typeCapitals(screens);
        final handle = tester.ensureSemantics();
        Future<void> meetsGuidelines() async {
          // From the top, so no control is cut by the screen's edge.
          await tester.ensureVisible(find.text('Front'));
          await tester.pumpAndSettle();
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
        }

        await meetsGuidelines();
        await select(screens, 3);
        await toggleBlank(screens);
        await enter(tester, _cell(3), '');
        await save(screens);
        expect(
          shownText('Fill in each cell chosen as a blank'),
          findsOneWidget,
        );
        await meetsGuidelines();
        handle.dispose();
        await screens.close();
      },
    );
  }
}
