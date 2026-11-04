# ADR 0186: Sign in with Apple on iOS through the system sheet and Supabase, with Apple's button under Google's

> Status: accepted; its button 64 tall at every text size superseded by ADR-0187
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #727.** App Store Review Guideline 4.8 asks an app that offers Google sign-in to offer Sign in with Apple too. The owner, 2026-11-04: each company's button follows that company's guidelines and is not drawn by us. The sign-in screen held a disabled "Apple로 계속하기 · 준비 중" text button that [ADR 0027](0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) placed for Apple sign-in to fill.
- **The PM's decisions on #727:** the system's Apple ID sheet through the `sign_in_with_apple` package, then Supabase's `signInWithIdToken` with a hashed nonce, as Supabase's guide documents; request name and email and store the full name, which Apple sends once; the package's `SignInWithAppleButton` in one of the Human Interface Guidelines' styles; the account linking by verified email recorded.
- **Sources read on 2026-11-04:**
  - Supabase, "Login with Apple" (`https://supabase.com/docs/guides/auth/social-login/auth-apple`): the Flutter flow hashes a raw nonce with SHA-256, gives Apple the hash and Supabase the raw value, and stores `full_name`, `given_name` and `family_name` with `updateUser` when Apple returns a name, which it does on the first sign-in alone. The Services ID comes first among the Client IDs.
  - Apple, Human Interface Guidelines, "Sign in with Apple" (`https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple`, change log last entry September 14, 2022): §Displaying buttons, "Make a Sign in with Apple button no smaller than other sign-in buttons"; §White, for dark backgrounds; §Black, for white or light backgrounds; §Button size and corner radius, a corner radius matching the app's other buttons, at least 140 by 30 pt, a margin of a tenth of the height; §Custom buttons with a logo and text, the title 43% of the button's height and titles limited to Sign in, Sign up or Continue with Apple.
  - `sign_in_with_apple` 8.2.0's README (`https://pub.dev/packages/sign_in_with_apple/versions/8.2.0`): the Sign in with Apple capability is required on iOS, or sign-in fails with no visual indication; Android and the web need a Services ID and a server that relays the callback.
- **Alternatives considered:**
  - **Supabase's browser OAuth on the phone.** It works on Android too, but opens a browser sheet where iOS has a system sheet, and Supabase's guide names the native flow for iOS.
  - **Draw our own Apple button.** The owner asked for the company's own; the package's button follows the guidelines' proportions.
  - **Offer Apple on Android through the browser flow.** Google Play asks for no Apple sign-in, and the flow needs a deep link back into the app that this project does not have.

## Decision

- **iOS alone offers Apple sign-in.** The sign-in screen draws Apple's button under Google's on iOS; elsewhere it draws Google's alone.
- **The system sheet, then Supabase.** `AccountService.signInWithApple` asks the sheet for the email and full name with a new nonce per sign-in, gives Apple its SHA-256 as hex, and passes the identity token and the raw nonce to `signInWithIdToken` with the Apple provider. Google sign-in becomes `signInWithGoogle`, unchanged.
- **The name Apple shares is stored once.** When the credential carries a given or family name, the service stores `full_name`, the parts joined by a space, with `given_name` and `family_name` in the user's metadata, as Supabase's guide does. A failure there is reported through `FlutterError.reportError` and the user stays signed in, since the session has started.
- **Failures map as Google's do.** A cancelled sheet returns quietly; a device without the sheet is `AccountMisconfigured`; any other failure Apple reports, or a credential without an identity token, is `AccountRejected`; Supabase's answers map as for Google. The rejection's sentence no longer names Google.
- **Apple's button.** The package's `SignInWithAppleButton`, titled "Apple로 계속하기" or "Continue with Apple", black in the light theme and white in the dark, 64 tall and as wide as Google's button, rounded as the app's buttons are, 8 under Google's. Its title keeps Apple's proportion to the height at every text size, as the system's button does.
- **The capability.** `app/ios/Runner/Runner.entitlements` holds `com.apple.developer.applesignin` with `Default`, and each of the app target's configurations names it in `CODE_SIGN_ENTITLEMENTS`. The project carries no team or other signing setting.
- **One account per verified email.** Supabase links an Apple sign-in to the account that already holds its verified email, so Apple and Google with the same address reach one account. An address from Apple's "Hide My Email" relay is its own, so it starts a separate account.
- **Supersedes** ADR 0027's disabled Apple slot on the sign-in screen, "quieter", a text button read as disabled.

## Consequences

- Sign-in works on a device only once the owner's steps on #727 are done: the capability on the `app.knowno` App ID, the Apple provider enabled in Supabase with `app.knowno` among its Client IDs.
- `account` imports `sign_in_with_apple` beside `google_sign_in`.
- A user who signed in with Apple and later revokes the app's access in their Apple ID settings keeps the Supabase session until it ends; the app does not check the credential's state.
- Supabase's secret for Apple's OAuth flow expires every six months; the native flow needs no secret, so the phone is unaffected when it lapses.

## Signs the decision was wrong

- App Review rejects the button or the flow.
- Users with the same email on Apple and Google find two accounts.
- Android users ask for Apple sign-in.
