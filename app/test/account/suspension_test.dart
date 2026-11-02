// Each request to the stack carries its own bound, the request timeout the
// app treats as offline, so the file sets no bound over a test's sum of them.
@Timeout.none
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/sync/sync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

import '../sync/bounded_auth.dart';

/// The local Supabase stack `scripts/test-sync.sh` starts, named by the
/// environment it runs this file in.
const _urlVariable = 'KNOWNO_SYNC_TEST_URL';
const _keyVariable = 'KNOWNO_SYNC_TEST_KEY';
const _dbVariable = 'KNOWNO_SYNC_TEST_DB_CONTAINER';

/// An admin suspending a user through the admin area's function, against the
/// real Supabase Auth and PostgREST (ADR 0072): the suspended user can neither
/// refresh its session nor sign in, and its sync writes are refused, while an
/// active user does all three; lifting the suspension lets the user sign in
/// again.
void main() {
  final url = Platform.environment[_urlVariable];
  final key = Platform.environment[_keyVariable];
  final db = Platform.environment[_dbVariable];
  final skip = url == null || key == null || db == null
      ? 'needs the local Supabase stack that scripts/test-sync.sh starts, '
            'which sets $_urlVariable, $_keyVariable and $_dbVariable'
      : null;
  const password = 'suspension-password';
  final clients = <SupabaseClient>[];

  /// A new account signed in on a client of its own.
  Future<SupabaseClient> signedUp(String name) async {
    // Password sign-in needs no PKCE flow, and so no storage for its verifier.
    const options = AuthClientOptions(authFlowType: AuthFlowType.implicit);
    final client = SupabaseClient(url!, key!, authOptions: options);
    clients.add(client);
    final email = '$name-${DateTime.now().microsecondsSinceEpoch}@example.com';
    await signUpWithinBound(
      client,
      email,
      password,
      SupabaseSyncServer(client).timeout,
    );
    expect(client.auth.currentUser?.email, email);
    return client;
  }

  /// Makes [client]'s user an admin, as the PM inserts the first admin.
  Future<void> makeAdmin(SupabaseClient client) async {
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
      '-c',
      "insert into private.admins (user_id) values ('${client.auth.currentUser!.id}')",
    ]);
    expect(result.exitCode, 0, reason: '${result.stderr}');
  }

  /// Pushes one new deck as [client]'s user's sync does.
  Future<void> pushDeck(SupabaseClient client) {
    final now = DateTime.now().toUtc();
    return SupabaseSyncServer(client)
        .pushDecks(UserId(client.auth.currentUser!.id), [
          DeckRow(
            id: const Uuid().v7(),
            name: 'Deck',
            visibility: 'private',
            createdAt: now,
            updatedAt: now,
            dirty: true,
          ),
        ]);
  }

  tearDown(() async {
    for (final client in clients) {
      await client.dispose();
    }
    clients.clear();
  });

  test("a suspended user's refresh, sign-in and sync writes are refused, and an active user's are not", () async {
    final admin = await signedUp('admin');
    final suspended = await signedUp('suspended');
    final active = await signedUp('active');
    final email = suspended.auth.currentUser!.email!;
    final suspendedId = suspended.auth.currentUser!.id;
    await makeAdmin(admin);

    expect(
      await admin.rpc<Object?>(
        'admin_suspend_user',
        params: {'user_id': suspendedId, 'reason': 'test'},
      ),
      'suspended',
    );

    // Its access token is still unexpired, so sync's write reaches the
    // server, whose policy refuses it.
    await expectLater(pushDeck(suspended), throwsA(isA<SyncRejected>()));
    await expectLater(
      suspended.auth.refreshSession(),
      throwsA(
        isA<AuthApiException>().having(
          (error) => error.code,
          'code',
          'user_banned',
        ),
      ),
    );
    final again = SupabaseClient(
      url!,
      key!,
      authOptions: const AuthClientOptions(authFlowType: AuthFlowType.implicit),
    );
    clients.add(again);
    await expectLater(
      again.auth.signInWithPassword(email: email, password: password),
      throwsA(
        isA<AuthApiException>().having(
          (error) => error.code,
          'code',
          'user_banned',
        ),
      ),
    );

    // Control: the active user does all three.
    await pushDeck(active);
    await active.auth.refreshSession();
    expect(active.auth.currentSession, isNotNull);

    expect(
      await admin.rpc<Object?>(
        'admin_unsuspend_user',
        params: {'user_id': suspendedId},
      ),
      true,
    );
    final response = await again.auth.signInWithPassword(
      email: email,
      password: password,
    );
    expect(response.user?.email, email, reason: 'lifted, it signs in again');
    await pushDeck(again);
  }, skip: skip);
}
