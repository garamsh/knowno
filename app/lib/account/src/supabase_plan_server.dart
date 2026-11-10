import 'package:supabase_flutter/supabase_flutter.dart';

import 'account_state.dart';
import 'plan.dart';

/// The server function behind 내 플랜: one row for the caller (`server.md`
/// §Store plans).
const myPlanFunction = 'my_plan';

/// [PlanServer] over `public.my_plan()`. [call] makes the remote call and
/// resolves to its raw answer.
final class SupabasePlanServer implements PlanServer {
  const SupabasePlanServer(this._call);

  SupabasePlanServer.of(SupabaseClient client)
    : _call = (() => client.rpc<Object?>(myPlanFunction));

  final Future<Object?> Function() _call;

  /// The server names the caller, so [user] is not sent.
  @override
  Future<PlanStanding> read(UserId user) async {
    final Object? answer;
    try {
      answer = await _call();
    } on Exception {
      throw const PlanUnavailable();
    }
    return _parse(answer) ?? (throw const PlanUnavailable());
  }

  /// The standing the row names, or null for an answer of another shape.
  static PlanStanding? _parse(Object? answer) {
    final row = switch (answer) {
      [final Map<String, Object?> one] => one,
      final Map<String, Object?> one => one,
      _ => null,
    };
    if (row == null) return null;
    final plan = switch (row['plan']) {
      'free' => Plan.free,
      'pro' => Plan.plus,
      'max' => Plan.pro,
      _ => null,
    };
    final source = switch (row['source']) {
      'none' => PlanSource.none,
      'store' => PlanSource.store,
      'admin' => PlanSource.admin,
      'unlimited' => PlanSource.unlimited,
      _ => null,
    };
    final endsAt = row['ends_at'];
    final limit = row['photo_limit'];
    final used = row['used'];
    if (plan == null ||
        source == null ||
        (endsAt != null && endsAt is! String) ||
        (limit != null && limit is! int) ||
        (used != null && used is! int)) {
      return null;
    }
    final renewsOn = endsAt == null
        ? null
        : DateTime.tryParse(endsAt as String);
    if (endsAt != null && renewsOn == null) return null;
    return PlanStanding(
      plan: plan,
      source: source,
      renewsOn: renewsOn?.toLocal(),
      photosUsed: used as int?,
      photoLimit: limit as int?,
    );
  }
}
