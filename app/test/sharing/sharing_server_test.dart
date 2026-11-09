// Each request to the stack carries its own bound, the request timeout the
// app treats as offline, so the file sets no bound over a test's sum of them.
@Timeout.none
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../sync/bounded_auth.dart';
import '../sync/device.dart';
import 'fakes.dart';

/// The local Supabase stack `scripts/test-sync.ts` starts, named by the
/// environment it runs this file in.
const _urlVariable = 'KNOWNO_SYNC_TEST_URL';
const _keyVariable = 'KNOWNO_SYNC_TEST_KEY';
const _dbVariable = 'KNOWNO_SYNC_TEST_DB_CONTAINER';

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
  final db = Platform.environment[_dbVariable];
  final skip = url == null || key == null || db == null
      ? 'needs the local Supabase stack that scripts/test-sync.ts starts, '
            'which sets $_urlVariable, $_keyVariable and $_dbVariable'
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

  /// Runs [sql] as the database's owner, as the stack's other tests do.
  Future<void> psql(String sql) async {
    final result = await Process.run('docker', [
      'exec',
      db!,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      sql,
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
  }

  /// `publish-note` as the stack can stand it in, for the stack runs no Edge
  /// runtime: the owner's request, made with the owner's own session as the
  /// function makes it, then the screening's pass, which lifts the hold on a
  /// note that is checking and has none, then the owner's own state, in the
  /// function's reply shape and statuses (`supabase/functions/publish-note/`).
  FunctionsClient publishNote(SupabaseClient client) => FunctionsClient(
    'https://publish-note.test/functions/v1',
    {},
    httpClient: MockClient((request) async {
      http.Response reply(int status, Object body) => http.Response(
        jsonEncode(body),
        status,
        headers: {'content-type': 'application/json'},
        request: request,
      );
      final body = jsonDecode(request.body) as Map<String, dynamic>;
      final deck = body['deck_id'] as String;
      try {
        final state = await client.rpc<Object?>(
          'request_deck_publication',
          params: {'deck_id': deck, 'description': body['description']},
        );
        if (state == 'checking') {
          await psql(
            "update public.decks set hidden = false where id = '$deck'",
          );
        }
        final mine = await client.rpc<Object?>(
          'my_deck_screening',
          params: {'deck_id': deck},
        );
        return reply(200, mine as Object);
      } on PostgrestException catch (error) {
        return reply(error.code == 'P0002' ? 404 : 403, {'error': 'no'});
      }
    }),
  );

  /// A new account, signed up and signed in on its own client.
  Future<_User> signUp(String name) async {
    const options = AuthClientOptions(authFlowType: AuthFlowType.implicit);
    final client = SupabaseClient(url!, key!, authOptions: options);
    final email = '$name-${DateTime.now().microsecondsSinceEpoch}@example.com';
    final server = SupabaseSharingServer(
      client,
      functions: publishNote(client),
    );
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

  test('a note held for an admin is not left public on the device', () async {
    final bea = await signUp('bea');
    final ada = await signUp('ada');
    final deck = await bea.device.deck.createDeck('Spanish');
    await bea.sync();
    // A standing hold, as an admin's keep-hidden leaves.
    await psql(
      'insert into private.deck_screening (deck_id, hold) '
      "values ('${deck.id.value}', 'admin')",
    );

    await expectLater(
      bea.sharing.makePublic(deck.id, description: 'about'),
      throwsA(
        isA<SharingRejected>().having(
          (failure) => failure.cause.toString(),
          'cause',
          contains('held'),
        ),
      ),
    );

    expect(
      (await bea.device.deck.getDeck(deck.id)).visibility,
      isA<PrivateDeck>(),
    );
    // Control: the server did take the request, and still shows nobody the note.
    expect(await listOurs(ada), isEmpty);
  }, skip: skip);

  test('a deck public on the device and never synced is created private, '
      'and the push does not retry', () async {
    final bea = await signUp('bea');
    final deck = await bea.device.deck.createDeck('Spanish');
    await bea.device.deck.setVisibility(
      deck.id,
      PublicDeck(bea.device.now),
      description: 'about',
    );
    // Control: the server refuses this very row written as a visibility.
    await expectLater(
      bea.client.from('decks').upsert({
        'id': deck.id.value,
        'name': 'Spanish',
        'visibility': 'public',
      }),
      throwsA(isA<PostgrestException>().having((e) => e.code, 'code', '42501')),
    );

    await bea.sync();
    await bea.sync();

    expect(await bea.device.store.hasUnsynced(), isFalse);
    final other = Device('bea2', SupabaseSyncServer(bea.client), scheduler);
    addTearDown(other.close);
    await other.sync(bea.id);
    final synced = (await other.deck.watchDecks().first).single;
    expect(synced.id, deck.id);
    expect(synced.visibility, isA<PrivateDeck>());
    expect(await listOurs(bea), isEmpty);
  }, skip: skip);
}
