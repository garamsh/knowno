import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/assistant/assistant.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _owner = '00000000-0000-4000-8000-00000000000a';
const _photo = '0199f3b2-7c1e-4a00-8000-000000000001';

/// An unsigned token for [_owner] that expires in a day, which the client
/// reads without asking the server.
String _token() {
  String part(Map<String, Object> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');
  final exp = DateTime.now().add(const Duration(days: 1));
  return '${part({'alg': 'HS256', 'typ': 'JWT'})}.'
      '${part({'sub': _owner, 'role': 'authenticated', 'exp': exp.millisecondsSinceEpoch ~/ 1000})}.'
      'signature';
}

/// A client whose every request is recorded in [requests] and answered with
/// [status], signed in as [_owner] unless [signedIn] is false.
Future<SupabaseClient> _client(
  List<http.Request> requests, {
  int status = 200,
  bool signedIn = true,
}) async {
  final client = SupabaseClient(
    'https://example.test',
    'anon-key',
    httpClient: MockClient((request) async {
      requests.add(request);
      return http.Response(
        '{"Key":"assistant-photos/x"}',
        status,
        request: request,
      );
    }),
  );
  if (signedIn) {
    await client.auth.recoverSession(
      jsonEncode({
        'access_token': _token(),
        'token_type': 'bearer',
        'expires_in': 86400,
        'refresh_token': 'refresh',
        'user': {
          'id': _owner,
          'aud': 'authenticated',
          'role': 'authenticated',
          'app_metadata': <String, Object>{},
          'user_metadata': <String, Object>{},
          'created_at': '2026-10-01T00:00:00Z',
        },
      }),
    );
  }
  addTearDown(client.dispose);
  return client;
}

void main() {
  test(
    'stores a photo as a JPEG in assistant-photos at {user id}/{photo id}',
    () async {
      final requests = <http.Request>[];
      final client = await _client(requests);
      await SupabasePhotoStore(client)
          .store(_photo, Uint8List.fromList([1, 2, 3]));
      final request = requests.single;
      expect(request.method, 'POST');
      expect(
        request.url.path,
        '/storage/v1/object/assistant-photos/$_owner/$_photo',
      );
      expect(request.bodyBytes, containsAllInOrder([1, 2, 3]));
      expect(request.body, contains('content-type: image/jpeg'));
    },
  );

  test('refuses where nobody is signed in, sending nothing', () async {
    final requests = <http.Request>[];
    final client = await _client(requests, signedIn: false);
    await expectLater(
      SupabasePhotoStore(client).store(_photo, Uint8List(3)),
      throwsA(isA<AuthException>()),
    );
    expect(requests, isEmpty);
  });

  test('fails where the bucket refuses', () async {
    final requests = <http.Request>[];
    final client = await _client(requests, status: 403);
    await expectLater(
      SupabasePhotoStore(client).store(_photo, Uint8List(3)),
      throwsA(isA<StorageException>()),
    );
  });
}
