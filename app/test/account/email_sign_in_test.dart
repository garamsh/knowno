import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:knowno/account/account.dart';
import 'package:knowno/account/src/email_sign_in_screen.dart';
import 'package:knowno/account/src/sign_in_screen.dart';
import 'package:knowno/design/app_button.dart';
import 'package:knowno/design/theme.dart';
import 'package:knowno/l10n/app_localizations.dart';

import '../word_breaks.dart';
import 'fake_account_service.dart';

void main() {
  late FakeAccountService service;

  setUp(() => service = FakeAccountService());

  Future<void> pumpSignIn(
    WidgetTester tester, {
    Locale locale = const Locale('en'),
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [accountServiceProvider.overrideWithValue(service)],
        child: MaterialApp(
          theme: lightTheme,
          locale: locale,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: const SignInScreen(),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapText(WidgetTester tester, String text) async {
    await tester.ensureVisible(shownText(text));
    await tester.tap(shownText(text));
    await tester.pumpAndSettle();
  }

  /// The email step, opened from the sign-in screen.
  Future<void> openEmailStep(WidgetTester tester) async {
    await pumpSignIn(tester);
    await tapText(tester, 'Continue with email');
  }

  /// The code step, after a code was sent to [address].
  Future<void> openCodeStep(
    WidgetTester tester, {
    String address = 'ada@example.com',
  }) async {
    await openEmailStep(tester);
    await tester.enterText(find.byType(TextField), address);
    await tapText(tester, 'Send code');
  }

  Finder codeField() => find.byType(TextField);

  AppButton signInButton(WidgetTester tester) => tester.widget<AppButton>(
    find.byWidgetPredicate(
      (widget) => widget is AppButton && widget.label == 'Sign in',
    ),
  );

  TextField codeInput(WidgetTester tester) =>
      tester.widget<TextField>(codeField());

  testWidgets('offers the email step below Google, and opens it', (
    tester,
  ) async {
    await pumpSignIn(tester);

    final google = tester.getTopLeft(shownText('Continue with Google'));
    final email = tester.getTopLeft(shownText('Continue with email'));
    expect(email.dy, greaterThan(google.dy), reason: 'below Google');

    await tapText(tester, 'Continue with email');

    expect(find.byType(EmailSignInScreen), findsOneWidget);
    expect(shownText('Send code'), findsOneWidget);
    expect(shownText('Email'), findsOneWidget);
    expect(service.emailsSentTo, isEmpty, reason: 'nothing is sent by opening');
  });

  testWidgets('says the words in Korean', (tester) async {
    await pumpSignIn(tester, locale: const Locale('ko'));
    await tapText(tester, '이메일로 계속하기');
    expect(shownText('코드 받기'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'ada@example.com');
    await tapText(tester, '코드 받기');
    expect(shownText('ada@example.com로 보낸 6자리 코드를 입력해 주세요.'), findsOneWidget);
    expect(shownText('60초 뒤에 코드를 다시 받을 수 있어요'), findsOneWidget);
    expect(shownText('이메일 주소 바꾸기'), findsOneWidget);
  });

  group('the email step', () {
    testWidgets(
      'refuses what is not shaped like an address, and sends nothing',
      (tester) async {
        await openEmailStep(tester);

        for (final typed in [
          '',
          'ada',
          'ada@',
          'ada@example',
          'a da@example.com',
        ]) {
          await tester.enterText(find.byType(TextField), typed);
          await tapText(tester, 'Send code');
          expect(
            shownText('Check the email address.'),
            findsOneWidget,
            reason: '"$typed"',
          );
        }
        expect(service.emailsSentTo, isEmpty);

        // Control: an address sends, trimmed of the spaces around it.
        await tester.enterText(find.byType(TextField), '  ada@example.com ');
        await tapText(tester, 'Send code');
        expect(service.emailsSentTo, ['ada@example.com']);
        expect(shownText('Check the email address.'), findsNothing);
      },
    );

    testWidgets(
      'asks the keyboard for an address and offers the email autofill',
      (tester) async {
        await openEmailStep(tester);

        final field = tester.widget<TextField>(find.byType(TextField));
        expect(field.keyboardType, TextInputType.emailAddress);
        expect(field.autofillHints, contains(AutofillHints.email));
      },
    );

    testWidgets(
      'goes to the code step once the code is sent, naming the address',
      (tester) async {
        await openCodeStep(tester);

        expect(
          shownText('Enter the 6-digit code sent to ada@example.com.'),
          findsOneWidget,
        );
        expect(shownText('Send code'), findsNothing);
        expect(shownText('Sign in'), findsOneWidget);
      },
    );

    testWidgets('says why no code was sent, and stays on the step', (
      tester,
    ) async {
      final failures = <(AccountFailure, String)>[
        (
          AccountOffline(Exception('no route')),
          "Couldn't reach the server. Check your internet connection.",
        ),
        (
          AccountAddressRefused(Exception('invalid')),
          'We cannot send a code to this address. Check the email address.',
        ),
        (
          AccountRateLimited(
            Exception('slow'),
            retryAfter: const Duration(seconds: 49),
          ),
          'Too many requests. Try again in 49 s.',
        ),
        (
          AccountRateLimited(Exception('slow')),
          'Too many requests. Try again in a moment.',
        ),
      ];
      await openEmailStep(tester);
      await tester.enterText(find.byType(TextField), 'ada@example.com');
      for (final (failure, message) in failures) {
        service.sendFailure = failure;
        await tapText(tester, 'Send code');
        expect(shownText(message), findsOneWidget, reason: message);
        expect(
          shownText('Send code'),
          findsOneWidget,
          reason: 'still the email step',
        );
      }
      expect(service.emailsSentTo, hasLength(failures.length));

      // Control: typing again clears the message, and once Auth answers, the
      // step moves on.
      service.sendFailure = null;
      await tester.enterText(find.byType(TextField), 'ada@example.com ');
      await tester.pump();
      expect(find.textContaining('Too many'), findsNothing);
      await tapText(tester, 'Send code');
      expect(shownText('Sign in'), findsOneWidget);
    });
  });

  group('the code step', () {
    testWidgets(
      'takes a one-time code the platform can fill, as any characters',
      (tester) async {
        await openCodeStep(tester);

        final field = codeInput(tester);
        expect(field.autofillHints, contains(AutofillHints.oneTimeCode));
        expect(field.keyboardType, TextInputType.visiblePassword);
      },
    );

    testWidgets(
      'signs in on the whole code pasted in, the service reading its digits',
      (tester) async {
        await openCodeStep(tester);

        await tester.enterText(codeField(), '123 456');
        await tester.pumpAndSettle();

        expect(service.verified, [(email: 'ada@example.com', code: '123 456')]);
        expect(find.byType(EmailSignInScreen), findsOneWidget);
      },
    );

    testWidgets(
      'keeps a code of 12 characters or more whole, as App Review types it',
      (tester) async {
        const reviewCode = 'f3a91c07d25be84601a9c3d7';
        service.emailCode = reviewCode;
        await openCodeStep(tester);

        await tester.enterText(codeField(), reviewCode);
        await tester.pumpAndSettle();

        expect(service.verified.single.code, reviewCode);
        expect(service.state, isA<SignedIn>());
        expect(find.byType(EmailSignInScreen), findsNothing, reason: 'closed');
      },
    );

    testWidgets('keeps at most 128 characters', (tester) async {
      await openCodeStep(tester);

      await tester.enterText(codeField(), 'a' * 130);
      await tester.pump();

      expect(tester.widget<TextField>(codeField()).controller!.text, 'a' * 128);
    });

    testWidgets('waits for the button when the code is typed key by key', (
      tester,
    ) async {
      await openCodeStep(tester);

      await tester.enterText(codeField(), '12345');
      await tester.pump();
      expect(signInButton(tester).onPressed, isNull);
      await tester.tap(shownText('Sign in'), warnIfMissed: false);
      await tester.pump();
      expect(service.verified, isEmpty);

      // The sixth character is typed, not pasted: it waits for the button.
      await tester.enterText(codeField(), '123456');
      await tester.pump();
      expect(service.verified, isEmpty);
      expect(signInButton(tester).onPressed, isNotNull);

      // Control: the button signs in.
      await tester.tap(shownText('Sign in'));
      await tester.pumpAndSettle();
      expect(service.verified, hasLength(1));
    });

    testWidgets('signs in with the button too, once the code is typed', (
      tester,
    ) async {
      await openCodeStep(tester);
      service.pendingVerify = Completer<void>();

      await tester.enterText(codeField(), '123456');
      await tester.pump();
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(service.verified, hasLength(1), reason: 'one request, not two');
      expect(
        service.state,
        isA<SignedOut>(),
        reason: 'not before Auth answers',
      );

      service.pendingVerify!.complete();
      await tester.pumpAndSettle();
      expect(service.state, isA<SignedIn>());
    });

    testWidgets(
      'says a wrong or expired code is refused, and lets it be typed again',
      (tester) async {
        await openCodeStep(tester);

        await tester.enterText(codeField(), '000000');
        await tester.pumpAndSettle();

        expect(
          shownText(
            'The code is wrong or has expired. Check it or ask for a new one.',
          ),
          findsOneWidget,
        );
        expect(service.state, isA<SignedOut>());
        expect(find.byType(EmailSignInScreen), findsOneWidget);

        // Control: the right code, typed over it, signs in with the button.
        await tester.enterText(codeField(), '123456');
        await tester.pump();
        await tester.tap(shownText('Sign in'));
        await tester.pumpAndSettle();
        expect(
          shownText(
            'The code is wrong or has expired. Check it or ask for a new one.',
          ),
          findsNothing,
        );
        expect(service.state, isA<SignedIn>());
      },
    );

    testWidgets(
      'says why the code did not sign in, for what Auth refuses besides it',
      (tester) async {
        final failures = <(AccountFailure, String)>[
          (
            AccountOffline(Exception('no route')),
            "Couldn't reach the server. Check your internet connection.",
          ),
          (
            AccountSuspended(Exception('banned')),
            'This account is suspended. Write to sauce@garam.sh with any questions.',
          ),
        ];
        await openCodeStep(tester);
        for (final (failure, message) in failures) {
          service.verifyFailure = failure;
          await tester.enterText(codeField(), '');
          await tester.enterText(codeField(), '123456');
          await tester.pumpAndSettle();
          expect(shownText(message), findsOneWidget, reason: message);
          expect(service.state, isA<SignedOut>());
        }
      },
    );

    testWidgets(
      'counts down to a new code, then offers it, and asks again for the same address',
      (tester) async {
        await openCodeStep(tester);

        expect(shownText('You can ask for a new code in 60 s'), findsOneWidget);
        expect(shownText('Send a new code'), findsNothing);
        await tester.pump(const Duration(seconds: 1));
        expect(shownText('You can ask for a new code in 59 s'), findsOneWidget);
        await tester.pump(const Duration(seconds: 58));
        expect(shownText('You can ask for a new code in 1 s'), findsOneWidget);
        expect(shownText('Send a new code'), findsNothing);

        await tester.pump(const Duration(seconds: 1));
        expect(shownText('Send a new code'), findsOneWidget);
        expect(find.textContaining('You can ask'), findsNothing);

        await tapText(tester, 'Send a new code');
        expect(service.emailsSentTo, ['ada@example.com', 'ada@example.com']);
        expect(shownText('You can ask for a new code in 60 s'), findsOneWidget);
        expect(shownText('Send a new code'), findsNothing);
      },
    );

    testWidgets('waits the time a rate limit names before the next code', (
      tester,
    ) async {
      await openCodeStep(tester);
      await tester.pump(const Duration(seconds: 60));
      service.sendFailure = AccountRateLimited(
        Exception('slow'),
        retryAfter: const Duration(seconds: 49),
      );

      await tapText(tester, 'Send a new code');

      expect(
        shownText('Too many requests. Try again in 49 s.'),
        findsOneWidget,
      );
      expect(shownText('You can ask for a new code in 49 s'), findsOneWidget);
      await tester.pump(const Duration(seconds: 49));
      expect(shownText('Send a new code'), findsOneWidget);
    });

    testWidgets(
      'goes back to the address from the screen and from the system back, keeping the address typed',
      (tester) async {
        await openCodeStep(tester);

        await tapText(tester, 'Change email address');
        expect(shownText('Send code'), findsOneWidget);
        expect(
          tester.widget<TextField>(find.byType(TextField)).controller!.text,
          'ada@example.com',
        );
        expect(find.byType(EmailSignInScreen), findsOneWidget);

        await tester.enterText(find.byType(TextField), 'grace@example.com');
        await tapText(tester, 'Send code');
        expect(
          shownText('Enter the 6-digit code sent to grace@example.com.'),
          findsOneWidget,
        );

        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();
        expect(shownText('Send code'), findsOneWidget, reason: 'system back');
        expect(find.byType(EmailSignInScreen), findsOneWidget);
      },
    );

    testWidgets(
      'leaves the screen from the address step, back to the sign-in screen',
      (tester) async {
        await openEmailStep(tester);

        await tester.binding.handlePopRoute();
        await tester.pumpAndSettle();

        expect(find.byType(EmailSignInScreen), findsNothing);
        expect(shownText('Continue with email'), findsOneWidget);
      },
    );
  });
}
