import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/sharing/sharing.dart';

import '../word_breaks.dart';
import 'fakes.dart';
import 'sharing_app.dart';
import 'sharing_service_test.dart' show publicDeck;

/// Three public decks: French (newest, copied once), German (copied five
/// times) and Spanish (oldest, never copied), each by another owner.
FakeSharingServer _server() => FakeSharingServer(
  decks: [
    publicDeck(
      'french',
      name: 'French',
      ownerName: 'Bea',
      owner: '00000000-0000-4000-8000-00000000000b',
      description: 'Everyday verbs',
      cards: 1,
      copies: 1,
      publishedAt: DateTime.utc(2026, 10, 15, 11),
    ),
    publicDeck(
      'german',
      name: 'German',
      ownerName: 'Cal',
      owner: '00000000-0000-4000-8000-00000000000c',
      cards: 12,
      copies: 5,
      publishedAt: DateTime.utc(2026, 10, 15, 10),
    ),
    publicDeck(
      'spanish',
      name: 'Spanish',
      ownerName: 'Dee',
      owner: '00000000-0000-4000-8000-00000000000d',
      cards: 3,
      publishedAt: DateTime.utc(2026, 10, 15, 9),
    ),
  ],
);

/// The deck names the browse screen lists, top to bottom.
List<String> _listed(WidgetTester tester) =>
    [
      for (final name in ['French', 'German', 'Spanish'])
        if (find.text(name).evaluate().isNotEmpty) name,
    ]..sort(
      (a, b) => tester
          .getTopLeft(find.text(a))
          .dy
          .compareTo(tester.getTopLeft(find.text(b)).dy),
    );

void main() {
  testWidgets(
    'the drawer pulled up offers New note over the deck rows, which opens 새 노트, and Browse public notes under them',
    (tester) async {
      final app = await SharingApp.open(
        tester,
        server: _server(),
        myDecks: {'Mine': {}},
      );
      await tester.ensureVisible(find.text('Browse public notes'));
      final mine = tester.getRect(find.text('Mine'));
      final create = tester.getRect(find.text('New note'));
      final browse = tester.getRect(find.text('Browse public notes'));
      expect(create.bottom, lessThan(mine.top));
      expect(browse.top, greaterThan(mine.bottom));

      await app.tapText('New note');
      expect(find.text('Note name'), findsOneWidget);
      await app.close();
    },
  );

  testWidgets(
    'the first-run home opens browse, titled Public notes, which lists public decks newest first with owner and counts',
    (tester) async {
      final app = await SharingApp.open(tester, server: _server());
      await app.browse();

      // The screen is named for what the entry that opened it names.
      expect(find.text('Public notes'), findsOneWidget);
      expect(find.text('Browse'), findsNothing);
      expect(_listed(tester), ['French', 'German', 'Spanish']);
      expect(shownText('Bea · 1 card · copied once'), findsOneWidget);
      expect(shownText('Cal · 12 cards · copied 5 times'), findsOneWidget);
      await app.close();
    },
  );

  testWidgets('the sort switches to most copied first', (tester) async {
    final app = await SharingApp.open(tester, server: _server());
    await app.browse();

    await app.tapText('Most copied');

    expect(_listed(tester), ['German', 'French', 'Spanish']);
    expect(app.server.listings.last.$2, BrowseSort.mostCopied);
    await app.tapText('Newest');
    expect(_listed(tester), ['French', 'German', 'Spanish']);
    await app.close();
  });

  testWidgets('a search keeps the decks whose name or description holds it', (
    tester,
  ) async {
    final app = await SharingApp.open(tester, server: _server());
    await app.browse();

    await tester.enterText(find.byType(TextField), 'VERBS');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(_listed(tester), ['French']);

    await tester.enterText(find.byType(TextField), 'span');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(_listed(tester), ['Spanish']);

    await tester.enterText(find.byType(TextField), 'italian');
    await tester.pump(const Duration(milliseconds: 300));
    await tester.pumpAndSettle();
    expect(_listed(tester), isEmpty);
    expect(shownText('No notes match. Try other words.'), findsOneWidget);
    await app.close();
  });

  testWidgets('offline, browse shows the offline state and lists once online', (
    tester,
  ) async {
    final app = await SharingApp.open(tester, server: _server(), online: false);
    await app.browse();

    expect(
      shownText("You're offline. Public notes appear once you're connected."),
      findsOneWidget,
    );
    expect(_listed(tester), isEmpty);
    expect(app.server.listings, isEmpty);

    app.network.online = true;
    await tester.pumpAndSettle();

    expect(_listed(tester), ['French', 'German', 'Spanish']);
    await app.close();
  });

  testWidgets('a listing that cannot reach the server says so and retries', (
    tester,
  ) async {
    final server = _server()..failure = SharingOffline(Exception('timeout'));
    final app = await SharingApp.open(tester, server: server);
    await app.browse();

    expect(
      shownText("You're offline. Check your connection and try again."),
      findsOneWidget,
    );
    server.failure = null;
    await app.tapText('Try again');
    expect(_listed(tester), ['French', 'German', 'Spanish']);
    await app.close();
  });

  for (final mode in [ThemeMode.light, ThemeMode.dark]) {
    testWidgets(
      'in the ${mode.name} theme browse and its states meet the tap target and contrast guidelines',
      (tester) async {
        final app = await SharingApp.open(
          tester,
          server: _server(),
          themeMode: mode,
        );
        await app.meetsGuidelines();
        await app.browse();
        await app.meetsGuidelines();
        app.network.online = false;
        await tester.pumpAndSettle();
        await app.meetsGuidelines();
        await app.close();
      },
    );
  }
}
