import 'dart:async';

import 'package:drift/drift.dart' show TableUpdateQuery;
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import '../account/fake_account_service.dart';
import '../media/fakes.dart';
import 'device.dart';
import 'fake_sync_server.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

/// Completes once [status] holds a value [matches] accepts.
Future<void> until(
  ValueListenable<SyncStatus> status,
  bool Function(SyncStatus) matches,
) {
  final reached = Completer<void>();
  void check() {
    if (matches(status.value) && !reached.isCompleted) reached.complete();
  }

  status.addListener(check);
  check();
  return reached.future.whenComplete(() => status.removeListener(check));
}

void main() {
  // The controller follows the app's lifecycle through the binding.
  TestWidgetsFlutterBinding.ensureInitialized();
  late Scheduler scheduler;
  late FakeSyncServer server;
  late FakeAccountService account;
  late FakeMediaServer media;
  late Device device;
  late SyncController controller;

  setUpAll(() async => scheduler = await Scheduler.load());

  setUp(() {
    server = FakeSyncServer(_ada);
    account = FakeAccountService()..userId = _ada;
    media = FakeMediaServer();
    device = Device('device', server, scheduler, mediaServer: media);
    controller = SyncController(
      account: account,
      synchronizer: device.synchronizer,
      store: device.store,
      media: device.media,
      edits: device.db.tableUpdates(
        TableUpdateQuery.onAllTables([device.db.decks, device.db.cards]),
      ),
      editDelay: const Duration(milliseconds: 20),
      firstRetry: const Duration(milliseconds: 20),
    )..start();
  });

  tearDown(() async {
    controller.dispose();
    await device.close();
  });

  test('signing in syncs, and signing out stops', () async {
    await device.deck.createDeck('French');
    expect(controller.status.value, isA<SyncIdle>());

    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);

    expect(server.decks, hasLength(1));
    await account.signOut();
    expect(controller.status.value, isA<SyncIdle>());
  });

  test('an edit while signed in syncs after a pause', () async {
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    server.requests.clear();

    await device.deck.createDeck('French');
    await until(controller.status, (status) => status is Syncing);
    await until(controller.status, (status) => status is Synced);

    expect(server.decks, hasLength(1));
  });

  test('an edit while signed out sends nothing', () async {
    await device.deck.createDeck('French');
    await Future<void>.delayed(const Duration(milliseconds: 100));

    expect(server.requests, isEmpty);
    // Control: the same edit, once signed in, is sent.
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    expect(server.decks, hasLength(1));
  });

  test('a failed run is shown and retried until it succeeds', () async {
    server.failure = const SyncOffline('no route to host');
    await account.signInWithGoogle();
    await until(
      controller.status,
      (status) => status is SyncInterrupted && status.failure is SyncOffline,
    );

    server.failure = null;
    await until(controller.status, (status) => status is Synced);
  });

  test('push reports whether every change reached the server', () async {
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    await device.deck.createDeck('French');
    server.failure = const SyncOffline('no route to host');

    expect(await controller.push(), isFalse);

    server.failure = null;
    expect(await controller.push(), isTrue);
    expect(server.decks, hasLength(1));
  });

  test("a deck's image is uploaded once its deck is pushed, and goes from the server with its deck", () async {
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    final deck = await device.deck.createDeck('French');
    final image = await device.media.addImage(preparedImage(1));

    await device.deck.setImage(deck.id, image);
    await until(controller.status, (status) => status is Syncing);
    await until(controller.status, (status) => status is Synced);
    expect(server.decks.values.single.row.imageMediaId, image.value);
    expect(media.files.keys, [image]);

    await device.deck.deleteDeck(deck.id);
    await until(controller.status, (status) => status is Syncing);
    await until(controller.status, (status) => status is Synced);
    expect(media.files, isEmpty);
    expect(media.rows, isEmpty);
  });

  test('an image the media server does not take keeps push false, and is retried until it lands', () async {
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    final deck = await device.deck.createDeck('French');
    media.offline = true;
    final image = await device.media.addImage(preparedImage(1));
    await device.deck.setImage(deck.id, image);

    expect(await controller.push(), isFalse);
    expect(
      server.decks.values.single.row.imageMediaId,
      image.value,
      reason: 'the rows still sync',
    );

    media.offline = false;
    while (media.files.isEmpty) {
      await Future<void>.delayed(const Duration(milliseconds: 10));
    }
    expect(await controller.push(), isTrue);
  });

  test('clear removes every row and the owner', () async {
    await device.deck.createDeck('French');
    await account.signInWithGoogle();
    await until(controller.status, (status) => status is Synced);
    expect(await device.store.owner(), _ada);

    await account.signOut();
    await controller.clear();

    expect(await device.deckNames(), isEmpty);
    expect(await device.db.select(device.db.decks).get(), isEmpty);
    expect(await device.store.owner(), isNull);
  });
}
