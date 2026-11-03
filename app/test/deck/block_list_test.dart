import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_sheet.dart';
import 'package:knowno/deck/src/undo_snack_bar.dart';
import 'package:knowno/study/study.dart' show CardPreviewScreen;
import 'package:knowno/deck/src/editor_group.dart';

import '../home/deck_screens.dart';
import '../word_breaks.dart';
import 'editor.dart';

/// The stored card.
Future<Card> _stored(DeckScreens screens) async =>
    (await screens.cards()).single;

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  Future<DeckScreens> openNew(WidgetTester tester) async {
    final screens = await DeckScreens.open(tester);
    await screens.push(
      (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
    );
    return screens;
  }

  testWidgets(
    'a new card opens with one Text under its type and menu, its Front and Back fields each named inline, the focus in Front, and no group per side',
    (tester) async {
      await openNew(tester);
      expect(find.byType(SegmentedButton), findsNothing);
      expect(find.bySemanticsLabel('Add to front'), findsNothing);
      expect(find.byType(EditorGroup), findsOneWidget, reason: 'one 칸');
      expect(
        find.descendant(of: blockList, matching: find.text('Text')),
        findsOneWidget,
      );
      expect(find.byTooltip('Block 1 menu'), findsOneWidget);
      expect(
        find.descendant(of: blockList, matching: find.byType(TextField)),
        findsNWidgets(2),
      );
      expect(namedField('Front'), findsOneWidget);
      expect(namedField('Back'), findsOneWidget);
      expect(
        tester.widget<TextField>(blockField()).focusNode!.hasFocus,
        isTrue,
        reason: 'typed first',
      );
      expect(
        tester.widget<TextField>(blockField(1)).focusNode?.hasFocus ?? false,
        isFalse,
        reason: 'control: the focus is in one field',
      );
      expect(
        [
          for (final icon in tester.widgetList<Icon>(
            find.descendant(of: blockList, matching: find.byType(Icon)),
          ))
            icon.icon,
        ],
        [LucideIcons.ellipsis],
        reason: 'the menu alone',
      );
    },
  );

  testWidgets(
    'Add block opens the sheet of that name with the six types in order, each row its icon, its name and one line, and adds a group',
    (tester) async {
      final screens = await openNew(tester);
      await tapVisible(screens, addRow);
      final sheet = find.byType(BottomSheet);
      expect(
        find.descendant(of: sheet, matching: shownText('Add block')),
        findsOneWidget,
      );
      final rows = [
        ('Text', LucideIcons.type, 'Write a front and a back'),
        ('Word', LucideIcons.bookA, 'A word and its meanings'),
        (
          'Cloze sentence',
          LucideIcons.textCursorInput,
          'Hide words in a sentence',
        ),
        ('Table', LucideIcons.table, 'Choose cells to hide'),
        ('Photo', LucideIcons.image, 'Draw what to hide over a photo'),
        ('Sound', LucideIcons.audioLines, 'Record or add a file'),
      ];
      final tops = [
        for (final (type, _, _) in rows)
          tester
              .getTopLeft(find.descendant(of: sheet, matching: find.text(type)))
              .dy,
      ];
      expect(tops, [...tops]..sort(), reason: 'in the order of ADR 0137');
      expect(
        find.descendant(of: sheet, matching: find.byType(ListTile)),
        findsNothing,
      );
      for (final (type, icon, line) in rows) {
        final row = find.ancestor(
          of: find.descendant(of: sheet, matching: find.text(type)),
          matching: find.byType(InkWell),
        );
        expect(row, findsOneWidget, reason: '$type is one row');
        expect(
          [
            for (final drawn in tester.widgetList<Icon>(
              find.descendant(of: row, matching: find.byType(Icon)),
            ))
              drawn.icon,
          ],
          [icon],
          reason: '$type has its one icon',
        );
        expect(
          find.descendant(of: row, matching: shownText(line)),
          findsOneWidget,
          reason: '$type has its line',
        );
        expect(
          tester
              .getCenter(find.descendant(of: row, matching: find.byIcon(icon)))
              .dx,
          lessThan(
            tester
                .getTopLeft(find.descendant(of: row, matching: find.text(type)))
                .dx,
          ),
          reason: "$type's icon leads its name",
        );
      }
      await screens.tap(
        find.descendant(of: sheet, matching: find.text('Text')),
      );
      expect(find.byType(EditorGroup), findsNWidgets(2));
    },
  );

  testWidgets(
    'groups are added, moved and deleted, saved in order in the frame, reopen in that order, and saved unchanged are stored as they were',
    (tester) async {
      final screens = await openNew(tester);
      await typeBlock(tester, 'apple');
      await typeBlock(tester, '사과', 1);
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'a fruit', 2);
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'red', 4);
      await typeBlock(tester, '빨강', 5);
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'gone', 6);
      await actOnBlock(screens, 3, 'Move up');
      await actOnBlock(screens, 4, 'Delete');

      await tapVisible(screens, find.text('Save'));
      final card = await _stored(screens);
      expect((card.template, card.templateVersion), ('free', 2));
      expect(card.cells, const [
        TextCell(front: 'apple', back: '사과'),
        TextCell(front: 'red', back: '빨강'),
        TextCell(front: 'a fruit'),
      ]);

      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(
        [
          for (final field in tester.widgetList<TextField>(
            find.descendant(of: blockList, matching: find.byType(TextField)),
          ))
            field.controller!.text,
        ],
        ['apple', '사과', 'red', '빨강', 'a fruit', ''],
      );
      await tapVisible(screens, find.text('Save'));
      final saved = await _stored(screens);
      expect(
        encodeCells(saved.cells!, newId: () => fail('every 칸 keeps its id')),
        encodeCells(card.cells!, newId: () => fail('every 칸 has an id')),
        reason: 'saved unchanged, stored as it was',
      );
    },
  );

  testWidgets(
    'a block menu moves up only where a group is above and down only where one is below',
    (tester) async {
      final screens = await openNew(tester);
      await addBlock(screens, 'Text');
      await tapVisible(screens, find.byTooltip('Block 1 menu'));
      bool enabled(String item) => switch (tester.widget(
        find
            .ancestor(
              of: find.text(item).last,
              matching: find.byWidgetPredicate(
                (widget) => widget is PopupMenuItem,
              ),
            )
            .first,
      )) {
        PopupMenuItem(:final enabled) => enabled,
        _ => fail('$item is not a menu item'),
      };
      expect((enabled('Move up'), enabled('Move down')), (false, true));
      await tester.tapAt(Offset.zero);
      await tester.pumpAndSettle();
      await tapVisible(screens, find.byTooltip('Block 2 menu'));
      expect((enabled('Move up'), enabled('Move down')), (true, false));
    },
  );

  group('a card that fails validity', () {
    const before = 'Add something to show on the front';
    const added = 'Add a back or a blank';

    testWidgets(
      'that shows nothing before the reveal is refused under the column, with nothing else said, and saves once it does',
      (tester) async {
        final screens = await openNew(tester);
        await tapVisible(screens, find.text('Save'));
        expect(shownText(before), findsOneWidget, reason: 'an empty 글');
        expect(shownText(added), findsNothing);
        expect(await screens.cards(), isEmpty);

        await typeBlock(tester, 'a back alone', 1);
        await tapVisible(screens, find.text('Save'));
        expect(shownText(before), findsOneWidget, reason: 'a back alone');
        expect(await screens.cards(), isEmpty);

        await actOnBlock(screens, 1, 'Delete');
        await tapVisible(screens, find.text('Save'));
        expect(shownText(before), findsOneWidget, reason: 'no 칸 at all');
        expect(await screens.cards(), isEmpty);

        await addBlock(screens, 'Text');
        await typeBlock(tester, 'apple');
        await typeBlock(tester, '사과', 1);
        expect(shownText(before), findsNothing, reason: 'answered as typed');
        await tapVisible(screens, find.text('Save'));
        expect((await _stored(screens)).cells, const [
          TextCell(front: 'apple', back: '사과'),
        ], reason: 'control: a front and a back save');
      },
    );

    testWidgets(
      'that adds nothing by the reveal is refused under the column, and a blank counts for both',
      (tester) async {
        final screens = await openNew(tester);
        await typeBlock(tester, 'Chat');
        await tapVisible(screens, find.text('Save'));
        expect(shownText(added), findsOneWidget);
        expect(shownText(before), findsNothing);
        expect(await screens.cards(), isEmpty);

        await replaceFirstBlock(screens, 'Cloze sentence');
        final line = blockField();
        await typeInto(tester, line, 'I like tea');
        await tester.tap(line);
        await tester.pump();
        tester.widget<TextField>(line).controller!.selection =
            const TextSelection(baseOffset: 7, extentOffset: 10);
        await tester.pump();
        await screens.tap(find.text('Insert blank'));
        await tapVisible(screens, find.text('Save'));
        final card = await _stored(screens);
        expect(card.cells, const [
          BlankCell(ClozeContent('I like ___', ['tea'])),
        ], reason: 'control: a blank alone saves');
      },
    );

    testWidgets(
      'a Text of spaces alone is not saved, and a part of spaces is saved empty',
      (tester) async {
        final screens = await openNew(tester);
        await typeBlock(tester, 'apple');
        await typeBlock(tester, '   ', 1);
        await tapVisible(screens, find.text('Save'));
        expect(shownText(added), findsOneWidget, reason: 'spaces add nothing');
        expect(await screens.cards(), isEmpty);

        await addBlock(screens, 'Text');
        await typeBlock(tester, '  ', 2);
        await typeBlock(tester, '사과', 1);
        await tapVisible(screens, find.text('Save'));
        expect((await _stored(screens)).cells, const [
          TextCell(front: 'apple', back: '사과'),
        ], reason: 'the empty 글 is dropped');
      },
    );

    testWidgets('no line speaks of an empty back beside a blank', (
      tester,
    ) async {
      final screens = await openNew(tester);
      await replaceFirstBlock(screens, 'Cloze sentence');
      await typeInto(tester, blockField(), 'I like tea');
      expect(find.textContaining('stay empty'), findsNothing);
      expect(find.textContaining('비워 둬도'), findsNothing);
    });
  });

  testWidgets(
    'a Word asks its word first until Meaning is chosen, the chip says which, and a save stores it',
    (tester) async {
      final screens = await openNew(tester);
      await replaceFirstBlock(screens, 'Word');
      expect(find.text('Shown on the front'), findsOneWidget);
      AppChip chip(String label) =>
          tester.widget<AppChip>(find.widgetWithText(AppChip, label));
      expect((chip('Word').selected, chip('Meaning').selected), (true, false));
      await typeInto(tester, namedField('Word'), 'apple');
      await typeInto(tester, labelledField('Meaning'), '사과');

      await tapVisible(screens, find.widgetWithText(AppChip, 'Meaning'));
      expect((chip('Word').selected, chip('Meaning').selected), (false, true));
      await tapVisible(screens, find.text('Save'));
      final card = await _stored(screens);
      expect(card.cells, const [
        WordCell(
          term: 'apple',
          senses: [CardSense(meaning: '사과')],
          ask: WordAsk.meaning,
        ),
      ]);
      expect(card.front, const [
        SensesContent([CardSense(meaning: '사과')]),
      ], reason: 'the meaning shows first');
      expect(card.back, const [TextContent('apple')]);

      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(
        tester
            .widget<AppChip>(find.widgetWithText(AppChip, 'Meaning'))
            .selected,
        isTrue,
        reason: 'reopened as saved',
      );
      await tapVisible(screens, find.widgetWithText(AppChip, 'Word'));
      await tapVisible(screens, find.text('Save'));
      expect((await _stored(screens)).front, const [TextContent('apple')]);
    },
  );

  testWidgets(
    'the preview draws a card as study does: a split card, and a card with a blank whole',
    (tester) async {
      final screens = await openNew(tester);
      final preview = find.byType(CardPreviewScreen);
      await screens.tap(find.text('Preview'));
      expect(
        find.descendant(of: preview, matching: find.byType(WholeCardView)),
        findsNothing,
        reason: 'control: text alone is split',
      );
      await screens.tap(find.byTooltip('Close'));
      await addBlock(screens, 'Table');
      await screens.tap(find.text('Preview'));
      expect(
        find.descendant(of: preview, matching: find.byType(WholeCardView)),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'the preview draws a back under the 글 that holds it, where the two side lists would pair it with the first',
    (tester) async {
      final screens = await openNew(tester);
      await typeBlock(tester, 'first');
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'second', 2);
      await typeBlock(tester, 'its back', 3);
      await addBlock(screens, 'Cloze sentence');
      final line = blockField(4);
      await typeInto(tester, line, 'I like tea');
      await tester.tap(line);
      await tester.pump();
      tester.widget<TextField>(line).controller!.selection =
          const TextSelection(baseOffset: 7, extentOffset: 10);
      await tester.pump();
      await screens.tap(find.text('Insert blank'));
      await screens.tap(find.text('Preview'));
      await screens.tap(find.byType(CardPreviewScreen));
      final preview = find.byType(CardPreviewScreen);
      double top(String text) => tester
          .getTopLeft(find.descendant(of: preview, matching: shownText(text)))
          .dy;
      expect(top('first'), lessThan(top('second')));
      expect(top('second'), lessThan(top('its back')));
    },
  );

  testWidgets(
    'deleting a 칸 acts at once and offers Undo, which puts it back in its place with what was typed; left alone, the bar goes and so does the 칸 (#622)',
    (tester) async {
      final screens = await openNew(tester);
      await typeBlock(tester, 'Chat');
      await typeBlock(tester, 'Cat', 1);
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'Hund', 2);
      await typeBlock(tester, 'Dog', 3);

      await actOnBlock(screens, 1, 'Delete');
      expect(find.byType(AppSheet), findsNothing, reason: 'nothing asks');
      expect(find.text('Block deleted'), findsOneWidget);
      expect(find.widgetWithText(TextField, 'Chat'), findsNothing);
      await screens.tap(find.text('Undo'));
      expect(find.byType(EditorGroup), findsNWidgets(2));
      expect(
        tester.widget<TextField>(blockField()).controller!.text,
        'Chat',
        reason: 'back first, as it was',
      );

      await actOnBlock(screens, 2, 'Delete');
      await tester.pump(undoDuration);
      await tester.pumpAndSettle();
      expect(find.text('Undo'), findsNothing, reason: 'the bar went');
      await tapVisible(screens, find.text('Save'));
      expect((await _stored(screens)).cells, const [
        TextCell(front: 'Chat', back: 'Cat'),
      ]);
    },
  );

  testWidgets(
    'a 칸 added through + 칸 추가 takes the focus in its first field; one with no text field closes the keyboard and is scrolled into view (#622)',
    (tester) async {
      final screens = await openNew(tester);
      expect(hasFocus(tester, blockField()), isTrue, reason: 'setup');
      Finder lastGroupField() => find
          .descendant(
            of: find.byType(EditorGroup).last,
            matching: find.byType(TextField),
          )
          .first;
      for (final type in ['Word', 'Cloze sentence', 'Table', 'Text']) {
        await addBlock(screens, type);
        expect(hasFocus(tester, lastGroupField()), isTrue, reason: type);
        expect(inView(tester, lastGroupField()), isTrue, reason: type);
      }
      await addBlock(screens, 'Photo');
      expect(
        tester.testTextInput.isVisible,
        isFalse,
        reason: 'no field keeps the keyboard up',
      );
      expect(inView(tester, find.text('Choose from album')), isTrue);
    },
  );

  testWidgets(
    'a refused save scrolls to the first 칸 that cannot be saved and puts the focus in its field (#622)',
    (tester) async {
      final screens = await openNew(tester);
      await replaceFirstBlock(screens, 'Word');
      await typeInto(tester, namedField('Word'), 'apple');
      for (var index = 0; index < 4; index++) {
        await addBlock(screens, 'Text');
        await typeBlock(tester, 'front $index', 3 + 2 * index);
      }
      final error = find.text('Write something');
      await tapVisible(screens, find.text('Save'));
      expect(error, findsOneWidget, reason: 'refused');
      expect(inView(tester, error), isTrue, reason: 'its error is in view');
      expect(hasFocus(tester, labelledField('Meaning')), isTrue);
      expect(await screens.cards(), isEmpty);
    },
  );
}
