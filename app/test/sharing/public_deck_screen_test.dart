import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_raised.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/sharing/sharing.dart';

import 'fakes.dart';
import 'sharing_app.dart';
import 'sharing_service_test.dart' show publicCard, publicDeck;
import '../deck/whole_cards.dart';
import '../word_breaks.dart';

final _spanish = publicDeck(
  'spanish',
  name: 'Spanish',
  ownerName: 'Dee',
  description: 'Animals',
  cards: 3,
  copies: 2,
);

/// Spanish, with three cards, one of whose keys the user's "Mine" holds.
FakeSharingServer _server() => FakeSharingServer(
  decks: [_spanish],
  cards: {
    _spanish.id: [
      publicCard('perro', 'dog'),
      publicCard('gato', 'cat'),
      publicCard('pez', 'fish'),
    ],
  },
);

const _mine = {
  'Mine': {'perro': 'hound'},
};

/// Opens the browse screen, then Spanish.
Future<SharingApp> _openSpanish(
  WidgetTester tester, {
  FakeSharingServer? server,
  ThemeMode themeMode = ThemeMode.light,
}) async {
  final app = await SharingApp.open(
    tester,
    server: server ?? _server(),
    myDecks: _mine,
    themeMode: themeMode,
  );
  await app.browse();
  await app.tapText('Spanish');
  return app;
}

/// Whether [text] sits in a box on the hatch.
bool _onHatch(WidgetTester tester, Finder text) => tester
    .widgetList<DecoratedBox>(
      find.ancestor(of: text, matching: find.byType(DecoratedBox)),
    )
    .any((box) => box.decoration is HatchDecoration);

void main() {
  testWidgets(
    'the preview draws a framed card as the deck screen does, split or whole',
    (tester) async {
      PublicCard framed(List<Cell> cells) {
        final sides = sidesOf(cells);
        return PublicCard(front: sides.front, back: sides.back, cells: cells);
      }

      final app = await _openSpanish(
        tester,
        server: FakeSharingServer(
          decks: [_spanish],
          cards: {
            _spanish.id: [
              framed(const [TextCell(front: 'perro', back: 'dog')]),
              framed(const [
                BlankCell(ClozeContent('___ barks.', ['Dog'])),
                TextCell(front: 'one'),
                TextCell(front: 'two', back: 'A pet.'),
              ]),
            ],
          },
        ),
      );

      final rows = find.byType(CardBackRow);
      // The 글 shows its back after its front, in a box on the hatch.
      expect(
        find.descendant(of: rows.first, matching: shownText('dog')),
        findsOneWidget,
      );
      expect(_onHatch(tester, shownText('dog')), isTrue);
      expect(_onHatch(tester, shownText('perro')), isFalse);
      // The whole card draws its 칸 in order, its blank on the hatch.
      expect(hatchedBlanksUnder(rows.last), ['Dog']);
      double top(String text) => tester.getTopLeft(shownText(text)).dy;
      expect(top('one'), lessThan(top('two')));
      expect(top('two'), lessThan(top('A pet.')));
      await app.close();
    },
  );

  testWidgets(
    'the preview shows the name, owner, description, counts and cards',
    (tester) async {
      final app = await _openSpanish(tester);

      expect(find.text('Dee · 3 cards · copied 2 times'), findsOneWidget);
      expect(find.text('Animals'), findsOneWidget);
      for (final text in ['perro', 'dog', 'gato', 'cat', 'pez', 'fish']) {
        expect(shownText(text), findsOneWidget, reason: text);
      }
      expect(find.byType(CardBackRow), findsNWidgets(3));
      await app.close();
    },
  );

  testWidgets(
    "the preview's cards are one group split by hairlines, each its front "
    'and then its back from one left edge, as the note draws them, opening '
    'nothing',
    (tester) async {
      final handle = tester.ensureSemantics();
      final app = await _openSpanish(tester);

      final rows = find.byType(CardBackRow);
      expect(rows, findsNWidgets(3));
      final group = find.byType(AppGroup);
      expect(group, findsOneWidget);
      expect(find.descendant(of: group, matching: rows), findsNWidgets(3));
      // A row draws no surface of its own: the group draws one.
      expect(
        find.descendant(of: rows.first, matching: find.byType(AppRaised)),
        findsNothing,
      );
      expect(
        find.descendant(of: group, matching: find.byType(Divider)),
        findsNWidgets(2),
      );
      for (final (front, back) in [
        ('perro', 'dog'),
        ('gato', 'cat'),
        ('pez', 'fish'),
      ]) {
        final shownFront = tester.getRect(shownText(front));
        final box = tester.getRect(
          find
              .ancestor(
                of: shownText(back),
                matching: find.byType(DecoratedBox),
              )
              .first,
        );
        expect(_onHatch(tester, shownText(back)), isTrue, reason: back);
        // The back's box starts on the front's left edge, under it.
        expect(box.left, shownFront.left, reason: back);
        expect(box.top, greaterThanOrEqualTo(shownFront.bottom), reason: back);
        expect(
          tester.getSemantics(find.bySemanticsLabel('$front, back $back')),
          isSemantics(isButton: false, hasTapAction: false),
          reason: front,
        );
      }
      handle.dispose();
      await app.close();
    },
  );

  testWidgets(
    'the preview shows the first 20 cards of a larger deck and says so',
    (tester) async {
      final big = publicDeck('big', name: 'Big', cards: 25);
      final server = FakeSharingServer(
        decks: [big],
        cards: {
          big.id: [
            for (var i = 0; i < 25; i++) publicCard('front $i', 'back $i'),
          ],
        },
      );
      final app = await SharingApp.open(tester, server: server);
      await app.browse();
      await app.tapText('Big');

      expect(find.byType(CardBackRow, skipOffstage: false), findsNWidgets(20));
      await tester.scrollUntilVisible(find.text('First 20 of 25 cards'), 200);
      expect(find.text('First 20 of 25 cards'), findsOneWidget);
      await app.close();
    },
  );

  testWidgets(
    'importing as a new deck, the default, copies every card into a deck named after it',
    (tester) async {
      final app = await _openSpanish(tester);

      await app.tapText('Add to my notes');
      expect(
        find.text('Creates the note "Spanish" with every card.'),
        findsOneWidget,
      );
      await app.tapText('Add');

      expect(find.text('Added 3 cards to "Spanish"'), findsOneWidget);
      expect(await app.cardsOf('Spanish'), [
        ('perro', 'dog', CardSource.copy),
        ('gato', 'cat', CardSource.copy),
        ('pez', 'fish', CardSource.copy),
      ]);
      expect(app.server.imports, [_spanish.id]);
      await app.close();
    },
  );

  for (final (option, expected) in [
    (
      'Skip',
      [
        ('perro', 'hound', CardSource.manual),
        ('gato', 'cat', CardSource.copy),
        ('pez', 'fish', CardSource.copy),
      ],
    ),
    (
      'Merge back',
      [
        ('perro', 'hound\ndog', CardSource.manual),
        ('gato', 'cat', CardSource.copy),
        ('pez', 'fish', CardSource.copy),
      ],
    ),
    (
      'Add as new',
      [
        ('perro', 'hound', CardSource.manual),
        ('perro', 'dog', CardSource.copy),
        ('gato', 'cat', CardSource.copy),
        ('pez', 'fish', CardSource.copy),
      ],
    ),
  ]) {
    testWidgets(
      'importing into an existing deck with "$option" applies it to the duplicate',
      (tester) async {
        final app = await _openSpanish(tester);

        await app.tapText('Add to my notes');
        await app.tapText('Into a note');
        // Nothing is chosen yet, so nothing can be added.
        expect(
          tester
              .widget<FilledButton>(widgetWithShownText(FilledButton, 'Add'))
              .onPressed,
          isNull,
        );
        await app.tap(find.byType(DropdownMenu<DeckId>));
        await app.tap(find.text('Mine').last);
        expect(
          tester
              .widget<RadioListTile<DuplicateChoice>>(
                find.widgetWithText(RadioListTile<DuplicateChoice>, 'Skip'),
              )
              .value,
          DuplicateChoice.skip,
        );
        await app.tapText(option);
        await app.tapText('Add');

        expect(find.textContaining('to "Mine"'), findsOneWidget);
        expect(await app.cardsOf('Mine'), expected);
        await app.close();
      },
    );
  }

  testWidgets(
    'an import of a deck no longer public says so and writes nothing',
    (tester) async {
      final app = await _openSpanish(tester);
      app.server.decks = [];

      await app.tapText('Add to my notes');
      await app.tapText('Add');

      expect(find.text('This note is no longer public.'), findsOneWidget);
      final names = await tester.runAsync(
        () async => [
          for (final deck in await app.decks.watchDecks().first) deck.name,
        ],
      );
      expect(names, ['Mine']);
      await app.close();
    },
  );

  testWidgets('a report needs a reason, is filed once, and a second says so', (
    tester,
  ) async {
    final app = await _openSpanish(tester);

    await app.deckMenu('Report note');
    final report = widgetWithShownText(FilledButton, 'Report');
    expect(tester.widget<FilledButton>(report).onPressed, isNull);
    // The sheet is dismissed by a drag or the scrim, so it offers no cancel.
    expect(
      find.descendant(
        of: find.byType(BottomSheet),
        matching: find.byType(AppButton),
      ),
      findsOneWidget,
    );
    expect(shownText('Cancel'), findsNothing);
    await app.tapText('Spam');
    await app.tap(report);

    expect(find.text("Reported. We'll review it."), findsOneWidget);
    expect(app.server.reports, [(_spanish.id, ReportReason.spam)]);
    // Snack bars queue; the first leaves before the second shows.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await app.deckMenu('Report note');
    await app.tapText('Other');
    await app.tap(widgetWithShownText(FilledButton, 'Report'));
    expect(find.text("You've already reported this note."), findsOneWidget);
    expect(app.server.reports, hasLength(1));
    await app.close();
  });

  testWidgets(
    "blocking the owner returns to browse without the owner's decks",
    (tester) async {
      final other = publicDeck(
        'german',
        name: 'German',
        owner: '00000000-0000-4000-8000-00000000000c',
      );
      final server = _server()..decks = [_spanish, other];
      final app = await _openSpanish(tester, server: server);

      await app.deckMenu('Block this user');
      expect(shownText('Block Dee?'), findsOneWidget);
      await app.tapText('Block');

      expect(find.text('Blocked Dee.'), findsOneWidget);
      expect(find.text('Spanish'), findsNothing);
      expect(find.text('German'), findsOneWidget);
      expect(app.server.blocked, {_spanish.owner});
      await app.close();
    },
  );

  testWidgets('cancelling the block blocks no one', (tester) async {
    final app = await _openSpanish(tester);

    await app.deckMenu('Block this user');
    await app.tapText('Cancel');

    expect(app.server.blocked, isEmpty);
    expect(shownText('Add to my notes'), findsOneWidget);
    await app.close();
  });

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the preview, import sheet and report dialog meet the tap target and contrast guidelines',
      (tester) async {
        final app = await _openSpanish(tester, themeMode: mode);
        await app.meetsGuidelines();
        await app.tapText('Add to my notes');
        await app.meetsGuidelines();
        await app.tapText('Into a note');
        await app.meetsGuidelines();
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
        await app.deckMenu('Report note');
        await app.meetsGuidelines();
        await app.close();
      },
    );
  }
}
