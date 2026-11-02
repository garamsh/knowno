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

/// Opens the deck list over "French", then French's card list.
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
    tester.widget(find.widgetWithText(FilledButton, 'Publish'));

void main() {
  testWidgets(
    'a first publish asks for the display name, requires the agreement, and marks the deck public',
    (tester) async {
      final app = await _openFrench(tester);

      await app.deckMenu('Publish');
      expect(shownText('Publish "French"'), findsOneWidget);
      expect(find.widgetWithText(AppTextField, 'Public name'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(AppTextField, 'Public name'),
        'Ada',
      );
      await tester.enterText(
        find.widgetWithText(AppTextField, 'Description (optional)'),
        'Cats',
      );
      await tester.pump();
      // The agreement is required: without it nothing can be published.
      expect(_publishButton(tester).onPressed, isNull);
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      expect(_publishButton(tester).onPressed, isNotNull);
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));

      expect(find.text('Note published'), findsOneWidget);
      expect(app.server.name?.value, 'Ada');
      expect(app.server.writes.single.description, 'Cats');
      final stored = await _stored(app);
      expect(stored.visibility, isA<PublicDeck>());
      expect(stored.description, 'Cats');
      expect(find.text('1 card · 0 mastered · Public'), findsOneWidget);
      await tester.tap(find.byTooltip('Note actions'));
      await tester.pumpAndSettle();
      expect(find.text('Make private'), findsOneWidget);
      expect(find.text('Publish'), findsNothing);
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
        find.widgetWithText(AppTextField, 'Public name'),
        'A',
      );
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));
      expect(find.text('Use 2 to 20 characters'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(AppTextField, 'Public name'),
        'a' * 21,
      );
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));
      expect(find.text('Use 2 to 20 characters'), findsOneWidget);
      expect(app.server.writes, isEmpty);
      expect(app.server.name, isNull);

      // Control: a valid name publishes.
      await tester.enterText(
        find.widgetWithText(AppTextField, 'Public name'),
        'Ad',
      );
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));
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
        find.widgetWithText(AppTextField, 'Description (optional)'),
        // 151 characters the field counts once each, of two code points each.
        '👍🏽' * 151,
      );
      await app.tap(
        shownText("I won't publish inappropriate or copyrighted content"),
      );
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));

      expect(find.text('Use at most 300 characters'), findsOneWidget);
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

    expect(find.widgetWithText(AppTextField, 'Public name'), findsNothing);
    await app.tap(
      shownText("I won't publish inappropriate or copyrighted content"),
    );
    await app.tap(find.widgetWithText(FilledButton, 'Publish'));
    expect(find.text('Note published'), findsOneWidget);
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
      await app.tap(find.widgetWithText(FilledButton, 'Publish'));

      expect(
        find.text("You're offline. Check your connection and try again."),
        findsOneWidget,
      );
      expect((await _stored(app)).visibility, isA<PrivateDeck>());
      await app.close();
    },
  );

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
    await app.tap(find.widgetWithText(FilledButton, 'Publish'));
    expect(find.text('1 card · 0 mastered · Public'), findsOneWidget);
    // Snack bars queue; the first leaves before the second shows.
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    await app.deckMenu('Make private');

    expect(find.text('Note is private again'), findsOneWidget);
    expect(find.text('1 card · 0 mastered · Public'), findsNothing);
    expect((await _stored(app)).visibility, isA<PrivateDeck>());
    expect(app.server.writes.last.visibility, isA<PrivateDeck>());
    await app.close();
  });

  testWidgets('the deck list shows the chip on a public deck only', (
    tester,
  ) async {
    final app = await SharingApp.open(
      tester,
      myDecks: {'French': {}, 'German': {}},
    );
    expect(find.text('Public'), findsNothing);
    await tester.runAsync(() async {
      final french = (await app.decks.watchDecks().first).first;
      await app.decks.setVisibility(
        french.id,
        PublicDeck(DateTime.utc(2026, 10, 15)),
      );
    });
    await tester.pumpAndSettle();

    expect(find.text('Public'), findsOneWidget);
    final chip = tester.getCenter(find.text('Public')).dy;
    expect(chip, closeTo(tester.getCenter(find.text('French')).dy, 20));
    await app.close();
  });

  testWidgets('offline, publishing is disabled with a one-line reason', (
    tester,
  ) async {
    final app = await _openFrench(tester, online: false);
    await tester.tap(find.byTooltip('Note actions'));
    await tester.pumpAndSettle();

    expect(find.text("Available when you're online"), findsOneWidget);
    await tester.tap(find.text('Publish'));
    await tester.pumpAndSettle();
    expect(shownText('Publish "French"'), findsNothing);
    expect(app.server.writes, isEmpty);
    await tester.tapAt(const Offset(10, 10));
    await tester.pumpAndSettle();

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
        await tester.tap(find.byTooltip('Note actions'));
        await tester.pumpAndSettle();
        await app.meetsGuidelines();
        await app.tapText('Publish');
        await app.meetsGuidelines();
        await tester.enterText(
          find.widgetWithText(AppTextField, 'Public name'),
          'A',
        );
        await app.tap(
          shownText("I won't publish inappropriate or copyrighted content"),
        );
        await app.tap(find.widgetWithText(FilledButton, 'Publish'));
        await app.meetsGuidelines();
        await tester.enterText(
          find.widgetWithText(AppTextField, 'Public name'),
          'Ada',
        );
        await app.tap(find.widgetWithText(FilledButton, 'Publish'));
        expect(find.text('1 card · 0 mastered · Public'), findsOneWidget);
        await app.meetsGuidelines();
        await tester.pageBack();
        await tester.pumpAndSettle();
        await app.meetsGuidelines();
        await app.close();
      },
    );
  }
}
