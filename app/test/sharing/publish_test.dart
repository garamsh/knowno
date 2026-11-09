import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/sharing/sharing.dart';

import 'fakes.dart';
import 'sharing_app.dart';
import '../word_breaks.dart';

const _french = {
  'French': {'chat': 'cat'},
};

/// Opens the 노트 tab over "French", then French's card list.
Future<SharingApp> _openFrench(
  WidgetTester tester, {
  FakeSharingServer? server,
  bool online = true,
  ThemeMode themeMode = ThemeMode.light,
}) async {
  final app = await SharingApp.open(
    tester,
    server: server,
    online: online,
    myDecks: _french,
    themeMode: themeMode,
  );
  await app.tapText('French');
  return app;
}

/// French as stored.
Future<Deck> _stored(SharingApp app) async => (await app.tester.runAsync(
  () async => (await app.decks.watchDecks().first).single,
))!;

FilledButton _publishButton(WidgetTester tester) =>
    tester.widget(widgetWithShownText(FilledButton, 'Publish'));

void main() {
  testWidgets(
    'a first publish asks for the display name, requires the agreement, and marks the deck public',
    (tester) async {
      final app = await _openFrench(tester);

      await app.deckMenu('Publish');
      expect(shownText('Publish "French"'), findsOneWidget);
      expect(widgetWithShownText(AppTextField, 'Public name'), findsOneWidget);
      await tester.enterText(
        widgetWithShownText(AppTextField, 'Public name'),
        'Ada',
      );
      await tester.enterText(
        widgetWithShownText(AppTextField, 'Description (optional)'),
        'Cats',
      );
      await tester.pump();
      // The agreement is required: without it nothing can be published.
      expect(_publishButton(tester).onPressed, isNull);
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      expect(_publishButton(tester).onPressed, isNotNull);
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));

      expect(shownText('Note published'), findsOneWidget);
      expect(app.server.name?.value, 'Ada');
      expect(app.server.writes.single.description, 'Cats');
      final stored = await _stored(app);
      expect(stored.visibility, isA<PublicDeck>());
      expect(stored.description, 'Cats');
      expect(shownText('0 learned · Public'), findsOneWidget);
      await tester.tap(find.byTooltip('Note settings'));
      await tester.pumpAndSettle();
      expect(shownText('Make private'), findsOneWidget);
      expect(shownText('Publish'), findsNothing);
      await app.close();
    },
  );

  testWidgets(
    'a display name of the wrong length is refused with a message and nothing is published',
    (tester) async {
      final app = await _openFrench(tester);
      await app.deckMenu('Publish');
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );

      await tester.enterText(
        widgetWithShownText(AppTextField, 'Public name'),
        'A',
      );
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));
      expect(shownText('Use 2 to 20 characters'), findsOneWidget);
      await tester.enterText(
        widgetWithShownText(AppTextField, 'Public name'),
        'a' * 21,
      );
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));
      expect(shownText('Use 2 to 20 characters'), findsOneWidget);
      expect(app.server.writes, isEmpty);
      expect(app.server.name, isNull);

      // Control: a valid name publishes.
      await tester.enterText(
        widgetWithShownText(AppTextField, 'Public name'),
        'Ad',
      );
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));
      expect(app.server.name?.value, 'Ad');
      expect(app.server.writes, hasLength(1));
      await app.close();
    },
  );

  testWidgets(
    'a description over 300 characters, as the server counts them, is refused with a message',
    (tester) async {
      final app = await _openFrench(
        tester,
        server: FakeSharingServer(name: DisplayName.tryParse('Ada')),
      );
      await app.deckMenu('Publish');
      await tester.enterText(
        widgetWithShownText(AppTextField, 'Description (optional)'),
        // 151 characters the field counts once each, of two code points each.
        '👍🏽' * 151,
      );
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));

      expect(shownText('Use at most 300 characters'), findsOneWidget);
      expect(app.server.writes, isEmpty);
      await app.close();
    },
  );

  testWidgets('a later publish does not ask for the display name again', (
    tester,
  ) async {
    final app = await _openFrench(
      tester,
      server: FakeSharingServer(name: DisplayName.tryParse('Ada')),
    );
    await app.deckMenu('Publish');

    expect(widgetWithShownText(AppTextField, 'Public name'), findsNothing);
    await app.tap(
      shownText("I won't publish inappropriate or copyrighted content"),
    );
    await app.tap(widgetWithShownText(FilledButton, 'Publish'));
    expect(shownText('Note published'), findsOneWidget);
    await app.close();
  });

  testWidgets(
    'a publish the server refuses says why in the sheet and leaves the deck private',
    (tester) async {
      final server = FakeSharingServer(name: DisplayName.tryParse('Ada'));
      final app = await _openFrench(tester, server: server);
      await app.deckMenu('Publish');
      server.failure = SharingOffline(Exception('no network'));
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      await app.tap(widgetWithShownText(FilledButton, 'Publish'));

      expect(
        shownText("You're offline. Check your connection and try again."),
        findsOneWidget,
      );
      expect((await _stored(app)).visibility, isA<PrivateDeck>());
      await app.close();
    },
  );

  Finder inSheet(String text) =>
      find.descendant(of: find.byType(BottomSheet), matching: shownText(text));

  Future<void> publishNow(SharingApp app) async {
    await app.tap(
      shownText("I won't publish inappropriate or copyrighted content"),
    );
    await app.tap(widgetWithShownText(FilledButton, 'Publish'));
  }

  testWidgets(
    'while the check runs the sheet says it is checking, and the answer ends the wait',
    (tester) async {
      final server = FakeSharingServer(name: DisplayName.tryParse('Ada'))
        ..hold = Completer<void>();
      final app = await _openFrench(tester, server: server);
      await app.deckMenu('Publish');
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      expect(shownText("We're checking this note"), findsNothing);

      await tester.tap(widgetWithShownText(FilledButton, 'Publish'));
      await tester.pump();

      expect(shownText("We're checking this note"), findsOneWidget);
      expect(shownText('Note published'), findsNothing);
      server.hold!.complete();
      await tester.pumpAndSettle();
      expect(shownText("We're checking this note"), findsNothing);
      expect(shownText('Note published'), findsOneWidget);
      await app.close();
    },
  );

  testWidgets(
    'a note held for an admin says why in the sheet and on the note, and stays under review on the device',
    (tester) async {
      final server = FakeSharingServer(name: DisplayName.tryParse('Ada'))
        ..screening = const Screening(DeckPublication.held);
      final app = await _openFrench(tester, server: server);
      await app.deckMenu('Publish');
      await publishNow(app);

      const why = 'An admin reviews this note before it goes public';
      expect(inSheet(why), findsOneWidget);
      expect(shownText('Note published'), findsNothing);
      final stored = await _stored(app);
      expect(stored.publication, DeckPublication.held);
      expect(stored.visibility, isA<PublicDeck>());
      await app.tap(widgetWithShownText(FilledButton, 'Close'));

      // The note shows the state and the sentence, not "Public".
      expect(shownText('0 learned · In review'), findsOneWidget);
      expect(shownText(why), findsOneWidget);
      expect(shownText('Public'), findsNothing);
      await app.close();
    },
  );

  testWidgets(
    'a refused note names each card and passage found, opens that card, and publishes again once fixed',
    (tester) async {
      final server = FakeSharingServer(name: DisplayName.tryParse('Ada'))
        ..screening = const Screening(
          DeckPublication.refused,
          refusal: 'rules',
          findings: [
            ScreeningFinding(
              place: FindingPlace.front,
              category: FindingCategory.phone,
              card: CardId('id1'),
              block: 0,
              start: 0,
              end: 4,
            ),
            ScreeningFinding(
              place: FindingPlace.description,
              category: FindingCategory.link,
              start: 0,
              end: 3,
            ),
          ],
        );
      final app = await SharingApp.open(
        tester,
        server: server,
        myDecks: {
          'French': {'chat': ''},
        },
      );
      await app.tapText('French');
      await app.deckMenu('Publish');
      await publishNow(app);

      const why =
          "This note has content that can't be public, so fix it and publish again";
      expect(inSheet(why), findsOneWidget);
      expect(
        shownText('Front: "chat", Looks like a phone number'),
        findsOneWidget,
      );
      expect(
        shownText('Description: Has a link or an address'),
        findsOneWidget,
      );
      final stored = await _stored(app);
      expect(stored.publication, DeckPublication.refused);
      expect(stored.visibility, isA<PrivateDeck>());

      // The row of the card opens it.
      await app.tap(shownText('Front: "chat", Looks like a phone number'));
      expect(shownText('Edit card'), findsOneWidget);
      await app.tap(find.byTooltip('Close'));
      expect(shownTextContaining('Not published'), findsOneWidget);

      // Fixed: the sheet says why it was refused last time, and publishes.
      server.screening = const Screening(DeckPublication.public);
      await app.deckMenu('Publish');
      expect(inSheet(why), findsOneWidget);
      await publishNow(app);
      expect(shownText('Note published'), findsOneWidget);
      final published = await _stored(app);
      expect(published.publication, DeckPublication.public);
      expect(published.visibility, isA<PublicDeck>());
      await app.close();
    },
  );

  testWidgets('the 노트 tab shows each state of the screening as its chip', (
    tester,
  ) async {
    final app = await SharingApp.open(
      tester,
      myDecks: {'French': {}, 'German': {}, 'Latin': {}},
    );
    Future<void> write(int at, Future<void> Function(DeckId) change) async {
      await tester.runAsync(() async {
        final decks = await app.decks.watchDecks().first;
        await change(decks[at].id);
      });
      await tester.pumpAndSettle();
    }

    final since = PublicDeck(DateTime.utc(2026, 10, 15));
    await write(
      0,
      (id) => app.decks.setVisibility(
        id,
        since,
        publication: DeckPublication.checking,
      ),
    );
    await write(
      1,
      (id) =>
          app.decks.setVisibility(id, since, publication: DeckPublication.held),
    );
    await write(
      2,
      (id) => app.decks.setPublication(id, DeckPublication.refused),
    );

    expect(shownText('Checking'), findsOneWidget);
    expect(shownText('In review'), findsOneWidget);
    expect(shownText('Not published'), findsOneWidget);
    expect(shownText('Public'), findsNothing);
    await app.close();
  });

  testWidgets('unpublishing makes the deck private and removes the chip', (
    tester,
  ) async {
    final app = await _openFrench(
      tester,
      server: FakeSharingServer(name: DisplayName.tryParse('Ada')),
    );
    await app.deckMenu('Publish');
    await app.tap(
      shownText("I won't publish inappropriate or copyrighted content"),
    );
    await app.tap(widgetWithShownText(FilledButton, 'Publish'));
    expect(shownText('0 learned · Public'), findsOneWidget);
    // Snack bars queue; the first leaves before the second shows.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await app.deckMenu('Make private');

    expect(shownText('Note is private again'), findsOneWidget);
    expect(shownText('0 learned · Public'), findsNothing);
    expect((await _stored(app)).visibility, isA<PrivateDeck>());
    expect(app.server.writes.last.visibility, isA<PrivateDeck>());
    await app.close();
  });

  testWidgets('the 노트 tab shows the chip on a public deck only', (
    tester,
  ) async {
    final app = await SharingApp.open(
      tester,
      myDecks: {'French': {}, 'German': {}},
    );
    expect(shownText('Public'), findsNothing);
    await tester.runAsync(() async {
      final french = (await app.decks.watchDecks().first).first;
      await app.decks.setVisibility(
        french.id,
        PublicDeck(DateTime.utc(2026, 10, 15)),
      );
    });
    await tester.pumpAndSettle();

    expect(shownText('Public'), findsOneWidget);
    final chip = tester.getCenter(shownText('Public')).dy;
    expect(chip, closeTo(tester.getCenter(shownText('French')).dy, 20));
    await app.close();
  });

  testWidgets('offline, publishing is disabled with a one-line reason', (
    tester,
  ) async {
    final app = await _openFrench(tester, online: false);
    await tester.tap(find.byTooltip('Note settings'));
    await tester.pumpAndSettle();

    expect(shownText("Available when you're online"), findsOneWidget);
    await tester.tap(shownText('Publish'));
    await tester.pumpAndSettle();
    expect(shownText('Publish "French"'), findsNothing);
    expect(app.server.writes, isEmpty);
    // The menu's button closes it again.
    await tester.tap(find.byTooltip('Note settings'));
    await tester.pumpAndSettle();
    expect(shownText('Publish'), findsNothing, reason: 'the menu closed');

    // Control: back online, the same item opens the sheet.
    app.network.online = true;
    await tester.pumpAndSettle();
    await app.deckMenu('Publish');
    expect(shownText('Publish "French"'), findsOneWidget);
    await app.close();
  });

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme the deck menu, publish sheet and public chip meet the tap target and contrast guidelines',
      (tester) async {
        final app = await _openFrench(tester, themeMode: mode);
        await tester.tap(find.byTooltip('Note settings'));
        await tester.pumpAndSettle();
        await app.meetsGuidelines();
        await app.tapText('Publish');
        await app.meetsGuidelines();
        await tester.enterText(
          widgetWithShownText(AppTextField, 'Public name'),
          'A',
        );
        await app.tap(
          shownText("I won't publish inappropriate or copyrighted content"),
        );
        await app.tap(widgetWithShownText(FilledButton, 'Publish'));
        await app.meetsGuidelines();
        await tester.enterText(
          widgetWithShownText(AppTextField, 'Public name'),
          'Ada',
        );
        await app.tap(widgetWithShownText(FilledButton, 'Publish'));
        expect(shownText('0 learned · Public'), findsOneWidget);
        await app.meetsGuidelines();
        await tester.pageBack();
        await tester.pumpAndSettle();
        await app.meetsGuidelines();
        await app.close();
      },
    );
  }
}
