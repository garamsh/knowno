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
import 'package:knowno/design/bottom_actions.dart';
import 'package:knowno/design/mascot.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/home/src/deck_screen.dart';
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

/// The text drawn on the hatch in every card row on screen, top to bottom.
List<String> _answers(WidgetTester tester) => [
  for (final text in tester.widgetList<RichText>(
    find.descendant(
      of: find.byWidgetPredicate(
        (widget) =>
            widget is DecoratedBox && widget.decoration is HatchDecoration,
      ),
      matching: find.byType(RichText),
    ),
  ))
    text.text.toPlainText().replaceAll('\u2060', ''),
];

/// The deck page's "이 노트 학습" button, with its count or without.
Finder get _studyButton => find.byWidgetPredicate(
  (widget) => widget is AppButton && widget.label.startsWith('Study this note'),
);

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
    'a deck with no card offers Add card in the header as a deck with cards does, with no foot bar, no search and no Study this note',
    (tester) async {
      AppButton button(String label) =>
          tester.widget<AppButton>(widgetWithShownText(AppButton, label));
      // Control: a deck with a card offers Study this note and the search.
      var screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(_studyButton, findsOneWidget);
      expect(find.widgetWithText(AppTextField, 'Search'), findsOneWidget);
      expect(button('Add card').variant, AppButtonVariant.tonal);
      await screens.close();

      screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(shownText('No cards yet'), findsOneWidget);
      expect(_studyButton, findsNothing);
      expect(find.byType(AppTextField), findsNothing);
      expect(button('Add card').variant, AppButtonVariant.tonal);
      expect(
        find.descendant(
          of: find.byType(AppBar),
          matching: widgetWithShownText(AppButton, 'Add card'),
        ),
        findsOneWidget,
      );
      expect(find.byType(BottomActions), findsNothing);
      await screens.tap(widgetWithShownText(AppButton, 'Add card'));
      expect(shownText('Enter by hand'), findsOneWidget);
      await screens.close();
    },
  );

  testWidgets('a deck\'s name is Pretendard, never Jua, as its title', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester);
    await screens.push((deck) => DeckScreen(deck: deck));

    final style = tester.widget<Text>(shownText('French').first).style!;
    expect(style.fontFamily, appFontFamily);
    expect(style.fontWeight, FontWeight.w800);
    // Control: the style a title we write takes is Jua, so the check can fail.
    expect(AppType.deckTitle.fontFamily, appDisplayFontFamily);
    await screens.close();
  });

  testWidgets(
    'a deck with no card shows no row of its count of none, where a deck with one counts it with those learned',
    (tester) async {
      // Control: a deck with a card has its count and its learned count.
      var screens = await DeckScreens.open(tester, cards: {'Chat': 'cat'});
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.text('Cards 1'), findsOneWidget);
      expect(find.text('0 learned'), findsOneWidget);
      await screens.close();

      screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(shownText('No cards yet'), findsOneWidget);
      expect(find.textContaining('Cards'), findsNothing);
      expect(find.textContaining('learned'), findsNothing);
      await screens.close();
    },
  );
  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the deck screen, its Study this note primary, meets the contrast guideline',
      (tester) async {
        final screens = await DeckScreens.open(
          tester,
          cards: cards,
          due: {'Chat'},
          themeMode: mode,
        );
        await screens.push((deck) => DeckScreen(deck: deck));
        expect(
          tester.widget<AppButton>(_studyButton).variant,
          AppButtonVariant.primary,
        );
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
        await screens.close();
      },
    );
  }

  testWidgets(
    'the top bar holds + Add card in the tonal fill 44 high, over the deck\'s name on its own line, leaving Study this note the screen\'s one primary, and a Note settings button at least 44 square whose menu holds Rename, Customize note and Delete note, over the search field and no magnifier',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      Finder inTopBar(Finder finder) =>
          find.descendant(of: find.byType(AppBar), matching: finder);

      // The name sits under the bar, a header, over the search.
      expect(inTopBar(shownText('French')), findsNothing);
      final name = shownText('French');
      expect(
        tester.getSemantics(name),
        isSemantics(label: 'French', isHeader: true),
      );
      expect(
        tester.getRect(name).top,
        greaterThanOrEqualTo(tester.getRect(find.byType(AppBar)).bottom),
      );
      final add = inTopBar(widgetWithShownText(AppButton, 'Add card'));
      expect(tester.widget<AppButton>(add).variant, AppButtonVariant.tonal);
      expect(tester.widget<AppButton>(add).icon, LucideIcons.plus);
      expect(
        tester
            .widgetList<AppButton>(find.byType(AppButton))
            .where((button) => button.variant == AppButtonVariant.primary)
            .map((button) => button.label),
        [tester.widget<AppButton>(_studyButton).label],
      );
      final drawn = find.descendant(of: add, matching: find.byType(Material));
      expect(tester.getSize(drawn.first).height, AppSize.tapTarget);
      final settings = inTopBar(find.byTooltip('Note settings'));
      expect(settings, findsOneWidget);
      expect(tester.getSize(settings).width, greaterThanOrEqualTo(44));
      expect(tester.getSize(settings).height, greaterThanOrEqualTo(44));
      expect(find.byTooltip('Search cards'), findsNothing);

      // The search is always shown, under the bar and not in it.
      final search = find.widgetWithText(AppTextField, 'Search');
      expect(search, findsOneWidget);
      expect(inTopBar(find.byType(AppTextField)), findsNothing);
      expect(
        tester.getRect(search).top,
        greaterThanOrEqualTo(tester.getRect(name).bottom),
      );

      await screens.tap(find.byTooltip('Note settings'));
      final items = ['Rename', 'Customize note', 'Delete note'];
      for (final item in items) {
        expect(
          find.widgetWithText(MenuItemButton, item),
          findsOneWidget,
          reason: item,
        );
      }
      // Without sharing, the menu offers no publish.
      expect(find.widgetWithText(MenuItemButton, 'Publish'), findsNothing);
      final tops = [
        for (final item in items) tester.getTopLeft(find.text(item)).dy,
      ];
      expect(tops, orderedEquals([...tops]..sort()));
      await tester.tapAt(const Offset(20, 400));
      await tester.pumpAndSettle();
      await screens.close();
    },
  );

  testWidgets(
    'Customize note in the menu names each icon and colour as a 48 pt button, previews the choice on its tile, and Save stores it',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      Finder onTile(IconData icon) => find.descendant(
        of: find.byType(DeckTile),
        matching: find.byIcon(icon),
      );
      // The page draws no tile of its own.
      expect(find.byType(DeckTile), findsNothing);

      await screens.tap(find.byTooltip('Note settings'));
      await screens.tap(find.text('Customize note'));
      expect(onTile(LucideIcons.layers), findsOneWidget);
      // The sheet's option, apart from the card list's "Cards 3".
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
      await screens.tap(find.bySemanticsLabel('Peach'));
      // The sheet's preview shows the pair before it is saved.
      expect(onTile(LucideIcons.bookOpen), findsOneWidget);
      expect(
        tester.getSemantics(find.bySemanticsLabel('Book')),
        isSemantics(isButton: true, hasSelectedState: true, isSelected: true),
      );
      await screens.tap(shownText('Save'));

      expect(find.byType(BottomSheet), findsNothing);
      final stored = (await tester.runAsync(
        () => screens.repository.getDeck(screens.deck.id),
      ))!;
      expect((stored.icon, stored.color), (DeckIcon.book, DeckColor.violet));
      // Opened again, the sheet starts from the pair stored.
      await screens.tap(find.byTooltip('Note settings'));
      await screens.tap(find.text('Customize note'));
      expect(onTile(LucideIcons.bookOpen), findsOneWidget);
      expect(onTile(LucideIcons.layers), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'Customize note offers exactly four colours, Blue, Peach, Sand and Slate',
    (tester) async {
      final semantics = tester.ensureSemantics();
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Note settings'));
      await screens.tap(find.text('Customize note'));

      // Every colour a deck can store, offered or not.
      const named = ['Blue', 'Sky', 'Peach', 'Sand', 'Amber', 'Slate'];
      final offered = [
        for (final name in named)
          if (find
              .descendant(
                of: find.byType(BottomSheet),
                matching: find.bySemanticsLabel(name),
              )
              .evaluate()
              .isNotEmpty)
            name,
      ];
      expect(offered, ['Blue', 'Peach', 'Sand', 'Slate']);
      semantics.dispose();
      await screens.close();
    },
  );

  testWidgets(
    'a deck that stored sky or amber, no longer offered, still draws its colour on its tile',
    (tester) async {
      for (final (stored, fill) in [
        (DeckColor.sky, (AppColors colors) => colors.deckSky),
        (DeckColor.amber, (AppColors colors) => colors.deckAmber),
        // Control: an offered colour draws its own, so the fill is read.
        (DeckColor.blue, (AppColors colors) => colors.deckBlue),
      ]) {
        final screens = await DeckScreens.open(tester, cards: cards);
        await tester.runAsync(
          () => screens.repository.setAppearance(
            screens.deck.id,
            DeckIcon.fallback,
            stored,
          ),
        );
        final deck = (await tester.runAsync(
          () => screens.repository.getDeck(screens.deck.id),
        ))!;
        expect(deck.color, stored, reason: 'the setup stored the colour');
        await screens.push((_) => DeckScreen(deck: deck));
        await screens.tap(find.byTooltip('Note settings'));
        await screens.tap(find.text('Customize note'));

        final colors = AppColors.of(tester.element(find.byType(DeckTile)));
        final tile = tester.widget<Container>(
          find.descendant(
            of: find.byType(DeckTile),
            matching: find.byType(Container),
          ),
        );
        expect(
          (tile.decoration! as BoxDecoration).color,
          fill(colors),
          reason: stored.key,
        );
        await screens.close();
      }
    },
  );

  testWidgets('dismissing Customize note keeps the deck as it was', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester, cards: cards);
    await screens.push((deck) => DeckScreen(deck: deck));
    Finder onTile(IconData icon) =>
        find.descendant(of: find.byType(DeckTile), matching: find.byIcon(icon));

    await screens.tap(find.byTooltip('Note settings'));
    await screens.tap(find.text('Customize note'));
    await screens.tap(find.bySemanticsLabel('Book'));
    // Control: the choice was made, so the sheet's preview shows it.
    expect(onTile(LucideIcons.bookOpen), findsOneWidget);
    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsNothing);

    final stored = (await tester.runAsync(
      () => screens.repository.getDeck(screens.deck.id),
    ))!;
    expect((stored.icon, stored.color), (null, null));
    await screens.tap(find.byTooltip('Note settings'));
    await screens.tap(find.text('Customize note'));
    expect(onTile(LucideIcons.bookOpen), findsNothing);
    expect(onTile(LucideIcons.layers), findsOneWidget);
    await screens.close();
  });

  testWidgets(
    '"Study this note" at the top counts today\'s cards and opens a session over the deck, and the row under it counts the cards with those learned',
    (tester) async {
      final screens = await DeckScreens.open(
        tester,
        cards: cards,
        due: {'Chat'},
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      // Chat was reviewed after a day's interval, so it is learning.
      expect(find.text('Cards 3'), findsOneWidget);
      expect(find.text('0 learned'), findsOneWidget);
      expect(
        tester.getSemantics(find.text('Cards 3')),
        isSemantics(label: 'Cards 3', isHeader: true),
      );
      final study = widgetWithShownText(AppButton, 'Study this note · 3');
      expect(study, findsOneWidget);
      // At the top: under the top bar, above the cards.
      expect(
        tester.getTopLeft(study).dy,
        greaterThanOrEqualTo(tester.getBottomLeft(find.byType(AppBar)).dy),
      );
      expect(
        tester.getBottomLeft(study).dy,
        lessThanOrEqualTo(tester.getTopLeft(find.text('Cards 3')).dy),
      );

      await screens.tap(study);

      expect(screens.session, {screens.deck.id});
      await screens.close();
    },
  );

  testWidgets(
    'opened from the 노트 tab, the deck screen sits above the tab bar, which stays under it until study covers it',
    (tester) async {
      final screens = await DeckScreens.open(
        tester,
        cards: cards,
        due: {'Chat'},
        fromHome: true,
      );
      final tabs = find.bySemanticsLabel('Tabs');
      await screens.tap(
        find.descendant(of: tabs, matching: find.text('Notes')),
      );
      await screens.tap(shownText('French'));

      expect(find.byType(DeckScreen), findsOneWidget);
      expect(tabs, findsOneWidget);
      expect(
        tester.getBottomLeft(find.byType(DeckScreen)).dy,
        lessThanOrEqualTo(tester.getTopLeft(tabs).dy),
      );
      // Control: study opens over the menu, so the bar can be covered.
      await screens.tap(_studyButton);
      expect(find.byType(StudyScreen), findsOneWidget);
      expect(tabs, findsNothing);
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

      await screens.tap(_studyButton);
      expect(
        shownText('How many minutes a day will you study?'),
        findsOneWidget,
      );
      expect(find.byType(StudyScreen), findsNothing);
      await waitForPicker(tester);
      await screens.tap(find.byTooltip('5 minutes less'));
      await screens.tap(shownText('Save'));

      expect(screens.session, {screens.deck.id});
      // Control: once shown, the next session opens at once.
      screens.navigator.currentState?.pop();
      await tester.pumpAndSettle();
      await screens.tap(_studyButton);
      expect(find.byType(BottomSheet), findsNothing);
      expect(screens.session, {screens.deck.id});
      await screens.close();
    },
  );

  testWidgets(
    'with nothing to study today, or no count yet or none readable, Study this note still opens a session over the deck',
    (tester) async {
      for (final (today, open, label) in [
        (
          'nothing to study',
          () =>
              DeckScreens.open(tester, cards: cards, later: cards.keys.toSet()),
          'Study this note · 0',
        ),
        (
          'no count yet',
          () => DeckScreens.open(tester, cards: cards, stalled: true),
          'Study this note',
        ),
        (
          'no count readable',
          () => DeckScreens.open(tester, cards: cards, unreadable: true),
          'Study this note',
        ),
      ]) {
        final screens = await open();
        await screens.push((deck) => DeckScreen(deck: deck));
        // The count is in the state the case names: read as zero, or not
        // read.
        expect(
          widgetWithShownText(AppButton, label),
          findsOneWidget,
          reason: today,
        );

        await screens.tap(_studyButton);

        expect(screens.session, {screens.deck.id}, reason: today);
        await screens.close();
      }
    },
  );

  testWidgets(
    'the cards are one group of rows, each whole with its back on the hatch, and a tap on a row opens that card in the editor',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(_rowFronts(tester), ['Chat', 'Chien', 'Hund']);
      expect(_answers(tester), ['cat', 'dog', 'DOG']);
      expect(find.bySemanticsLabel('Chien, back dog'), findsOneWidget);
      // There is no switch to show or hide the backs.
      expect(find.byType(Switch), findsNothing);
      // One group holds every row, and no row draws a bar or a pencil.
      expect(find.byType(SliverAppGroup), findsOneWidget);
      for (final row in tester.widgetList(find.byType(CardBackRow))) {
        final drawn = find.descendant(
          of: find.byWidget(row),
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Container ||
                (widget is DecoratedBox &&
                    widget.decoration is! HatchDecoration) ||
                widget is IconButton,
          ),
        );
        expect(drawn, findsNothing);
      }

      await screens.tap(shownText('Chien'));

      expect(find.widgetWithText(TextField, 'Chien'), findsOneWidget);
      await screens.close();
    },
  );
  testWidgets(
    'a cloze card shows its sentence with its blank filled on the hatch, read with its back',
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
      expect(hatchedBlanksUnder(row), ['Paris']);
      expect(
        find.bySemanticsLabel(
          'The capital of France is blank, back The capital of France is Paris',
        ),
        findsOneWidget,
      );
      // The stored back is never drawn beside the whole card.
      expect(shownText('The capital of France is Paris'), findsNothing);
      await screens.close();
    },
  );
  testWidgets(
    'each back is on the hatch under its front, in ink-2 against the front in ink',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      expect(find.text('Cards 3'), findsOneWidget);
      final colors = AppColors.of(tester.element(find.byType(DeckScreen)));
      final back = tester.getRect(shownText('dog'));
      final front = tester.getRect(shownText('Chien'));
      expect(back.top, greaterThan(front.bottom), reason: 'under the front');
      RichText drawn(String text) => tester.widget<RichText>(
        find
            .descendant(of: shownText(text), matching: find.byType(RichText))
            .first,
      );
      expect(drawn('dog').text.style?.color, colors.ink2);
      // Control: the front is drawn in ink.
      expect(drawn('Chien').text.style?.color, isNot(colors.ink2));
      await screens.close();
    },
  );
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
      '$name is read on its row as its 칸 revealed, its kept back after them',
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

  testWidgets('the heading Cards N stays pinned while the list scrolls', (
    tester,
  ) async {
    final semantics = tester.ensureSemantics();
    final screens = await DeckScreens.open(
      tester,
      cards: {for (var i = 0; i < 30; i++) 'word $i': 'answer $i'},
    );
    await screens.push((deck) => DeckScreen(deck: deck));

    final heading = find.text('Cards 30');
    final top = tester.getTopLeft(heading).dy;
    expect(shownText('word 0'), findsOneWidget);
    await tester.drag(find.byType(CustomScrollView), const Offset(0, -600));
    await tester.pumpAndSettle();
    // The list scrolled past its first card and Study this note.
    expect(shownText('word 0'), findsNothing);
    expect(_studyButton, findsNothing);
    expect(tester.getTopLeft(heading).dy, lessThan(top));
    expect(
      tester.getTopLeft(heading).dy,
      greaterThanOrEqualTo(tester.getBottomLeft(find.byType(AppBar)).dy),
    );
    semantics.dispose();
    await screens.close();
  });

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
          label: 'Chien, back dog',
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
      await screens.enter('Search', 'dog');
      expect(_rowFronts(tester), ['Chien', 'Hund']);

      await screens.enter('Search', 'CHAT');
      expect(_rowFronts(tester), ['Chat']);

      await screens.enter('Search', 'zebra');
      expect(_rowFronts(tester), isEmpty);
      expect(shownText('No card matches. Try other words.'), findsOneWidget);

      await screens.enter('Search', '');
      expect(_rowFronts(tester), ['Chat', 'Chien', 'Hund']);
      await screens.close();
    },
  );

  testWidgets(
    'while searching above a phone keyboard, the first match starts under the search field and shows above the keyboard',
    (tester) async {
      final screens = await DeckScreens.open(tester, cards: cards);
      await screens.push((deck) => DeckScreen(deck: deck));
      // Control: before the search, Study this note is up.
      expect(_studyButton, findsOneWidget);

      tester.view.viewInsets = const FakeViewPadding(bottom: 336);
      addTearDown(tester.view.resetViewInsets);
      await screens.enter('Search', 'ch');
      await tester.pumpAndSettle();
      expect(tester.view.viewInsets.bottom, 336, reason: 'the keyboard is up');

      final first = tester.getRect(find.byType(CardBackRow).first);
      final search = tester.getRect(
        find.widgetWithText(AppTextField, 'Search'),
      );
      expect(first.bottom, lessThanOrEqualTo(844 - 336));
      expect(first.top - search.bottom, lessThan(AppSize.tapTarget * 2));
      expect(_studyButton, findsNothing);
      await screens.close();
    },
  );

  testWidgets('the back leaves the screen, a search typed or not', (
    tester,
  ) async {
    final screens = await DeckScreens.open(tester, cards: cards);
    await screens.push((deck) => DeckScreen(deck: deck));
    await screens.enter('Search', 'ch');
    expect(_rowFronts(tester), ['Chat', 'Chien']);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();
    expect(find.byType(DeckScreen), findsNothing);
    await screens.close();
  });

  testWidgets(
    '"Delete note" is drawn in the destructive text colour, where "Rename" is not',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Note settings'));

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
    'the Add card sheet, titled Add card, offers by hand, the camera, the album and a file, each row its title alone with no line under it',
    (tester) async {
      final screens = await DeckScreens.open(tester, photoImport: true);
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(shownText('Add card'));

      final sheet = find.byType(BottomSheet);
      expect(
        find.descendant(of: sheet, matching: shownText('Add card')),
        findsOneWidget,
      );
      final rows = find.descendant(
        of: sheet,
        matching: find.byType(AppListRow),
      );
      const titles = [
        'Enter by hand',
        'Take photo',
        'Choose from album',
        'Excel or CSV file',
      ];
      expect([
        for (final row in tester.widgetList<AppListRow>(rows)) row.title,
      ], titles);
      for (final (i, title) in titles.indexed) {
        final row = rows.at(i);
        // One line of text is drawn, and read, on the row: its title.
        expect(
          [
            for (final text in tester.widgetList<Text>(
              find.descendant(of: row, matching: find.byType(Text)),
            ))
              text.data,
          ],
          [title],
          reason: title,
        );
        expect(
          tester.getSemantics(row),
          isSemantics(label: title, hasTapAction: true),
          reason: title,
        );
      }
      await screens.close();
    },
  );

  testWidgets(
    'without photo import, Add card offers by hand and a file, no photo',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(shownText('Add card'));

      expect(find.text('Take photo'), findsNothing);
      expect(shownText('Choose from album'), findsNothing);
      expect(shownText('Excel or CSV file'), findsOneWidget);
      await screens.tap(shownText('Enter by hand'));
      expect(find.widgetWithText(AppBar, 'New card'), findsOneWidget);
      await screens.close();
    },
  );

  testWidgets(
    'Excel or CSV file adds the rows reviewed to this deck, and returns to its list',
    (tester) async {
      final pick = _OneFile('pear,배\nplum,자두');
      final screens = await DeckScreens.open(
        tester,
        cards: const {'apple': '사과'},
        overrides: [spreadsheetPickProvider.overrideWithValue(pick)],
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      await screens.tap(shownText('Add card'));
      await screens.tap(shownText('Excel or CSV file'));
      expect(shownText('Add cards from a file'), findsOneWidget);
      await screens.tap(shownText('Choose file'));
      expect(find.text('Review cards'), findsOneWidget);

      await tester.tap(widgetWithShownText(AppButton, 'Add 2 cards'));
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
    'with photo import, Add card offers by hand, the camera and the album in one sheet, each photo row opening photo import for this deck from its source',
    (tester) async {
      final screens = await DeckScreens.open(tester, photoImport: true);
      await screens.push((deck) => DeckScreen(deck: deck));

      for (final (row, origin) in [
        ('Take photo', PhotoOrigin.camera),
        ('Choose from album', PhotoOrigin.album),
      ]) {
        await screens.tap(shownText('Add card'));
        expect(shownText('Enter by hand'), findsOneWidget);
        expect(find.text('Take photo'), findsOneWidget);
        expect(shownText('Choose from album'), findsOneWidget);
        await screens.tap(find.text(row));
        expect(find.text('photo import'), findsOneWidget);
        expect(screens.photoImports.last, (screens.deck.id, origin));
        screens.navigator.currentState!.pop();
        await tester.pumpAndSettle();
      }
      // By hand opens the editor.
      await screens.tap(shownText('Add card'));
      await screens.tap(shownText('Enter by hand'));
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
        await screens.tap(shownText('Add card'));
        await screens.tap(find.text('Take photo'));
        screens.navigator.currentState!.pop(PhotoImportSaved(deck));
        await tester.pumpAndSettle();
      }

      await saveInto(screens.deck);
      expect(shownText('French'), findsOneWidget);

      await saveInto(other);
      expect(shownText('Spanish'), findsOneWidget);
      expect(shownText('French'), findsNothing);
      screens.navigator.currentState!.pop();
      await tester.pumpAndSettle();
      expect(find.byType(DeckScreen), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'a photo import left for adding by hand opens the editor on this deck, and one left for a spreadsheet opens the file import on it, back returning to the deck each time',
    (tester) async {
      final pick = _OneFile('pear,배');
      final screens = await DeckScreens.open(
        tester,
        photoImport: true,
        overrides: [spreadsheetPickProvider.overrideWithValue(pick)],
      );
      await screens.push((deck) => DeckScreen(deck: deck));

      Future<void> leaveFor(PhotoImportOutcome outcome) async {
        await screens.tap(shownText('Add card'));
        await screens.tap(find.text('Take photo'));
        screens.navigator.currentState!.pop(outcome);
        await tester.pumpAndSettle();
      }

      await leaveFor(AddByHandInstead(screens.deck.id));
      expect(find.widgetWithText(AppBar, 'New card'), findsOneWidget);
      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.widgetWithText(AppBar, 'New card'), findsNothing);
      expect(shownText('French'), findsOneWidget);

      await leaveFor(AddFromSpreadsheetInstead(screens.deck.id));
      expect(shownText('Add cards from a file'), findsOneWidget);
      await screens.tap(shownText('Choose file'));
      await tester.tap(widgetWithShownText(AppButton, 'Add 1 card'));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 50)),
      );
      await tester.pumpAndSettle();
      expect(shownText('French'), findsOneWidget);
      expect((await screens.cards()).map((card) => plainText(card.front)), [
        'pear',
      ]);
      await screens.close();
    },
  );

  testWidgets('the deck menu renames the deck', (tester) async {
    final screens = await DeckScreens.open(tester);
    await screens.push((deck) => DeckScreen(deck: deck));

    await screens.tap(find.byTooltip('Note settings'));
    await screens.tap(find.text('Rename'));
    await screens.enter('Note name', 'Français');
    await screens.tap(shownText('Save'));

    expect(shownText('Français'), findsOneWidget);
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
      expect(shownText('French'), findsOneWidget, reason: 'the opening name');

      await tester.runAsync(
        () => screens.repository.renameDeck(screens.deck.id, 'Français'),
      );
      await tester.pumpAndSettle();
      expect(shownText('Français'), findsOneWidget);
      expect(shownText('French'), findsNothing);

      await screens.tap(find.byTooltip('Note settings'));
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

      await screens.tap(find.byTooltip('Note settings'));
      await screens.tap(find.text('Delete note'));
      expect(shownText('Delete "Français"?'), findsOneWidget);
      await screens.tap(shownText('Cancel'));

      await screens.tap(shownText('Add card'));
      await screens.tap(shownText('Enter by hand'));
      expect(shownText('Français'), findsOneWidget, reason: "the editor's");
      expect(shownText('French'), findsNothing);
      await screens.close();
    },
  );

  testWidgets(
    'the rename sheet opens focused on the current name, refuses an empty one, and saves on Enter',
    (tester) async {
      final screens = await DeckScreens.open(tester);
      await screens.push((deck) => DeckScreen(deck: deck));
      await screens.tap(find.byTooltip('Note settings'));
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

      await screens.tap(find.byTooltip('Note settings'));
      await screens.tap(find.text('Delete note'));
      expect(shownText('Its 3 cards will be deleted too.'), findsOneWidget);
      await screens.tap(shownText('Delete'));

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
        expect(shownText('카드 추가'), findsOneWidget);
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
