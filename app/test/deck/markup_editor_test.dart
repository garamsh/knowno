import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/editor_group.dart';
import 'package:knowno/deck/src/image_download.dart';
import 'package:knowno/deck/src/markup_editing.dart';
import 'package:knowno/design/app_chip.dart';
import 'package:knowno/media/media.dart';

import '../home/deck_screens.dart';
import '../media/fakes.dart';
import '../settle_until.dart';
import '../word_breaks.dart';
import 'editor.dart';

/// The preview drawn under the first field, or null where none is drawn.
String? _preview(WidgetTester tester) {
  final texts = find.descendant(
    of: find.byType(MarkupPreview),
    matching: find.byType(Text),
  );
  if (texts.evaluate().isEmpty) return null;
  return tester
      .widget<Text>(texts.first)
      .textSpan!
      .toPlainText(includeSemanticsLabels: false)
      .replaceAll('⁠', '');
}

/// The weight [span] draws the text [word] in, found among its leaves with
/// the weights they inherit, or null where it sets none.
FontWeight? _weightOf(InlineSpan span, String word, [FontWeight? inherited]) {
  if (span is! TextSpan) return null;
  final weight = span.style?.fontWeight ?? inherited;
  if (span.text?.replaceAll('⁠', '').trim() == word) return weight;
  for (final child in span.children ?? const <InlineSpan>[]) {
    final found = _weightOf(child, word, weight);
    if (found != null) return found;
  }
  return null;
}

TextEditingController _controller(WidgetTester tester, [int index = 0]) =>
    tester.widget<TextField>(blockField(index)).controller!;

Future<DeckScreens> _openNew(
  WidgetTester tester, {
  List<Override> overrides = const [],
}) async {
  final screens = await DeckScreens.open(tester, overrides: overrides);
  await screens.push(
    (deck) =>
        CardEditorScreen(deck: deck, preview: (cells) => const SizedBox()),
  );
  return screens;
}

Future<void> _save(DeckScreens screens) async {
  await screens.tester.ensureVisible(shownText('Save'));
  await screens.tap(shownText('Save'));
}

/// Puts the cursor at [start], or selects [start] to [end], in the focused
/// field [index], as a tap or a drag leaves it.
Future<void> _select(
  WidgetTester tester,
  int start, [
  int? end,
  int index = 0,
]) async {
  await tester.showKeyboard(blockField(index));
  _controller(tester, index).selection = TextSelection(
    baseOffset: start,
    extentOffset: end ?? start,
  );
  await tester.pump();
}

/// A media store over memory, closed with the test.
MediaStore _store() {
  final directory = newMediaDirectory();
  addTearDown(() => deleteMediaDirectory(directory));
  final db = AppDatabase(NativeDatabase.memory());
  addTearDown(db.close);
  return MediaStore(
    db,
    FakeMediaServer(),
    directory: directory,
    clock: () => DateTime.utc(2026, 11, 9),
    newId: () => 'pasted-photo',
  );
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  group('a new Text (text version 3)', () {
    testWidgets('is saved as markup, its parts as typed', (tester) async {
      final screens = await _openNew(tester);
      await typeBlock(tester, '**apple** is a *fruit*');
      await typeBlock(tester, '- red\n- green', 1);
      await _save(screens);
      final card = (await screens.cards()).single;
      expect(card.cells, const [
        TextCell(
          front: '**apple** is a *fruit*',
          back: '- red\n- green',
          markup: true,
        ),
      ]);
      await screens.close();
    });

    testWidgets(
      'shows the formatting as it is typed, and nothing for plain text',
      (tester) async {
        final screens = await _openNew(tester);
        expect(_preview(tester), isNull);
        await typeBlock(tester, 'plain words');
        expect(_preview(tester), isNull, reason: 'plain text reads as written');
        await typeBlock(tester, '**bold** and `code`\n- one\n- two');
        expect(_preview(tester), 'bold and code\n• one\n• two');
        final preview = tester.widget<Text>(
          find
              .descendant(
                of: find.byType(MarkupPreview),
                matching: find.byType(Text),
              )
              .first,
        );
        expect(_weightOf(preview.textSpan!, 'bold'), FontWeight.w700);
        expect(_weightOf(preview.textSpan!, 'and'), isNull, reason: 'control');
        await screens.close();
      },
    );

    testWidgets(
      'goes on with a list as a line is broken, and ends it on an empty item',
      (tester) async {
        final screens = await _openNew(tester);
        await tester.ensureVisible(blockField());
        await tester.enterText(blockField(), '- one');
        await tester.pump();
        await tester.enterText(blockField(), '- one\n');
        await tester.pump();
        expect(_controller(tester).text, '- one\n- ');
        await tester.enterText(blockField(), '- one\n- two');
        await tester.pump();
        await tester.enterText(blockField(), '- one\n- two\n');
        await tester.pump();
        expect(_controller(tester).text, '- one\n- two\n- ');
        await tester.enterText(blockField(), '- one\n- two\n- \n');
        await tester.pump();
        expect(_controller(tester).text, '- one\n- two\n\n', reason: 'ended');
        await tester.enterText(blockField(), '1. a');
        await tester.pump();
        await tester.enterText(blockField(), '1. a\n');
        await tester.pump();
        expect(_controller(tester).text, '1. a\n2. ');
        await screens.close();
      },
    );
  });

  group('a Text stored before markup', () {
    /// A card holding [text] as a literal 글, opened in the editor.
    Future<DeckScreens> openStored(WidgetTester tester, String text) async {
      final screens = await DeckScreens.open(tester);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [TextContent(text)],
          back: [const TextContent('back')],
        ),
      );
      final card = (await screens.cards()).single;
      await screens.push(
        (deck) => CardEditorScreen(
          deck: deck,
          card: card,
          preview: (cells) => const SizedBox(),
        ),
      );
      return screens;
    }

    testWidgets(
      'is shown as written, with no preview, and stored as it was while unchanged',
      (tester) async {
        final screens = await openStored(tester, '*not italic* {{c1::x}}');
        expect(_controller(tester).text, '*not italic* {{c1::x}}');
        expect(_preview(tester), isNull);
        await _save(screens);
        expect((await screens.cards()).single.cells, const [
          TextCell(front: '*not italic* {{c1::x}}', back: 'back'),
        ], reason: 'a literal 글 as it was, in the frame');
        await screens.close();
      },
    );

    for (final (name, typed) in [
      ('a literal asterisk', '2 * 3 and *a* **b**'),
      ('a cloze opener', 'type {{c1::x}} as text'),
      ('a run of blank lines', 'one\n\n\n\ntwo'),
      ('CRLF line ends', 'one\r\ntwo'),
      ('a line that reads as a list', '- not a list\n1. nor this'),
      ('an underscore word and a backtick', 'snake_case `x`'),
    ]) {
      testWidgets(
        'edited, it is written as version 3 and reads back as the same text: $name',
        (tester) async {
          final screens = await openStored(tester, 'old');
          await typeBlock(tester, typed);
          await typeBlock(tester, 'b $typed', 1);
          await _save(screens);
          final cell = (await screens.cards()).single.cells!.single as TextCell;
          expect(cell.back, markupEngine.escapeLiteral('b $typed'));
          expect(cell.markup, isTrue, reason: 'version 3');
          expect(cell.front, markupEngine.escapeLiteral(typed));
          expect(
            markupEngine.plainText(cell.front),
            typed.replaceAll('\r\n', '\n'),
            reason: 'it says what the user typed',
          );
          // Control: a text that needs no escape is written as typed.
          expect(markupEngine.escapeLiteral('plain'), 'plain');
          await screens.close();
        },
      );
    }
  });

  group('a new Cloze sentence (cloze version 2)', () {
    Future<DeckScreens> openCloze(WidgetTester tester) async {
      final screens = await _openNew(tester);
      await replaceFirstBlock(screens, 'Cloze sentence');
      return screens;
    }

    testWidgets('wraps the selection in the next free number with Hide', (
      tester,
    ) async {
      final screens = await openCloze(tester);
      await typeBlock(tester, 'The cat sat on the mat');
      await _select(tester, 4, 7);
      await screens.tap(shownText('Hide'));
      expect(_controller(tester).text, 'The {{c1::cat}} sat on the mat');
      await _select(tester, 27, 30);
      await screens.tap(shownText('Hide'));
      expect(
        _controller(tester).text,
        'The {{c1::cat}} sat on the {{c2::mat}}',
      );
      // The number freed is the next one.
      _controller(tester).text = 'The {{c2::cat}} sat on the mat';
      await _select(tester, 27, 30);
      await screens.tap(shownText('Hide'));
      expect(
        _controller(tester).text,
        'The {{c2::cat}} sat on the {{c1::mat}}',
      );
      await screens.close();
    });

    testWidgets(
      'offers to remove a cloze the cursor is in, and puts its text back',
      (tester) async {
        final screens = await openCloze(tester);
        await typeBlock(tester, 'The {{c1::cat::animal}} sat');
        await _select(tester, 3);
        expect(
          widgetWithShownText(AppChip, 'Hide'),
          findsOneWidget,
          reason: 'outside',
        );
        await _select(tester, 11);
        expect(widgetWithShownText(AppChip, 'Hide'), findsNothing);
        await screens.tap(widgetWithShownText(AppChip, 'Show again'));
        expect(_controller(tester).text, 'The cat sat');
        await screens.close();
      },
    );

    testWidgets(
      'draws each cloze as a blank with its hint, and is saved as version 2',
      (tester) async {
        final screens = await openCloze(tester);
        await typeBlock(
          tester,
          'The {{c1::cat::animal}} sat on the {{c2::mat}}',
        );
        expect(_preview(tester), 'The  animal  sat on the  mat ');
        await _save(screens);
        final card = (await screens.cards()).single;
        expect(card.cells, const [
          BlankCell(
            ClozeContent.markup(
              'The {{c1::cat::animal}} sat on the {{c2::mat}}',
            ),
          ),
        ]);
        await screens.close();
      },
    );

    testWidgets('is refused with no cloze, and saves once it has one', (
      tester,
    ) async {
      final screens = await openCloze(tester);
      await typeBlock(tester, 'The cat sat');
      await _save(screens);
      expect(shownText('Insert at least one blank'), findsOneWidget);
      expect(await screens.cards(), isEmpty);
      // Control: braces that are no cloze do not count.
      await typeBlock(tester, 'The {{c1::}} sat');
      await _save(screens);
      expect(await screens.cards(), isEmpty);
      await typeBlock(tester, 'The {{c1::cat}} sat');
      await _save(screens);
      expect(shownText('Insert at least one blank'), findsNothing);
      expect(await screens.cards(), hasLength(1));
      await screens.close();
    });

    testWidgets('is a duplicate of a card whose text is what it fills in to', (
      tester,
    ) async {
      final screens = await DeckScreens.open(
        tester,
        cards: {'The cat sat': '고양이가 앉았다'},
      );
      await screens.push(
        (deck) =>
            CardEditorScreen(deck: deck, preview: (cells) => const SizedBox()),
      );
      await replaceFirstBlock(screens, 'Cloze sentence');
      await typeBlock(tester, ' The {{c1::cat}} sat ');
      await _save(screens);
      expect(shownText('Add anyway'), findsOneWidget);
      expect((await screens.cards()).length, 1);
      await screens.close();
    });
  });

  group('Markdown pasted into a Text', () {
    testWidgets(
      'makes a table a 표 in place of the empty 글, and keeps the text around it',
      (tester) async {
        final screens = await _openNew(tester);
        await typeBlock(
          tester,
          'Capitals\n| 나라 | 수도 |\n|---|---|\n| 한국 | 서울 |\n| 일본 | 도쿄 |\nthe end',
        );
        await tester.pumpAndSettle();
        // The empty 글 is the first of three: text, table, text.
        expect(find.byType(EditorGroup), findsNWidgets(3));
        expect(
          find.descendant(of: blockList, matching: shownText('Table')),
          findsOneWidget,
        );
        expect(find.widgetWithText(TextField, 'Capitals'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'the end'), findsOneWidget);
        expect(find.widgetWithText(TextField, '서울'), findsOneWidget);
        await screens.close();
      },
    );

    testWidgets(
      'leaves a paste of text alone, and a table typed in a 글 that has text goes after it',
      (tester) async {
        final screens = await _openNew(tester);
        await typeBlock(tester, 'line one\nline two\nline three');
        expect(find.byType(EditorGroup), findsNWidgets(1));
        expect(_controller(tester).text, 'line one\nline two\nline three');
        await typeBlock(
          tester,
          'line one\nline two\nline three\n| a | b |\n|---|---|\n| 1 | 2 |',
        );
        await tester.pumpAndSettle();
        expect(
          find.byType(EditorGroup),
          findsNWidgets(2),
          reason: 'the 글 stays',
        );
        await screens.close();
      },
    );

    testWidgets('makes an https image a 사진, fetched and stored as a pick is', (
      tester,
    ) async {
      final media = _store();
      final fetched = <Uri>[];
      final screens = await _openNew(
        tester,
        overrides: [
          mediaStoreProvider.overrideWithValue(media),
          imageDownloadProvider.overrideWithValue((url) async {
            fetched.add(url);
            return preparedWholeImage(160, 90).bytes;
          }),
        ],
      );
      await typeBlock(tester, '![a map](https://example.test/map.png)');
      await tester.pumpAndSettle();
      await settleUntil(
        tester,
        'the pasted photo is chosen',
        () => shownText('Choose another photo').evaluate().isNotEmpty,
      );
      expect(fetched, [Uri.parse('https://example.test/map.png')]);
      expect(
        find.descendant(of: blockList, matching: shownText('Photo')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: blockList, matching: find.byType(TextField)),
        findsNothing,
      );
      await screens.close();
    });

    testWidgets('says a photo that cannot be had, and leaves the 사진 to pick', (
      tester,
    ) async {
      final screens = await _openNew(
        tester,
        overrides: [
          mediaStoreProvider.overrideWithValue(_store()),
          imageDownloadProvider.overrideWithValue((url) async => null),
        ],
      );
      await typeBlock(tester, '![a map](https://example.test/map.png)');
      await tester.pumpAndSettle();
      expect(shownText('Could not get the pasted photo'), findsOneWidget);
      expect(
        find.descendant(of: blockList, matching: shownText('Photo')),
        findsOneWidget,
      );
      expect(shownText('Choose another photo'), findsNothing);
      await screens.close();
    });
  });
}
