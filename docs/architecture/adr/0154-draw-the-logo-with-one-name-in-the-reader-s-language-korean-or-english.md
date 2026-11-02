# ADR 0154: Draw the logo with one name in the reader's language, 알아몰라 in Korean and knowno in English

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #588**, the owner's direction of 2026-11-03: the logo shows one name, in the reader's language, never both. Both lockups drew 알아몰라 and knowno together ([ADR 0139](0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md), [ADR 0153](0153-draw-the-lockups-in-cobalt-on-a-white-or-dark-card-circle.md)), the second name smaller under or after the first, so a reader met a name in a language they did not read.
- **The web is Korean only** (`lang="ko"`); the phone has `app_ko.arb` and `app_en.arb`, whose `appTitle` is already 알아몰라 and knowno ([ADR 0134](0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)).
- **After #585** the phone draws only the stacked lockup, on sign-in; the horizontal lockup is the web's, atop its side menu.
- **Alternatives considered:**
  - **One bilingual file with both names, the unused one hidden.** A file carrying a name nobody can see is the both-names logo with a switch.
  - **A horizontal lockup in English as well.** Nothing draws it: the web is Korean only and the phone does not bundle the horizontal one.

## Decision

- **A lockup holds one name:** 알아몰라 for Korean, knowno for any other language. The mark on its circle sits over (stacked) or beside (horizontal) the word, centred on it, with the gaps the layout already used: 14 under the circle, 28 beside it.
- **Both names are drawn 446 across**, so a stacked lockup is 446 wide in either language and 421 high with 알아몰라, 390 with knowno; the horizontal lockup is 674 by 200. Each canvas is the size of what it holds, with no band left where the second name was.
- **The phone picks by locale:** `AppBrand.stacked` takes the locale and names `knowno-stacked-ko-*.png` for Korean, `knowno-stacked-en-*.png` for any other, and the sign-in screen passes the locale it is shown in. `wordmarks.json` keeps both outlines.
- **The web draws 알아몰라 alone:** `knowno-lockup-*.svg` and `knowno-stacked-*.svg` under `web/public/brand/`. The generator draws no knowno lockup for the web and no horizontal lockup for the phone, since nothing would show it. The lockups' `<title>` is the name they show.
- **The slots are re-sized to the new canvas,** keeping the mark as large as before: `AppSize.stackedLockupWidth` and the web's `--spacing-stacked-lockup-width` are 150, from 200.
- **Supersedes** the two-word lockups of ADR 0153 and ADR 0139, and the lockup canvases (981 by 200 and 600 by 484) with them. The colours, circles and the rest of ADR 0153 stand.

## Consequences

- A user reads the logo in their own language, and the logo agrees with the name the screen reader announces (`appTitle` on the phone, the alt text on the web).
- A third language would show knowno until it has its own outline and a branch in `AppBrand.stacked`.
- The phone's lockup files are renamed with the language, and the web's keep their names: the web has one language, so its files need no token.
- The stacked lockup's word is a third larger than before at the same mark size; the sign-in screen has the room for it.

## Signs the decision was wrong

- A language the phone ships in is not read from its word: the English-reading user on a Korean-set phone, or the reverse, sees a name they cannot place and files it as a defect.
- The web gains a second language or the phone a horizontal lockup, and one slot needs a name the generator does not draw.
