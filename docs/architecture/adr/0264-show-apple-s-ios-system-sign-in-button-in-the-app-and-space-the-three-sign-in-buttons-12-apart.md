# ADR 0264: Show Apple's iOS system sign-in button in the app and space the three sign-in buttons 12 apart

> Status: accepted
> Date: 2026-11-21

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

Supersedes the Apple button's package, title size and gap in [ADR 0186](0186-sign-in-with-apple-on-ios-through-the-system-sheet-and-supabase-with-apple-s-button-under-google-s.md), [ADR 0187](0187-make-apple-s-sign-in-button-as-tall-as-google-s-when-a-large-text-size-grows-google-s.md) and [ADR 0194](0194-draw-google-s-and-apple-s-sign-in-buttons-48-tall-with-their-content-centred-and-keep-one-apple-nonce-until-a-sign-in-spends-it.md), and the email button's font in [ADR 0214](0214-sign-in-with-an-email-code-on-the-phone-in-a-screen-opened-over-the-sign-in-screen-with-three-failures-added-to-the-account-failures.md).

## Context

- Goal #1000's direction (Designer, 2026-11-21, on [#1000](https://github.com/garamsh/knowno/issues/1000#issuecomment-7061688993)): one 48 high group of Google, Apple and email buttons, each provider's inside following its own specification. Apple's inside is left to the system button; the email button is Pretendard 16/24 medium with a thin outline; the gap is 12.
- The app drew Apple's button with the `sign_in_with_apple` package's `SignInWithAppleButton`, which draws its own logo and title at 43% of the height it is given, and a title of 20.6 beside Google's 14.
- The app's iOS runner uses Flutter's implicit engine, whose `FlutterImplicitEngineBridge.pluginRegistry` gives a registrar that registers a platform view factory, so a native view can be shown.

## Decision

- **On iOS the Apple button is `ASAuthorizationAppleIDButton`**, type `continue`, black in the light theme and white in the dark, shown as a platform view (`app.knowno/apple-sign-in-button`) registered in `app/ios/Runner/AppDelegate.swift`. Dart gives it the theme's style and the button radius, 24, when it makes the view, and a theme change makes a new view. A tap reaches Dart over a channel named for the view and runs the same `SignInWithApple.getAppleIDCredential` sign-in as before. The system draws its title in the device's language.
- **The button keeps the height Google's takes at the same width**, 48 at text scale 1.0 and taller where a large text size grows Google's, so no size is locked and nothing is clipped.
- **A seam stands in for the platform view**: `appleButtonViewProvider` returns the system button, and a test overrides it, since a test has no iOS to host the view. The gate test, which builds the shipped graph, records the platform view the screen asks for instead.
- **The email button's label is Pretendard 16/24 medium in ink**, on the surface the screen is drawn on, with a one-pixel outline in the outline token.
- **The three buttons are 12 apart**, in the order Google, Apple, email.
- **The global button theme does not change**; the sign-in buttons are their own variant.

## Consequences

- The Swift side runs only in CI's macOS jobs and on a device; `flutter test` on Linux covers the Dart side and the seam alone.
- The `signInWithApple` string in the ARB files is no longer read by the app, since the system draws the title.
- If the system's title in the device's language differs from the app's language, the button follows the device.

## Signs the decision was wrong

- The platform view fails to show or to receive a tap on a device, or VoiceOver does not read it as a button.
- A future iOS or Flutter release changes how a platform view takes its size, and the button is clipped or stretched.
