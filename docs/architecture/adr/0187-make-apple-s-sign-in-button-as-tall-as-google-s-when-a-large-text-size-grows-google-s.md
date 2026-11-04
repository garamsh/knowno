# ADR 0187: Make Apple's sign-in button as tall as Google's when a large text size grows Google's

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #732.** At text scale 3.12 Google's label "Google로 계속하기" was cut by the button's fixed 64. PR #730 lets Google's button grow to hold its wrapped label, from 64 at the least, as the app's other buttons do (`docs/architecture/design/principles.md` §Nothing clipped).
- [ADR 0186](0186-sign-in-with-apple-on-ios-through-the-system-sheet-and-supabase-with-apple-s-button-under-google-s.md) set Apple's button 64 tall, its title at Apple's proportion of the height at every text size. Once Google's button grows, Apple's at 64 is the smaller of the two.
- Apple, Human Interface Guidelines, "Sign in with Apple", §Displaying buttons: "Make a Sign in with Apple button no smaller than other sign-in buttons". The owner's rule (#727): each company's button follows that company's guidelines. The PM's review of PR #730 on 2026-11-04 asked for both buttons at one height, the taller setting it, Apple's title unscaled.
- The `sign_in_with_apple` 8.2.0 button sizes its title as 43% of the height it is given.

## Decision

- **On iOS, Apple's button is as tall as Google's at the same width and text size**: 64 at text scale 1.0, and the height Google's grown button takes where a large text size grows it. `GoogleSignInButton.heightFor` gives that height, and the sign-in screen lays Apple's button out at it.
- **Apple's title keeps its size at 64.** The package is given 64, so the title stays at 43% of 64, and the button's fill takes the full height around it.
- **Unchanged from ADR 0186:** the package's button, its title, its styles per theme, its width and radius, and its place 8 under Google's.
- **Supersedes** ADR 0186's 64 tall at every text size.

## Consequences

- At the largest text size Apple's button is a tall black or white box with its one-line title at its usual size in the middle.
- The height comes from a measurement of Google's label rather than from Google's laid-out button, so a change to the Google button's layout must change `heightFor` with it; the 3.12 test in `app/test/account/sign_in_screen_test.dart`, which compares the two heights, fails when they part.

## Signs the decision was wrong

- Apple's review, or the HIG, objects to a title smaller than 43% of the button's height.
- The tall Apple button reads as empty or broken to the owner at the largest text size.
