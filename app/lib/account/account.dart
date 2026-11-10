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
        AccountAddressRefused,
        AccountCodeRefused,
        AccountFailure,
        AccountMisconfigured,
        AccountOffline,
        AccountRateLimited,
        AccountRejected,
        AccountSuspended;
export 'src/plan.dart' show PlanServer, UnavailablePlanServer;
export 'src/profile_button.dart' show ProfileButton;
export 'src/supabase_plan_server.dart' show SupabasePlanServer;
export 'src/purchase_store.dart' show PurchaseStore, UnavailablePurchaseStore;
export 'src/revenuecat_store.dart' show connectPurchases;
export 'src/providers.dart' show accountServiceProvider, appVersionProvider;
export 'src/plan_controller.dart'
    show planServerProvider, purchaseOfferProvider, purchaseStoreProvider;
