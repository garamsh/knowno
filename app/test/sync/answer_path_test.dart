import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/deck/deck.dart';
import 'package:knowno/design/app_text_field.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/home/home.dart';
import 'package:knowno/main.dart';
import 'package:knowno/media/media.dart';
import 'package:knowno/photo_import/photo_import.dart';
import 'package:knowno/study/study.dart';
import 'package:knowno/sync/sync.dart';

import '../account/fake_account_service.dart';
import '../photo_import/fakes.dart';
import '../sharing/fakes.dart';
import 'fake_sync_server.dart';
import '../media/fakes.dart';
import '../word_breaks.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

void main() {
  late Scheduler scheduler;
  setUpAll(() async => scheduler = await Scheduler.load());

  Future<void> tapAndSettle(WidgetTester tester, String text) async {
    await tester.tap(find.text(text));
    await tester.pumpAndSettle();
  }

  testWidgets('answering advances while a sync run never finishes', (
    tester,
  ) async {
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
    final server = FakeSyncServer(_ada)..stall = true;
    await tester.pumpWidget(
      composeApp(
        NativeDatabase.memory(),
        scheduler,
        FakeAccountService(const SignedIn(userId: _ada, email: null)),
        server,
        themeStorage,
        null,
        MemoryImportJobStore(),
        null,
        FakeReachability(),
        const UnavailableMediaServer(),
        unusedMediaDirectory,
        '1.0.0',
      ),
    );
    await tester.pumpAndSettle();
    final sync = ProviderScope.containerOf(
      tester.element(find.byType(HomeScreen)),
    ).read(syncControllerProvider);

    await tapAndSettle(tester, 'Create a note');
    await tester.enterText(
      find.widgetWithText(AppTextField, 'Note name'),
      'French',
    );
    // Saving 새 노트 makes the deck and opens it.
    await tapAndSettle(tester, 'Save');
    for (final (front, back) in [('Chat', 'cat'), ('Chien', 'dog')]) {
      await tapAndSettle(tester, 'Add card');
      await tapAndSettle(tester, 'Enter by hand');
      // A new card's two Text blocks, the front's and the back's.
      await tester.enterText(find.byType(TextField).at(0), front);
      await tester.enterText(find.byType(TextField).at(1), back);
      await tapAndSettle(tester, 'Save');
    }
    await tester.tap(find.textContaining('Study this note'));
    await tester.pumpAndSettle();
    // The run that started with the app is still waiting on the server.
    expect(sync.status.value, isA<Syncing>());
    expect(server.requests, isEmpty);
    expect(find.text('0/2'), findsOneWidget);
    final first = shownText('Chat').evaluate().isEmpty ? 'Chien' : 'Chat';

    await tester.timedDrag(
      shownText(first),
      const Offset(200, 0),
      const Duration(seconds: 1),
    );
    await tester.pumpAndSettle();

    expect(find.text('1/2'), findsOneWidget);
    expect(sync.status.value, isA<Syncing>());

    sync.dispose();
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  });

  testWidgets(
    'a change of the daily study minutes is pushed after the edit delay',
    (tester) async {
      SharedPreferencesAsyncPlatform.instance =
          InMemorySharedPreferencesAsync.empty();
      final storage = (await tester.runAsync(
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
      final server = FakeSyncServer(_ada);
      await tester.pumpWidget(
        composeApp(
          NativeDatabase.memory(),
          scheduler,
          FakeAccountService(const SignedIn(userId: _ada, email: null)),
          server,
          storage,
          null,
          MemoryImportJobStore(),
          null,
          FakeReachability(),
          const UnavailableMediaServer(),
          unusedMediaDirectory,
          '1.0.0',
        ),
      );
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(
        tester.element(find.byType(HomeScreen)),
      );
      final sync = container.read(syncControllerProvider);
      Future<void> settle() async {
        for (var i = 0; i < 200 && sync.status.value is! Synced; i++) {
          await tester.runAsync(() => Future<void>.delayed(Duration.zero));
          await tester.pump();
        }
      }

      // The run that started with the app has finished, its own writes' edit
      // delay has passed, and nothing was pushed.
      await settle();
      await tester.pump(const Duration(seconds: 4));
      await settle();
      expect(sync.status.value, isA<Synced>());
      expect(server.studySettings, isEmpty);
      server.requests.clear();

      await tester.runAsync(
        () => container
            .read(studyRepositoryProvider)
            .setDailyMinutes(45, at: DateTime.now()),
      );
      await tester.pump(const Duration(seconds: 4));
      await settle();

      expect(server.requests, contains('pushStudySettings'));
      expect(server.studySettings[_ada]?.dailyMinutes, 45);

      sync.dispose();
      await tester.pumpWidget(const SizedBox());
      await tester.pump(const Duration(seconds: 1));
    },
  );
}
