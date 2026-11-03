import 'dart:async';
import 'dart:convert';

import 'package:drift/drift.dart' show QueryExecutor;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:google_sign_in_platform_interface/google_sign_in_platform_interface.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/account_service.dart';
import 'package:knowno/account/src/google_button.dart';
import 'package:knowno/account/src/sign_in_screen.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/home/src/deck_screen.dart';
import 'package:knowno/main.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../photo_import/fakes.dart';
import '../sharing/fakes.dart';
import '../sync/fake_sync_server.dart';
import 'fake_account_service.dart';
import 'fake_google_sign_in.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

/// A session stored by an earlier run, whose access token expired an hour
/// ago, so the client refreshes it over the network before it is fresh again.
String _expiredSession() {
  String part(Map<String, Object?> json) =>
      base64Url.encode(utf8.encode(jsonEncode(json))).replaceAll('=', '');
  final expiredAt =
      DateTime.now()
          .subtract(const Duration(hours: 1))
          .millisecondsSinceEpoch ~/
      1000;
  return jsonEncode({
    'access_token':
        '${part({'alg': 'HS256'})}.${part({'sub': _ada.value, 'exp': expiredAt})}.signature',
    'expires_in': 3600,
    'refresh_token': 'supabase-refresh-token',
    'token_type': 'bearer',
    'user': {
      'id': _ada.value,
      'aud': 'authenticated',
      'email': 'ada@example.com',
      'app_metadata': <String, Object?>{},
      'user_metadata': <String, Object?>{},
      'created_at': '2026-10-14T00:00:00Z',
    },
  });
}

/// An extraction client the test never calls.
final class _NoExtraction implements ExtractionClient {
  @override
  Future<Extracted?> extract(
    JpegPhoto photo, {
    String? cursor,
    required Future<void> cancel,
  }) => throw UnimplementedError('not called');

  @override
  Future<ExtractionAllowance?> allowance() =>
      throw UnimplementedError('not called');
}

void main() {
  late Scheduler scheduler;
  late QueryExecutor executor;
  setUpAll(() async {
    scheduler = await Scheduler.load();
    GoogleSignInPlatform.instance = FakeGoogleSignIn();
  });

  /// Composes the app, signing in through [account], syncing with [server],
  /// and offering photo import.
  Future<void> pumpApp(
    WidgetTester tester,
    AccountService account, {
    FakeSyncServer? server,
  }) async {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.withData({
          studyCoachShownKey: true,
          dailyMinutesAskedKey: true,
        });
    final themeStorage = (await tester.runAsync(
      () => SharedPreferencesWithCache.create(
        cacheOptions: const SharedPreferencesWithCacheOptions(
          allowList: {
            ...themeStorageKeys,
            ...photoImportStorageKeys,
            ...studyStorageKeys,
            ...deckStorageKeys,
          },
        ),
      ),
    ))!;
    executor = NativeDatabase.memory();
    await tester.pumpWidget(
      composeApp(
        executor,
        scheduler,
        account,
        server ?? FakeSyncServer(_ada),
        themeStorage,
        _NoExtraction(),
        MemoryImportJobStore(),
        null,
        FakeReachability(),
        const UnavailableMediaServer(),
        unusedMediaDirectory,
        '1.0.0',
      ),
    );
    await tester.pumpAndSettle();
  }

  // Unmounting the scope cancels drift's stream queries, whose cleanup timer
  // must fire before the test body ends.
  Future<void> unmountApp(WidgetTester tester) async {
    final sync = ProviderScope.containerOf(
      tester.element(find.byType(AccountGate, skipOffstage: false)),
    ).read(syncControllerProvider);
    sync.dispose();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }

  Future<void> tapAndSettle(WidgetTester tester, Finder target) async {
    // The account screen's rows can run past the test's screen, and its list
    // builds only the rows near it.
    if (target.evaluate().isEmpty) {
      await tester.scrollUntilVisible(
        target,
        200,
        scrollable: find.byType(Scrollable).first,
      );
    }
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  /// The rows the device's database holds in the synced tables and the sync
  /// state, read from the database the app was composed over.
  Future<int> deviceRows(WidgetTester tester) async {
    final rows = (await tester.runAsync(
      () => executor.runSelect(
        'SELECT (SELECT count(*) FROM decks) + (SELECT count(*) FROM cards)'
        ' + (SELECT count(*) FROM reviews) + (SELECT count(*) FROM card_states)'
        ' + (SELECT count(*) FROM sync_state) AS n',
        const [],
      ),
    ))!;
    return rows.single['n']! as int;
  }

  /// Makes the deck "French" on 새 노트 from the first-run home, which then
  /// opens it.
  Future<void> createAndOpenDeck(WidgetTester tester) async {
    await tapAndSettle(tester, shownText('Create a note'));
    await tester.enterText(
      find.widgetWithText(AppTextField, 'Note name'),
      'French',
    );
    await tapAndSettle(tester, shownText('Save'));
  }

  /// Creates the deck "French" from the first-run home, which opens it on the
  /// 노트 tab, and goes back to that tab's first screen.
  Future<void> createDeck(WidgetTester tester) async {
    await createAndOpenDeck(tester);
    await tester.pageBack();
    await tester.pumpAndSettle();
  }

  /// The tab named [name] in the tab bar.
  Finder tab(String name) => find.descendant(
    of: find.bySemanticsLabel('Tabs'),
    matching: find.text(name),
  );

  /// Opens 설정, the account screen, from 홈's profile button.
  Future<void> showSettings(WidgetTester tester) async {
    final semantics = tester.ensureSemantics();
    await tapAndSettle(tester, tab('Home'));
    semantics.dispose();
    await tapAndSettle(tester, find.byTooltip('Settings'));
  }

  /// Shows the 노트 tab, where the decks are listed.
  Future<void> showNotes(WidgetTester tester) async {
    final semantics = tester.ensureSemantics();
    await tapAndSettle(tester, tab('Notes'));
    semantics.dispose();
  }

  /// The buttons on screen that respond to a tap.
  List<String> enabledButtons(WidgetTester tester) => [
    for (final button in tester.widgetList<GoogleSignInButton>(
      find.byType(GoogleSignInButton),
    ))
      button.label,
    for (final button in tester.widgetList<ButtonStyleButton>(
      find.byWidgetPredicate((w) => w is ButtonStyleButton),
    ))
      if (button.onPressed != null) (button.child! as Text).data!,
  ];

  testWidgets(
    'signed out, only the sign-in screen shows, in Korean, with Apple sign-in disabled',
    (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ko')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);

      await pumpApp(tester, FakeAccountService());

      expect(find.byType(SignInScreen), findsOneWidget);
      expect(find.bySemanticsLabel('알아몰라'), findsOneWidget);
      expect(find.text('밀어서 응답하고,\n잊을 때쯤 다시 만나는 암기 카드'), findsOneWidget);
      expect(shownText('Apple로 계속하기 · 준비 중'), findsOneWidget);
      // Besides Google's button, only the links to the terms answer a tap.
      expect(enabledButtons(tester), ['Google로 계속하기', '이용약관', '개인정보 처리방침']);
      expect(find.byType(HomeScreen), findsNothing);
      await unmountApp(tester);
    },
  );

  testWidgets('signing in shows 홈', (tester) async {
    final account = FakeAccountService();
    await pumpApp(tester, account);

    await tapAndSettle(tester, find.text('Continue with Google'));

    expect(account.state, isA<SignedIn>());
    expect(find.byType(HomeScreen), findsOneWidget);
    expect(find.byType(SignInScreen), findsNothing);
    await unmountApp(tester);
  });

  testWidgets(
    'a cancelled sign-in stays on the gate, and a failed one says why',
    (tester) async {
      final account = FakeAccountService()..cancelSignIn = true;
      await pumpApp(tester, account);

      await tapAndSettle(tester, find.text('Continue with Google'));

      expect(find.byType(SignInScreen), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
      // The control: the same tap with a failure does show a snack bar.
      account.failure = const AccountOffline(FormatException('offline'));
      await tapAndSettle(tester, find.text('Continue with Google'));
      expect(
        find.text("Couldn't reach the server. Check your internet connection."),
        findsOneWidget,
      );
      expect(find.byType(SignInScreen), findsOneWidget);
      await unmountApp(tester);
    },
  );

  testWidgets('signing out from the account screen returns to the gate', (
    tester,
  ) async {
    final account = FakeAccountService(
      const SignedIn(userId: _ada, email: 'ada@example.com'),
    );
    await pumpApp(tester, account);

    await showSettings(tester);
    await tapAndSettle(tester, find.text('Sign out'));

    expect(account.state, isA<SignedOut>());
    expect(find.byType(SignInScreen), findsOneWidget);
    expect(find.byType(AccountScreen), findsNothing);
    expect(find.byType(HomeScreen), findsNothing);
    await unmountApp(tester);
  });

  // The gate closes the account screen as soon as the session ends, while
  // the screen's sign-out or deletion is still running.
  testWidgets(
    'signing out under the gate still clears the device\'s data from the database',
    (tester) async {
      final account = FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      );
      await pumpApp(tester, account);
      await createDeck(tester);
      // The setup put a deck on the device.
      expect(await deviceRows(tester), greaterThan(0));

      await showSettings(tester);
      await tapAndSettle(tester, find.text('Sign out'));

      expect(find.byType(SignInScreen), findsOneWidget);
      expect(find.byType(AccountScreen), findsNothing);
      expect(await deviceRows(tester), 0);
      await unmountApp(tester);
    },
  );

  testWidgets(
    'deleting the account under the gate shows the sign-in screen and clears the device\'s data from the database',
    (tester) async {
      final account = FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      );
      await pumpApp(tester, account);
      await createDeck(tester);
      expect(await deviceRows(tester), greaterThan(0));

      await showSettings(tester);
      await tapAndSettle(tester, find.text('Delete account'));
      await tapAndSettle(tester, shownText('Delete'));

      expect(account.deletions, 1);
      expect(account.state, isA<SignedOut>());
      expect(find.byType(SignInScreen), findsOneWidget);
      expect(find.byType(AccountScreen), findsNothing);
      expect(find.byType(HomeScreen), findsNothing);
      expect(await deviceRows(tester), 0);
      await unmountApp(tester);
    },
  );

  group('no deck or study screen is reachable while signed out', () {
    /// Each screen 홈 leads to, how to open it from there, and the screen.
    final routes =
        <String, (Future<void> Function(WidgetTester), Finder Function())>{
          'card list': (
            (tester) async {
              await showNotes(tester);
              await tapAndSettle(tester, shownText('French'));
            },
            () => find.byType(DeckScreen),
          ),
          'card editor': (
            (tester) async {
              await showNotes(tester);
              await tapAndSettle(tester, shownText('French'));
              await tapAndSettle(tester, shownText('Add card'));
              await tapAndSettle(tester, shownText('Enter by hand'));
            },
            () => find.byType(CardEditorScreen),
          ),
          'study': (
            (tester) async {
              await showNotes(tester);
              await tapAndSettle(tester, shownText('French'));
              await tapAndSettle(
                tester,
                shownTextContaining('Study this note'),
              );
            },
            () => find.byType(StudyScreen),
          ),
          'new note': (
            (tester) async {
              await showNotes(tester);
              await tapAndSettle(tester, shownText('New note'));
            },
            () => find.byType(NewDeckScreen),
          ),
          'account': (showSettings, () => find.byType(AccountScreen)),
        };
    for (final MapEntry(key: name, value: (open, screen)) in routes.entries) {
      testWidgets('the $name screen closes when the session ends', (
        tester,
      ) async {
        final account = FakeAccountService(
          const SignedIn(userId: _ada, email: 'ada@example.com'),
        );
        await pumpApp(tester, account);
        await createAndOpenDeck(tester);
        await tapAndSettle(tester, shownText('Add card'));
        // With photo import, Add card asks how.
        await tapAndSettle(tester, shownText('Enter by hand'));
        // A new card's two Text blocks, the front's and the back's.
        await tester.enterText(find.byType(TextField).at(0), 'Chat');
        await tester.enterText(find.byType(TextField).at(1), 'cat');
        await tapAndSettle(tester, shownText('Save'));
        // Back from the deck it opened, to the 노트 tab.
        await tester.pageBack();
        await tester.pumpAndSettle();
        await open(tester);
        // The app's own navigator, 홈's above it.
        final navigator = tester.state<NavigatorState>(
          find.byType(Navigator).first,
        );
        // The setup reached the screen.
        expect(screen(), findsOneWidget);

        // The session ends outside the app, as an expired refresh token does.
        await account.signOut();
        await tester.pumpAndSettle();

        expect(screen(), findsNothing);
        expect(navigator.canPop(), isFalse);
        expect(find.byType(SignInScreen), findsOneWidget);
        expect(enabledButtons(tester), [
          'Continue with Google',
          'Terms of Service',
          'Privacy Policy',
        ]);
        expect(find.byType(HomeScreen), findsNothing);
        expect(find.byType(StudyScreen), findsNothing);
        expect(find.byType(AccountScreen), findsNothing);
        expect(shownText('Choose from album'), findsNothing);
        expect(shownText('French'), findsNothing);
        expect(find.text('Chat'), findsNothing);
        await unmountApp(tester);
      });
    }
  });

  group('with the network never answering', () {
    late GoTrueClient auth;
    final requests = <String>[];

    /// An account service over a Supabase Auth client whose server never
    /// answers, holding [storedSession] as the session an earlier run
    /// stored.
    Future<AccountService> offlineAccount(String? storedSession) async {
      auth = GoTrueClient(
        url: 'https://example.test/auth/v1',
        httpClient: MockClient((request) {
          requests.add(request.url.path);
          return Completer<http.Response>().future;
        }),
      );
      if (storedSession != null) {
        await auth.setInitialSession(storedSession);
        // The setup holds the expired session it asked for.
        expect(auth.currentSession?.isExpired, isTrue);
      }
      return GoogleAccountService.start(
        auth,
        GoogleSignIn.instance,
        functions: FunctionsClient('https://example.test/functions/v1', {}),
        clientId: null,
        serverClientId: 'web-client-id',
      );
    }

    testWidgets(
      'a restored session opens the deck list, and without one the gate stays',
      (tester) async {
        final server = FakeSyncServer(_ada)..stall = true;
        await pumpApp(
          tester,
          await offlineAccount(_expiredSession()),
          server: server,
        );

        expect(find.byType(HomeScreen), findsOneWidget);
        expect(find.byType(SignInScreen), findsNothing);
        // The app opened while the session's refresh was still unanswered.
        expect(requests, ['/auth/v1/token']);
        await unmountApp(tester);
        auth.dispose();

        // The control: the same offline client with nothing stored.
        await pumpApp(tester, await offlineAccount(null), server: server);

        expect(find.byType(SignInScreen), findsOneWidget);
        expect(find.byType(HomeScreen), findsNothing);
        await unmountApp(tester);
        auth.dispose();
      },
    );
  });

  testWidgets(
    'a build that cannot sign anyone in says so and shows no app, in Korean',
    (tester) async {
      tester.platformDispatcher.localesTestValue = const [Locale('ko')];
      addTearDown(tester.platformDispatcher.clearLocalesTestValue);

      await pumpApp(
        tester,
        const UnavailableAccountService(
          AccountMisconfigured(FormatException('SUPABASE_URL is missing')),
        ),
      );

      expect(find.text('이 앱의 로그인 설정에 문제가 있어 로그인할 수 없어요.'), findsOneWidget);
      expect(enabledButtons(tester), ['이용약관', '개인정보 처리방침']);
      expect(find.text('Google로 계속하기'), findsNothing);
      expect(find.byType(HomeScreen), findsNothing);
      await unmountApp(tester);
    },
  );
}
