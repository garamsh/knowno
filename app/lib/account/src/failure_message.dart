import '../../l10n/app_localizations.dart';
import 'failure.dart';

/// The message a user reads for [failure].
String describeAccountFailure(AppLocalizations l10n, AccountFailure failure) =>
    switch (failure) {
      AccountOffline() => l10n.accountOffline,
      AccountMisconfigured() => l10n.accountMisconfigured,
      AccountRejected() => l10n.accountRejected,
      AccountSuspended() => l10n.accountSuspended,
      AccountRateLimited(:final retryAfter) =>
        retryAfter == null
            ? l10n.accountRateLimitedLater
            : l10n.accountRateLimited(retryAfter.inSeconds),
      AccountCodeRefused() => l10n.accountCodeRefused,
      AccountAddressRefused() => l10n.accountAddressRefused,
    };

/// The message a user reads when deleting the account failed with [failure].
String describeDeletionFailure(AppLocalizations l10n, AccountFailure failure) =>
    switch (failure) {
      AccountOffline() => l10n.accountOffline,
      AccountMisconfigured() => l10n.accountMisconfigured,
      AccountRejected() => l10n.deleteAccountRejected,
      AccountSuspended() => l10n.accountSuspended,
      AccountRateLimited() ||
      AccountCodeRefused() ||
      AccountAddressRefused() => l10n.deleteAccountRejected,
    };
