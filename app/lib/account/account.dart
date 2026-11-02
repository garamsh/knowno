/// The account domain: signing in with Google through Supabase Auth, and the
/// session that sign-in starts.
library;

export 'src/account_data.dart'
    show AccountData, AccountDataNotCleared, accountDataProvider;
export 'src/account_gate.dart' show AccountGate;
export 'src/account_screen.dart' show AccountScreen;
export 'src/account_service.dart'
    show AccountConnection, AccountService, connectAccount;
export 'src/account_state.dart'
    show AccountState, AccountUnavailable, SignedIn, SignedOut, UserId;
export 'src/config.dart' show accountDefines;
export 'src/failure.dart'
    show
        AccountFailure,
        AccountMisconfigured,
        AccountOffline,
        AccountRejected,
        AccountSuspended;
export 'src/profile_button.dart' show ProfileButton;
export 'src/providers.dart' show accountServiceProvider, appVersionProvider;
