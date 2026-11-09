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

/// Supabase Auth refused a request for coming too often: a code was asked for
/// again before the interval between codes, or past the hourly limit.
final class AccountRateLimited extends AccountFailure {
  const AccountRateLimited(this.cause, {this.retryAfter});

  final Exception cause;

  /// How long to wait before asking again, where the refusal says; null where
  /// it does not.
  final Duration? retryAfter;

  @override
  String toString() => 'AccountRateLimited: $cause';
}

/// The email code was refused. Supabase Auth answers a code that is wrong and
/// one that has expired the same way (`otp_expired`), so the two are one
/// failure.
final class AccountCodeRefused extends AccountFailure {
  const AccountCodeRefused(this.cause);

  final Exception cause;

  @override
  String toString() => 'AccountCodeRefused: $cause';
}

/// Supabase Auth refused the email address a code was asked for: it is not an
/// address, or it is one the project may not send to.
final class AccountAddressRefused extends AccountFailure {
  const AccountAddressRefused(this.cause);

  final Exception cause;

  @override
  String toString() => 'AccountAddressRefused: $cause';
}
