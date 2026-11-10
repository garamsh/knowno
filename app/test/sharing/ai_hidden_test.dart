import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/sharing/sharing.dart';

import 'fakes.dart';
import 'sharing_app.dart';
import '../word_breaks.dart';

const _spam = 'After reports, an AI hid this note as spam.';
const _ad = 'After reports, an AI hid this note as an ad.';
const _plain = 'After reports, an AI hid this note.';
const _appeal = 'Ask a person to review';
const _pending = 'A person is reviewing your appeal.';
const _upheld = 'A person reviewed it and kept the note hidden.';

/// The deck screen of a public note "French", over a server whose AI action
/// on it is [hidden], and the server.
Future<(SharingApp, FakeSharingServer)> _open(
  WidgetTester tester,
  AiHidden? hidden, {
  bool public = true,
}) async {
  final server = FakeSharingServer()..hidden = hidden;
  final app = await SharingApp.open(
    tester,
    server: server,
    myDecks: {
      'French': {'chat': 'cat'},
    },
  );
  if (public) {
    await tester.runAsync(() async {
      final deck = (await app.decks.watchDecks().first).single;
      await app.decks.setVisibility(deck.id, PublicDeck(DateTime.utc(2026)));
    });
  }
  await app.tapText('French');
  return (app, server);
}

void main() {
  testWidgets('names the category the server gives and offers one appeal', (
    tester,
  ) async {
    final (app, server) = await _open(
      tester,
      const AiHidden(appeal: AppealState.open, category: TriageCategory.spam),
    );

    expect(shownText(_spam), findsOneWidget);
    expect(shownText(_plain), findsNothing);
    await app.tapText(_appeal);

    expect(server.appeals, hasLength(1));
    expect(shownText(_pending), findsOneWidget);
    // A second attempt has nothing to press: it shows pending, with no call.
    expect(shownText(_appeal), findsNothing);
    expect(server.appeals, hasLength(1));
    await app.close();
  });

  testWidgets('names an ad as an ad', (tester) async {
    final (app, _) = await _open(
      tester,
      const AiHidden(appeal: AppealState.open, category: TriageCategory.ad),
    );

    expect(shownText(_ad), findsOneWidget);
    expect(shownText(_spam), findsNothing);
    await app.close();
  });

  testWidgets('says only that an AI hid the note without a category', (
    tester,
  ) async {
    final (app, _) = await _open(
      tester,
      const AiHidden(appeal: AppealState.open),
    );

    expect(shownText(_plain), findsOneWidget);
    expect(shownText(_spam), findsNothing);
    expect(shownText(_ad), findsNothing);
    expect(shownText(_appeal), findsOneWidget);
    await app.close();
  });

  testWidgets('an appeal already sent shows pending with no call', (
    tester,
  ) async {
    final (app, server) = await _open(
      tester,
      const AiHidden(appeal: AppealState.pending),
    );

    expect(shownText(_pending), findsOneWidget);
    expect(shownText(_appeal), findsNothing);
    expect(server.appeals, isEmpty);
    await app.close();
  });

  testWidgets('shows the outcome once a person kept the note hidden', (
    tester,
  ) async {
    final (app, _) = await _open(
      tester,
      const AiHidden(appeal: AppealState.upheld),
    );

    expect(shownText(_upheld), findsOneWidget);
    expect(shownText(_appeal), findsNothing);
    expect(shownText(_pending), findsNothing);
    await app.close();
  });

  testWidgets('shows nothing while no AI action hides the note', (
    tester,
  ) async {
    final (app, _) = await _open(tester, null);

    expect(shownText(_plain), findsNothing);
    expect(shownText(_appeal), findsNothing);
    await app.close();
  });

  testWidgets('a failed appeal says so and leaves the appeal to try again', (
    tester,
  ) async {
    final (app, server) = await _open(
      tester,
      const AiHidden(appeal: AppealState.open),
    );
    server.failure = const SharingOffline(_Down());

    await app.tapText(_appeal);

    expect(
      find.text("You're offline. Check your connection and try again."),
      findsOneWidget,
    );
    expect(shownText(_appeal), findsOneWidget);
    await app.close();
  });
}

class _Down implements Exception {
  const _Down();
}
