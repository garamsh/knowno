/// A failure the account domain reports to its caller.
sealed class AccountFailure implements Exception {
  const AccountFailure();
}

/// The server could not be reached.
final class AccountOffline extends AccountFailure {
  const AccountOffline(this.cause);

  final Exception cause;

  @override
  String toString() => 'AccountOffline: $cause';
}

/// The app's sign-in configuration is missing or does not match what Google,
/// Apple or Supabase expects.
final class AccountMisconfigured extends AccountFailure {
  const AccountMisconfigured(this.cause);

  /// An `InvalidAccountConfig`, or the exception Google, Apple or Supabase
  /// raised.
  final Exception cause;

  @override
  String toString() => 'AccountMisconfigured: $cause';
}

/// An admin suspended the account: Supabase Auth refuses its sign-in and
/// refresh (`user_banned`).
final class AccountSuspended extends AccountFailure {
  const AccountSuspended(this.cause);

  final Exception cause;

  @override
  String toString() => 'AccountSuspended: $cause';
}

/// Google, Apple or Supabase refused the request.
final class AccountRejected extends AccountFailure {
  const AccountRejected(this.cause);

  final Exception cause;

  @override
  String toString() => 'AccountRejected: $cause';
}
