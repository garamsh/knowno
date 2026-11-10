/// The sharing domain: publishing a deck, and browsing, copying, reporting
/// and blocking other users' public decks.
library;

export 'src/failure.dart'
    show
        DeckNoLongerPublic,
        SharingFailed,
        SharingFailure,
        SharingOffline,
        SharingRejected;
export 'src/model.dart'
    show
        BrowseSort,
        DisplayName,
        FindingCategory,
        FindingPlace,
        PublicCard,
        PublicDeckSummary,
        ReportOutcome,
        ReportReason,
        Screening,
        ScreeningFinding;
export 'src/providers.dart' show onlineProvider, sharingServiceProvider;
export 'src/reachability.dart' show DeviceReachability, Reachability;
export 'src/server.dart' show SharingServer;
export 'src/sharing_service.dart'
    show CopyIntoDeck, CopyIntoNewDeck, CopyTarget, SharingService;
export 'src/supabase_sharing_server.dart' show SupabaseSharingServer;
