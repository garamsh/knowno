import 'dart:io';
import 'dart:math';

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'account/account.dart';
import 'assistant/assistant.dart';
import 'database/database.dart';
import 'deck/deck.dart';
import 'design/keyboard_dismissal.dart';
import 'design/theme.dart';
import 'design/theme_choice.dart';
import 'home/home.dart';
import 'l10n/app_localizations.dart';
import 'media/media.dart';
import 'photo_import/photo_import.dart';
import 'sharing/sharing.dart';
import 'study/study.dart';
import 'sync/sync.dart';

/// The composition site: the one place that constructs the application.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final scheduler = await Scheduler.load();
  final account = await connectAccount(accountDefines());
  final package = await PackageInfo.fromPlatform();
  final support = await getApplicationSupportDirectory();
  final preferences = await SharedPreferencesWithCache.create(
    cacheOptions: const SharedPreferencesWithCacheOptions(
      allowList: {
        ...themeStorageKeys,
        ...photoImportStorageKeys,
        ...studyStorageKeys,
        ...deckStorageKeys,
        ...assistantStorageKeys,
      },
    ),
  );
  runApp(
    composeApp(
      driftDatabase(name: 'smartman'),
      scheduler,
      account.service,
      connectSyncServer(account),
      preferences,
      switch (account.client) {
        final client? => HttpExtractionClient(
          http.Client(),
          functionUrl: extractCardsUrl(client.rest.url),
          accessToken: () async => client.auth.currentSession?.accessToken,
          readAllowance: () => client.rpc<Object?>('extraction_allowance'),
        ),
        null => null,
      },
      FileImportJobStore(Directory('${support.path}/photo_import')),
      switch (account.client) {
        final client? => SupabaseSharingServer(client),
        null => null,
      },
      DeviceReachability(),
      switch (account.client) {
        final client? => SupabaseMediaServer(client),
        null => const UnavailableMediaServer(),
      },
      Directory('${support.path}/media'),
      package.version,
      assistant: switch (account.client) {
        final client? => HttpAssistantClient(
          http.Client(),
          functionUrl: assistantUrl(client.rest.url),
          accessToken: () async => client.auth.currentSession?.accessToken,
          readAllowance: () => client.rpc<Object?>('assistant_allowance'),
        ),
        null => null,
      },
    ),
  );
}

/// Constructs the application over the database [executor] opens, scheduling
/// with the loaded [scheduler], signing in through [account], syncing with
/// [server], keeping the theme choice and whether photo import's and the
/// study screen's coaches have shown in [preferences], extracting cards from
/// photos through [extraction], whose absence hides photo import, keeping a
/// photo import's photos and cards in [jobStore] until it is saved, and sharing
/// decks through [sharing] while [reachability] says the device is online;
/// without [sharing] the app offers no sharing. Decks' images are kept in
/// [mediaDirectory] and stored through [mediaServer]. The account screen names
/// the app's [version]. Chats with 말랑이 go through [assistant], whose
/// absence hides every way into the chat, and are kept in [preferences]. Sync
/// starts at once.
Widget composeApp(
  QueryExecutor executor,
  Scheduler scheduler,
  AccountService account,
  SyncServer server,
  SharedPreferencesWithCache preferences,
  ExtractionClient? extraction,
  ImportJobStore jobStore,
  SharingServer? sharing,
  Reachability reachability,
  MediaServer mediaServer,
  Directory mediaDirectory,
  String version, {
  AssistantClient? assistant,
}) {
  final database = AppDatabase(executor);
  const uuid = Uuid();
  final media = MediaStore(
    database,
    mediaServer,
    directory: mediaDirectory,
    clock: DateTime.now,
    newId: uuid.v7,
  );
  final deckRepository = DeckRepository(
    database,
    clock: DateTime.now,
    newId: uuid.v7,
    media: media,
  );
  final studyRepository = StudyRepository(database, newId: uuid.v7);
  final syncStore = SyncStore(database, scheduler, clock: DateTime.now);
  final sync = SyncController(
    account: account,
    synchronizer: Synchronizer(syncStore, server),
    store: syncStore,
    edits: database.tableUpdates(
      TableUpdateQuery.onAllTables([
        database.decks,
        database.cards,
        database.reviews,
        database.cardStates,
        database.studySettings,
        database.mediaUploads,
        database.mediaDeletions,
      ]),
    ),
    media: media,
  )..start();
  final imports = extraction == null
      ? null
      : (PhotoImports(
          client: extraction,
          photos: const DevicePhotoSource(),
          preferences: preferences,
          store: jobStore,
          decks: deckRepository,
        )..restore());
  return ProviderScope(
    overrides: [
      deckRepositoryProvider.overrideWithValue(deckRepository),
      mediaStoreProvider.overrideWithValue(media),
      sharingServiceProvider.overrideWithValue(
        sharing == null
            ? null
            : SharingService(
                server: sharing,
                decks: deckRepository,
                reachability: reachability,
                clock: DateTime.now,
              ),
      ),
      photoImportProvider.overrideWithValue(
        imports == null
            ? null
            : (context, deck, origin) => importFromPhoto(
                context,
                imports: imports,
                deck: deck,
                origin: origin,
              ),
      ),
      photoImportsProvider.overrideWithValue(imports),
      studyRepositoryProvider.overrideWithValue(studyRepository),
      schedulerProvider.overrideWithValue(scheduler),
      studyClockProvider.overrideWithValue(DateTime.now),
      studyZoneProvider.overrideWithValue(localOffsetAt),
      studyStorageProvider.overrideWithValue(preferences),
      studyRandomProvider.overrideWithValue(
        (start) => Random(start.microsecondsSinceEpoch),
      ),
      accountServiceProvider.overrideWithValue(account),
      appVersionProvider.overrideWithValue(version),
      accountDataProvider.overrideWithValue(sync),
      syncControllerProvider.overrideWithValue(sync),
      themeStorageProvider.overrideWithValue(preferences),
      deckStorageProvider.overrideWithValue(preferences),
      assistantClientProvider.overrideWithValue(assistant),
      assistantStorageProvider.overrideWithValue(preferences),
    ],
    child: const KnownoApp(),
  );
}

/// The application root, opening on the account gate in the theme the user
/// chose, every route closing the keyboard as [KeyboardDismissal] says, and
/// under the photo import's bar while one is under way.
class KnownoApp extends ConsumerWidget {
  const KnownoApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final imports = ref.watch(photoImportsProvider);
    return MaterialApp(
      theme: lightTheme,
      darkTheme: darkTheme,
      themeMode: ref.watch(themeModeProvider),
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      // A screen that draws nothing of its own under the status bar keeps the
      // glyphs that read on the theme's ground.
      builder: (context, child) => AnnotatedRegion<SystemUiOverlayStyle>(
        value: AppStatusBar.over(Theme.of(context).brightness),
        child: KeyboardDismissal(
          child: imports == null || child == null
              ? child
              : PhotoImportFrame(imports: imports, child: child),
        ),
      ),
      home: const AccountGate(signedIn: HomeScreen()),
    );
  }
}
