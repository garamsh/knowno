import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/plan.dart';

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
      SupabasePlanServer(() async => answer).read(_ada);

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
      expect(plus.canBuy, isFalse);
      expect(pro.plan, Plan.pro);
    },
  );

  test('a store grant that does not renew shows no renewal date', () async {
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
  });

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
      SupabasePlanServer(() async => throw Exception('offline')).read(_ada),
      throwsA(isA<PlanUnavailable>()),
    );
  });
}
