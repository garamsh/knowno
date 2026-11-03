import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/study/study.dart' show CardPreviewScreen;
import 'package:knowno/deck/src/cloze_block.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/word_break.dart';

import '../contrast.dart';
import '../home/deck_screens.dart';
import '../word_breaks.dart';
import 'editor.dart';
import 'whole_cards.dart';

/// The stored card, front and back.
Future<Card> _stored(DeckScreens screens) async =>
    (await screens.cards()).single;

/// The line: the first field of the front's blocks.
final _line = blockField();

/// The line field's controller.
TextEditingController _controller(WidgetTester tester) =>
    tester.widget<TextField>(_line).controller!;

/// The blanks the line draws as blocks, in order: the spans of its text on
/// `brandTint`.
List<String> _blocks(WidgetTester tester) {
  final colors = AppColors.of(tester.element(_line));
  final blocks = <String>[];
  _controller(tester)
      .buildTextSpan(context: tester.element(_line), withComposing: false)
      .visitChildren((child) {
        if (child is TextSpan &&
            child.style?.backgroundColor == colors.brandTint) {
          blocks.add(child.text!);
        }
        return true;
      });
  return blocks;
}

/// The phones the app ships to, each drawing its own selection handles.
final _phones = TargetPlatformVariant(const {
  TargetPlatform.iOS,
  TargetPlatform.android,
});

/// The bar's one action while it reads [label].
Finder _action(String label) => find.widgetWithText(AppChip, label);

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  /// A new card's editor whose one 칸 is a Cloze sentence.
  Future<DeckScreens> openCloze(WidgetTester tester, {DeckScreens? on}) async {
    final screens = on ?? await DeckScreens.open(tester);
    await screens.push(
      (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
    );
    await replaceFirstBlock(screens, 'Cloze sentence');
    return screens;
  }

  Future<void> typeLine(WidgetTester tester, String line) async {
    await tester.ensureVisible(_line);
    await tester.enterText(_line, line);
    await tester.pump();
  }

  /// Selects [start] to [end] of the line, or puts the cursor at [start],
  /// the line focused, as a tap into it leaves it.
  Future<void> select(WidgetTester tester, int start, [int? end]) async {
    await tester.showKeyboard(_line);
    _controller(tester).selection = TextSelection(
      baseOffset: start,
      extentOffset: end ?? start,
    );
    await tester.pump();
  }

  /// Types into the focused line as the keyboard does: [text], the cursor
  /// after [cursor].
  Future<void> typeAt(WidgetTester tester, String text, int cursor) async {
    tester.testTextInput.updateEditingValue(
      TextEditingValue(
        text: text,
        selection: TextSelection.collapsed(offset: cursor),
      ),
    );
    await tester.pump();
  }

  Future<void> insertBlank(DeckScreens screens) =>
      screens.tap(find.text('Insert blank'));

  Future<void> save(DeckScreens screens) async {
    await screens.tester.ensureVisible(find.text('Save'));
    await screens.tap(find.text('Save'));
  }

  testWidgets(
    'Insert blank makes exactly the selected characters a blank, digits, subscripts and particles included, and the card reopens unchanged when saved as it was',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'H₂O예요');
      await select(tester, 0, 3);
      await insertBlank(screens);
      expect(_blocks(tester), ['H₂O']);
      await save(screens);
      final card = await _stored(screens);
      expect(card.front, [
        const ClozeContent('___예요', ['H₂O']),
      ]);
      expect(card.back, isEmpty, reason: 'a back is the blocks listed on it');

      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(_blocks(tester), ['H₂O'], reason: 'opens with its blank');
      await save(screens);
      expect((await _stored(screens)).front, card.front, reason: 'unchanged');

      await openCloze(tester, on: screens);
      await typeLine(tester, '서울은 한국의 수도예요');
      await select(tester, 0, 2);
      await insertBlank(screens);
      await save(screens);
      final cards = await screens.cards();
      expect(
        cards.map((card) => card.front.single),
        contains(const ClozeContent('___은 한국의 수도예요', ['서울'])),
        reason: 'the particle stays outside',
      );
      await screens.close();
    },
  );

  testWidgets(
    'Insert blank with no selection opens an empty blank at the cursor, what is typed into it becomes its answer, and one left empty goes',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, '물은 예요');
      await select(tester, 3);
      await insertBlank(screens);
      expect(
        _action('Undo blank'),
        findsOneWidget,
        reason: 'the caret is in the empty blank',
      );
      await typeAt(tester, '물은 H예요', 4);
      await typeAt(tester, '물은 H₂예요', 5);
      await typeAt(tester, '물은 H₂O예요', 6);
      expect(_blocks(tester), ['H₂O']);
      // The cursor leaves it: typing there is text again.
      await select(tester, 0);
      await typeAt(tester, '그 물은 H₂O예요', 2);
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('그 물은 ___예요', ['H₂O']),
      ]);

      await openCloze(tester, on: screens);
      await typeLine(tester, 'one two');
      await select(tester, 3);
      await insertBlank(screens);
      expect(_action('Undo blank'), findsOneWidget);
      await select(tester, 0);
      // Back where it was: no blank there any more.
      await select(tester, 3);
      expect(
        _action('Insert blank'),
        findsOneWidget,
        reason: 'left with nothing typed into it, it goes',
      );
      await screens.close();
    },
  );

  testWidgets(
    'the one action follows the caret: inside a blank it reads Undo blank, is named for a screen reader with that blank, and turns exactly that blank into text; elsewhere it reads Insert blank',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'a cat and a dog');
      await select(tester, 2, 5);
      await insertBlank(screens);
      await select(tester, 12, 15);
      await insertBlank(screens);
      expect(_blocks(tester), ['cat', 'dog']);

      await select(tester, 7);
      expect(_action('Insert blank'), findsOneWidget, reason: 'outside');
      expect(_action('Undo blank'), findsNothing);

      final handle = tester.ensureSemantics();
      await select(tester, 3);
      expect(_action('Undo blank'), findsOneWidget, reason: 'inside cat');
      expect(_action('Insert blank'), findsNothing);
      expect(find.bySemanticsLabel('Undo blank, cat'), findsOneWidget);
      await select(tester, 2, 5);
      expect(
        find.bySemanticsLabel('Undo blank, cat'),
        findsOneWidget,
        reason: 'the whole blank selected',
      );
      handle.dispose();

      await screens.tap(_action('Undo blank'));
      expect(_blocks(tester), ['dog'], reason: 'exactly that blank goes');
      expect(_controller(tester).text, 'a cat and a dog');
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('a cat and a ___', ['dog']),
      ]);
      await screens.close();
    },
  );

  testWidgets(
    'a tap on a blank of one or two characters puts the caret in it, so Undo blank turns it back into text',
    (tester) async {
      final screens = await openCloze(tester);
      for (final (line, blank) in [
        ('Paris is the capital of France', (start: 0, end: 1)),
        ('물은 산에서 흘러요', (start: 3, end: 4)),
        ('서울은 한국의 수도예요', (start: 0, end: 2)),
      ]) {
        await typeLine(tester, line);
        await select(tester, blank.start, blank.end);
        await insertBlank(screens);
        expect(_blocks(tester), [
          line.substring(blank.start, blank.end),
        ], reason: 'setup: $line');
        // Control: a caret one character away from the blank is outside it.
        await select(tester, blank.end + 1);
        expect(_action('Insert blank'), findsOneWidget, reason: line);

        // A tap just inside either edge of the blank, as a finger lands on
        // it, leaves the caret at that end.
        final editable = tester
            .state<EditableTextState>(
              find.descendant(of: _line, matching: find.byType(EditableText)),
            )
            .renderEditable;
        final [box] = editable.getBoxesForSelection(
          TextSelection(baseOffset: blank.start, extentOffset: blank.end),
        );
        final rect = box.toRect();
        for (final (x, end) in [
          (rect.left + 2, blank.start),
          (rect.right - 2, blank.end),
        ]) {
          await tester.tapAt(editable.localToGlobal(Offset(x, rect.center.dy)));
          await tester.pump(const Duration(milliseconds: 500));
          final caret = _controller(tester).selection;
          expect(caret.isCollapsed, isTrue, reason: 'setup: $line');
          expect(caret.baseOffset, end, reason: 'setup: $line');
          expect(_action('Undo blank'), findsOneWidget, reason: '$line, $end');
        }
        await screens.tap(_action('Undo blank'));
        expect(_blocks(tester), isEmpty, reason: line);
        expect(_controller(tester).text, line);
      }
      await screens.close();
    },
  );

  group('a selection in a Cloze sentence line', () {
    const sentence = 'Paris is the capital of France';
    const longer = '$sentence and the largest city in the country';
    const capital = TextSelection(baseOffset: 13, extentOffset: 20);
    final insert = _action('Insert blank');

    /// The line's own text layout.
    RenderEditable line(WidgetTester tester) => tester
        .state<EditableTextState>(
          find.descendant(of: _line, matching: find.byType(EditableText)),
        )
        .renderEditable;

    /// Where [offset] of the line meets the bottom of its text, on screen.
    Offset bottomOf(WidgetTester tester, int offset) {
      final editable = line(tester);
      final [point] = editable.getEndpointsForSelection(
        TextSelection.collapsed(offset: offset),
      );
      return editable.localToGlobal(point.point);
    }

    /// Opens the editor as the app root does, the front one Cloze sentence
    /// block holding [text], raises the keyboard over 300 of a phone's
    /// screen, and selects "capital" by a double-tap, as a user does.
    Future<DeckScreens> selectCapital(
      WidgetTester tester, [
      String text = sentence,
    ]) async {
      final screens = await openCloze(
        tester,
        on: await DeckScreens.open(tester, asAppRoot: true),
      );
      await typeLine(tester, text);
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      final word = bottomOf(tester, 16) - const Offset(0, 8);
      await tester.tapAt(word);
      await tester.pump(const Duration(milliseconds: 50));
      await tester.tapAt(word);
      await tester.pumpAndSettle();
      expect(
        _controller(tester).selection,
        capital,
        reason: 'setup: the double-tap selects the word',
      );
      expect(insert, findsOneWidget, reason: 'setup');
      return screens;
    }

    /// The middle of the selection's end handle as it is painted, over the
    /// screen rather than in the line: where a fingertip lands on it.
    Offset endHandle(WidgetTester tester) {
      // A handle answers a drag in any direction, and nothing else over
      // the editor does.
      final handles = find.descendant(
        of: find.byType(CompositedTransformFollower),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is RawGestureDetector &&
              widget.gestures.containsKey(PanGestureRecognizer),
        ),
      );
      expect(handles, findsNWidgets(2), reason: 'setup: start and end');
      final at = tester.getCenter(
        find.descendant(of: handles.last, matching: find.byType(CustomPaint)),
      );
      final hit = [
        for (final entry in tester.hitTestOnBinding(at).path) entry.target,
      ];
      expect(
        hit,
        contains(tester.renderObject(handles.last)),
        reason: 'setup: on the end handle',
      );
      expect(
        hit,
        isNot(contains(line(tester))),
        reason: 'setup: over the line, not in it',
      );
      return at;
    }

    /// The selection is where the double-tap left it and offered a blank;
    /// "Insert blank" then makes it one.
    Future<void> expectKept(DeckScreens screens) async {
      final tester = screens.tester;
      expect(tester.testTextInput.isVisible, isTrue);
      expect(_controller(tester).selection, capital);
      expect(insert, findsOneWidget);
      await tester.tap(insert);
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(AppChip, 'Undo blank'),
        findsOneWidget,
        reason: '"capital" is a blank',
      );
      // Control: a tap on what handles none, the deck's name, still
      // closes the keyboard.
      await tester.tap(find.text('French'));
      await tester.pumpAndSettle();
      expect(tester.testTextInput.isVisible, isFalse);
      await screens.close();
    }

    testWidgets('is kept through a tap on its end handle', (tester) async {
      final screens = await selectCapital(tester);
      await tester.tapAt(endHandle(tester));
      await tester.pumpAndSettle();
      await expectKept(screens);
    }, variant: _phones);

    testWidgets(
      'is kept through a nudge of its end handle shorter than a drag',
      (tester) async {
        final screens = await selectCapital(tester);
        final gesture = await tester.startGesture(endHandle(tester));
        await gesture.moveBy(const Offset(5, 0));
        await tester.pump();
        await gesture.up();
        await tester.pumpAndSettle();
        await expectKept(screens);
      },
      variant: _phones,
    );

    testWidgets(
      "is kept through a drag that starts on the line's text and scrolls the form",
      (tester) async {
        final screens = await selectCapital(tester, longer);
        final form = tester.state<ScrollableState>(
          find.ancestor(of: _line, matching: find.byType(Scrollable)).first,
        );
        expect(form.position.maxScrollExtent, greaterThan(0), reason: 'setup');
        // On the line's second row, under the selection and clear of
        // the toolbar over it.
        final start = bottomOf(tester, longer.length - 2) - const Offset(0, 8);
        expect(
          start.dy,
          greaterThan(bottomOf(tester, capital.end).dy),
          reason: 'setup: the line wraps',
        );
        expect(
          [
            for (final entry in tester.hitTestOnBinding(start).path)
              entry.target,
          ],
          contains(line(tester)),
          reason: "setup: on the line's text",
        );
        final drag = await tester.startGesture(start);
        for (var step = 0; step < 6; step++) {
          await drag.moveBy(const Offset(0, -10));
          await tester.pump();
        }
        await drag.up();
        await tester.pumpAndSettle();
        expect(form.position.pixels, greaterThan(0), reason: 'it scrolled');
        await expectKept(screens);
      },
      variant: _phones,
    );
  });

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme an empty blank is drawn in the line as a gap over a muted underline, and the line and the saved cloze are unchanged by it',
      (tester) async {
        final screens = await DeckScreens.open(tester, themeMode: mode);
        await openCloze(tester, on: screens);
        await typeLine(tester, '물은 예요');
        final drawn = find.byType(ClozeEmptyBlanks);
        final muted = AppColors.of(tester.element(_line)).muted;
        RenderEditable editable() => tester
            .state<EditableTextState>(
              find.descendant(of: _line, matching: find.byType(EditableText)),
            )
            .renderEditable;
        double caretAt(int offset) =>
            editable().getLocalRectForCaret(TextPosition(offset: offset)).left;
        final before = caretAt(3);
        await select(tester, 3);
        expect(drawn, isNot(paints..line()), reason: 'control: no blank');

        await insertBlank(screens);
        expect(_action('Undo blank'), findsOneWidget, reason: 'setup');
        expect(
          caretAt(3) - before,
          closeTo(emptyBlankWidth, 1),
          reason: 'a gap opens before the caret',
        );
        expect(drawn, paints..line(color: muted, strokeWidth: 1));
        expect(_controller(tester).text, '물은 예요', reason: 'no text added');

        await typeAt(tester, '물은 H₂O예요', 6);
        expect(drawn, isNot(paints..line()), reason: 'filled, it is a block');
        expect(_blocks(tester), ['H₂O']);
        await save(screens);
        expect((await _stored(screens)).front, [
          const ClozeContent('물은 ___예요', ['H₂O']),
        ]);
        await screens.close();
      },
    );
  }

  testWidgets(
    'the word chips, Pick letters, the blank list, the hint and any row of blank chips are gone, and the line draws its blanks as blocks in place',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'The cat sat');
      expect(find.byType(FilterChip), findsNothing);
      expect(find.text('Tap the words to make blanks'), findsNothing);
      await select(tester, 4, 7);
      await insertBlank(screens);
      expect(find.text('Pick letters'), findsNothing);
      expect(find.textContaining('Blank 1'), findsNothing);
      expect(find.byType(InputChip), findsNothing, reason: 'no chip row');
      expect(_blocks(tester), ['cat']);
      await screens.close();
    },
  );

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the preview draws the cloze whole on one face, each blank a block with its answer, an empty one included',
      (tester) async {
        final screens = await DeckScreens.open(tester, themeMode: mode);
        await openCloze(tester, on: screens);
        await typeLine(tester, 'The cat sat');
        await select(tester, 4, 7);
        await insertBlank(screens);
        await select(tester, 11);
        await insertBlank(screens);
        await screens.tap(find.text('Preview'));
        final preview = find.byType(CardPreviewScreen);
        expect(
          find.descendant(of: preview, matching: find.byType(WholeCardView)),
          findsOneWidget,
        );
        expect(
          find.descendant(of: preview, matching: find.byType(VerticalDivider)),
          findsNothing,
          reason: 'one face, no split card',
        );
        expect(find.text('Front'), findsNothing, reason: 'one face: no side');
        // The blanks as blocks of their answers on brandTint.
        List<String> blocks() {
          final colors = AppColors.of(tester.element(preview));
          final blocks = <String>[];
          for (final paragraph in tester.widgetList<RichText>(
            find.descendant(of: preview, matching: find.byType(RichText)),
          )) {
            paragraph.text.visitChildren((span) {
              if (span is TextSpan &&
                  span.style?.backgroundColor == colors.brandTint) {
                blocks.add(blankAnswer(span.text!));
              }
              return true;
            });
          }
          return blocks;
        }

        expect(blocks(), isEmpty, reason: 'the blanks empty, as study asks');
        expect(shownText('Tap the card to see the answer'), findsOneWidget);
        await screens.tap(preview);
        expect(blocks(), ['cat', '']);
        expect(shownText('Tap again to empty its blanks'), findsOneWidget);
        await screens.close();
      },
    );
  }

  testWidgets(
    'typing elsewhere in the line keeps the blanks, and a blank the edit changes is left out',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'a cat and a dog');
      await select(tester, 10, 11);
      await insertBlank(screens);
      await select(tester, 2, 5);
      await insertBlank(screens);
      await select(tester, 12, 15);
      await insertBlank(screens);
      // The first "a" becomes "one", "cat" becomes "cot", and "big" comes in.
      await typeLine(tester, 'one cat and a dog');
      await typeLine(tester, 'one cot and a dog');
      await typeLine(tester, 'one cot and a big dog');
      expect(_blocks(tester), ['a', 'dog'], reason: 'a changed blank goes');
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('one cot and ___ big ___', ['a', 'dog']),
      ]);
      await screens.close();
    },
  );

  testWidgets(
    'a line with no blank is refused with a message under it, and saves once one is inserted',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'The cat sat');
      await save(screens);
      expect(shownText('Insert at least one blank'), findsOneWidget);
      // Broken only between words, and read as written.
      final message = tester.widget<Text>(
        shownText('Insert at least one blank'),
      );
      expect(message.data, keepWords('Insert at least one blank'));
      expect(message.semanticsLabel, 'Insert at least one blank');
      expect(find.byType(SnackBar), findsNothing);
      expect(await screens.cards(), isEmpty);

      await select(tester, 8, 11);
      await insertBlank(screens);
      expect(shownText('Insert at least one blank'), findsNothing);
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('The cat ___', ['sat']),
      ], reason: 'control: with a blank, it saves');
      await screens.close();
    },
  );

  testWidgets(
    'a stored blank inside a word is kept through a save and an edit elsewhere',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const cloze = ClozeContent('It is un___able', ['believ']);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [cloze],
          back: [const TextContent('It is unbelievable')],
        ),
      );
      final card = await _stored(screens);
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(_blocks(tester), ['believ']);
      await save(screens);
      expect((await _stored(screens)).front, [cloze]);

      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      await select(tester, 0, 2);
      await insertBlank(screens);
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('___ is un___able', ['It', 'believ']),
      ], reason: 'another blank added, the stored one keeps its letters');
      await screens.close();
    },
  );

  testWidgets(
    'an imported list cloze keeps its four blanks through a fix elsewhere in the line',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const answers = ['자기', '자신', '저', '저희'];
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [const ClozeContent('3인칭 재귀칭: ___, ___, ___, ___', answers)],
          back: [const TextContent('3인칭 재귀칭: 자기, 자신, 저, 저희')],
        ),
      );
      final card = await _stored(screens);
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      await typeLine(tester, '3인칭 재귀칭 : 자기, 자신, 저, 저희');
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('3인칭 재귀칭 : ___, ___, ___, ___', answers),
      ]);
      await screens.close();
    },
  );

  testWidgets(
    'a cloze whose filled line is already a card opens the duplicate sheet',
    (tester) async {
      final screens = await DeckScreens.open(
        tester,
        cards: {'The cat sat': '고양이가 앉았다'},
      );
      await openCloze(tester, on: screens);
      await typeLine(tester, ' the cat sat ');
      await select(tester, 5, 8);
      await insertBlank(screens);
      await save(screens);
      expect(find.text('Add anyway'), findsOneWidget);
      expect((await screens.cards()).length, 1);
      await screens.close();
    },
  );

  testWidgets(
    'a new line holding ___ or a longer run of underscores is refused with a message under it, and the deck still lists',
    (tester) async {
      final screens = await openCloze(tester);
      for (final line in ['capital ___ Paris', 'capital ____ Paris']) {
        await typeLine(tester, line);
        await select(tester, line.length - 5, line.length);
        // The second line keeps the first one's blank on "Paris".
        if (_action('Insert blank').evaluate().isNotEmpty) {
          await insertBlank(screens);
        }
        await save(screens);
        expect(
          shownText('Remove ___ from the line'),
          findsOneWidget,
          reason: line,
        );
        expect(find.byType(SnackBar), findsNothing);
        expect(await screens.cards(), isEmpty, reason: 'it lists, empty');
      }

      await typeLine(tester, 'capital of France Paris');
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('capital of France ___', ['Paris']),
      ], reason: 'control: without the underscores, it saves');
      await screens.close();
    },
  );

  testWidgets(
    'an edit of a stored cloze that types ___ into its line is refused, the card is kept as stored, and the deck still lists',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const cloze = ClozeContent('a ___ b', ['x']);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [cloze],
          back: [const TextContent('a x b')],
        ),
      );
      final card = await _stored(screens);
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      await typeLine(tester, 'a x b ___ c');
      await save(screens);
      expect(shownText('Remove ___ from the line'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      expect((await _stored(screens)).front, [cloze]);

      await typeLine(tester, 'a x b c');
      await save(screens);
      expect((await _stored(screens)).front, [
        const ClozeContent('a ___ b c', ['x']),
      ], reason: 'control: without the underscores, the edit saves');
      await screens.close();
    },
  );

  testWidgets(
    'while the line has focus its action is an outlined chip under it, so the editor shows one primary fill, inside a blank and outside one',
    (tester) async {
      final screens = await openCloze(tester);
      await typeLine(tester, 'The cat sat');
      Iterable<AppButton> primaries() => tester
          .widgetList<AppButton>(find.byType(AppButton))
          .where((button) => button.variant == AppButtonVariant.primary);
      for (final (start, end, action) in [
        (4, 7, 'Insert blank'),
        (5, 5, 'Undo blank'),
      ]) {
        await select(tester, start, end);
        if (action == 'Undo blank') {
          // Inside the blank "cat", made by the first round.
          expect(_blocks(tester), ['cat'], reason: 'the setup: a blank');
        }
        // Control: the action is on screen.
        expect(_action(action), findsOneWidget, reason: action);
        expect(
          [for (final button in primaries()) button.label],
          ['Save and next card'],
          reason: action,
        );
        // Right under the line, not in a bar over the keyboard.
        expect(
          tester.getTopLeft(_action(action)).dy,
          greaterThan(tester.getBottomLeft(_line).dy - 1),
          reason: action,
        );
        if (action == 'Insert blank') await insertBlank(screens);
      }
      await screens.close();
    },
  );

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme a Cloze sentence block meets the tap target, label and contrast guidelines',
      (tester) async {
        final screens = await DeckScreens.open(tester, themeMode: mode);
        await openCloze(tester, on: screens);
        await typeLine(tester, 'The cat sat');
        await select(tester, 4, 7);
        await insertBlank(screens);
        final handle = tester.ensureSemantics();
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(iOSTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        handle.dispose();
        await screens.close();
      },
    );
  }
}
