import 'dart:convert';
import 'dart:io';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:drift/native.dart';
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/deck/src/card_preview.dart';
import 'package:knowno/study/study.dart' show CardPreviewScreen;
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/word_break.dart';
import 'package:knowno/media/media.dart';

import '../home/deck_screens.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';
import 'editor.dart';

/// The text the preview screen's card shows, its word joiners left out.
List<String> _previewText(WidgetTester tester) => [
  for (final text in tester.widgetList<Text>(
    find.descendant(
      of: find.byType(CardPreviewScreen),
      matching: find.byType(Text),
    ),
  ))
    ?(text.data ?? text.textSpan?.toPlainText())?.replaceAll('\u2060', ''),
]..remove('Preview');

/// The text of every stored card, front and back.
Future<List<(String, String)>> _stored(DeckScreens screens) async => [
  for (final card in await screens.cards())
    (plainText(card.front), plainText(card.back)),
];

/// Whether the first 글's 앞면 has the focus.
bool _focused(WidgetTester tester) => tester
    .widget<EditableText>(
      find.descendant(of: blockField(), matching: find.byType(EditableText)),
    )
    .focusNode
    .hasFocus;

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  Future<DeckScreens> openNew(
    WidgetTester tester, {
    Map<String, String> cards = const {},
  }) async {
    final screens = await DeckScreens.open(tester, cards: cards);
    await screens.push(
      (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
    );
    return screens;
  }

  testWidgets(
    'the editor shows no preview of its own: Preview opens the preview it is handed over the card\'s 칸, its front, a tap shows it answered, front over back, and another back to its front',
    (tester) async {
      final screens = await openNew(tester);
      expect(find.text('New card'), findsOneWidget);
      expect(find.text('French'), findsOneWidget);
      expect(find.byType(CardPreview), findsNothing);
      await typeBlock(tester, 'Chat');
      await typeBlock(tester, 'cat', 1);

      await screens.tap(find.text('Preview'));
      expect(find.byType(CardPreviewScreen), findsOneWidget);
      expect(_previewText(tester), ['Chat', 'Tap the card to see the answer']);
      await screens.tap(find.byType(CardPreviewScreen));
      expect(_previewText(tester), [
        'Chat',
        'cat',
        'Tap again to go back to the front',
      ]);
      await screens.tap(find.byType(CardPreviewScreen));
      expect(_previewText(tester), ['Chat', 'Tap the card to see the answer']);

      await screens.tap(find.byTooltip('Close'));
      expect(find.byType(CardPreviewScreen), findsNothing);
      expect(find.widgetWithText(TextField, 'Chat'), findsOneWidget);
      await screens.close();
    },
  );

  testWidgets(
    'with the keyboard up, both save actions sit above it and add cards in a row, and an edit Save does too',
    (tester) async {
      final screens = await openNew(tester);
      // A phone keyboard 336 high over the 844 high screen.
      tester.view.viewInsets = const FakeViewPadding(bottom: 336);
      addTearDown(tester.view.resetViewInsets);
      await tester.pumpAndSettle();
      const keyboardTop = 844.0 - 336;
      expect(
        // The editor's own scaffold, over the form's, which takes no inset.
        MediaQuery.viewInsetsOf(
          tester.element(
            find
                .descendant(
                  of: find.byType(CardEditorScreen),
                  matching: find.byType(Scaffold),
                )
                .first,
          ),
        ).bottom,
        336,
        reason: 'the setup: the keyboard is up',
      );

      for (final action in ['Save', 'Save and next card']) {
        expect(
          tester.getRect(find.text(action)).bottom,
          lessThanOrEqualTo(keyboardTop),
          reason: action,
        );
      }
      for (final (front, back) in [('Chat', 'cat'), ('Chien', 'dog')]) {
        await typeBlock(tester, front);
        await typeBlock(tester, back, 1);
        await tester.tap(find.text('Save and next card'), warnIfMissed: false);
        await tester.pumpAndSettle();
      }
      final cards = await _stored(screens);
      expect(cards, unorderedEquals([('Chat', 'cat'), ('Chien', 'dog')]));

      await tester.tap(find.byTooltip('Close'));
      await tester.pumpAndSettle();
      final card = (await screens.cards()).first;
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(
        tester.getRect(find.text('Save')).bottom,
        lessThanOrEqualTo(keyboardTop),
        reason: 'editing',
      );
      await screens.close();
    },
  );

  group('leaving', () {
    testWidgets(
      'with changes, Close and the system back ask first: Keep writing stays with the text, Discard leaves and stores nothing',
      (tester) async {
        final screens = await openNew(tester);
        await typeBlock(tester, 'ephemeral');
        await typeBlock(tester, '덧없는', 1);

        await screens.tap(find.byTooltip('Close'));
        expect(shownText('Discard this card?'), findsOneWidget);
        await screens.tap(find.text('Keep writing'));
        expect(find.byType(CardEditorScreen), findsOneWidget);
        expect(find.widgetWithText(TextField, 'ephemeral'), findsOneWidget);

        // Android's back, as the platform sends it.
        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(shownText('Discard this card?'), findsOneWidget);
        await screens.tap(find.text('Discard'));
        expect(find.byType(CardEditorScreen), findsNothing);
        expect(await screens.cards(), isEmpty);
        await screens.close();
      },
    );

    testWidgets(
      'without changes, Close leaves at once, and Save and next card starts unchanged again',
      (tester) async {
        final screens = await openNew(tester);
        await screens.tap(find.byTooltip('Close'));
        expect(shownText('Discard this card?'), findsNothing);
        expect(find.byType(CardEditorScreen), findsNothing);

        await screens.push(
          (deck) => CardEditorScreen(preview: studyPreview, deck: deck),
        );
        await typeBlock(tester, 'Chat');
        await typeBlock(tester, 'cat', 1);
        await screens.tap(find.text('Save and next card'));
        await screens.tap(find.byTooltip('Close'));
        expect(find.byType(CardEditorScreen), findsNothing);
        expect(await _stored(screens), [('Chat', 'cat')]);
        await screens.close();
      },
    );

    testWidgets(
      'with changes the route refuses a pop, which disables the iOS back swipe, and without it allows one',
      (tester) async {
        final screens = await openNew(tester);
        // What the iOS back swipe asks before it starts.
        RoutePopDisposition disposition() =>
            ModalRoute.of(tester.element(find.byType(CardEditorScreen)))!
                .popDisposition;
        expect(disposition(), RoutePopDisposition.pop);

        await typeBlock(tester, 'ephemeral');
        expect(disposition(), RoutePopDisposition.doNotPop);
        await screens.close();
      },
    );
  });

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      'at $scale times the text size a long deck name leaves the title readable and nothing in the top bar overflows, for a new card and an edited one',
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
        const name = '토익 실전 어휘 900 — 2026 개정판 Part 5 & 6 집중 대비 단어장';
        final deck = Deck(
          id: screens.deck.id,
          name: name,
          createdAt: screens.deck.createdAt,
          updatedAt: screens.deck.updatedAt,
        );
        final card = (await screens.cards()).single;
        for (final (title, editor) in [
          ('New card', CardEditorScreen(preview: studyPreview, deck: deck)),
          (
            'Edit card',
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
          ),
        ]) {
          await screens.push((_) => editor);
          expect(tester.takeException(), isNull, reason: title);
          expect(find.text(title), findsOneWidget);
          // The title is drawn whole, inside the screen.
          expect(tester.getRect(find.text(title)).right, lessThan(390));
          expect(find.text(name), findsOneWidget, reason: 'the deck shows');
          await screens.tap(find.byTooltip('Close'));
        }
        await screens.close();
      },
    );
  }

  testWidgets('Save stores the card and closes the editor', (tester) async {
    final screens = await openNew(tester);

    await typeBlock(tester, 'Chat');
    await typeBlock(tester, 'cat', 1);
    await screens.tap(find.text('Save'));

    expect(find.byType(CardEditorScreen), findsNothing);
    expect(await _stored(screens), [('Chat', 'cat')]);
    await screens.close();
  });

  testWidgets(
    'Save and next card stores the card and leaves the editor open and empty, focused on the front',
    (tester) async {
      final screens = await openNew(tester);
      await typeBlock(tester, 'Chat');
      await typeBlock(tester, 'cat', 1);
      await tester.showKeyboard(find.widgetWithText(TextField, 'cat'));
      // Control: focus has left the front before the save.
      expect(_focused(tester), isFalse);

      await screens.tap(find.text('Save and next card'));

      expect(find.byType(CardEditorScreen), findsOneWidget);
      expect(await _stored(screens), [('Chat', 'cat')]);
      expect(find.widgetWithText(TextField, 'Chat'), findsNothing);
      expect(find.widgetWithText(TextField, 'cat'), findsNothing);
      expect(_focused(tester), isTrue);

      await typeBlock(tester, 'Chien');
      await typeBlock(tester, 'dog', 1);
      await screens.tap(find.text('Save and next card'));
      expect(await _stored(screens), [('Chat', 'cat'), ('Chien', 'dog')]);
      await screens.close();
    },
  );

  testWidgets('a saved card gives one light haptic, and a refused save none', (
    tester,
  ) async {
    final haptics = <String>[];
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      (call) async {
        if (call.method == 'HapticFeedback.vibrate') {
          haptics.add(call.arguments as String);
        }
        return null;
      },
    );
    addTearDown(
      () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        null,
      ),
    );
    final screens = await openNew(tester);
    await typeBlock(tester, 'Chat');
    await screens.tap(find.text('Save and next card'));
    expect(shownText('Add a back or a blank'), findsOneWidget);
    expect(haptics, isEmpty, reason: 'refused');

    await typeBlock(tester, 'cat', 1);
    await screens.tap(find.text('Save and next card'));
    expect(await _stored(screens), [('Chat', 'cat')]);
    expect(haptics, ['HapticFeedbackType.lightImpact']);
    await screens.close();
  });

  group('a card of each fixture placement', () {
    final fixtures = (jsonDecode(
      File('../supabase/fixtures/card-frame/conversion.json')
          .readAsStringSync(),
    ) as List<Object?>).cast<Map<String, Object?>>();
    List<Content> blocks(Object? stored) => decodeContent(jsonEncode(stored));

    test('the fixtures name each placement', () {
      for (var number = 1; number <= 7; number++) {
        expect(
          fixtures.where(
            (fixture) =>
                (fixture['name'] as String).contains('placement $number'),
          ),
          isNotEmpty,
          reason: 'placement $number',
        );
      }
    });

    /// A store whose files no test writes, so a photo is drawn as its fallback.
    List<Override> media() => [
      mediaStoreProvider.overrideWithValue(
        MediaStore(
          AppDatabase(NativeDatabase.memory()),
          FakeMediaServer(),
          directory: unusedMediaDirectory,
          clock: DateTime.now,
          newId: () => 'unused',
        ),
      ),
    ];

    bool valid(Map<String, Object?> fixture) =>
        frameProblem(decodeCells(jsonEncode(fixture['cells']))) == null;

    test('every fixture but the one card with no back is valid', () {
      expect(
        [
          for (final fixture in fixtures)
            if (fixture['cells'] != null && !valid(fixture)) fixture['name'],
        ],
        ['no blank: front senses alone keep their meanings first'],
      );
    });

    for (final fixture in fixtures.where(
      (f) => f['cells'] != null && valid(f),
    )) {
      testWidgets('opens, saves and reads back: ${fixture['name']}', (
        tester,
      ) async {
        final screens = await DeckScreens.open(tester, overrides: media());
        await tester.runAsync(
          () => screens.repository.addCard(
            screens.deck.id,
            front: blocks(fixture['front']),
            back: blocks(fixture['back']),
          ),
        );
        final card = (await screens.cards()).single;
        expect(
          (card.template, card.templateVersion, card.cells),
          ('free', 1, null),
          reason: 'the setup stores a card of two side lists',
        );
        await screens.push(
          (deck) =>
              CardEditorScreen(preview: studyPreview, deck: deck, card: card),
        );
        await tapVisible(screens, find.text('Save'));
        expect(find.byType(CardEditorScreen), findsNothing);
        final saved = (await screens.cards()).single;
        expect((saved.template, saved.templateVersion), ('free', 2));
        expect(saved.cells, decodeCells(jsonEncode(fixture['cells'])));
        await screens.close();
      });
    }

    testWidgets(
      'a card that fails validity opens and is refused, as it was before the frame, and stays as stored',
      (tester) async {
        final fixture = fixtures.singleWhere(
          (f) => f['cells'] != null && !valid(f),
        );
        final screens = await DeckScreens.open(tester);
        await tester.runAsync(
          () => screens.repository.addCard(
            screens.deck.id,
            front: blocks(fixture['front']),
            back: blocks(fixture['back']),
          ),
        );
        final card = (await screens.cards()).single;
        await screens.push(
          (deck) =>
              CardEditorScreen(preview: studyPreview, deck: deck, card: card),
        );
        await tapVisible(screens, find.text('Save'));
        expect(shownText('Add a back or a blank'), findsOneWidget);
        expect((await screens.cards()).single.templateVersion, 1);
        await screens.close();
      },
    );

    for (final fixture in fixtures.where((f) => f['cells'] == null)) {
      testWidgets('opens read-only: ${fixture['name']}', (tester) async {
        final screens = await DeckScreens.open(tester);
        await tester.runAsync(
          () => screens.repository.addCard(
            screens.deck.id,
            front: blocks(fixture['front']),
            back: blocks(fixture['back']),
          ),
        );
        final card = (await screens.cards()).single;
        await screens.push(
          (deck) =>
              CardEditorScreen(preview: studyPreview, deck: deck, card: card),
        );
        expect(find.text('Save'), findsNothing);
        expect(find.byType(CardPreview), findsOneWidget);
        await screens.close();
      });
    }
  });

  testWidgets(
    'a card of each earlier template opens as its 칸 in order, and saved records the frame',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const name = TextContent('Capitals');
      const table = TableContent(
        columns: ['Country', 'Capital'],
        rows: [
          ['France', 'Paris'],
        ],
        blanks: [(row: 0, column: 1)],
      );
      for (final (template, front, whole) in <(String, List<Content>, bool)>[
        ('flip', [const TextContent('apple')], false),
        (
          'cloze',
          [
            const ClozeContent('The ___ is red', ['apple']),
          ],
          true,
        ),
        ('table', [name, table], true),
      ]) {
        await tester.runAsync(
          () => screens.repository.addCard(
            screens.deck.id,
            front: front,
            back: [const TextContent('a back')],
          ),
        );
        final added = (await screens.cards()).last;
        // The card as an earlier build stored it, its template its form's.
        final card = Card(
          id: added.id,
          deckId: added.deckId,
          front: added.front,
          back: added.back,
          cardKey: added.cardKey,
          source: added.source,
          createdAt: added.createdAt,
          updatedAt: added.updatedAt,
          template: template,
          templateVersion: 1,
        );
        await screens.push(
          (deck) =>
              CardEditorScreen(preview: studyPreview, deck: deck, card: card),
        );
        await screens.tap(find.text('Preview'));
        expect(
          find.descendant(
            of: find.byType(CardPreviewScreen),
            matching: find.byType(WholeCardView),
          ),
          whole ? findsOneWidget : findsNothing,
          reason: '$template: the preview draws it as study does',
        );
        await screens.tap(find.byTooltip('Close'));
        await tapVisible(screens, find.text('Save'));
        final saved = (await screens.cards()).singleWhere(
          (stored) => stored.id == card.id,
        );
        expect((saved.template, saved.templateVersion), ('free', 2));
        expect(saved.cells, cellsFromSides(card.front, card.back));
      }
      await screens.close();
    },
  );

  testWidgets(
    'a card of two side lists holding a block this build cannot read opens read-only, where a framed one keeps the block through a save',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      final unknown =
          decodeContent(
                '[{"type":"mindmap","v":1,"id":"m","payload":{"nodes":[1,2]}}]',
              ).single
              as UnsupportedContent;
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [const TextContent('apple')],
          back: [unknown],
        ),
      );
      final card = (await screens.cards()).single;
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(find.text('Save'), findsNothing);
      await screens.tap(find.byTooltip('Close'));

      // Control: in the frame the block keeps its place, and a 글 is edited
      // beside it.
      final cells = [
        const TextCell(front: 'pear', back: '배'),
        UnknownCell(unknown),
      ];
      final (:front, :back) = sidesOf(cells);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: front,
          back: back,
          cells: cells,
        ),
      );
      final framed = (await screens.cards()).firstWhere(
        (stored) => stored.cells != null,
      );
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: framed),
      );
      expect(
        find.text('[Content this version cannot show: mindmap]'),
        findsOneWidget,
      );
      await typeBlock(tester, '배', 1);
      await typeBlock(tester, 'pears');
      await tapVisible(screens, find.text('Save'));
      final saved = (await screens.cards()).firstWhere(
        (stored) => stored.id == framed.id,
      );
      expect(saved.cells!.first, const TextCell(front: 'pears', back: '배'));
      expect(
        encodeContent([(saved.cells!.last as UnknownCell).block]),
        encodeContent([unknown]),
        reason: 'kept as it was stored',
      );
      await screens.close();
    },
  );

  testWidgets(
    'each 칸 keeps its id through an edit and a move, and a new one takes its own',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      const cells = [
        TextCell(front: 'a', back: 'b', id: 'first'),
        TextCell(front: 'c', back: 'd', id: 'second'),
      ];
      final (:front, :back) = sidesOf(cells);
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: front,
          back: back,
          cells: cells,
        ),
      );
      final card = (await screens.cards()).single;
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      await typeBlock(tester, 'edited');
      await actOnBlock(screens, 1, 'Move down');
      await addBlock(screens, 'Text');
      await typeBlock(tester, 'new', 4);
      await tapVisible(screens, find.text('Save'));
      final ids = [
        for (final cell in (await screens.cards()).single.cells!) cell.id,
      ];
      expect(ids.take(2), ['second', 'first']);
      expect(ids.last, isNotNull);
      expect(ids.toSet(), hasLength(3));
      await screens.close();
    },
  );

  testWidgets('editing a card offers Save only, and deletes after confirming', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
    final card = (await screens.cards()).single;
    await screens.push(
      (deck) => CardEditorScreen(preview: studyPreview, deck: deck, card: card),
    );

    expect(find.text('Edit card'), findsOneWidget);
    expect(find.text('Save'), findsOneWidget);
    expect(find.text('Save and next card'), findsNothing);
    // Deleting is red text at the end of the form, not an icon in the bar.
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.byType(IconButton),
      ),
      findsOneWidget,
      reason: 'the bar holds Close alone',
    );
    expect(
      tester
          .widget<AppButton>(find.widgetWithText(AppButton, 'Delete card'))
          .variant,
      AppButtonVariant.destructive,
    );

    await tapVisible(screens, find.text('Delete card'));
    expect(shownText('Delete this card?'), findsOneWidget);
    // The confirmation keeps its cancel, and the delete comes last, below it.
    expect(
      tester.getRect(find.text('Cancel')).bottom,
      lessThanOrEqualTo(tester.getRect(find.text('Delete')).top),
    );
    await screens.tap(find.text('Delete'));

    expect(find.byType(CardEditorScreen), findsNothing);
    expect(await _stored(screens), isEmpty);
    await screens.close();
  });

  group('a duplicate front opens the duplicate sheet', () {
    Future<DeckScreens> collide(WidgetTester tester) async {
      final screens = await openNew(tester, cards: {'Chat': 'cat'});
      await typeBlock(tester, '  CHAT ');
      await typeBlock(tester, 'chat (talk)', 1);
      await screens.tap(find.text('Save'));
      expect(shownText('This note already has this card'), findsOneWidget);
      expect(
        shownText('Case and spacing are ignored when comparing.'),
        findsOneWidget,
      );
      // The existing card, in the same split preview as the editor's.
      expect(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(CardPreview),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text(keepWords('cat')),
        ),
        findsOneWidget,
      );
      return screens;
    }

    testWidgets('Add anyway stores the second card beside the first', (
      tester,
    ) async {
      final screens = await collide(tester);

      await screens.tap(find.text('Add anyway'));

      expect(find.byType(CardEditorScreen), findsNothing);
      expect(await _stored(screens), [
        ('Chat', 'cat'),
        ('  CHAT ', 'chat (talk)'),
      ]);
      await screens.close();
    });

    testWidgets(
      'Open existing card opens it over the editor and stores nothing, and closing it returns to the typed card',
      (tester) async {
        final screens = await collide(tester);

        await screens.tap(find.text('Open existing card'));

        expect(find.text('Edit card'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'Chat'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'cat'), findsOneWidget);
        expect(await _stored(screens), [('Chat', 'cat')]);

        await screens.tap(find.byTooltip('Close'));
        expect(find.text('New card'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'chat (talk)'), findsOneWidget);
        await screens.close();
      },
    );

    testWidgets(
      'the sheet offers no cancel, and dismissing it returns to the editor and stores nothing',
      (tester) async {
        final screens = await collide(tester);
        final actions = find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(AppButton),
        );
        // Control: the finder reaches the sheet's actions.
        expect(actions, findsNWidgets(2));
        expect(
          find.descendant(
            of: find.byType(BottomSheet),
            matching: find.text('Cancel'),
          ),
          findsNothing,
        );

        await tester.tapAt(const Offset(20, 20));
        await tester.pumpAndSettle();

        expect(find.byType(BottomSheet), findsNothing);
        expect(find.text('New card'), findsOneWidget);
        expect(find.widgetWithText(TextField, 'chat (talk)'), findsOneWidget);
        expect(await _stored(screens), [('Chat', 'cat')]);
        await screens.close();
      },
    );
  });

  testWidgets(
    'a card whose template this build does not know opens read-only: it says the app needs an update, offers nothing to save, and still deletes',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: {'chat': 'cat'});
      final stored = (await screens.cards()).single;
      // The same card as a later build records it.
      final later = Card(
        id: stored.id,
        deckId: stored.deckId,
        front: stored.front,
        back: stored.back,
        cardKey: stored.cardKey,
        source: stored.source,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        template: 'image_occlusion',
        templateVersion: 1,
      );
      await screens.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: later),
      );
      expect(
        find.text(
          "This card was made in a newer version of the app, so this version can't edit it. Update the app.",
        ),
        findsOneWidget,
      );
      expect(find.byType(CardPreview), findsOneWidget);
      expect(find.byType(TextField), findsNothing, reason: 'nothing to edit');
      expect(find.text('Save'), findsNothing);

      await tapVisible(screens, find.text('Delete card'));
      await screens.tap(find.text('Delete'));
      expect(await screens.cards(), isEmpty, reason: 'it still deletes');
      await screens.close();

      // Control: the card as stored, its template free, opens to edit.
      final again = await DeckScreens.open(tester, cards: {'chat': 'cat'});
      final card = (await again.cards()).single;
      await again.push(
        (deck) =>
            CardEditorScreen(preview: studyPreview, deck: deck, card: card),
      );
      expect(find.text('Save'), findsOneWidget);
      await again.close();
    },
  );
}
