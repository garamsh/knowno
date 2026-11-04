# ADR 0194: Draw Google's and Apple's sign-in buttons 48 tall with their content centred, and keep one Apple nonce until a sign-in spends it

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #743, from production on 2026-11-04.** The owner's first Apple sign-in on knowno.app, in Firefox, came back to `/login` with "로그인하지 못했어요". Supabase Auth logged `invalid nonce: Nonces mismatch` for the id_token grant. The retry worked. On the same page, Google's and Apple's buttons were both 64 by 375. Apple's title drew at about 27 px beside Google's 14 px label, so the owner read Apple's as twice the size: "로그인 버튼 형식이 공식 가이드와 틀린듯".
- **How the nonces parted.** Apple's script, `appleid.auth.js` at `.../appleid/1/ko_KR/` (`Last-Modified: Thu, 29 Oct 2026 19:21:36 GMT`, its requests sent as `v=1.5.7`, read 2026-11-04), handles a press in a fixed order. It builds the popup's URL from the nonce `init` last gave it, closes any popup still open, and reports that close as `AppleIDSignInOnFailure` with `popup_closed_by_user`. Only then does it open the new popup. Under [ADR 0191](0191-sign-in-with-apple-on-the-web-through-apple-s-js-button-in-a-popup-and-supabase-on-both-hosts-login.md), a closed popup drew a new nonce. So a second press while the first popup was open left the page holding a raw nonce whose hash no popup carried. The token then failed at Supabase. `web/src/features/account/__tests__/apple-sign-in-button.test.tsx` reproduces this press on the code of #740. The Supabase log cannot show which press the owner made.
- **The phone has no such path.** `AccountService.signInWithApple` draws its nonce inside the call. It gives Apple the hash and Supabase the raw value from that one local value ([ADR 0186](0186-sign-in-with-apple-on-ios-through-the-system-sheet-and-supabase-with-apple-s-button-under-google-s.md)), so nothing outside the call can replace it.
- **Sources read on 2026-11-04:**
  - Apple, Human Interface Guidelines, "Sign in with Apple" (`https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple`, change log last entry September 14, 2022):
    - §Displaying buttons: "Make a Sign in with Apple button no smaller than other sign-in buttons".
    - §Button size and corner radius: a corner radius that matches the app's other buttons, up to a capsule; at least 140 by 30 pt; a margin of a tenth of the height.
    - §Custom buttons with a logo and text: the title is 43% of the button's height; 44 points is "the default (and recommended) button height in iOS".
  - Apple, "Displaying Sign in with Apple buttons on the web" (`https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web`):
    - `data-mode`: `center-align`, the default, centres the logo and text. `left-align` adds `data-logo-size`, `data-logo-position` and `data-label-position`, and "the system may override the value to maintain proper margins".
    - `data-height` is 30 to 64. `data-border-radius` is 0 to 50, a percentage of the height in the script.
  - Google, "Sign in with Google Branding Guidelines" (`https://developers.google.com/identity/branding-guidelines`, last updated 2026-07-07):
    - §Size: the button scales as long as its aspect ratio is kept.
    - §Color: the label is Google Sans Medium 14/20. §Padding: 12, 10 and 12 on Android and the web.
    - §Incorrect button design: the "G" keeps "fixed padding and size".
    - §Sign in with Google and other third party sign-in options: "approximately the same size and have similar visual weight".
  - `sign_in_with_apple` 8.2.0's `SignInWithAppleButton`: its height defaults to 44, its title is `height * 0.43`, and its icon is centred by default.
  - Flutter 3.47.7's `flutter_test`: `androidTapTargetGuideline` asks for 48 by 48 and `iOSTapTargetGuideline` for 44 by 44. `app/test/account/sign_in_screen_test.dart` holds the sign-in screen to the Android one on iOS too. At 44 both buttons fail it, which was seen on this branch.
- **Alternatives considered:**
  - **Keep 64 and scale Google's button up to Apple's title.** Google's §Size allows scaling, but a 27 px label needs Google's button about twice its size. That also scales the "G" and its padding, which the guidelines ask to keep fixed.
  - **44, Apple's recommended height.** Apple's title would be 19 px. But the sign-in screen's tap-target test, which asks for 48, fails at 44.
  - **`left-align`, with the logos in one column.** Google's label would leave its centre, and Apple's script may move a logo position it is given. Neither button documents an alignment with the other.

## Decision

- **Both buttons are 48 tall at the default text size, on both clients.** 48 is the least height the screen's tap-target check accepts. It is no smaller than Google's button, as Apple asks, and it is above Apple's 30 pt minimum and its 44. At 48, Apple's title is 43% of the height, about 20.6 px, beside Google's 14 px label.
  - On the web the height is `--spacing-sign-in-button` in `globals.css`. Google's button takes it as its least height. Apple's wrapper takes it as its height, and Apple's script draws its button to fit.
  - On the phone it is `GoogleButtonStyle.height`. `GoogleSignInButton.heightFor` gives 48, or the wrapped label's height where a large text size makes that taller. Apple's button is laid out at that height ([ADR 0187](0187-make-apple-s-sign-in-button-as-tall-as-google-s-when-a-large-text-size-grows-google-s.md)), and the package is given 48, so its title stays at 43% of 48 at every text size.
- **Centred content.** Apple's button is `data-mode="center-align"` on the web and the package's centred icon on the phone. Google's mark and label stay centred together.
- **Google's metrics are unchanged:** the 14/20 Google Sans Medium label, the 20 px mark and the 12, 10 and 12 (web and Android) or 16, 12 and 16 (iOS) spacing.
- **Rounded as the app's buttons.** The 24 radius is half of 48, so both buttons are capsules. Apple's web button takes `data-border-radius="50"`, the HIG's maximum corner radius.
- **One Apple nonce until a sign-in spends it.** The web keeps one nonce pair from the first configuration of Apple's script. A cancelled, closed or replaced popup, a theme change and a re-render keep it. When Apple's success event arrives, the page takes the raw nonce at once, sends it with the token to `signInWithIdToken`, and draws a new pair for the next sign-in. A failure without a token keeps the pair.
- **Unchanged:** the width, the column's up to 375 px; the colours and titles; the order with Apple under Google; the gap between the buttons.
- **Supersedes:**
  - ADR 0191's 64 px height, its 24 px radius at 38% of it, and its "a closed or cancelled popup draws a new one".
  - ADR 0187's 64, as the height at the default text size and as the height Apple's title is sized from.

## Consequences

- The sign-in buttons are shorter than the app's 64 calls to action. They are third-party buttons drawn to their own guidelines, as Google's was already.
- Apple's title is still about half again Google's label, as Apple fixes it at 43% of the height. Narrowing that gap means a height below 48, which the tap-target check refuses.
- A nonce given to Apple can serve more than one popup. A popup that is cancelled returns no token, and one that returns a token spends the nonce, so no token is ever matched with a second raw value.

## Signs the decision was wrong

- Supabase logs `Nonces mismatch` for an Apple sign-in again.
- The owner still reads Apple's button as larger than Google's at 48.
- Apple's review, or a change to Apple's script, objects to the 48 height or the capsule radius.
