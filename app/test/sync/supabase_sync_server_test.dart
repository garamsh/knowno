import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/database/database.dart';
import 'package:knowno/sync/src/supabase_sync_server.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

final _t0 = DateTime.utc(2026, 10, 15, 9);

DeckRow _deck(String id, String visibility) => DeckRow(
  id: id,
  name: id,
  visibility: visibility,
  publishedAt: visibility == 'public' ? _t0 : null,
  description: visibility == 'public' ? 'about' : null,
  createdAt: _t0,
  updatedAt: _t0,
  dirty: true,
);

void main() {
  test('a deck row that says public is pushed without a visibility or a '
      'publication time, a private one with both', () async {
    final sent = <List<Map<String, dynamic>>>[];
    final client = SupabaseClient(
      'https://example.test',
      'anon-key',
      httpClient: MockClient((request) async {
        sent.add([
          for (final row in jsonDecode(request.body) as List<dynamic>)
            row as Map<String, dynamic>,
        ]);
        return http.Response('', 201, request: request);
      }),
    );
    addTearDown(client.dispose);

    await SupabaseSyncServer(client).pushDecks(const UserId('owner'), [
      _deck('shared', 'public'),
      _deck('mine', 'private'),
      _deck('also-shared', 'public'),
    ]);

    // Two requests, since a bulk upsert takes one set of keys.
    expect(sent, hasLength(2));
    final (privates, publics) = sent.first.first['id'] == 'mine'
        ? (sent.first, sent.last)
        : (sent.last, sent.first);
    expect([for (final row in privates) row['id']], ['mine']);
    expect(privates.single, containsPair('visibility', 'private'));
    expect(privates.single, containsPair('published_at', null));
    expect([for (final row in publics) row['id']], ['shared', 'also-shared']);
    for (final row in publics) {
      expect(row.keys, isNot(contains('visibility')));
      expect(row.keys, isNot(contains('published_at')));
      // The rest of the row still reaches the server.
      expect(row, containsPair('description', 'about'));
      expect(row, containsPair('user_id', 'owner'));
    }
  });
}
