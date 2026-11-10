import 'account_state.dart';

/// The plans the app names, by what a user reads: 무료, 플러스 and 프로.
enum Plan { free, plus, pro }

/// Where a plan comes from, as the server answers it.
enum PlanSource {
  /// Nothing grants it: the free plan every account starts on.
  none,

  /// A store subscription RevenueCat reports.
  store,

  /// The account is an admin's.
  admin,

  /// The account holds 무제한 without paying.
  unlimited,
}

/// What the server says about the signed-in account's plan and the photos it
/// may read: the app shows it and decides nothing from anything else.
final class PlanStanding {
  const PlanStanding({
    required this.plan,
    required this.source,
    this.renewsOn,
    this.photosUsed,
    this.photoLimit,
  });

  final Plan plan;
  final PlanSource source;

  /// When a store subscription renews or ends; null without one.
  final DateTime? renewsOn;

  /// The photos read in the period the limit counts, and the limit; null
  /// where the server names none.
  final int? photosUsed;
  final int? photoLimit;

  /// Whether the app offers 플러스: the free plan with nothing granting more.
  /// An admin and a 무제한 holder are never offered it and never locked.
  bool get canBuy => plan == Plan.free && source == PlanSource.none;

  /// Whether a store subscription is the plan's source, which the store
  /// manages and a restore can find.
  bool get fromStore => source == PlanSource.store;
}

/// The server's answer could not be had.
final class PlanUnavailable implements Exception {
  const PlanUnavailable();

  @override
  String toString() => 'PlanUnavailable';
}

/// Reads the account's plan from the server.
abstract interface class PlanServer {
  /// The plan of the account signed in as [user]. Throws [PlanUnavailable]
  /// when the server cannot answer.
  Future<PlanStanding> read(UserId user);
}

/// The plan server of a build with no server to ask: every read fails.
final class UnavailablePlanServer implements PlanServer {
  const UnavailablePlanServer();

  @override
  Future<PlanStanding> read(UserId user) => throw const PlanUnavailable();
}
