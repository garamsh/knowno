import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/legal.dart';
import 'package:knowno/account/src/plan.dart';
import 'package:knowno/account/src/plan_controller.dart';
import 'package:knowno/account/src/plus_sheet.dart';
import 'package:knowno/account/src/purchase_store.dart';
import 'package:knowno/design/app_list_row.dart';
import 'package:knowno/design/app_sheet.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/design/theme_choice.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:shared_preferences_platform_interface/in_memory_shared_preferences_async.dart';
import 'package:shared_preferences_platform_interface/shared_preferences_async_platform_interface.dart';

import '../contrast.dart';
import '../word_breaks.dart';
import 'fake_account_data.dart';
import 'fake_account_service.dart';
import 'fake_plan.dart';

const _ada = UserId('00000000-0000-4000-8000-00000000000a');

const _free = PlanStanding(
  plan: Plan.free,
  source: PlanSource.none,
  photosUsed: 2,
  photoLimit: 5,
);

final _plus = PlanStanding(
  plan: Plan.plus,
  source: PlanSource.store,
  renewsOn: DateTime(2026, 12, 10),
  photosUsed: 12,
  photoLimit: 100,
);

const _mcpServer = 'https://api.knowno.app/functions/v1/mcp';

const _admin = PlanStanding(plan: Plan.pro, source: PlanSource.admin);
const _unlimited = PlanStanding(plan: Plan.free, source: PlanSource.unlimited);

void main() {
  late FakeAccountService service;
  late FakePlanServer plans;
  late FakePurchaseStore store;
  late List<Uri> opened;

  Future<void> pumpScreen(
    WidgetTester tester, {
    PlanStanding? standing = _free,
    Locale locale = const Locale('en'),
    String? themeMode,
  }) async {
    tester.view.physicalSize = const Size(800, 3200);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    SharedPreferencesAsyncPlatform.instance =
        InMemorySharedPreferencesAsync.withData({'themeMode': ?themeMode});
    final storage = (await tester.runAsync(
      () => SharedPreferencesWithCache.create(
        cacheOptions: const SharedPreferencesWithCacheOptions(
          allowList: themeStorageKeys,
        ),
      ),
    ))!;
    service = FakeAccountService(
      const SignedIn(userId: _ada, email: 'ada@example.com'),
    );
    plans = FakePlanServer(standing);
    store = FakePurchaseStore();
    opened = [];
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accountServiceProvider.overrideWithValue(service),
          appVersionProvider.overrideWithValue('1.0.0'),
          accountDataProvider.overrideWithValue(FakeAccountData()),
          planServerProvider.overrideWithValue(plans),
          purchaseStoreProvider.overrideWithValue(store),
          themeStorageProvider.overrideWithValue(storage),
          linkOpenerProvider.overrideWithValue((uri) async {
            opened.add(uri);
            return true;
          }),
        ],
        child: Consumer(
          builder: (context, ref, _) => MaterialApp(
            theme: lightTheme,
            darkTheme: darkTheme,
            themeMode: ref.watch(themeModeProvider),
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            // The gate keeps the plan alive from sign-in on.
            home: Consumer(
              builder: (context, ref, _) {
                ref.listen(planProvider, (_, _) {});
                return const AccountScreen(
                  syncStatus: Text('sync status'),
                  studySettings: [AppListRow(title: 'study setting')],
                );
              },
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
    await tester.tap(finder);
    await tester.pumpAndSettle();
  }

  Finder lock() => find.byIcon(LucideIcons.lock);

  testWidgets(
    'on the free plan 내 플랜 comes first with the plan, the photos used of the limit and 플러스 알아보기, in Korean',
    (tester) async {
      await pumpScreen(tester, locale: const Locale('ko'));

      double top(Finder finder) => tester.getRect(finder).top;
      final order = [
        shownText('내 플랜'),
        shownText('무료'),
        shownText('사진 2/5장 사용'),
        shownText('플러스 알아보기'),
        shownText('계정'),
        shownText('학습'),
        shownText('AI 연결'),
        shownText('화면'),
      ];
      for (final (index, finder) in order.indexed.skip(1)) {
        expect(finder, findsOneWidget);
        expect(top(order[index - 1]), lessThan(top(finder)));
      }
      expect(shownText('구독 관리'), findsNothing);
      expect(shownText('구매 복원'), findsNothing);
      expect(plans.reads, [_ada], reason: 'asked for the signed-in user');
      expect(store.signedInAs, [_ada], reason: 'the app user id is theirs');
    },
  );

  testWidgets(
    'a paid plan shows the plan and its next renewal with 구독 관리 and 구매 복원, and offers nothing to buy',
    (tester) async {
      await pumpScreen(tester, standing: _plus);

      expect(shownText('Plus'), findsOneWidget);
      expect(shownText('Renews 12/10/2026'), findsOneWidget);
      expect(shownText('Manage subscription'), findsOneWidget);
      expect(shownText('Restore purchases'), findsOneWidget);
      expect(shownText('Learn about Plus'), findsNothing);
      expect(lock(), findsNothing);
    },
  );

  test('the plan is named 무료, 플러스 and 프로', () {
    final names = <Plan, String>{};
    final l10n = lookupAppLocalizations(const Locale('ko'));
    for (final plan in Plan.values) {
      names[plan] = switch (plan) {
        Plan.free => l10n.planFree,
        Plan.plus => l10n.planPlus,
        Plan.pro => l10n.planPro,
      };
    }
    expect(names.values, ['무료', '플러스', '프로']);
  });

  testWidgets('구독 관리 opens the store page, and says so when none opens', (
    tester,
  ) async {
    await pumpScreen(tester, standing: _plus);

    await tapAndSettle(tester, shownText('Manage subscription'));
    expect(opened, [store.management]);
    expect(
      shownText("Couldn't open the link. Please try again."),
      findsNothing,
    );

    store.management = null;
    await tapAndSettle(tester, shownText('Manage subscription'));
    expect(opened, hasLength(1));
    expect(
      shownText("Couldn't open the link. Please try again."),
      findsOneWidget,
    );
  });

  testWidgets(
    '구매 복원 asks the store, reads the plan again and says it restored; a failed restore says so and reads nothing',
    (tester) async {
      await pumpScreen(tester, standing: _plus);

      await tapAndSettle(tester, shownText('Restore purchases'));
      expect(store.restores, 1);
      expect(plans.reads, hasLength(2), reason: 'refreshed after a restore');
      expect(shownText('Purchases restored'), findsOneWidget);

      store.restoreOutcome = RestoreOutcome.failed;
      await tester.pump(const Duration(seconds: 5));
      await tapAndSettle(tester, shownText('Restore purchases'));
      expect(store.restores, 2);
      expect(plans.reads, hasLength(2));
      expect(
        shownText("Couldn't restore purchases. Please try again."),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'buying shows the package at the store price, buys it, refreshes the plan and closes on 플러스',
    (tester) async {
      await pumpScreen(tester);
      store.onBought = () => plans.standing = _plus;

      await tapAndSettle(tester, shownText('Learn about Plus'));
      expect(find.byType(AppSheet), findsOneWidget);
      expect(shownText('₩4,900'), findsOneWidget);

      await tapAndSettle(tester, shownText('Start Plus'));

      expect(store.bought.single.id, r'$rc_monthly');
      expect(plans.reads, hasLength(2), reason: 'refreshed after the purchase');
      expect(find.byType(AppSheet), findsNothing);
      expect(shownText('Plus started'), findsOneWidget);
      expect(shownText('Renews 12/10/2026'), findsOneWidget);
      expect(shownText('Learn about Plus'), findsNothing);
      expect(lock(), findsNothing, reason: 'AI 연결 opened with the plan');
    },
  );

  testWidgets(
    'a purchase the server does not show yet says it may take a moment, and the plan stays as it was',
    (tester) async {
      await pumpScreen(tester);

      await tapAndSettle(tester, shownText('Learn about Plus'));
      await tapAndSettle(tester, shownText('Start Plus'));

      expect(
        shownText('Payment complete. Your plan may take a moment to update.'),
        findsOneWidget,
      );
      expect(shownText('Free'), findsOneWidget);
    },
  );

  testWidgets(
    'cancelling keeps the sheet and says nothing; a payment on hold and a failure say so and keep the sheet and its button',
    (tester) async {
      await pumpScreen(tester);
      await tapAndSettle(tester, shownText('Learn about Plus'));

      store.purchase = const PurchaseCancelled();
      await tapAndSettle(tester, shownText('Start Plus'));
      expect(find.byType(AppSheet), findsOneWidget);
      expect(shownText('Start Plus'), findsOneWidget);
      expect(shownText('Plus started'), findsNothing);
      expect(
        shownText("Couldn't complete the payment. Please try again."),
        findsNothing,
      );

      store.purchase = const PurchasePending();
      await tapAndSettle(tester, shownText('Start Plus'));
      expect(
        shownText(
          'Waiting for the payment to be approved. Your plan changes when it is.',
        ),
        findsOneWidget,
      );
      expect(shownText('Start Plus'), findsOneWidget);

      store.purchase = const PurchaseFailed();
      await tapAndSettle(tester, shownText('Start Plus'));
      expect(
        shownText("Couldn't complete the payment. Please try again."),
        findsOneWidget,
      );
      expect(shownText('Start Plus'), findsOneWidget);
      expect(plans.reads, hasLength(1), reason: 'nothing bought, nothing read');
      expect(store.bought, hasLength(3));
    },
  );

  testWidgets(
    'with no store key the sheet says purchases are not ready and sells nothing',
    (tester) async {
      await pumpScreen(tester);
      store.ready = false;

      await tapAndSettle(tester, shownText('Learn about Plus'));

      expect(
        shownText("Purchases aren't ready yet. Please check back soon."),
        findsOneWidget,
      );
      expect(shownText('Start Plus'), findsNothing);
      expect(store.offers, 0);
    },
  );

  testWidgets('a store with no package to sell says it cannot be bought now', (
    tester,
  ) async {
    await pumpScreen(tester);
    store.package = null;

    await tapAndSettle(tester, shownText('Learn about Plus'));

    expect(
      shownText("You can't buy right now. Please try again in a moment."),
      findsOneWidget,
    );
    expect(shownText('Start Plus'), findsNothing);
  });

  for (final (name, standing) in [
    ('an admin', _admin),
    ('a 무제한 holder', _unlimited),
  ]) {
    testWidgets(
      '$name is never offered a purchase and never locked, and the sheet cannot be opened',
      (tester) async {
        await pumpScreen(tester, standing: standing);

        expect(shownText('Learn about Plus'), findsNothing);
        expect(shownText('Manage subscription'), findsNothing);
        expect(shownText('Restore purchases'), findsNothing);
        expect(lock(), findsNothing);
        expect(shownText(_mcpServer), findsOneWidget);
        await tapAndSettle(tester, shownText('Claude'));
        expect(find.byType(AppSheet), findsNothing);
        expect(
          ProviderScope.containerOf(tester.element(find.byType(AccountScreen)))
              .read(purchaseOfferProvider),
          isNull,
        );
      },
    );
  }

  testWidgets(
    'on the free plan AI 연결 is locked and each row opens the purchase sheet, the address withheld',
    (tester) async {
      await pumpScreen(tester);

      expect(shownText('AI connection'), findsOneWidget);
      expect(lock(), findsNWidgets(3));
      expect(shownText(_mcpServer), findsNothing);
      expect(shownText('Available with Plus'), findsOneWidget);
      for (final row in ['Claude', 'ChatGPT', 'Server address']) {
        await tapAndSettle(tester, shownText(row));
        expect(find.byType(PlusSheet), findsOneWidget, reason: row);
        await tester.tapAt(const Offset(10, 10));
        await tester.pumpAndSettle();
        expect(find.byType(PlusSheet), findsNothing, reason: row);
      }
    },
  );

  testWidgets(
    'for a paid user AI 연결 is open, with the address, how to add Claude and ChatGPT and what a connection may do, and no tap opens the sheet',
    (tester) async {
      await pumpScreen(tester, standing: _plus);

      expect(shownText('AI connection'), findsOneWidget);
      expect(shownText(_mcpServer), findsOneWidget);
      expect(shownText('Claude'), findsOneWidget);
      expect(shownText('ChatGPT'), findsOneWidget);
      expect(
        shownTextContaining('can read, add, change and delete'),
        findsOneWidget,
      );
      await tapAndSettle(tester, shownText('Claude'));
      expect(find.byType(PlusSheet), findsNothing);

      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tapAndSettle(tester, shownText(_mcpServer));
      expect(copied, _mcpServer);
      expect(shownText('Server address copied'), findsOneWidget);
    },
  );

  testWidgets(
    'a plan the server cannot answer offers nothing and locks nothing, and retrying reads it',
    (tester) async {
      await pumpScreen(tester, standing: null);

      expect(
        shownText("Couldn't load your plan. Tap to try again."),
        findsOneWidget,
      );
      expect(shownText('Learn about Plus'), findsNothing);
      expect(lock(), findsNothing);

      plans.standing = _free;
      await tapAndSettle(
        tester,
        shownText("Couldn't load your plan. Tap to try again."),
      );
      expect(shownText('Free'), findsOneWidget);
      expect(shownText('Learn about Plus'), findsOneWidget);
      expect(lock(), findsNWidgets(3));
    },
  );

  testWidgets('signing out forgets the store customer and reads nothing more', (
    tester,
  ) async {
    await pumpScreen(tester);
    expect(store.signOuts, 0);

    await service.signOut();
    await tester.pumpAndSettle();

    expect(store.signOuts, 1);
    expect(shownText('내 플랜'), findsNothing);
    expect(plans.reads, [_ada]);
  });

  for (final mode in ['light', 'dark']) {
    testWidgets(
      'in the $mode theme the plan card, the locked AI 연결 and the purchase sheet meet the tap target and contrast guidelines',
      (tester) async {
        await pumpScreen(tester, themeMode: mode);
        Future<void> meetsGuidelines() async {
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
          expectScreenTextReadable(tester);
        }

        await meetsGuidelines();
        await tapAndSettle(tester, shownText('Learn about Plus'));
        await meetsGuidelines();
      },
    );

    testWidgets(
      'in the $mode theme a paid plan card meets the tap target and contrast guidelines',
      (tester) async {
        await pumpScreen(tester, standing: _plus, themeMode: mode);

        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);
      },
    );
  }
}
