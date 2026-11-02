// Each request to the stack carries its own bound, the request timeout the
// app treats as offline, so the file sets no bound over a test's sum of them.
@Timeout.none
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../sync/bounded_auth.dart';
import '../sync/device.dart';
import 'fakes.dart';

/// The local Supabase stack `scripts/test-sync.sh` starts, named by the
/// environment it runs this file in.
const _urlVariable = 'KNOWNO_SYNC_TEST_URL';
const _keyVariable = 'KNOWNO_SYNC_TEST_KEY';

/// One signed-in user: a device that syncs, and sharing over the same
/// session.
class _User {
  _User(this.id, this.client, this.device, this.sharing);

  final UserId id;
  final SupabaseClient client;
  final Device device;
  final SharingService sharing;

  Future<void> sync() => device.sync(id);
}

void main() {
  final url = Platform.environment[_urlVariable];
  final key = Platform.environment[_keyVariable];
  final skip = url == null || key == null
      ? 'needs the local Supabase stack that scripts/test-sync.sh starts, '
            'which sets $_urlVariable and $_keyVariable'
      : null;

  late Scheduler scheduler;
  final users = <_User>[];

  setUpAll(() async {
    if (skip != null) return;
    scheduler = await Scheduler.load();
  });

  tearDown(() async {
    for (final user in users) {
      await user.device.close();
      await user.client.dispose();
    }
    users.clear();
  });

  /// The decks [viewer] lists, among those of this test's users; earlier
  /// tests' public decks stay on the stack.
  Future<List<PublicDeckSummary>> listOurs(
    _User viewer, {
    String search = '',
    BrowseSort sort = BrowseSort.newest,
  }) async {
    final ours = {for (final user in users) user.id};
    return [
      for (final deck in await viewer.sharing.listDecks(search, sort))
        if (ours.contains(deck.owner)) deck,
    ];
  }

  /// A new account, signed up and signed in on its own client.
  Future<_User> signUp(String name) async {
    const options = AuthClientOptions(authFlowType: AuthFlowType.implicit);
    final client = SupabaseClient(url!, key!, authOptions: options);
    final email = '$name-${DateTime.now().microsecondsSinceEpoch}@example.com';
    final server = SupabaseSharingServer(client);
    // Signing up is bounded as each sharing request is.
    await signUpWithinBound(client, email, 'sharing-password', server.timeout);
    expect(client.auth.currentUser?.email, email);
    final device = Device(name, SupabaseSyncServer(client), scheduler);
    final user = _User(
      UserId(client.auth.currentUser!.id),
      client,
      device,
      SharingService(
        server: server,
        decks: device.deck,
        reachability: FakeReachability(),
        clock: () => device.now,
      ),
    );
    users.add(user);
    return user;
  }

  /// [owner]'s deck "name", holding [fronts], published and synced.
  Future<Deck> publish(
    _User owner,
    String name,
    List<String> fronts, {
    String? displayName,
  }) async {
    final deck = await owner.device.deck.createDeck(name);
    for (final front in fronts) {
      await owner.device.deck.addCard(
        deck.id,
        front: [TextContent(front)],
        back: [TextContent('$front back')],
      );
    }
    await owner.sync();
    await owner.sharing.makePublic(
      deck.id,
      name: displayName == null ? null : DisplayName.tryParse(displayName),
      description: 'about $name',
    );
    await owner.sync();
    return deck;
  }

  test('another user lists, previews and copies a public deck, which counts the copy', () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    final deck = await publish(bea, 'Spanish', [
      'perro',
      'gato',
    ], displayName: 'Bea');
    // Control: a private deck of the same owner is never listed.
    await bea.device.deck.createDeck('Diary');
    await bea.sync();

    final listed = await listOurs(ada);
    expect(
      [
        for (final summary in listed)
          (summary.name, summary.ownerName.value, summary.cardCount),
      ],
      [('Spanish', 'Bea', 2)],
    );
    expect(listed.single.description, 'about Spanish');

    final preview = await ada.sharing.preview(deck.id);
    expect(
      {for (final card in preview) plainText(card.front)},
      {'perro', 'gato'},
    );

    final imported = await ada.sharing.copy(
      listed.single,
      const CopyIntoNewDeck(),
    );
    final copied = await ada.device.deck.listCards(imported.deck.id);
    // The device's clock stands still, so the copies share a creation time.
    expect(
      {
        for (final card in copied)
          (plainText(card.front), card.source, card.originDeckId),
      },
      {('perro', CardSource.copy, deck.id), ('gato', CardSource.copy, deck.id)},
    );
    final after = await listOurs(
      ada,
      search: 'span',
      sort: BrowseSort.mostCopied,
    );
    expect(after.single.copyCount, 1);

    // The copy syncs as Ada's own cards, with their source and origin.
    await ada.sync();
    final again = Device('ada2', SupabaseSyncServer(ada.client), scheduler);
    addTearDown(again.close);
    await again.sync(ada.id);
    final synced = await again.deck.listCards(imported.deck.id);
    expect(synced.map((card) => (card.source, card.originDeckId)).toSet(), {
      (CardSource.copy, deck.id),
    });
  }, skip: skip);

  test("sync pulls none of another user's public decks", () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    await publish(bea, 'Spanish', ['perro'], displayName: 'Bea');
    await ada.device.deck.createDeck('Mine');

    await ada.sync();
    await ada.sync();

    expect(await ada.device.deckNames(), ['Mine']);
    // Control: the deck is readable to Ada, so the pull's owner filter is
    // what keeps it out.
    expect(await listOurs(ada), hasLength(1));
  }, skip: skip);

  test('a publish on one device reaches the owner\'s other device', () async {
    final bea = await signUp('bea');
    final deck = await publish(bea, 'Spanish', ['perro'], displayName: 'Bea');

    final other = Device('bea2', SupabaseSyncServer(bea.client), scheduler);
    addTearDown(other.close);
    await other.sync(bea.id);

    final synced = (await other.deck.watchDecks().first).single;
    expect(synced.id, deck.id);
    expect(synced.visibility, isA<PublicDeck>());
    expect(synced.description, 'about Spanish');
  }, skip: skip);

  test('a report is filed once, and a block removes the owner\'s decks from the listing', () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    final deck = await publish(bea, 'Spanish', ['perro'], displayName: 'Bea');

    expect(
      await ada.sharing.report(deck.id, ReportReason.spam),
      ReportOutcome.reported,
    );
    expect(
      await ada.sharing.report(deck.id, ReportReason.other),
      ReportOutcome.alreadyReported,
    );

    await ada.sharing.block(bea.id);
    await ada.sharing.block(bea.id);
    expect(await listOurs(ada), isEmpty);
    // Control: Bea, who blocked no one, still lists her own deck.
    expect(await listOurs(bea), hasLength(1));
  }, skip: skip);

  test('an unpublished deck leaves the listing and refuses a copy', () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    final deck = await publish(bea, 'Spanish', ['perro'], displayName: 'Bea');
    final listed = (await listOurs(ada)).single;

    await bea.sharing.makePrivate(deck.id);

    expect(await listOurs(ada), isEmpty);
    await expectLater(
      ada.sharing.copy(listed, const CopyIntoNewDeck()),
      throwsA(isA<DeckNoLongerPublic>()),
    );
    expect(await ada.device.deckNames(), isEmpty);
  }, skip: skip);

  test('a second publish keeps the display name, and a deck another user owns cannot be written', () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    final deck = await publish(bea, 'Spanish', ['perro'], displayName: 'Bea');
    expect((await bea.sharing.displayName())?.value, 'Bea');
    expect(await ada.sharing.displayName(), isNull);

    await expectLater(
      SupabaseSharingServer(ada.client)
          .writeVisibility(deck, const PrivateDeck(), at: DateTime.now()),
      throwsA(isA<SharingRejected>()),
    );
    expect(await listOurs(ada), hasLength(1));
  }, skip: skip);
}
