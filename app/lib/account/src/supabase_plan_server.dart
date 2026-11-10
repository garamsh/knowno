import 'package:supabase_flutter/supabase_flutter.dart';

import 'account_state.dart';
import 'plan.dart';

/// The server function behind 내 플랜: one row for the caller (`server.md`
/// §Store plans).
const myPlanFunction = 'my_plan';

/// The Edge Function route the app calls right after a purchase or restore
/// (`payments.md`): `POST /functions/v1/store-webhook/sync`, the user's
/// session sent by the client, no body.
const storeSyncFunction = 'store-webhook/sync';

/// [PlanServer] over `public.my_plan()`. [call] makes the remote call and
/// resolves to its raw answer.
final class SupabasePlanServer implements PlanServer {
  const SupabasePlanServer(this._call, this._syncCall);

  SupabasePlanServer.of(SupabaseClient client)
    : _call = (() => client.rpc<Object?>(myPlanFunction)),
      _syncCall = (() => client.functions.invoke(storeSyncFunction));

  final Future<Object?> Function() _call;
  final Future<Object?> Function() _syncCall;

  /// A `401`, `429` or `5xx` raises a `FunctionException` and a lost
  /// connection another exception; none stops the plan being read after.
  @override
  Future<void> sync() async {
    try {
      await _syncCall();
    } on Exception {
      // The webhook still follows.
    }
  }

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
    final date = endsAt == null ? null : DateTime.tryParse(endsAt as String);
    if (endsAt != null && date == null) return null;
    // `ends_at` is a renewal only while `renews`; otherwise it is an end.
    final renews = row['renews'] == true;
    return PlanStanding(
      plan: plan,
      source: source,
      renewsOn: renews ? date?.toLocal() : null,
      endsOn: renews ? null : date?.toLocal(),
      photosUsed: used as int?,
      photoLimit: limit as int?,
    );
  }
}
