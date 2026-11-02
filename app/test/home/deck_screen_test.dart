import 'dart:convert';

import 'package:drift/drift.dart' show driftRuntimeOptions;
import 'package:flutter/material.dart' hide Card;
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/home/src/progress_bar.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart' show StudyScreen;

import '../deck/whole_cards.dart';
import '../study/minutes_sheet.dart';
import '../word_breaks.dart';
import '../contrast.dart';
import 'deck_screens.dart';

/// The front of every card row on screen, top to bottom.
List<String> _rowFronts(WidgetTester tester) => [
  for (final row in tester.widgetList<CardBackRow>(find.byType(CardBackRow)))
    plainText(row.front),
];

/// The deck page's "뒷면 보기" switch.
Switch _switch(WidgetTester tester) =>
    tester.widget<Switch>(find.byType(Switch));

/// The back of every card row on screen that shows it, top to bottom.
List<String> _answers(WidgetTester tester) => [
  for (final row in tester.widgetList<CardBackRow>(find.byType(CardBackRow)))
    if (row.shown) plainText(row.back),
];

/// Hands out [csv] as the file picked.
final class _OneFile implements SpreadsheetPick {
  const _OneFile(this.csv);

  final String csv;

  @override
  Future<OpenedFile?> pick() async =>
      parseSpreadsheet('words.csv', utf8.encode(csv));
}

void main() {
  driftRuntimeOptions.dontWarnAboutMultipleDatabases = true;

  const cards = {'Chat': 'cat', 'Chien': 'dog', 'Hund': 'DOG'};

  testWidgets(
    'a deck with no card offers adding one as its one primary action, and no Study',
    (tester) async {
      AppButton button(String label) =>
          tester.widget<AppButton>(find.widgetWithText(AppButton, label));
      // Control: a deck with a card offers Study, and adding a card is quieter.
      var screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.widgetWithText(AppButton, 'Study'), findsOneWidget);
      expect(button('Add card').variant, AppButtonVariant.secondary);
      await screens.close();

      screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(shownText('No cards yet'), findsOneWidget);
      expect(find.widgetWithText(AppButton, 'Study'), findsNothing);
      expect(button('Add card').variant, AppButtonVariant.primary);
      await screens.close();
    },
  );

  testWidgets('a deck\'s name is Pretendard, never Jua, as its title', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester);
    await screens.push((deck) => DeckScreen(deck: deck));

    final style = tester.widget<Text>(find.text('French').first).style!;
    expect(style.fontFamily, appFontFamily);
    expect(style.fontWeight, FontWeight.w800);
    // Control: the style a title we write takes is Jua, so the check can fail.
    expect(AppType.deckTitle.fontFamily, appDisplayFontFamily);
    await screens.close();
  });

  testWidgets(
    'a deck with no card shows no today card of zeros and only its count of none, where a deck with one shows its counts and today card',
    (tester) async {
      // Control: a deck with a card has its today card and its mastered count.
      var screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.text('Study today'), findsOneWidget);
      expect(find.text('1 card · 0 mastered'), findsOneWidget);
      await screens.close();

      screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(shownText('No cards yet'), findsOneWidget);
      expect(find.text('Study today'), findsNothing);
      expect(find.text('0 cards'), findsOneWidget);
      expect(find.textContaining('mastered'), findsNothing);
      await screens.close();
    },
  );
  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the deck\'s today card is white with an ink Study button, and meets the contrast guideline',
      (tester) async {
        final screens = await DeckScreens.open(
          tester,
          cards: cards,
          due: {'Chat'},
          themeMode: mode,
        );
        await screens.push((deck) => DeckScreen(deck: deck));
        final colors = AppColors.of(tester.element(find.byType(DeckScreen)));
        final study = find.widgetWithText(AppButton, 'Study');
        final card = find
            .ancestor(
              of: study,
              matching: find.byWidgetPredicate(
                (widget) =>
                    widget is DecoratedBox &&
                    widget.decoration is BoxDecoration &&
                    (widget.decoration as BoxDecoration).borderRadius ==
                        BorderRadius.circular(AppRadius.card),
              ),
            )
            .first;
        expect(
          (tester.widget<DecoratedBox>(card).decoration as BoxDecoration).color,
          colors.surface,
        );
        expect(
          tester.widget<AppButton>(study).variant,
          AppButtonVariant.primary,
        );
        // The card holds no progress bar: the counts are in the line above.
        expect(find.byType(ProgressBar), findsNothing);
        expectTextReadable(tester, card, colors.surface);
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        await screens.close();
      },
    );
  }

  testWidgets(
    "Customize deck in the menu names each icon and colour as a 48 pt button, previews the choice, and Save stores it on the header's tile",
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      Finder header(IconData icon) => find.descendant(
        of: find.byType(DeckTile),
        matching: find.byIcon(icon),
      );
      expect(header(LucideIcons.layers), findsOneWidget);

      await screens.tap(find.byTooltip('Note actions'));
      await screens.tap(find.text('Customize note'));
      // The sheet's option, apart from the card list's label "Cards".
      Finder sheetOption(String name) => find.descendant(
        of: find.byType(BottomSheet),
        matching: find.bySemanticsLabel(name),
      );
      // The deck's own default pair is selected, and every option is a
      // labelled button with a selected state, at least 48 square.
      expect(
        tester.getSemantics(sheetOption('Cards')),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: true),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('Book')),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: false),
      );
      for (final option in ['Cards', 'Star', 'Blue', 'Slate']) {
        final size = tester.getSize(sheetOption(option));
        expect(size.width, greaterThanOrEqualTo(48), reason: option);
        expect(size.height, greaterThanOrEqualTo(48), reason: option);
      }

      await screens.tap(find.bySemanticsLabel('Book'));
      await screens.tap(find.bySemanticsLabel('Amber'));
      // The sheet's preview shows the pair before it is saved.
      expect(header(LucideIcons.bookOpen), findsOneWidget);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Book')),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: true),
      );
      await screens.tap(find.text('Save'));

      expect(find.text('Customize note'), findsNothing);
      expect(header(LucideIcons.bookOpen), findsOneWidget);
      expect(header(LucideIcons.layers), findsNothing);
      final stored = (await tester.runAsync(
        () => screens.repository.getDeck(screens.deck.id),
      ))!;
      expect((stored.icon, stored.color), (DeckIcon.book, DeckColor.amber));
      await screens.close();
    },
  );

  testWidgets('dismissing Customize deck keeps the deck as it was', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester, cards: cards);
    await screens.push((deck) => DeckScreen(deck: deck));

    await screens.tap(find.byTooltip('Note actions'));
    await screens.tap(find.text('Customize note'));
    await screens.tap(find.bySemanticsLabel('Book'));
    Finder onTile(IconData icon) =>
        find.descendant(of: find.byType(DeckTile), matching: find.byIcon(icon));
    // Control: the choice was made, so the sheet's preview shows it.
    expect(onTile(LucideIcons.bookOpen), findsOneWidget);
    await tester.tapAt(const Offset(195, 10));
    await tester.pumpAndSettle();

    expect(onTile(LucideIcons.bookOpen), findsNothing);
    expect(onTile(LucideIcons.layers), findsOneWidget);
    final stored = (await tester.runAsync(
      () => screens.repository.getDeck(screens.deck.id),
    ))!;
    expect((stored.icon, stored.color), (null, null));
    await screens.close();
  });

  testWidgets(
    "the header names the deck and counts its cards once, with those mastered; the today card counts today's in large figures beside its minutes; and Study opens a session over it",
    (tester) async {
      final screens = await DeckScreens.open(
        tester,
        cards: cards,
        due: {'Chat'},
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      expect(find.text('French'), findsOneWidget);
      // Chat was reviewed after a day's interval, so it is learning.
      expect(find.text('3 cards · 0 mastered'), findsOneWidget);
      // The card count is on the screen once: no "Cards 3" over the list.
      expect(find.textContaining(RegExp(r'Cards \d')), findsNothing);
      expect(find.textContaining('learning'), findsNothing);
      expect(find.text('Study today'), findsOneWidget);
      expect(find.textContaining(RegExp(r'^About \d+ min$')), findsOneWidget);
      final count = find.bySemanticsLabel('3 cards for today');
      expect(count, findsOneWidget);
      // The figure is large and tabular, its unit right after it, smaller
      // and muted.
      final drawn = tester.widget<RichText>(
        find.descendant(of: count, matching: find.byType(RichText)),
      );
      // Text.rich wraps the count's span in one carrying the default style.
      final spans = ((drawn.text as TextSpan).children!.single as TextSpan)
          .children!
          .cast<TextSpan>();
      expect([for (final span in spans) span.text], ['3', ' cards']);
      expect(spans.first.style?.fontSize, AppType.figure.fontSize);
      expect(
        spans.first.style?.fontFeatures,
        contains(const FontFeature.tabularFigures()),
      );
      expect(
        spans.last.style!.fontSize,
        lessThan(spans.first.style!.fontSize!),
      );
      expect(
        spans.last.style?.color,
        AppColors.of(tester.element(count)).muted,
      );

      await screens.tap(find.text('Study'));

      expect(screens.session, {screens.deck.id});
      await screens.close();
    },
  );
  testWidgets(
    'a first session asks for the daily study minutes once, before it opens',
    (tester) async {
      final screens = await DeckScreens.open(
        tester,
        cards: cards,
        minutesAsked: false,
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(find.text('Study'));
      expect(
        shownText('How many minutes a day will you study?'),
        findsOneWidget,
      );
      expect(find.byType(StudyScreen), findsNothing);
      await waitForPicker(tester);
      await screens.tap(find.byTooltip('5 minutes less'));
      await screens.tap(find.text('Save'));

      expect(screens.session, {screens.deck.id});
      // Control: once shown, the next session opens at once.
      screens.navigator.currentState?.pop();
      await tester.pumpAndSettle();
      await screens.tap(find.text('Study'));
      expect(find.byType(BottomSheet), findsNothing);
      expect(screens.session, {screens.deck.id});
      await screens.close();
    },
  );

  testWidgets(
    'in a backlog the header says new cards wait, and not otherwise',
    (tester) async {
      const paused = 'New cards wait until you catch up on your reviews.';
      // Three reviews due after 30-day intervals are far more than three
      // days' load.
      var screens = await DeckScreens.open(
        tester,
        cards: cards,
        due: cards.keys.toSet(),
        dueDays: 30,
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      expect(find.bySemanticsLabel('3 cards for today'), findsOneWidget);
      expect(find.text(paused), findsOneWidget);
      await screens.close();

      // Control: the same reviews after one-day intervals are within three
      // days' load, so the header has no such sentence.
      screens = await DeckScreens.open(
        tester,
        cards: cards,
        due: cards.keys.toSet(),
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      expect(find.bySemanticsLabel('3 cards for today'), findsOneWidget);
      expect(find.text(paused), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'with nothing to study today, or no count yet or none readable, Study still opens a session over the deck',
    (tester) async {
      const unreadable =
          "Couldn't read or write the device's storage. Please try again.";
      for (final (today, open, counted, failed) in [
        (
          'nothing to study',
          () =>
              DeckScreens.open(tester, cards: cards, later: cards.keys.toSet()),
          true,
          false,
        ),
        (
          'no count yet',
          () => DeckScreens.open(tester, cards: cards, stalled: true),
          false,
          false,
        ),
        (
          'no count readable',
          () => DeckScreens.open(tester, cards: cards, unreadable: true),
          false,
          true,
        ),
      ]) {
        final screens = await open();
        await screens.push((deck) => DeckScreen(deck: deck));
        // The count is in the state the case names: read as zero, pending,
        // or failed.
        expect(
          find.bySemanticsLabel('0 cards for today'),
          counted ? findsOneWidget : findsNothing,
          reason: today,
        );
        expect(
          find.text(unreadable),
          failed ? findsOneWidget : findsNothing,
          reason: today,
        );

        await screens.tap(find.text('Study'));

        expect(screens.session, {screens.deck.id}, reason: today);
        await screens.close();
      }
    },
  );

  testWidgets(
    'the cards are one group of rows, each its front alone with nothing drawn for its hidden back, and a tap on a row opens that card in the editor',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(_rowFronts(tester), ['Chat', 'Chien', 'Hund']);
      expect(find.text('dog'), findsNothing);
      expect(find.bySemanticsLabel('Chien, back hidden'), findsOneWidget);
      // One group holds every row, and no row draws a bar or a pencil.
      expect(find.byType(SliverAppGroup), findsOneWidget);
      for (final row in tester.widgetList(find.byType(CardBackRow))) {
        final drawn = find.descendant(
          of: find.byWidget(row),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Container ||
                widget is DecoratedBox ||
                widget is IconButton,
          ),
        );
        expect(drawn, findsNothing);
      }

      await screens.tap(find.text('Chien'));

      expect(find.widgetWithText(TextField, 'Chien'), findsOneWidget);
      await screens.close();
    },
  );
  testWidgets(
    'a cloze card shows its front with its blank empty and nothing for its back, and the switch fills it in place',
    (tester) async {
      const cloze = ClozeContent('The capital of France is ___', ['Paris']);
      final screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [cloze],
          back: [const TextContent('The capital of France is Paris')],
        ),
      );
      await screens.push((deck) => DeckScreen(deck: deck));
      final row = find.byWidgetPredicate(
        (widget) => widget is CardBackRow && widget.front.first == cloze,
      );
      expect(row, findsOneWidget);
      expect(
        find.bySemanticsLabel('The capital of France is blank, back hidden'),
        findsOneWidget,
      );
      expect(blanksUnder(row), {'Paris': false});
      expect(find.text('The capital of France is Paris'), findsNothing);

      await screens.tap(find.byType(Switch));
      expect(blanksUnder(row), {'Paris': true});
      expect(
        find.bySemanticsLabel(
          'The capital of France is blank, back The capital of France is Paris',
        ),
        findsOneWidget,
      );
      // The stored back is never drawn beside the whole card.
      expect(find.text('The capital of France is Paris'), findsNothing);
      await screens.close();
    },
  );
  testWidgets(
    'the Show backs switch is off on opening, on shows every back muted after its front and off hides them',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.text('Cards'), findsOneWidget);
      expect(_switch(tester).value, isFalse);
      expect(_answers(tester), isEmpty);

      await screens.tap(find.byType(Switch));
      expect(_switch(tester).value, isTrue);
      expect(_answers(tester), ['cat', 'dog', 'DOG']);
      final colors = AppColors.of(tester.element(find.byType(DeckScreen)));
      final back = tester.getRect(find.text('dog'));
      final front = tester.getRect(find.text('Chien'));
      expect(back.left, greaterThan(front.right), reason: 'after the front');
      expect(back.center.dy, moreOrLessEquals(front.center.dy, epsilon: 2));
      RichText drawn(String text) => tester.widget<RichText>(
        find
            .descendant(of: find.text(text), matching: find.byType(RichText))
            .first,
      );
      expect(drawn('dog').text.style?.color, colors.muted);
      // Control: the front is drawn in ink.
      expect(drawn('Chien').text.style?.color, isNot(colors.muted));

      await screens.tap(find.byType(Switch));
      expect(_switch(tester).value, isFalse);
      expect(_answers(tester), isEmpty);
      await screens.close();
    },
  );
  testWidgets('search results follow the switch', (tester) async {
    final screens = await DeckScreens.open(tester, cards: cards);
    await screens.push((deck) => DeckScreen(deck: deck));
    await screens.tap(find.byType(Switch));

    await screens.tap(find.byTooltip('Search cards'));
    await screens.enter('Search', 'ch');
    expect(_rowFronts(tester), ['Chat', 'Chien']);
    expect(_answers(tester), ['cat', 'dog']);

    await screens.tap(find.byType(Switch));
    expect(_answers(tester), isEmpty);
    await screens.close();
  });

  for (final (name, back, read) in [
    (
      'a new cloze card, with no back,',
      const <Content>[],
      'The capital of France is Paris',
    ),
    (
      'a former cloze card whose stored back no longer matches its front',
      const [TextContent('The capital of France is Lyon')],
      'The capital of France is Paris. The capital of France is Lyon',
    ),
  ]) {
    testWidgets(
      '$name is read on its row as its 칸 revealed once shown, its kept back after them',
      (tester) async {
        const cloze = ClozeContent('The capital of France is ___', ['Paris']);
        final screens = await DeckScreens.open(tester);
        await tester.runAsync(
          () => screens.repository.addCard(
            screens.deck.id,
            front: [cloze],
            back: back,
          ),
        );
        // The setup stored the card with the back asked for.
        expect((await screens.cards()).single.back, back);
        await screens.push((deck) => DeckScreen(deck: deck));
        final row = find.byWidgetPredicate(
          (widget) => widget is CardBackRow && widget.front.first == cloze,
        );
        expect(
          find.bySemanticsLabel('The capital of France is blank, back hidden'),
          findsOneWidget,
        );

        await screens.tap(find.byType(Switch));
        expect(
          find.bySemanticsLabel('The capital of France is blank, back $read'),
          findsOneWidget,
        );
        expect(row, findsOneWidget);
        await screens.close();
      },
    );
  }

  testWidgets(
    'search reads every 칸 revealed, so a cloze card\'s kept back is found',
    (tester) async {
      const cloze = ClozeContent('The capital of France is ___', ['Paris']);
      final screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      // A 빈칸 card whose back differs from its filled text, which study shows.
      await tester.runAsync(
        () => screens.repository.addCard(
          screens.deck.id,
          front: [cloze],
          back: [const TextContent('The capital of Italy is Rome')],
        ),
      );
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.byType(CardBackRow), findsNWidgets(2));

      await screens.tap(find.byTooltip('Search cards'));
      await screens.enter('Search', 'rome');
      expect(find.byType(CardBackRow), findsOneWidget);

      // Controls: a match narrows the list, the cloze card's answer is
      // searched, and a split card's back still is.
      await screens.enter('Search', 'nowhere');
      expect(find.byType(CardBackRow), findsNothing);
      await screens.enter('Search', 'paris');
      expect(find.byType(CardBackRow), findsOneWidget);
      expect(
        find.byWidgetPredicate(
          (widget) => widget is CardBackRow && widget.front.first == cloze,
        ),
        findsOneWidget,
      );
      await screens.enter('Search', 'cat');
      expect(_rowFronts(tester), ['Chat']);
      await screens.close();
    },
  );

  testWidgets(
    'the switch is read as Show backs with its state, and stays pinned under the section label Cards while the list scrolls',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final screens = await DeckScreens.open(
        tester,
        cards: {for (var i = 0; i < 30; i++) 'word $i': 'answer $i'},
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      expect(
        tester.getSemantics(find.byType(Switch)),
        isSemantics(
          label: 'Show backs',
          hasToggledState: true,
          isToggled: false,
        ),
      );
      await screens.tap(find.byType(Switch));
      expect(
        tester.getSemantics(find.byType(Switch)),
        isSemantics(
          label: 'Show backs',
          hasToggledState: true,
          isToggled: true,
        ),
      );

      final top = tester.getTopLeft(find.text('Cards')).dy;
      expect(find.text('word 0'), findsOneWidget);
      await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
      await tester.pumpAndSettle();
      // The list scrolled past its first card and the today card.
      expect(find.text('word 0'), findsNothing);
      expect(find.text('Study'), findsNothing);
      expect(tester.getTopLeft(find.text('Cards')).dy, lessThan(top));
      expect(
        tester.getTopLeft(find.text('Cards')).dy,
        greaterThanOrEqualTo(tester.getBottomLeft(find.byType(AppBar)).dy),
      );
      await screens.tap(find.byType(Switch));
      expect(_switch(tester).value, isFalse);
      semantics.dispose();
      await screens.close();
    },
  );

  testWidgets(
    'a screen reader hears each card row as one button whose tap, hinted Edit card, opens that card',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));

      final row = find.byType(CardBackRow).at(1);
      expect(
        tester.getSemantics(row),
        isSemantics(
          label: 'Chien, back hidden',
          isButton: true,
          hasTapAction: true,
          onTapHint: 'Edit card',
        ),
      );
      tester
          .renderObject(row)
          .owner!
          .semanticsOwner!
          .performAction(tester.getSemantics(row).id, SemanticsAction.tap);
      await tester.pumpAndSettle();
      expect(find.widgetWithText(TextField, 'Chien'), findsOneWidget);
      semantics.dispose();
      await screens.close();
    },
  );
  testWidgets(
    'search keeps the cards whose front or back holds the text, ignoring case',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.byType(AppTextField), findsNothing);

      await screens.tap(find.byTooltip('Search cards'));
      await screens.enter('Search', 'dog');
      expect(_rowFronts(tester), ['Chien', 'Hund']);

      await screens.enter('Search', 'CHAT');
      expect(_rowFronts(tester), ['Chat']);

      await screens.enter('Search', 'zebra');
      expect(_rowFronts(tester), isEmpty);
      expect(shownText('No card matches. Try other words.'), findsOneWidget);

      await screens.enter('Search', 'CHAT');
      await screens.tap(find.byTooltip('Close search'));
      expect(find.byType(AppTextField), findsNothing);
      expect(_rowFronts(tester), ['Chat', 'Chien', 'Hund']);
      await screens.close();
    },
  );

  testWidgets(
    'while searching above a phone keyboard, the first match starts under the top bar and shows above the keyboard',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      // Control: before the search, the deck's header and today card are up.
      expect(find.byType(DeckTile), findsOneWidget);
      expect(find.text('Study today'), findsOneWidget);

      await screens.tap(find.byTooltip('Search cards'));
      tester.view.viewInsets = const FakeViewPadding(bottom: 336);
      addTearDown(tester.view.resetViewInsets);
      await screens.enter('Search', 'ch');
      await tester.pumpAndSettle();
      expect(tester.view.viewInsets.bottom, 336, reason: 'the keyboard is up');

      final first = tester.getRect(find.byType(CardBackRow).first);
      final topBar = tester.getRect(find.byType(AppBar));
      expect(first.bottom, lessThanOrEqualTo(844 - 336));
      expect(first.top - topBar.bottom, lessThan(AppSize.tapTarget * 2));
      expect(find.byType(DeckTile), findsNothing);
      expect(find.text('Study today'), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'the back closes an open search and keeps the screen, and a second back leaves it',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Search cards'));
      await screens.enter('Search', 'ch');

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(AppTextField), findsNothing);
      expect(find.byType(DeckScreen), findsOneWidget);
      expect(_rowFronts(tester), ['Chat', 'Chien', 'Hund']);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    '"Delete note" is drawn in the destructive text colour, where "Rename" is not',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Note actions'));

      final colors = AppColors.of(tester.element(find.text('Delete note')));
      expect(
        tester.widget<Text>(find.text('Delete note')).style?.color,
        colors.dontKnowText,
      );
      expect(
        tester.widget<Text>(find.text('Rename')).style?.color,
        isNot(colors.dontKnowText),
      );
      await screens.close();
    },
  );

  testWidgets(
    'without photo import, Add card offers by hand and a file, no photo',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(find.text('Add card'));

      expect(find.text('Take photo'), findsNothing);
      expect(find.text('Choose from album'), findsNothing);
      expect(find.text('Choose a file'), findsOneWidget);
      await screens.tap(find.text('Enter by hand'));
      expect(find.widgetWithText(AppBar, 'New card'), findsOneWidget);
      await screens.close();
    },
  );

  testWidgets(
    'Choose a file adds the rows reviewed to this deck, and returns to its list',
    (tester) async {
      final pick = _OneFile('pear,배\nplum,자두');
      final screens = await DeckScreens.open(
        tester,
        cards: const {'apple': '사과'},
        overrides: [spreadsheetPickProvider.overrideWithValue(pick)],
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(find.text('Add card'));
      await screens.tap(find.text('Choose a file'));
      expect(shownText('Add cards from a file'), findsOneWidget);
      await screens.tap(find.text('Choose file'));
      expect(find.text('Review cards'), findsOneWidget);

      await tester.tap(find.widgetWithText(AppButton, 'Add 2 cards'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();

      expect(find.byType(DeckScreen), findsOneWidget);
      expect(find.text('Review cards'), findsNothing);
      final cards = (await tester.runAsync(
        () => screens.repository.listCards(screens.deck.id),
      ))!;
      expect(cards.map((card) => plainText(card.front)), [
        'apple',
        'pear',
        'plum',
      ]);
      await screens.close();
    },
  );

  testWidgets(
    'with photo import, Add card offers by hand, the camera and the album in one sheet, named as the new-deck sheet names them, each photo row opening photo import for this deck from its source',
    (tester) async {
      final screens = await DeckScreens.open(tester, photoImport: true);
      await screens.push((deck) => DeckScreen(deck: deck));

      for (final (row, origin) in [
        ('Take photo', PhotoOrigin.camera),
        ('Choose from album', PhotoOrigin.album),
      ]) {
        await screens.tap(find.text('Add card'));
        expect(find.text('Enter by hand'), findsOneWidget);
        expect(find.text('Take photo'), findsOneWidget);
        expect(find.text('Choose from album'), findsOneWidget);
        await screens.tap(find.text(row));
        expect(find.text('photo import'), findsOneWidget);
        expect(screens.photoImports.last, (screens.deck.id, origin));
        screens.navigator.currentState!.pop();
        await tester.pumpAndSettle();
      }
      // By hand opens the editor.
      await screens.tap(find.text('Add card'));
      await screens.tap(find.text('Enter by hand'));
      expect(find.widgetWithText(AppBar, 'New card'), findsOneWidget);
      await screens.close();
    },
  );

  testWidgets(
    'a photo import into another deck replaces this list with that deck, and one into this deck returns here',
    (tester) async {
      final screens = await DeckScreens.open(tester, photoImport: true);
      final other = (await tester.runAsync(
        () => screens.repository.createDeck('Spanish'),
      ))!;
      await screens.push((deck) => DeckScreen(deck: deck));

      Future<void> saveInto(Deck deck) async {
        await screens.tap(find.text('Add card'));
        await screens.tap(find.text('Take photo'));
        screens.navigator.currentState!.pop(deck);
        await tester.pumpAndSettle();
      }

      await saveInto(screens.deck);
      expect(find.text('French'), findsOneWidget);

      await saveInto(other);
      expect(find.text('Spanish'), findsOneWidget);
      expect(find.text('French'), findsNothing);
      screens.navigator.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsNothing);
      await screens.close();
    },
  );

  testWidgets('the deck menu renames the deck', (tester) async {
    final screens = await DeckScreens.open(tester);
    await screens.push((deck) => DeckScreen(deck: deck));

    await screens.tap(find.byTooltip('Note actions'));
    await screens.tap(find.text('Rename'));
    await screens.enter('Note name', 'Français');
    await screens.tap(find.text('Save'));

    expect(find.text('Français'), findsOneWidget);
    final decks = await tester.runAsync(
      () => screens.repository.watchDecks().first,
    );
    expect(decks!.single.name, 'Français');
    await screens.close();
  });

  testWidgets(
    'a rename stored while the screen is open, as a sync lands one, shows in the title, the rename sheet, the delete question and the editor',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.text('French'), findsOneWidget, reason: 'the opening name');

      await tester.runAsync(
        () => screens.repository.renameDeck(screens.deck.id, 'Français'),
      );
      await tester.pumpAndSettle();
      expect(find.text('Français'), findsOneWidget);
      expect(find.text('French'), findsNothing);

      await screens.tap(find.byTooltip('Note actions'));
      await screens.tap(find.text('Rename'));
      expect(
        tester
            .widget<EditableText>(
              find.descendant(
                of: find.widgetWithText(AppTextField, 'Note name'),
                matching: find.byType(EditableText),
              ),
            )
            .controller
            .text,
        'Français',
      );
      await tester.tapAt(const Offset(20, 100));
      await tester.pumpAndSettle();

      await screens.tap(find.byTooltip('Note actions'));
      await screens.tap(find.text('Delete note'));
      expect(shownText('Delete "Français"?'), findsOneWidget);
      await screens.tap(find.text('Cancel'));

      await screens.tap(find.text('Add card'));
      await screens.tap(find.text('Enter by hand'));
      expect(find.text('Français'), findsOneWidget, reason: "the editor's");
      expect(find.text('French'), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'the rename sheet opens focused on the current name, refuses an empty one, and saves on Enter',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Note actions'));
      await screens.tap(find.text('Rename'));
      EditableText field() => tester.widget<EditableText>(
        find.descendant(
          of: find.widgetWithText(AppTextField, 'Note name'),
          matching: find.byType(EditableText),
        ),
      );
      expect(field().focusNode.hasFocus, isTrue);
      expect(field().controller.text, 'French');

      await screens.enter('Note name', '  ');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.text('Enter a name'), findsOneWidget);
      expect(find.byType(BottomSheet), findsOneWidget);

      await screens.enter('Note name', 'Français');
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      final decks = await tester.runAsync(
        () => screens.repository.watchDecks().first,
      );
      expect(decks!.single.name, 'Français');
      await screens.close();
    },
  );

  testWidgets(
    'the deck menu deletes the deck after confirming, and closes it',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(find.byTooltip('Note actions'));
      await screens.tap(find.text('Delete note'));
      expect(shownText('Its 3 cards will be deleted too.'), findsOneWidget);
      await screens.tap(find.text('Delete'));

      expect(find.byType(DeckScreen), findsNothing);
      final decks = await tester.runAsync(
        () => screens.repository.watchDecks().first,
      );
      expect(decks, isEmpty);
      await screens.close();
    },
  );

  for (final scale in [1.0, 2.0]) {
    testWidgets(
      "on a 390 wide phone at text scale $scale the empty deck's Korean line stays on one line and is read as written",
      (tester) async {
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        final screens = await DeckScreens.open(
          tester,
          locale: const Locale('ko'),
        );
        await screens.push((deck) => DeckScreen(deck: deck));

        const line = '아직 카드가 없어요';
        expect(lineEnds(tester, line).$1, hasLength(1));
        // A screen reader reads it as written, without the joiners.
        expect(find.bySemanticsLabel(line), findsOneWidget);
        // Adding a card is the screen's one action, said by its button alone.
        expect(find.text('카드 추가'), findsOneWidget);
        // The mascot dozes over it, above the words.
        final mascot = find.byType(Mascot);
        expect(
          tester.widget<Mascot>(mascot).expression,
          MascotExpression.sleepy,
        );
        expect(
          tester.getBottomLeft(mascot).dy,
          lessThanOrEqualTo(tester.getTopLeft(shownText(line)).dy),
        );
        await screens.close();
      },
    );
  }
}
