import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/sharing/sharing.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _deckId = DeckId('0199f3b2-7c1e-7a00-8000-000000000001');

/// A client whose requests go to [answer], which is given each request with
/// its body read, in the order they arrive.
SupabaseClient _clientAnswering(
  List<http.Request> sent,
  http.Response Function(http.Request request) answer,
) {
  final client = SupabaseClient(
    'https://example.test',
    'anon-key',
    httpClient: MockClient((request) async {
      sent.add(request);
      final response = answer(request);
      // PostgREST reads the request off its response.
      return http.Response(
        response.body,
        response.statusCode,
        headers: response.headers,
        request: request,
      );
    }),
  );
  addTearDown(client.dispose);
  return client;
}

http.Response _json(Object body, int status) => http.Response(
  jsonEncode(body),
  status,
  headers: {'content-type': 'application/json'},
);

Deck _deck({DateTime? created}) => Deck(
  id: _deckId,
  name: 'Verbs',
  createdAt: created ?? DateTime.utc(2026, 10, 1),
  updatedAt: created ?? DateTime.utc(2026, 10, 1),
);

/// A server answering the row upsert with 201 and `publish-note` with
/// [publish].
SupabaseSharingServer _publishing(
  List<http.Request> sent,
  http.Response publish,
) => SupabaseSharingServer(
  _clientAnswering(
    sent,
    (request) => request.url.path.endsWith('/publish-note')
        ? publish
        : http.Response('', 201),
  ),
);

void main() {
  test('a publish sends every time in UTC, truncated to the millisecond, '
      'and no visibility, then asks publish-note', () async {
    final sent = <http.Request>[];
    // Times with sub-millisecond parts in a zone other than UTC, as
    // DateTime.now() gives them.
    final created = DateTime.utc(2026, 10, 1, 9, 30, 0, 123, 456).toLocal();
    final at = DateTime.utc(2026, 10, 17, 12, 0, 5, 789, 321).toLocal();
    expect(created.microsecond, 456);
    expect(at.microsecond, 321);

    await _publishing(sent, _json({'state': 'public'}, 200)).writeVisibility(
      _deck(created: created),
      PublicDeck(at),
      description: 'about',
      at: at,
    );

    expect(sent, hasLength(2));
    final row = jsonDecode(sent.first.body) as Map<String, dynamic>;
    expect(sent.first.url.path, endsWith('/rest/v1/decks'));
    expect(row, containsPair('created_at', '2026-10-01T09:30:00.123Z'));
    expect(row, containsPair('updated_at', '2026-10-17T12:00:05.789Z'));
    // The server refuses a client write that makes a deck public.
    expect(row.keys, isNot(contains('visibility')));
    expect(row.keys, isNot(contains('published_at')));
    expect(sent.last.url.path, endsWith('/functions/v1/publish-note'));
    expect(jsonDecode(sent.last.body), {
      'deck_id': _deckId.value,
      'description': 'about',
    });
  });

  test(
    'a private write sends visibility private and no publish-note',
    () async {
      final sent = <http.Request>[];

      await _publishing(sent, _json({'state': 'public'}, 200)).writeVisibility(
        _deck(),
        const PrivateDeck(),
        at: DateTime.utc(2026, 10, 17),
      );

      expect(sent, hasLength(1));
      expect(
        jsonDecode(sent.single.body),
        allOf(
          containsPair('visibility', 'private'),
          containsPair('published_at', null),
        ),
      );
    },
  );

  for (final (state, expected) in [
    ('checking', DeckPublication.checking),
    ('held', DeckPublication.held),
    ('refused', DeckPublication.refused),
    ('public', DeckPublication.public),
  ]) {
    test('a note publish-note answers $state is answered as $expected, '
        'not thrown', () async {
      final server = _publishing(
        [],
        _json({'state': state, 'refusal': null, 'findings': <Object>[]}, 200),
      );

      final screening = await server.writeVisibility(
        _deck(),
        PublicDeck(DateTime.utc(2026, 10, 17)),
        at: DateTime.utc(2026, 10, 17),
      );

      expect(screening.state, expected);
    });
  }

  test('a refusal carries the layer and each finding by card, face, block, '
      'field and offsets, a finding without a card has none', () async {
    final server = _publishing(
      [],
      _json({
        'state': 'refused',
        'refusal': 'rules',
        'findings': [
          {
            'card_id': 'c1',
            'where': 'front',
            'block': 2,
            'field': 'senses.1.meaning',
            'category': 'phone',
            'start': 4,
            'end': 17,
          },
          {
            'card_id': null,
            'where': 'description',
            'block': null,
            'field': null,
            'category': 'a_future_category',
            'start': 0,
            'end': 3,
          },
        ],
      }, 200),
    );

    final screening = await server.writeVisibility(
      _deck(),
      PublicDeck(DateTime.utc(2026, 10, 17)),
      at: DateTime.utc(2026, 10, 17),
    );

    expect(screening.refusal, 'rules');
    final [first, second] = screening.findings;
    expect(first.card, const CardId('c1'));
    expect(first.place, FindingPlace.front);
    expect(first.category, FindingCategory.phone);
    expect((first.block, first.start, first.end), (2, 4, 17));
    expect(first.field, 'senses.1.meaning');
    expect(second.field, isNull);
    expect(second.card, isNull);
    expect(second.place, FindingPlace.description);
    expect(second.category, FindingCategory.other);
  });

  test('a state publish-note cannot answer fails the publish', () async {
    final server = _publishing([], _json({'state': 'private'}, 200));

    await expectLater(
      server.writeVisibility(
        _deck(),
        PublicDeck(DateTime.utc(2026, 10, 17)),
        at: DateTime.utc(2026, 10, 17),
      ),
      throwsA(isA<SharingFailed>()),
    );
  });

  test('an answer with no state fails the publish', () async {
    final server = _publishing([], _json({'ok': true}, 200));

    await expectLater(
      server.writeVisibility(
        _deck(),
        PublicDeck(DateTime.utc(2026, 10, 17)),
        at: DateTime.utc(2026, 10, 17),
      ),
      throwsA(isA<SharingFailed>()),
    );
  });

  for (final (status, kind, matcher) in [
    (401, 'SharingRejected', isA<SharingRejected>()),
    (403, 'SharingRejected', isA<SharingRejected>()),
    (400, 'SharingFailed', isA<SharingFailed>()),
    (404, 'SharingFailed', isA<SharingFailed>()),
    (502, 'SharingOffline', isA<SharingOffline>()),
    (503, 'SharingOffline', isA<SharingOffline>()),
  ]) {
    test('publish-note answering $status is $kind', () async {
      final server = _publishing([], _json({'error': 'no'}, status));

      await expectLater(
        server.writeVisibility(
          _deck(),
          PublicDeck(DateTime.utc(2026, 10, 17)),
          at: DateTime.utc(2026, 10, 17),
        ),
        throwsA(matcher),
      );
    });
  }

  test('a card is read from its 칸 list when free v2 and from its sides '
      'otherwise', () async {
    final asked = <Uri>[];
    final client = SupabaseClient(
      'https://example.test',
      'anon-key',
      httpClient: MockClient((request) async {
        asked.add(request.url);
        return http.Response(
          jsonEncode([
            {
              'front': [
                {
                  'type': 'text',
                  'v': 2,
                  'id': 'a',
                  'payload': {'front': 'one', 'back': 'two'},
                },
              ],
              'back': <Object>[],
              'template': 'free',
              'template_version': 2,
            },
            {
              'front': [
                {
                  'type': 'text',
                  'v': 1,
                  'payload': {'text': 'three'},
                },
              ],
              'back': [
                {
                  'type': 'text',
                  'v': 1,
                  'payload': {'text': 'four'},
                },
              ],
              'template': null,
              'template_version': null,
            },
          ]),
          200,
          request: request,
          headers: {'content-type': 'application/json'},
        );
      }),
    );
    addTearDown(client.dispose);

    final [framed, earlier] = await SupabaseSharingServer(client)
        .listCards(const DeckId('deck'), limit: 2);

    expect(
      asked.single.queryParameters['select'],
      contains('template_version'),
    );
    expect(framed.cells, const [TextCell(front: 'one', back: 'two')]);
    expect(framed.front, const [TextContent('one')]);
    expect(framed.back, const [TextContent('two')]);
    expect(earlier.cells, isNull);
    expect(earlier.front, const [TextContent('three')]);
    expect(earlier.back, const [TextContent('four')]);
  });
}
