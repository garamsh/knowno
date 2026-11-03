# ADR 0024: Write every Korean string in 해요체, give a sheet a cancel only when it confirms an irreversible action, and draw Google sign-in as Google's branded button

> Status: accepted; its Apple slot's label "Apple로 로그인 (준비 중)" superseded by ADR-0027; its Google button colours in `app/lib/shared/theme.dart` superseded by ADR-0039
> Date: 2026-10-15

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #64: the PM's review of the 48 screenshots of PR #62 ([ADR 0021](0021-type-and-spacing-scales-and-a-shared-component-layer.md)) found what that change left:
  - the Korean strings mixed 합쇼체 ("아직 덱이 없습니다.", "카드 4장도 함께 삭제됩니다.") with 해요체 ("이 덱에 이미 있는 카드예요"), while the owner-approved canvas writes 해요체 throughout;
  - the duplicate sheet floated a text "취소" above its two buttons, and nothing written said where a cancel goes or whether a sheet needs one;
  - the Google sign-in button had no "G" mark, against Google's Sign in with Google branding guidelines (developers.google.com/identity/branding-guidelines, read 2026-10-15).
- The PM decided the voice, the sheet rule and the button in issue #64; this ADR records them as the project's rules. Alternatives considered:
  - 합쇼체 everywhere. It reads as a notice rather than as the app speaking, and the approved canvas already writes 해요체.
  - A cancel on every sheet, for symmetry. Every sheet is already dismissed by a drag, a tap on the scrim and Android's back ([`design/principles.md`](../design/principles.md) §Direct manipulation where it is natural), so a cancel beside one or two actions repeats a gesture and takes the space of an action.
  - Google's pre-rendered button images from its asset bundle. Their label is English, set in Google Sans, and cannot be localized; the guidelines allow the text to be localized and the button drawn to their colours and spacing.
  - An SVG of the mark through a new dependency. The bundle's SVGs draw the mark with a conic gradient inside a `foreignObject`, which `flutter_svg`, the renderer the app would add, does not support; the bundle's own PNGs, at four densities, need no dependency.

## Decision

- **Voice.** Every string in `app/lib/shared/l10n/app_ko.arb` is written in 해요체: plain, short, with one consistent sentence ending. No string ends a sentence in 합쇼체 ("…ㅂ니다", "…ㅂ니까"). `app_en.arb` matches it in tone: plain, second person, no exclamation marks. `app/test/shared/l10n/voice_test.dart` fails on a 합쇼체 ending in Korean and on an exclamation mark in English.
- **Sheet actions.**
  - Every sheet is dismissed by a drag and by the scrim, so a sheet's actions hold no cancel.
  - A confirmation of an action that cannot be undone, `showAppConfirm`, keeps an explicit cancel, and puts its destructive button last, at the bottom.
  - Actions are always full width, with the primary one last.
- **Google sign-in.** The sign-in screen draws Google's button as its branding guidelines specify: the light button in the light theme and the dark one in the dark theme, with the guidelines' fill, stroke and label colours, the standard-colour "G" mark from Google's asset bundle (`signin-assets.zip`) before the label, the guidelines' spacing per platform, and a localized label. "Apple로 로그인 (준비 중)" stays a quieter text button below it.

## Consequences

- A new string or a new sheet has a rule to follow, and a test or a reviewer has a rule to cite when it does not.
- A sheet that needs a way out other than dismissing it has to be an irreversible confirmation, or argue for an exception to this ADR.
- The Google button's colours and spacing are Google's, not the app's tokens; they sit in `app/lib/shared/theme.dart` beside the tokens, and move only when Google's guidelines do.
- The guidelines name Google Sans for the label; the app bundles no font but IBM Plex Sans KR, so the Korean label is set in it at the guidelines' size and weight, and a reviewer comparing the button with Google's samples sees that difference.

## Signs the decision was wrong

- Users miss a way out of a sheet without a cancel, for example when the scrim is small on a tall sheet, or an accessibility service exposes no dismiss action.
- A string cannot be written naturally in 해요체, such as a legal notice, and the voice test gathers exceptions.
- Google's app verification rejects the button for its font or shape, or its guidelines change the mark and the bundled PNGs fall out of date unnoticed.
