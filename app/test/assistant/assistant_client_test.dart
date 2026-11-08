import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/assistant/src/assistant_client.dart';
import 'package:knowno/assistant/src/protocol.dart';

import 'fakes.dart';

final _url = assistantUrl('https://x.supabase.co/rest/v1');

HttpAssistantClient _client(
  http.Client inner, {
  String? token = 'jwt',
  Future<Object?> Function()? allowance,
  Future<void> Function(String photoId, Uint8List bytes)? storePhoto,
}) => HttpAssistantClient(
  inner,
  functionUrl: _url,
  accessToken: () async => token,
  readAllowance: allowance ?? () async => <Object?>[],
  storePhoto: storePhoto ?? (_, _) async {},
);

http.StreamedResponse _stream(int status, Stream<List<int>> body) =>
    http.StreamedResponse(body, status);

void main() {
  test('builds the function\'s url from the project\'s rest url', () {
    expect(_url.toString(), 'https://x.supabase.co/functions/v1/assistant');
    expect(() => assistantUrl('https://x.supabase.co'), throwsArgumentError);
  });

  test('sends the turns with the user\'s token and reads the stream', () async {
    late http.BaseRequest seen;
    late String body;
    final inner = MockClient.streaming((request, bodyStream) async {
      seen = request;
      body = await bodyStream.bytesToString();
      return _stream(
        200,
        Stream.fromIterable([
          utf8.encode(
            'event: text\ndata: {"delta":"hi"}\n\nevent: ping\ndata: {}\n\n',
          ),
          utf8.encode(
            'event: usage\ndata: {"token_budget":null,"tokens_used":4}\n\n',
          ),
        ]),
      );
    });
    final outcome = await _client(inner).send([
      {'role': 'user', 'text': '안녕'},
    ], abort: Completer<void>().future);
    expect(seen.url, _url);
    expect(seen.headers['authorization'], 'Bearer jwt');
    expect(jsonDecode(body), {
      'messages': [
        {'role': 'user', 'text': '안녕'},
      ],
    });
    final events = await (outcome as SendStarted).events.toList();
    expect(events, hasLength(2), reason: 'the unknown event is dropped');
    expect(events.first, isA<TextDelta>());
    expect((events.last as UsageEvent).allowance.budget, isNull);
  });

  test(
    'reads a refusal from its status and body, and an offline device',
    () async {
      Future<MessageRefusal> refusal(int status, Object body) async {
        final inner = MockClient.streaming(
          (_, _) async =>
              _stream(status, Stream.value(utf8.encode(jsonEncode(body)))),
        );
        final outcome = await _client(inner)
            .send(const [], abort: Completer<void>().future);
        return (outcome as SendRefused).refusal;
      }

      expect(await refusal(429, {'error': 'busy'}), isA<Busy>());
      expect(
        await refusal(429, {
          'error': 'rate_limited',
          'token_budget': 5,
          'tokens_used': 5,
        }),
        isA<RateLimited>(),
      );
      expect(await refusal(403, {'error': 'suspended'}), isA<Suspended>());
      final offline = MockClient.streaming(
        (_, _) async => throw http.ClientException('offline'),
      );
      expect(
        ((await _client(offline).send(
          const [],
          abort: Completer<void>().future,
        )) as SendRefused).refusal,
        isA<Unreachable>(),
      );
      final signedOut = await _client(
        MockClient.streaming((_, _) async => throw StateError('not reached')),
        token: null,
      ).send(const [], abort: Completer<void>().future);
      expect((signedOut as SendRefused).refusal, isA<SignInNeeded>());
    },
  );

  test('reads what a commit wrote, and why one failed', () async {
    final proposal = proposalOf(
      groups: [
        ('A', CardForm.text, [('q', 'a')]),
      ],
    );
    Future<CommitOutcome> commit(int status, Object body) {
      final inner = MockClient((request) async {
        expect(request.url.toString(), '$_url/commit');
        expect(jsonDecode(request.body), {
          'proposal': proposal.toJson(),
          'checked': {
            'g0': ['g0-c0'],
          },
        });
        return http.Response(jsonEncode(body), status);
      });
      return _client(inner).commit(proposal, {
        'g0': ['g0-c0'],
      });
    }

    final added = await commit(200, {
      'deck': {'id': 'd1', 'name': 'N'},
      'added': [<String, Object?>{}, <String, Object?>{}],
    });
    expect((added as Committed).added, (deckId: 'd1', deckName: 'N', count: 2));
    final updated = await commit(200, {
      'deck': {'id': 'd1', 'name': 'N'},
      'updated': [<String, Object?>{}],
    });
    expect((updated as Committed).added.count, 1);
    expect(
      ((await commit(422, {})) as CommitFailed).failure,
      CommitFailure.refused,
    );
    expect(
      ((await commit(400, {})) as CommitFailed).failure,
      CommitFailure.refused,
    );
    expect(
      ((await commit(401, {})) as CommitFailed).failure,
      CommitFailure.signIn,
    );
    expect(
      ((await commit(500, {})) as CommitFailed).failure,
      CommitFailure.failed,
    );
    expect(
      ((await commit(200, {
        'deck': {'id': 'd'},
      })) as CommitFailed).failure,
      CommitFailure.failed,
      reason: 'a 200 that names no note and cards is not a commit',
    );
  });

  test('reads the day\'s tokens, or null where they cannot be read', () async {
    final inner = MockClient((_) async => http.Response('', 500));
    expect(
      await _client(
        inner,
        allowance: () async => [
          {'token_budget': 200, 'tokens_used': 50, 'tokens_left': 150},
        ],
      ).allowance().then((a) => a?.leftShare),
      75,
    );
    expect(
      await _client(inner, allowance: () async => <Object?>[]).allowance(),
      isNull,
    );
    expect(
      await _client(
        inner,
        allowance: () async => throw Exception('offline'),
      ).allowance(),
      isNull,
    );
  });

  test(
    'sends the note the chat was opened in as the message\'s context',
    () async {
      late String body;
      final inner = MockClient.streaming((request, bodyStream) async {
        body = await bodyStream.bytesToString();
        return _stream(200, const Stream.empty());
      });
      final client = _client(inner);
      await client.send(
        const [],
        deckId: 'deck-1',
        abort: Completer<void>().future,
      );
      expect(jsonDecode(body), containsPair('context', {'deck_id': 'deck-1'}));
      await client.send(const [], abort: Completer<void>().future);
      // Control: a chat opened from nowhere sends no context.
      expect(jsonDecode(body), isNot(contains('context')));
    },
  );

  test('stores a photo and says whether it was kept', () async {
    final inner = MockClient((_) async => http.Response('', 500));
    final stored = <String>[];
    expect(
      await _client(
        inner,
        storePhoto: (id, bytes) async => stored.add('$id ${bytes.length}'),
      ).uploadPhoto('p1', Uint8List(3)),
      isTrue,
    );
    expect(stored, ['p1 3']);
    expect(
      await _client(
        inner,
        storePhoto: (_, _) async => throw http.ClientException('offline'),
      ).uploadPhoto('p1', Uint8List(3)),
      isFalse,
    );
  });

  test('reads a photo job\'s poll, and a job that is not there', () async {
    Future<JobPollOutcome> poll(int status, Object body) {
      final inner = MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.toString(), '$_url/jobs/j1');
        expect(request.headers['authorization'], 'Bearer jwt');
        return http.Response(jsonEncode(body), status);
      });
      return _client(inner).pollJob('j1');
    }

    final running = await poll(200, {
      'id': 'j1',
      'status': 'running',
      'photos': [
        {'position': 0, 'photo_id': 'a', 'status': 'read'},
        {'position': 1, 'photo_id': 'b', 'status': 'queued'},
        {'position': 2, 'photo_id': 'c', 'status': 'failed'},
      ],
      'read': 1,
      'queued': 1,
      'failed': 1,
    });
    expect(
      (running as JobPolled).progress,
      isA<JobProgress>()
          .having((p) => p.photos, 'photos', 3)
          .having((p) => p.finished, 'finished', 2)
          .having((p) => p.state, 'state', JobState.running),
    );
    expect(
      ((await poll(200, {
        'id': 'j1',
        'status': 'done',
        'photos': <Object?>[],
        'queued': 0,
      })) as JobPolled).progress.state,
      JobState.done,
    );
    expect(await poll(404, {'error': 'not_found'}), isA<JobMissing>());
    expect(await poll(503, {'error': 'unavailable'}), isA<JobPollFailed>());
    expect(await poll(200, {'id': 'j1'}), isA<JobPollFailed>());
  });

  test('cancels a photo job through its cancel route', () async {
    var sentTo = '';
    final inner = MockClient((request) async {
      sentTo = '${request.method} ${request.url}';
      return http.Response('{"id":"j1","status":"cancelled"}', 200);
    });
    expect(await _client(inner).cancelJob('j1'), isTrue);
    expect(sentTo, 'POST $_url/jobs/j1/cancel');
    expect(
      await _client(MockClient((_) async => http.Response('', 404)))
          .cancelJob('j1'),
      isFalse,
    );
  });
}
