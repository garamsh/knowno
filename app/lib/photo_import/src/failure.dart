/// A failure of photo import that the user is shown.
sealed class PhotoImportFailure implements Exception {
  const PhotoImportFailure();
}

/// The extraction service could not be reached.
final class ExtractionOffline extends PhotoImportFailure {
  const ExtractionOffline(this.cause);

  final Exception cause;

  @override
  String toString() => 'ExtractionOffline: $cause';
}

/// The service refused the photo as too large (`413`) or of a type it does
/// not read (`415`).
final class PhotoRefused extends PhotoImportFailure {
  const PhotoRefused(this.status);

  final int status;

  @override
  String toString() => 'PhotoRefused: HTTP $status';
}

/// The model found no card on the page (`422`).
final class NoCardsFound extends PhotoImportFailure {
  const NoCardsFound();

  @override
  String toString() => 'NoCardsFound';
}

/// An admin suspended the account, so it extracts nothing (`403`, `suspended`).
final class AccountSuspendedFailure extends PhotoImportFailure {
  const AccountSuspendedFailure();

  @override
  String toString() => 'AccountSuspendedFailure';
}

/// The period a plan's photo limit counts over: a calendar month or a day in
/// Asia/Seoul (ADR 0097).
enum LimitPeriod { month, day }

/// The user has made the period's extractions (`429`): [limit] photos a
/// [period] on the user's plan.
final class PhotoLimitReached extends PhotoImportFailure {
  const PhotoLimitReached({required this.limit, required this.period});

  final int limit;

  final LimitPeriod period;

  @override
  String toString() => 'PhotoLimitReached($limit a ${period.name})';
}

/// No AI configuration can read photos now (`503`, `unavailable`, ADR 0162):
/// the plan's provider has no key. Cards are still added by hand or from a
/// spreadsheet.
final class ExtractionUnavailable extends PhotoImportFailure {
  const ExtractionUnavailable();

  @override
  String toString() => 'ExtractionUnavailable';
}

/// The model failed or answered invalidly twice (`502`).
final class ModelFailed extends PhotoImportFailure {
  const ModelFailed();

  @override
  String toString() => 'ModelFailed';
}

/// No session, or one the service does not accept (`401`).
final class SignInRequired extends PhotoImportFailure {
  const SignInRequired();

  @override
  String toString() => 'SignInRequired';
}

/// The service answered with a status or body the contract does not give
/// this request: `400`, `405`, `500`, `503`, or an unreadable success.
final class ServiceFailed extends PhotoImportFailure {
  const ServiceFailed(this.reason);

  final String reason;

  @override
  String toString() => 'ServiceFailed: $reason';
}

/// The chosen file could not be decoded as an image.
final class PhotoUnreadable extends PhotoImportFailure {
  const PhotoUnreadable(this.cause);

  final Object cause;

  @override
  String toString() => 'PhotoUnreadable: $cause';
}

/// A photo of a job could not be written to the device, as on a full disk,
/// or read back from it, as when its file is gone.
final class PhotoNotKept extends PhotoImportFailure {
  const PhotoNotKept(this.cause);

  final Object cause;

  @override
  String toString() => 'PhotoNotKept: $cause';
}

/// The user, or a restriction, has not let the app use the camera or the
/// photo library.
final class PhotoAccessDenied extends PhotoImportFailure {
  const PhotoAccessDenied(this.cause);

  final Object cause;

  @override
  String toString() => 'PhotoAccessDenied: $cause';
}

/// The device has no camera the system can open.
final class CameraUnavailable extends PhotoImportFailure {
  const CameraUnavailable(this.cause);

  final Object cause;

  @override
  String toString() => 'CameraUnavailable: $cause';
}
