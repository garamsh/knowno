import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/legal.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_sheet.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../contrast.dart';
import 'fake_account_data.dart';
import 'fake_account_service.dart';
import '../word_breaks.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

void main() {
  Future<void> pumpScreen(
    WidgetTester tester,
    AccountService service, {
    Locale locale = const Locale('en'),
    AccountData? data,
    String? themeMode,
    LinkOpener? opener,
  }) async {
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.withData({'themeMode': ?themeMode});
    final storage = (await tester.runAsync(
      () => SharedPreferencesWithCache.create(
        cacheOptions: const SharedPreferencesWithCacheOptions(
          allowList: themeStorageKeys,
        ),
      ),
    ))!;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accountServiceProvider.overrideWithValue(service),
          appVersionProvider.overrideWithValue('1.0.0'),
          accountDataProvider.overrideWithValue(data ?? FakeAccountData()),
          themeStorageProvider.overrideWithValue(storage),
          if (opener != null) linkOpenerProvider.overrideWithValue(opener),
        ],
        child: Consumer(
          builder: (context, ref, _) => MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ref.watch(themeModeProvider),
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const AccountScreen(
              syncStatus: Text('sync status'),
              studySettings: [
                Padding(
                  padding: EdgeInsets.all(AppSpace.s16),
                  child: Text('study setting'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  /// Taps [text] and lets a dialog open over the sign-out progress
  /// indicator, which never settles.
  Future<void> tapAndOpen(WidgetTester tester, String text) async {
    await tester.tap(shownText(text));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));
  }

  Future<void> tapAndSettle(WidgetTester tester, String text) async {
    await tester.tap(shownText(text));
    await tester.pumpAndSettle();
  }

  testWidgets('a restored session opens signed in', (tester) async {
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'grace@example.com'),
      ),
    );

    expect(find.text('grace@example.com'), findsOneWidget);
  });

  testWidgets(
    'titled 설정, the account section comes first with the email over the sync status and sign-out, then 학습, 화면 and, last, the deletion, in Korean',
    (tester) async {
      await pumpScreen(
        tester,
        FakeAccountService(
          const SignedIn(userId: _ada, email: 'grace@example.com'),
        ),
        locale: const Locale('ko'),
      );

      expect(
        find.descendant(of: find.byType(AppBar), matching: find.text('설정')),
        findsOneWidget,
      );
      double top(Finder finder) => tester.getRect(finder).top;
      final account = find.text('계정');
      final email = find.text('grace@example.com');
      final signOut = find.text('로그아웃');
      final order = [
        account,
        email,
        find.text('sync status'),
        signOut,
        find.text('학습'),
        find.text('study setting'),
        find.text('화면'),
        find.text('테마'),
        find.text('계정 삭제'),
      ];
      for (final (index, finder) in order.indexed.skip(1)) {
        expect(
          top(order[index - 1]),
          lessThan(top(finder)),
          reason: '${order[index - 1]} above $finder',
        );
      }
      for (final label in ['계정', '학습', '화면']) {
        expect(
          tester.getSemantics(find.text(label)).flagsCollection.isHeader,
          isTrue,
          reason: label,
        );
      }
      // The email and sign-out are one group; the deletion is a group alone.
      Finder groupOf(Finder finder) =>
          find.ancestor(of: finder, matching: find.byType(AppGroup));
      expect(
        tester.widget(groupOf(email)),
        same(tester.widget(groupOf(signOut))),
      );
      expect(
        tester.widget(groupOf(find.text('계정 삭제'))),
        isNot(same(tester.widget(groupOf(signOut)))),
      );
      // Sign-out and deletion are their words alone.
      for (final row in ['로그아웃', '계정 삭제']) {
        expect(find.widgetWithText(AppListRow, row), findsOneWidget);
        expect(
          find.descendant(
            of: find.widgetWithText(AppListRow, row),
            matching: find.byType(Icon),
          ),
          findsNothing,
          reason: row,
        );
      }
    },
  );

  testWidgets('signing out returns to the signed-out state', (tester) async {
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      ),
    );

    await tapAndSettle(tester, 'Sign out');

    expect(find.text('ada@example.com'), findsNothing);
  });

  testWidgets('signing out pushes, then clears the device\'s data', (
    tester,
  ) async {
    final data = FakeAccountData();
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      ),
      data: data,
    );

    await tapAndSettle(tester, 'Sign out');

    expect([data.pushes, data.clears], [1, 1]);
    expect(shownText('Sign out without syncing?'), findsNothing);
    expect(find.text('ada@example.com'), findsNothing);
  });

  testWidgets(
    'unsynced changes warn before signing out, in Korean, and cancelling keeps the account and its data',
    (tester) async {
      final data = FakeAccountData()..pushSucceeds = false;
      final service = FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      );
      await pumpScreen(tester, service, data: data, locale: const Locale('ko'));

      await tapAndOpen(tester, '로그아웃');

      expect(shownText('동기화하지 않고 로그아웃할까요?'), findsOneWidget);
      await tapAndSettle(tester, '취소');
      expect(service.state, isA<SignedIn>());
      expect(data.clears, 0);
      expect(find.text('ada@example.com'), findsOneWidget);
    },
  );

  testWidgets('signing out anyway signs out and clears the device\'s data', (
    tester,
  ) async {
    final data = FakeAccountData()..pushSucceeds = false;
    final service = FakeAccountService(
      const SignedIn(userId: _ada, email: 'ada@example.com'),
    );
    await pumpScreen(tester, service, data: data);

    await tapAndOpen(tester, 'Sign out');
    await tapAndSettle(tester, 'Sign out anyway');

    expect(service.state, isA<SignedOut>());
    expect(data.clears, 1);
  });

  for (final mode in ['light', 'dark']) {
    testWidgets(
      'in the $mode theme the screen and the unsynced warning meet the tap target and contrast guidelines',
      (tester) async {
        Future<void> meetsGuidelines() async {
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
        }

        await pumpScreen(
          tester,
          FakeAccountService(
            const SignedIn(userId: _ada, email: 'ada@example.com'),
          ),
          data: FakeAccountData()..pushSucceeds = false,
          themeMode: mode,
        );
        expect(
          Theme.of(tester.element(find.text('Display'))).brightness.name,
          mode,
        );
        await meetsGuidelines();

        await tapAndOpen(tester, 'Sign out');
        expect(shownText('Sign out without syncing?'), findsOneWidget);
        await meetsGuidelines();
      },
    );
  }

  testWidgets('data that cannot be cleared is reported after signing out', (
    tester,
  ) async {
    final data = FakeAccountData()
      ..clearFailure = const AccountDataNotCleared(FormatException('disk'));
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      ),
      data: data,
    );

    await tapAndSettle(tester, 'Sign out');

    expect(
      find.text(
        "Couldn't delete this device's data. It's deleted when another account signs in.",
      ),
      findsOneWidget,
    );
    expect(find.text('ada@example.com'), findsNothing);
  });

  group('deleting the account', () {
    FakeAccountService signedIn() => FakeAccountService(
      const SignedIn(userId: _ada, email: 'ada@example.com'),
    );

    testWidgets(
      'is a red row below the theme with no second line, its consequence said by the confirmation alone, in Korean',
      (tester) async {
        final semantics = tester.ensureSemantics();
        await pumpScreen(tester, signedIn(), locale: const Locale('ko'));

        final row = find.text('계정 삭제');
        expect(
          tester.getRect(find.text('테마')).top,
          lessThan(tester.getRect(row).top),
        );
        expect(
          tester.widget<Text>(row).style?.color,
          AppColors.light.dontKnowText,
        );
        expect(
          tester.getSemantics(row),
          isSemantics(label: '계정 삭제', hasTapAction: true),
        );
        // The control: sign-out is drawn in ink, not red.
        expect(
          tester.widget<Text>(find.text('로그아웃')).style?.color,
          isNot(AppColors.light.dontKnowText),
        );
        semantics.dispose();
      },
    );

    testWidgets(
      'asks first, saying what goes and what stays, with cancel above a red delete, in Korean',
      (tester) async {
        await pumpScreen(tester, signedIn(), locale: const Locale('ko'));

        await tapAndSettle(tester, '계정 삭제');

        expect(shownText('계정을 삭제할까요?'), findsOneWidget);
        expect(
          shownText(
            '서버와 이 기기의 노트, 카드, 학습 기록이 모두 삭제되고, 다른 사람이 가져간 노트와 Google 계정은 남아요.',
          ),
          findsOneWidget,
        );
        final cancel = widgetWithShownText(AppButton, '취소');
        final delete = widgetWithShownText(AppButton, '삭제');
        expect(
          tester.getRect(cancel).bottom,
          lessThanOrEqualTo(tester.getRect(delete).top),
        );
        expect(
          tester.widget<AppButton>(delete).variant,
          AppButtonVariant.destructiveFinal,
        );
      },
    );

    testWidgets('cancelling keeps the account and its data', (tester) async {
      final service = signedIn();
      final data = FakeAccountData();
      await pumpScreen(tester, service, data: data);

      await tapAndSettle(tester, 'Delete account');
      await tapAndSettle(tester, 'Cancel');

      expect(service.deletions, 0);
      expect(service.state, isA<SignedIn>());
      expect([data.pushes, data.clears], [0, 0]);
      expect(find.text('ada@example.com'), findsOneWidget);
    });

    testWidgets(
      'deleting signs out and clears the device\'s data without pushing first',
      (tester) async {
        final service = signedIn();
        final data = FakeAccountData();
        await pumpScreen(tester, service, data: data);

        await tapAndSettle(tester, 'Delete account');
        await tapAndSettle(tester, 'Delete');

        expect(service.deletions, 1);
        expect(service.state, isA<SignedOut>());
        expect([data.pushes, data.clears], [0, 1]);
        expect(find.byType(SnackBar), findsNothing);
      },
    );

    for (final (failure, message) in [
      (
        const AccountOffline(FormatException('offline')),
        "Couldn't reach the server. Check your internet connection.",
      ),
      (
        const AccountRejected(FormatException('401')),
        "Couldn't delete your account. Try again.",
      ),
    ]) {
      testWidgets(
        'a deletion failing as ${failure.runtimeType} says so and keeps the account and its data',
        (tester) async {
          final service = signedIn()..deletionFailure = failure;
          final data = FakeAccountData();
          await pumpScreen(tester, service, data: data);

          await tapAndSettle(tester, 'Delete account');
          await tapAndSettle(tester, 'Delete');

          expect(find.text(message), findsOneWidget);
          expect(service.state, isA<SignedIn>());
          expect(data.clears, 0);
          expect(find.text('ada@example.com'), findsOneWidget);
        },
      );
    }

    testWidgets('data that cannot be cleared after deleting is reported', (
      tester,
    ) async {
      final service = signedIn();
      final data = FakeAccountData()
        ..clearFailure = const AccountDataNotCleared(FormatException('disk'));
      await pumpScreen(tester, service, data: data);

      await tapAndSettle(tester, 'Delete account');
      await tapAndSettle(tester, 'Delete');

      expect(service.deletions, 1);
      expect(
        find.text(
          "Couldn't delete this device's data. It's deleted when another account signs in.",
        ),
        findsOneWidget,
      );
    });

    for (final mode in ['light', 'dark']) {
      testWidgets(
        'in the $mode theme the row and the confirmation meet the tap target and contrast guidelines',
        (tester) async {
          await pumpScreen(tester, signedIn(), themeMode: mode);
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);

          await tapAndSettle(tester, 'Delete account');
          expect(shownText('Delete your account?'), findsOneWidget);
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
        },
      );
    }
  });

  testWidgets('the sync status shows only while signed in', (tester) async {
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      ),
    );
    expect(find.text('sync status'), findsOneWidget);

    await tapAndSettle(tester, 'Sign out');

    expect(find.text('sync status'), findsNothing);
  });

  testWidgets(
    'an offline sign-out signs out and reports the server out of reach',
    (tester) async {
      await pumpScreen(
        tester,
        FakeAccountService(
          const SignedIn(userId: _ada, email: 'ada@example.com'),
        )..failure = const AccountOffline(FormatException('offline')),
      );

      await tapAndSettle(tester, 'Sign out');

      expect(
        find.text("Couldn't reach the server. Check your internet connection."),
        findsOneWidget,
      );
      expect(find.text('ada@example.com'), findsNothing);
    },
  );

  testWidgets('tap targets carry labels', (tester) async {
    await pumpScreen(
      tester,
      FakeAccountService(
        const SignedIn(userId: _ada, email: 'ada@example.com'),
      ),
    );

    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  });

  testWidgets(
    'the display section\'s 테마 row shows the choice and opens a sheet of system, light and dark, in Korean, applying a choice at once',
    (tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.light;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);
      await pumpScreen(
        tester,
        FakeAccountService(
          const SignedIn(userId: _ada, email: 'ada@example.com'),
        ),
        locale: const Locale('ko'),
      );
      Brightness brightness() =>
          Theme.of(tester.element(find.text('화면'))).brightness;
      Finder row(String choice) => find.widgetWithText(AppListRow, choice);
      expect(find.byType(SegmentedButton<ThemeMode>), findsNothing);
      expect(
        find.descendant(of: row('테마'), matching: find.text('시스템')),
        findsOneWidget,
      );
      expect(brightness(), Brightness.light);

      await tapAndSettle(tester, '테마');
      final sheet = find.byType(AppSheet);
      expect(
        find.descendant(of: sheet, matching: shownText('테마')),
        findsOneWidget,
      );
      for (final choice in ['시스템', '라이트', '다크']) {
        expect(
          find.descendant(of: sheet, matching: find.text(choice)),
          findsOneWidget,
          reason: choice,
        );
      }
      expect(
        tester.getSemantics(row('시스템').last),
        isSemantics(label: '시스템', isSelected: true, hasSelectedState: true),
      );
      await tester.tap(find.descendant(of: sheet, matching: find.text('다크')));
      await tester.pumpAndSettle();

      expect(find.byType(AppSheet), findsNothing);
      expect(brightness(), Brightness.dark);
      expect(
        find.descendant(of: row('테마'), matching: find.text('다크')),
        findsOneWidget,
      );

      // Control: dismissing the sheet keeps the choice.
      await tapAndSettle(tester, '테마');
      await tester.tapAt(const Offset(195, 40));
      await tester.pumpAndSettle();
      expect(find.byType(AppSheet), findsNothing);
      expect(brightness(), Brightness.dark);
      await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
    },
  );

  testWidgets(
    'the foot is one centred line of the version and the legal links, below the deletion, with no mascot or avatar',
    (tester) async {
      await pumpScreen(
        tester,
        FakeAccountService(
          const SignedIn(userId: _ada, email: 'grace@example.com'),
        ),
      );

      // The foot is below the rows the screen builds first.
      await tester.scrollUntilVisible(
        find.text('Version 1.0.0'),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      final version = tester.getRect(find.text('Version 1.0.0'));
      for (final link in ['Terms of Service', 'Privacy Policy']) {
        expect(
          tester.getCenter(find.text(link)).dy,
          moreOrLessEquals(version.center.dy, epsilon: 1),
          reason: '$link on the version\'s line',
        );
      }
      // The line's ends: the version's padding and the last link's button.
      final line = tester
          .getRect(
            find
                .ancestor(
                  of: find.text('Version 1.0.0'),
                  matching: find.byType(Padding),
                )
                .first,
          )
          .expandToInclude(
            tester.getRect(
              find.ancestor(
                of: find.text('Privacy Policy'),
                matching: find.byType(TextButton),
              ),
            ),
          );
      expect(
        line.center.dx,
        moreOrLessEquals(
          tester.getCenter(find.byType(ListView)).dx,
          epsilon: 1,
        ),
      );
      expect(
        version.top,
        greaterThan(tester.getBottomLeft(find.text('Delete account')).dy),
      );
      // The mascot was the screen's one image.
      expect(find.byType(Image), findsNothing);
    },
  );

  testWidgets(
    "the foot's links open the terms and the privacy policy on the web outside the app",
    (tester) async {
      final opened = <Uri>[];
      await pumpScreen(
        tester,
        FakeAccountService(
          const SignedIn(userId: _ada, email: 'grace@example.com'),
        ),
        opener: (uri) async {
          opened.add(uri);
          return true;
        },
      );

      // The foot is below the rows the screen builds first.
      await tester.scrollUntilVisible(
        find.text('Terms of Service'),
        100,
        scrollable: find.byType(Scrollable).first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Terms of Service'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Privacy Policy'));
      await tester.pumpAndSettle();

      expect(opened, [
        Uri.parse('https://knowno.app/terms'),
        Uri.parse('https://knowno.app/privacy'),
      ]);
      expect(find.byType(SnackBar), findsNothing);
    },
  );
}
