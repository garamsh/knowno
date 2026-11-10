import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show FunctionsClient;
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/plan.dart';
import 'package:knowno/account/src/supabase_plan_server.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

Map<String, Object?> _row({
  Object? plan = 'free',
  Object? source = 'none',
  Object? endsAt,
  Object? renews,
  Object? limit = 5,
  Object? used = 2,
}) => {
  'plan': plan,
  'source': source,
  'ends_at': endsAt,
  'renews': renews,
  'photo_limit': limit,
  'period': 'month',
  'used': used,
};

void main() {
  Future<PlanStanding> read(Object? answer) =>
      SupabasePlanServer(() async => answer, () async => null).read(_ada);

  test(
    'the free plan with its photos used and limit is read from the row',
    () async {
      final standing = await read([_row()]);

      expect(standing.plan, Plan.free);
      expect(standing.source, PlanSource.none);
      expect(standing.photosUsed, 2);
      expect(standing.photoLimit, 5);
      expect(standing.renewsOn, isNull);
      expect(standing.canBuy, isTrue);
    },
  );

  test(
    'the server plan pro is 플러스 and max is 프로, a store grant with its renewal',
    () async {
      final plus = await read([
        _row(
          plan: 'pro',
          source: 'store',
          endsAt: '2026-12-10T00:00:00+00:00',
          renews: true,
        ),
      ]);
      final pro = await read([_row(plan: 'max', source: 'store')]);

      expect(plus.plan, Plan.plus);
      expect(plus.fromStore, isTrue);
      expect(plus.renewsOn, DateTime.utc(2026, 12, 10).toLocal());
      expect(plus.endsOn, isNull);
      expect(plus.canBuy, isFalse);
      expect(pro.plan, Plan.pro);
    },
  );

  test(
    'a store grant that does not renew is read as an end, not a renewal',
    () async {
      final ended = await read([
        _row(
          plan: 'pro',
          source: 'store',
          endsAt: '2026-12-10T00:00:00+00:00',
          renews: false,
        ),
      ]);

      expect(ended.fromStore, isTrue);
      expect(ended.renewsOn, isNull);
      expect(ended.endsOn, DateTime.utc(2026, 12, 10).toLocal());
    },
  );

  test(
    'an admin and a 무제한 holder are read as never to be offered a purchase',
    () async {
      final admin = await read([
        _row(plan: 'max', source: 'admin', limit: null),
      ]);
      final unlimited = await read(
        _row(plan: 'free', source: 'unlimited', limit: null, used: null),
      );

      expect(admin.canBuy, isFalse);
      expect(admin.photoLimit, isNull);
      expect(
        unlimited.canBuy,
        isFalse,
        reason: 'free, but held without paying',
      );
      expect(unlimited.plan, Plan.free);
    },
  );

  test('an answer of another shape, a plan or source it does not know, and a read that fails are all unavailable', () async {
    for (final answer in <Object?>[
      null,
      const <Object?>[],
      [_row(), _row()],
      'free',
      [_row(plan: 'gold')],
      [_row(plan: 'special')],
      [_row(source: 'friend')],
      [_row(endsAt: 5)],
      [_row(endsAt: 'next week')],
      [_row(limit: '5')],
      [_row(used: 2.5)],
    ]) {
      await expectLater(
        read(answer),
        throwsA(isA<PlanUnavailable>()),
        reason: '$answer',
      );
    }
    await expectLater(
      SupabasePlanServer(
        () async => throw Exception('offline'),
        () async => null,
      ).read(_ada),
      throwsA(isA<PlanUnavailable>()),
    );
  });

  group('sync', () {
    late List<http.Request> requests;

    /// A server over an Edge Functions client whose server answers [status].
    SupabasePlanServer answering(int status) {
      requests = [];
      final functions = FunctionsClient(
        'https://example.test/functions/v1',
        const {},
        httpClient: MockClient((request) async {
          requests.add(request);
          return http.Response('{"outcome": "applied"}', status);
        }),
      );
      addTearDown(functions.dispose);
      return SupabasePlanServer(
        () async => [_row()],
        () => functions.invoke(storeSyncFunction),
      );
    }

    test('posts to the store-webhook sync route with no body', () async {
      await answering(200).sync();

      final request = requests.single;
      expect(request.method, 'POST');
      expect(
        request.url.toString(),
        'https://example.test/functions/v1/store-webhook/sync',
      );
      expect(request.body, isEmpty);
    });

    test(
      'a 401, a 429 and a 5xx are not thrown, and the plan is still read after',
      () async {
        for (final status in [401, 429, 500, 502, 503]) {
          final server = answering(status);

          await server.sync();
          final standing = await server.read(_ada);

          expect(requests, hasLength(1), reason: '$status');
          expect(standing.plan, Plan.free, reason: '$status');
        }
      },
    );

    test('a lost connection is not thrown either', () async {
      final server = SupabasePlanServer(
        () async => [_row()],
        () async => throw http.ClientException('offline'),
      );

      await server.sync();
    });
  });
}
