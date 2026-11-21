import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/apple_button.dart';
import 'package:knowno/account/src/email_button.dart';
import 'package:knowno/account/src/google_button.dart';
import 'package:knowno/account/src/legal.dart';
import 'package:knowno/account/src/sign_in_screen.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../app_fonts.dart';
import '../contrast.dart';
import 'fake_account_service.dart';
import 'fake_apple_button.dart';
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
          appleButtonViewProvider.overrideWithValue(fakeAppleButtonView),
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

      expect(find.text(message), findsOneWidget);
      expect(shownText('Continue with Google'), findsOneWidget);
    });
  }

  group('on iOS', () {
    final iOS = TargetPlatformVariant.only(TargetPlatform.iOS);

    final apple = find.byType(FakeAppleButton);

    testWidgets(
      "the system's Apple button sits between Google's and the email button, each 48 tall and 12 apart on shared edges",
      (tester) async {
        await pumpScreen(tester, FakeAccountService());

        final google = tester.getRect(find.byType(GoogleSignInButton));
        final appleRect = tester.getRect(apple);
        final email = tester.getRect(find.byType(EmailSignInButton));
        for (final rect in [google, appleRect, email]) {
          expect(rect.height, 48);
          expect(rect.left, google.left);
          expect(rect.right, google.right);
        }
        expect(appleRect.top - google.bottom, 12);
        expect(email.top - appleRect.bottom, 12);
      },
      variant: iOS,
    );

    for (final scale in [1.5, 3.12]) {
      testWidgets(
        "at text scale $scale nothing is clipped, the buttons stay on shared edges 12 apart and none is under 48 tall",
        (tester) async {
          tester.platformDispatcher.textScaleFactorTestValue = scale;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          await pumpScreen(tester, FakeAccountService());

          final google = tester.getRect(find.byType(GoogleSignInButton));
          final appleRect = tester.getRect(apple);
          final email = tester.getRect(find.byType(EmailSignInButton));
          for (final rect in [google, appleRect, email]) {
            expect(rect.height, greaterThanOrEqualTo(48));
            expect(rect.left, google.left);
            expect(rect.right, google.right);
          }
          expect(appleRect.height, google.height);
          expect(appleRect.top - google.bottom, 12);
          expect(email.top - appleRect.bottom, 12);
          // The email label's whole paragraph fits its button.
          final label = find.descendant(
            of: find.byType(EmailSignInButton),
            matching: find.byType(RichText),
          );
          expect(
            tester.getSize(label.first).height,
            lessThanOrEqualTo(email.height),
          );
          expect(tester.takeException(), isNull);
        },
        variant: iOS,
      );
    }

    for (final (mode, dark) in [
      (ThemeMode.light, false),
      (ThemeMode.dark, true),
    ]) {
      testWidgets(
        "in the ${mode.name} theme Apple's button is asked for ${dark ? 'white' : 'black'}, and the screen meets the tap target and contrast guidelines",
        (tester) async {
          await pumpScreen(tester, FakeAccountService(), themeMode: mode);

          expect(tester.widget<FakeAppleButton>(apple).dark, dark);
          await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
          await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
          await expectLater(tester, meetsGuideline(textContrastGuideline));
        },
        variant: iOS,
      );
    }

    testWidgets('signs in with Apple, not Google', (tester) async {
      final service = FakeAccountService();
      await pumpScreen(tester, service);

      await tester.tap(apple);
      await tester.pumpAndSettle();

      expect(service.state, isA<SignedIn>());
      expect(service.appleSignIns, 1);
      expect(service.googleSignIns, 0);
    }, variant: iOS);

    testWidgets(
      "shows progress in the buttons' place while signing in with Apple, then nothing more for a cancelled sheet",
      (tester) async {
        final pending = Completer<void>();
        final service = FakeAccountService()
          ..cancelSignIn = true
          ..pendingSignIn = pending;
        await pumpScreen(tester, service);
        final buttons = tester
            .getRect(find.byType(GoogleSignInButton))
            .expandToInclude(tester.getRect(apple))
            .expandToInclude(tester.getRect(find.byType(EmailSignInButton)));

        await tester.tap(apple);
        await tester.pump();
        expect(find.bySemanticsLabel('Signing in'), findsOneWidget);
        expect(apple, findsNothing);
        // Progress holds the buttons' place, so nothing around them moves.
        expect(
          tester.getRect(
            find
                .ancestor(
                  of: find.byType(CircularProgressIndicator),
                  matching: find.byType(SizedBox),
                )
                .first,
          ),
          buttons,
        );
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

          await tester.tap(apple);
          await tester.pumpAndSettle();

          expect(service.appleSignIns, 1);
          expect(find.text(message), findsOneWidget);
          expect(apple, findsOneWidget);
        },
        variant: iOS,
      );
    }
  });

  for (final (mode, colors) in [
    (ThemeMode.light, AppColors.light),
    (ThemeMode.dark, AppColors.dark),
  ]) {
    testWidgets(
      'the email button is Pretendard 16/24 medium in ink with a thin outline on the screen surface in the ${mode.name} theme, as wide as Google\'s and 12 under it off iOS',
      (tester) async {
        await pumpScreen(tester, FakeAccountService(), themeMode: mode);

        final button = find.byType(EmailSignInButton);
        final label = tester.widget<Text>(
          find.descendant(of: button, matching: find.byType(Text)),
        );
        expect(label.style!.fontFamily, appFontFamily);
        expect(label.style!.fontSize, 16);
        expect(label.style!.height, 24 / 16);
        expect(label.style!.fontWeight, FontWeight.w500);
        expect(label.style!.color, colors.ink);
        final surface = tester.widget<Material>(
          find.descendant(of: button, matching: find.byType(Material)).first,
        );
        expect(surface.color, colors.surface);
        final side = (surface.shape! as RoundedRectangleBorder).side;
        expect(side.color, colors.outline);
        expect(side.width, 1);
        final google = tester.getRect(find.byType(GoogleSignInButton));
        final email = tester.getRect(button);
        expect(email.height, 48);
        expect(email.left, google.left);
        expect(email.right, google.right);
        expect(email.top - google.bottom, 12);
      },
    );
  }

  testWidgets('offers no Apple button off iOS, where there is no Apple sheet', (
    tester,
  ) async {
    await pumpScreen(tester, FakeAccountService());

    expect(find.byType(GoogleSignInButton), findsOneWidget);
    expect(find.byType(FakeAppleButton), findsNothing);
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
        // The label is Google Sans Medium, 14 on 20, as the guidelines set
        // it, with the app's font for the Hangul Google Sans lacks.
        final label = tester
            .widget<RichText>(
              find.descendant(of: button, matching: find.byType(RichText)),
            )
            .text
            .style!;
        expect(label.fontFamily, 'GoogleSans');
        expect(label.fontFamilyFallback, [appFontFamily]);
        expect(label.fontWeight, FontWeight.w500);
        expect(label.fontSize, 14);
        expect(label.height, 20 / 14);
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

  group('at the largest text size, in the bundled fonts,', () {
    setUpAll(loadAppFonts);

    for (final width in [320.0, 390.0]) {
      for (final mode in ThemeMode.values.skip(1)) {
        testWidgets(
          "on a ${width.toInt()} wide phone in the ${mode.name} theme Google's Korean label is whole, broken between words, inside a button grown to hold it, with the mark and the padding unchanged",
          (tester) async {
            tester.view.physicalSize = Size(width, 844);
            tester.view.devicePixelRatio = 1;
            addTearDown(tester.view.reset);
            tester.platformDispatcher.textScaleFactorTestValue = 3.12;
            addTearDown(
              tester.platformDispatcher.clearTextScaleFactorTestValue,
            );
            await pumpScreen(
              tester,
              FakeAccountService(),
              locale: const Locale('ko'),
              themeMode: mode,
            );

            const text = 'Google로 계속하기';
            final button = find.byType(GoogleSignInButton);
            final label = find.descendant(
              of: button,
              matching: shownText(text),
            );
            final paragraph = tester.renderObject<RenderParagraph>(
              find.descendant(of: label, matching: find.byType(RichText)),
            );
            // The label laid out at its width with no height to fit.
            final whole = TextPainter(
              text: paragraph.text,
              textDirection: paragraph.textDirection,
              textScaler: paragraph.textScaler,
            )..layout(maxWidth: paragraph.size.width);
            addTearDown(whole.dispose);
            expect(paragraph.size.height, greaterThanOrEqualTo(whole.height));
            expectBreaksBetweenWords(tester, text);
            // Room above and below the label, as a call to action has.
            final box = tester.getRect(button);
            final words = tester.getRect(label);
            expect(words.top - box.top, greaterThanOrEqualTo(AppSpace.s8));
            expect(
              box.bottom - words.bottom,
              greaterThanOrEqualTo(AppSpace.s8),
            );
            expect(box.height, greaterThan(GoogleButtonStyle.height));
            final mark = find.descendant(
              of: button,
              matching: find.byType(Image),
            );
            expect(
              tester.getSize(mark),
              const Size.square(GoogleButtonStyle.markSize),
            );
            expect(
              tester.getRect(mark).left - box.left,
              greaterThanOrEqualTo(12),
            );
            expect(tester.getRect(label).left - tester.getRect(mark).right, 10);
            expect(tester.takeException(), isNull);
          },
        );
      }

      testWidgets(
        "on a ${width.toInt()} wide iPhone Apple's button is as tall as Google's grown one",
        (tester) async {
          tester.view.physicalSize = Size(width, 844);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          tester.platformDispatcher.textScaleFactorTestValue = 3.12;
          addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
          await pumpScreen(
            tester,
            FakeAccountService(),
            locale: const Locale('ko'),
          );

          final google = tester.getSize(find.byType(GoogleSignInButton));
          // The setup: Google's button has grown past 48.
          expect(google.height, greaterThan(GoogleButtonStyle.height));
          final apple = find.byType(FakeAppleButton);
          expect(tester.getSize(apple).height, google.height);
          expect(tester.getSize(apple).width, google.width);
          expect(tester.takeException(), isNull);
        },
        variant: TargetPlatformVariant.only(TargetPlatform.iOS),
      );
    }
  });

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
        find.text(
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
      find.text("Couldn't open the link. Please try again."),
      findsOneWidget,
    );
  });
}
