import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/google_button.dart';
import 'package:knowno/account/src/legal.dart';
import 'package:knowno/account/src/sign_in_screen.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

import '../contrast.dart';
import 'fake_account_service.dart';
import '../word_breaks.dart';

/// The stacked logo, read as the app's name.
final _logo = find.bySemanticsLabel('knowno');

void main() {
  Future<void> pumpScreen(
    WidgetTester tester,
    AccountService service, {
    Locale locale = const Locale('en'),
    ThemeMode themeMode = ThemeMode.light,
    LinkOpener? opener,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          accountServiceProvider.overrideWithValue(service),
          if (opener != null) linkOpenerProvider.overrideWithValue(opener),
        ],
        child: MaterialApp(
          theme: lightTheme,
          darkTheme: darkTheme,
          themeMode: themeMode,
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const SignInScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapAndSettle(WidgetTester tester, String text) async {
    await tester.tap(shownText(text));
    await tester.pumpAndSettle();
  }

  testWidgets(
    'welcomes with the app name and what it does, and never says it works without an account',
    (tester) async {
      await pumpScreen(tester, FakeAccountService());

      expect(_logo, findsOneWidget);
      expect(
        shownText(
          'Swipe to respond,\nand meet each card again just before you forget',
        ),
        findsOneWidget,
      );
      expect(find.textContaining('without an account'), findsNothing);
      expect(
        find.bySemanticsLabel('knowno'),
        findsOneWidget,
        reason: 'the stacked logo is read as the app name',
      );
      expect(
        tester.getSemantics(_logo).flagsCollection.isHeader,
        isTrue,
        reason: 'the app name is the screen heading',
      );
    },
  );

  for (final (locale, name) in [
    (const Locale('ko'), 'ko'),
    (const Locale('en'), 'en'),
  ]) {
    testWidgets('draws the logo of the $name locale, one name in both themes', (
      tester,
    ) async {
      for (final (mode, ground) in [
        (ThemeMode.light, 'light'),
        (ThemeMode.dark, 'dark'),
      ]) {
        await pumpScreen(
          tester,
          FakeAccountService(),
          locale: locale,
          themeMode: mode,
        );

        final logo = find.byWidgetPredicate(
          (widget) =>
              widget is Image &&
              widget.image is AssetImage &&
              (widget.image as AssetImage).assetName.contains('stacked'),
        );
        expect(
          ((tester.widget<Image>(logo)).image as AssetImage).assetName,
          'assets/brand/knowno-stacked-$name-$ground.png',
        );
        expect(
          find.bySemanticsLabel(name == 'ko' ? '알아몰라' : 'knowno'),
          findsOneWidget,
          reason: 'the logo is read as the one name it shows',
        );
      }
    });
  }

  testWidgets('draws knowno for a locale other than Korean', (tester) async {
    await pumpScreen(
      tester,
      FakeAccountService(),
      locale: const Locale('en', 'GB'),
    );

    expect(
      find.image(const AssetImage('assets/brand/knowno-stacked-en-light.png')),
      findsOneWidget,
    );
  });

  testWidgets(
    'shows progress while signing in, then nothing more for a cancelled picker',
    (tester) async {
      final pending = Completer<void>();
      final service = FakeAccountService()
        ..cancelSignIn = true
        ..pendingSignIn = pending;
      await pumpScreen(tester, service);

      await tester.tap(shownText('Continue with Google'));
      await tester.pump();
      expect(find.bySemanticsLabel('Signing in'), findsOneWidget);
      expect(shownText('Continue with Google'), findsNothing);
      pending.complete();
      await tester.pumpAndSettle();

      expect(find.bySemanticsLabel('Signing in'), findsNothing);
      expect(shownText('Continue with Google'), findsOneWidget);
      expect(find.byType(SnackBar), findsNothing);
    },
  );

  final failures = <String, AccountFailure>{
    "Couldn't reach the server. Check your internet connection.":
        const AccountOffline(FormatException('offline')),
    "Sign-in isn't set up correctly in this app, so you can't sign in.":
        const AccountMisconfigured(FormatException('bad client')),
    'Sign-in was refused. Please try again.': const AccountRejected(
      FormatException('refused'),
    ),
  };
  for (final MapEntry(key: message, value: failure) in failures.entries) {
    testWidgets('${failure.runtimeType} on sign-in is shown as "$message"', (
      tester,
    ) async {
      await pumpScreen(tester, FakeAccountService()..failure = failure);

      await tapAndSettle(tester, 'Continue with Google');

      expect(shownText(message), findsOneWidget);
      expect(shownText('Continue with Google'), findsOneWidget);
    });
  }

  group('on iOS', () {
    final iOS = TargetPlatformVariant.only(TargetPlatform.iOS);

    final apple = find.byType(SignInWithAppleButton);

    testWidgets(
      "Apple's button sits under Google's, as tall, with Apple's Korean title",
      (tester) async {
        await pumpScreen(
          tester,
          FakeAccountService(),
          locale: const Locale('ko'),
        );

        expect(
          find.descendant(of: apple, matching: find.text('Apple로 계속하기')),
          findsOneWidget,
        );
        final google = tester.getRect(find.byType(GoogleSignInButton));
        final appleRect = tester.getRect(apple);
        expect(appleRect.top, greaterThan(google.bottom));
        expect(appleRect.height, google.height);
        expect(appleRect.width, google.width);
      },
      variant: iOS,
    );

    for (final (mode, style) in [
      (ThemeMode.light, SignInWithAppleButtonStyle.black),
      (ThemeMode.dark, SignInWithAppleButtonStyle.white),
    ]) {
      testWidgets(
        "in the ${mode.name} theme Apple's button is ${style.name}, and the screen meets the tap target and contrast guidelines",
        (tester) async {
          await pumpScreen(tester, FakeAccountService(), themeMode: mode);

          expect(tester.widget<SignInWithAppleButton>(apple).style, style);
          expect(
            tester.getSemantics(find.text('Continue with Apple')),
            matchesSemantics(
              label: 'Continue with Apple',
              isButton: true,
              hasTapAction: true,
              isFocusable: true,
            ),
          );
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        },
        variant: iOS,
      );
    }

    testWidgets("Apple's title keeps its size at the largest text", (
      tester,
    ) async {
      tester.platformDispatcher.textScaleFactorTestValue = 3.12;
      addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
      await pumpScreen(tester, FakeAccountService());

      final title = find.descendant(
        of: apple,
        matching: find.text('Continue with Apple'),
      );
      expect(
        tester.getSize(title).height,
        lessThan(tester.getSize(apple).height),
      );
      expect(tester.takeException(), isNull);
    }, variant: iOS);

    testWidgets('signs in with Apple, not Google', (tester) async {
      final service = FakeAccountService();
      await pumpScreen(tester, service);

      await tapAndSettle(tester, 'Continue with Apple');

      expect(service.state, isA<SignedIn>());
      expect(service.appleSignIns, 1);
      expect(service.googleSignIns, 0);
    }, variant: iOS);

    testWidgets(
      'shows progress while signing in with Apple, then nothing more for a cancelled sheet',
      (tester) async {
        final pending = Completer<void>();
        final service = FakeAccountService()
          ..cancelSignIn = true
          ..pendingSignIn = pending;
        await pumpScreen(tester, service);

        await tester.tap(find.text('Continue with Apple'));
        await tester.pump();
        expect(find.bySemanticsLabel('Signing in'), findsOneWidget);
        expect(apple, findsNothing);
        pending.complete();
        await tester.pumpAndSettle();

        expect(service.appleSignIns, 1);
        expect(service.state, isA<SignedOut>());
        expect(find.bySemanticsLabel('Signing in'), findsNothing);
        expect(apple, findsOneWidget);
        expect(find.byType(SnackBar), findsNothing);
      },
      variant: iOS,
    );

    for (final MapEntry(key: message, value: failure) in failures.entries) {
      testWidgets(
        '${failure.runtimeType} on Apple sign-in is shown as "$message"',
        (tester) async {
          final service = FakeAccountService()..failure = failure;
          await pumpScreen(tester, service);

          await tapAndSettle(tester, 'Continue with Apple');

          expect(service.appleSignIns, 1);
          expect(find.text(message), findsOneWidget);
          expect(apple, findsOneWidget);
        },
        variant: iOS,
      );
    }
  });

  testWidgets('offers no Apple button off iOS, where there is no Apple sheet', (
    tester,
  ) async {
    await pumpScreen(tester, FakeAccountService());

    expect(find.byType(GoogleSignInButton), findsOneWidget);
    expect(find.byType(SignInWithAppleButton), findsNothing);
    expect(find.textContaining('Apple'), findsNothing);
  });

  for (final (mode, style) in [
    (ThemeMode.light, GoogleButtonStyle.light),
    (ThemeMode.dark, GoogleButtonStyle.dark),
  ]) {
    testWidgets(
      "in the ${mode.name} theme the Google button is Google's ${mode.name} button, with the G mark and the label, and the screen meets the tap target and contrast guidelines",
      (tester) async {
        final service = FakeAccountService();
        await pumpScreen(tester, service, themeMode: mode);

        final button = find.byType(GoogleSignInButton);
        final mark = find.descendant(
          of: button,
          matching: find.byWidgetPredicate(
            (widget) =>
                widget is Image &&
                widget.image == AssetImage(style.mark) &&
                widget.width == GoogleButtonStyle.markSize,
          ),
        );
        expect(mark, findsOneWidget);
        expect(
          find.descendant(
            of: button,
            matching: shownText('Continue with Google'),
          ),
          findsOneWidget,
        );
        // The mark sits before the label.
        expect(
          tester.getRect(mark).right,
          lessThan(tester.getRect(shownText('Continue with Google')).left),
        );
        final surface = tester.widget<Material>(
          find.descendant(of: button, matching: find.byType(Material)).first,
        );
        expect(surface.color, style.fill);
        expect(
          (surface.shape! as RoundedRectangleBorder).side.color,
          style.stroke,
        );
        expect(tester.getSemantics(button).flagsCollection.isButton, isTrue);
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
        expectScreenTextReadable(tester);

        await tester.tap(button);
        await tester.pumpAndSettle();
        expect(service.state, isA<SignedIn>());
      },
    );
  }

  testWidgets('the logo sits in the upper part and the buttons at the bottom', (
    tester,
  ) async {
    await pumpScreen(tester, FakeAccountService());
    final screen = tester.getSize(find.byType(Scaffold));

    final wordmark = tester.getCenter(_logo);
    expect(wordmark.dy, greaterThan(screen.height / 6));
    expect(wordmark.dy, lessThan(screen.height / 2));
    expect(
      tester.getRect(find.byType(GoogleSignInButton)).top,
      greaterThan(screen.height / 2),
    );
  });

  testWidgets('tap targets carry labels', (tester) async {
    await pumpScreen(tester, FakeAccountService());

    await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
  });

  testWidgets(
    'the terms the user agrees to are named under the buttons, and each link opens its document on the web outside the app',
    (tester) async {
      final opened = <Uri>[];
      await pumpScreen(
        tester,
        FakeAccountService(),
        opener: (uri) async {
          opened.add(uri);
          return true;
        },
      );

      expect(
        shownText(
          'By continuing, you agree to the Terms of Service and the Privacy Policy.',
        ),
        findsOneWidget,
      );
      await tapAndSettle(tester, 'Terms of Service');
      await tapAndSettle(tester, 'Privacy Policy');

      expect(opened, [
        Uri.parse('https://knowno.app/terms'),
        Uri.parse('https://knowno.app/privacy'),
      ]);
      // An opened link says nothing and leaves the screen.
      expect(find.byType(SnackBar), findsNothing);
      expect(find.byType(SignInScreen), findsOneWidget);
    },
  );

  testWidgets('a link that does not open says so', (tester) async {
    final opened = <Uri>[];
    await pumpScreen(
      tester,
      FakeAccountService(),
      opener: (uri) async {
        opened.add(uri);
        return false;
      },
    );

    await tapAndSettle(tester, 'Privacy Policy');
    expect(opened, [Uri.parse('https://knowno.app/privacy')]);
    expect(
      shownText("Couldn't open the link. Please try again."),
      findsOneWidget,
    );
  });
}
