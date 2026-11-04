# Design theme

The shared light and dark theme of the phone and the web: where it lives, its colour tokens, its type, spacing, radius, height and edge scales, its fonts, Google's button, and the user's choice of theme.

## Current decisions

### Where it lives

- `app/lib/design/theme.dart` holds every token as `AppColors` (a light and a dark set), `AppType`, `AppSpace`, `AppRadius`, `AppSize` and `AppShadow`, and the light and dark `ThemeData` built from them ([ADR 0011](../adr/0011-shared-app-theme-bundled-font-and-today-builder.md), [ADR 0021](../adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md)). `app/lib/design/theme_choice.dart` holds the user's choice.
- `web/src/styles/globals.css` declares the same tokens under the same names in kebab case ([`web.md`](../web.md)); `web/src/design/theme.ts` and `theme-choice.tsx` hold the web's choice and its store.
- No file under `app/lib/` writes a colour but the theme, Google's button and the mascot's generated drawing, and none writes a spacing or font-size number but the theme, the components in `app/lib/design/`, Google's button and `CardText`, which scales the `AppType` style it is given; `app/test/design/theme_test.dart` enforces both.

### Colour

The colours are cobalt ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)), with coral the mascot's alone.

| Token | Light | Dark | Use |
|---|---|---|---|
| `ground` | `#EEF3FF` | `#111A2E` | the screen's ground |
| `surface` | `#FFFFFF` | `#232F4E` | a card, a group, a row |
| `raised` | `#FFFFFF` | `#2E3B60` | a menu, a neutral chip |
| `bar` | `#FFFFFF` | `#2C3A60` | the tab bar |
| `scrim` | black at 40%, `#00000066` | black at 60%, `#00000099` | what a sheet or a dialog dims the screen behind it with; never a brand tint |
| `edge` | `#C9D6FB` | `#0A1020` | a solid object's hard edge; decoration, carries nothing |
| `ink` | `#13224A` | `#EEF2FF` | text; the quiet fill of a selection, the segmented control and a snack bar, under `onInk` |
| `ink2`, `muted` | `#44527A` | `#B3BEDC` | quieter text |
| `line`, `brandTint` | `#DCE5FD` | `#34405F` | `brandTint`: a tonal fill, a blank, a selected chip |
| `outline` | `#C9D6FB` | `#34405F` | a table's lines, a field's border, the empty previous card's dashed place |
| `know` | `#14683F` | `#8CE6BC` | "Know" |
| `dontKnowText` | `#A3202F` | `#FFA8BA` | "Don't know", red text |
| `primary` | `#2547D0` on `#172E94` | `#8AB4FF` on `#4A78D6` | the one fill, under `onPrimary`, white light and `#0D1424` dark |
| `accent` | `#2547D0` | `#8AB4FF` | every coloured word and mark; 7.26:1 on the surface light and 6.33:1 dark |
| `hero` | `#2547D0` | `#1A2F78` | a full-screen colour surface and the completion panel, under white `onHero` |
| `heroButton` | white | `#8AB4FF` | a button or chip on the hero, under `onHeroButton` (`#2547D0` light, `#0D1424` dark), on `onHeroEdge` (`#C9D6FB` light, `#4A78D6` dark) |

- Every modal's barrier is `scrim` alone: the phone's `bottomSheetTheme.modalBarrierColor`, the web's `backdrop:bg-scrim` on `Sheet` and `AuthoringScreen`. `theme_test.dart` and the web's `class-rules.ts` refuse any other barrier or `backdrop:` colour (issue #717).
- `accent` is the current tab's label, a count, the progress bars' fill, a chart's today bar, a selected ring, a quiet button's label on a coloured ground and the on switch.
- `primary` is the one fill; [`principles.md`](principles.md) §One primary action per screen says how many.
- Green and red mean "안다" and "모른다" alone: answers, grades and the completion card's counts. No grade has a fill of its own: a previous card's grade is a 3 px line on the surface, `know` or `dontKnowText` ([ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)). Words on the green and red tints, the coach's demonstration's, are `onKnowTint` (`#14683F` light, `#8CE6BC` dark) and `onDontKnowTint` (`#A3202F` light, `#FFA8BA` dark). No screen draws a streak flame, so no token holds one.
- The hatch ([ADR 0175](../adr/0175-show-every-card-whole-in-a-note-s-card-list-and-mark-what-study-hides-with-one-hatch.md), [ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)): a note's card list, study's cards and the card editor's preview mark everything study hides until the reveal, and nothing else, with one light diagonal hatch, stripes 6 wide every 12 across them, running up to the right, `hatchStripe` over `hatch`: light `#E2E8F8` over `#EEF2FC`, dark `#354262` over `#2B3757`. The phone draws it with `AppHatch` and `HatchDecoration`, the web with the `hatch` utility in `globals.css`. Text on it is `ink` or `ink2`, 4.5:1 on either colour in both themes.
- 홈's first screen is `hero` with its words in `onHero` and its one button and the profile button in `heroButton`; the week card under it is a `surface` card over its edge, its streak's count in `accent`, its bars `heat1` and today's `accent`, a day with no card dashed in `edge`; quiet text elsewhere is `muted` ([ADR 0098](../adr/0098-draw-the-today-tab-s-and-the-deck-page-s-cards-white-with-ink-accents-in-their-current-layout.md)). A learning share of a progress bar is `chartQuiet`, and a progress bar's counts are always in text beside it ([ADR 0036](../adr/0036-organise-the-app-in-today-decks-and-record-tabs-and-define-the-daily-goal-forecast-and-card-progress.md)).
- A deck tile is `brandTint` until the user chooses one of the four note colours a picker offers ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)): blue, violet, sand and slate, light `#DCE6FF`, `#FFE3DC`, `#F2EAD8`, `#E3E8F2`, dark `#2C3A66`, `#4A3330`, `#433C30`, `#323B52`. A deck that stored sky or amber, which no picker offers since [ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), still draws `#E0F0FA` and `#FFE9A8` light, `#1D3A50` and `#4A3B1E` dark. Its icon is in ink; the palette holds no green or red ([ADR 0103](../adr/0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md)).
- The 기록 tab's charts ([`study.md`](../study.md), [ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)):
  - the retention line in `accent` over `accent` at 10%, against a target dashed in `ink2` and named "목표 90%" in `ink2` on its line at the plot's left, on the surface so the line passes behind it, with no scale label (issue #155);
  - the gap a round pill, `tintGreen` under `onKnowTint` at or above the target and `tintAmber` under ink below it;
  - the recall bands `recallStrong`, `recallFair` and `recallFading`, told apart by hue with each count in ink, each but light 보통, which its count carries, 3:1 on the surface, 45 degrees or more apart in hue;
  - this week's mastered bar `accent`, the others `heat1`; a past week's bar is a shape whose count the chart's label states, so it is not held to 3:1;
  - the heatmap's steps `heat0` to `heat3`, light `#E3E9F8`, `#AABEF3`, `#7D98EA`, `#2547D0`, dark `#2C3858`, `#365292`, `#5578C9`, `#8AB4FF`, the second step in each theme darkened from the owner's `#B9C9F5` and `#34508F` to clear 1.5:1 from the first; every two adjacent steps differ in lightness by at least 1.5:1. A studied day's step is the third of 1 to the busiest day of the twelve weeks its cards fall in;
  - each chart is read as one label that states its values. The web's `/record` draws the same tokens by the same rules ([`web-study.md`](../web-study.md)).
- Every text pair the screens draw meets WCAG AA (4.5:1), each grade's chip 3:1 on the ground, in both themes.

### Type

`AppType`, Jua for what we write and Pretendard for what a user wrote, and the theme's `TextTheme` built from it ([ADR 0027](../adr/0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md)). Below the titles the roles take two sizes, the body's 16 and the caption's 13 ([ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)); the web's classes are `text-` and the role in kebab case.

| Role | Size / line / weight | Use |
|---|---|---|
| display | 28 / 36, Jua | Material's display styles |
| title | 26 / 34, Jua | a pushed screen's and a sheet's title, the photo import list's title, the first-run heading, the completion card's heading, 홈's hero title but today's count |
| deckTitle | 28 / 36, Jua | the 노트 and 기록 tabs' titles |
| deckName | 28 / 36 / 800, −0.8 | a title a user wrote: the deck name on its screen, a sheet's title holding a name |
| figure | 38 / 46, Jua, tabular digits | a large count |
| heroFigure | 58 / 68, Jua | today's count on 홈's hero ([ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md)) |
| headline | 20 / 28, Jua | a section's title, a figure's unit |
| body | 16 / 24 / 500 | running text, field text |
| bodyStrong | 16 / 24 / 700 | a row's title, a photo group's header, the record tab's target, a card row's front |
| label | 16 / 24, Jua | a tab, a chart's heading, a text button |
| button | 23 / 28, Jua | a primary or quiet button's label |
| secondary | 13 / 18 / 400 | a sheet's body, a line under a title, a card row's back, the study count at 700 |
| caption | 13 / 18 / 400 | a row's second line, a note, an error |
| section | 13 / 18 / 600 | a section label, a field's label, a chip |
| micro | 13 / 18 / 400 | a small note: the tab bar's labels, the day bars' figures and labels, a chart's scale, the study card's guide button |
| front | 42 / 46 / 800, −0.6 | a study card's front, in Pretendard |
| back | 20 / 28 / 600 | a study card's back |
| wholeFront | 20 / 28 / 700 | a 글's front on a whole card ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)) |
| wholeAdded | 18 / 26 / 600 | the part the reveal adds to a whole card |

### Scales

- **Spacing**, `AppSpace`: `s4` to `s40` (4, 8, 12, 16, 20, 24, 28, 32, 40); the screen gutter `gutter` (20), the gap between rows `rowGap` (12), between sections `sectionGap` (28). On the web, Tailwind's 4 px steps (`5` is 20).
- **Radii**, `AppRadius` and the web's `rounded-*` ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)): `panel` 40, `sheet` 32, `card`, `previous` and `group` 28, `button` 24, `row` 22, `field` 18, `chip` and `menu` 16.
- **Heights**, `AppSize`: `cta` and `button` 64 ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)), `field` 50, `search` 48, `tapTarget` 44 at least, `tabBar` 66, `deckTile` 46, `listedPhoto` 96 ([ADR 0175](../adr/0175-show-every-card-whole-in-a-note-s-card-list-and-mark-what-study-hides-with-one-hatch.md)), `checkIcon` 14, `coachDot` 6 and `coachDotCurrent` 16 long, `menuElevation` 12; the brand's `stackedLockupWidth` 150 and the mascot's `mascotHero` 210, `mascotLarge` 128 and `mascotMedium` 96. The coach's mascot (56), hand (44) and touch ring (40) are `StudyStyle`'s ([ADR 0166](../adr/0166-draw-no-mascot-during-a-study-session-let-it-present-the-coach-with-a-back-and-a-next-and-a-tilted-hand-and-fill-an-empty-day-s-bar.md)).
- **Edges**, `AppShadow` ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)): a hard offset with no blur, its heights `AppSize`'s: `edgeCard` 6 for a card, a group and a quiet button, `edgeButton` 7 for a primary, `edgeRow` 5 for a row and the tab bar, in `edge` or the object's own darker colour; `edgePressed` 2 is what a press leaves.

### Fonts

- Pretendard 1.3.9, Regular to ExtraBold, bundled under `app/assets/fonts/` with its OFL licence and read by the web app from there; nothing is downloaded at run time. The files are `public/static/*.otf` of `Pretendard-1.3.9.zip` from the v1.3.9 release of github.com/orioncactus/pretendard (SHA-256 `04be351a74d6bf7d60c480a3087e51d185485d35a52023142af1df19eb8c428a`), each byte-identical to the npm package `pretendard@1.3.9`, whose tarball matches the registry's sha512 integrity. The release page publishes no checksum, so that cross-check stands in for one. The mover is the PM, by the same verification.
- Jua, from the commit of github.com/google/fonts named in `app/pubspec.yaml`, is bundled beside it with its licence in `OFL-Jua.txt`, and read by the web from there. It draws only what we write, in the styles the type table marks; everything a user wrote is Pretendard, always ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)). A character it lacks falls back to Pretendard ExtraBold: the web declares it at 800 with `font-synthesis: none`, and the phone asks for its own w400, which Flutter does not thicken, and falls back to `PretendardExtraBold`, a family of that one face.

### Google's button

Google sign-in is Google's own button, drawn to its Sign in with Google branding guidelines (developers.google.com/identity/branding-guidelines, read 2026-10-15 and again 2026-11-04) rather than to the tokens: `GoogleButtonStyle` in `app/lib/account/src/google_button.dart` holds its light and dark fill, stroke and label colours, its 14/20 label in Google Sans Medium, its 20 px mark, and its spacing per platform ([ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md)). Only `account` draws it, so it lives there, not in `design/`.

- The "G" mark under `app/assets/google/` is cropped, unscaled and unrecoloured, from the icon-only "Square" Android and Web PNGs of the light and dark themes, at 1x to 4x, in Google's asset bundle `https://developers.google.com/static/identity/images/signin-assets.zip` (SHA-256 `ba884069e12093b06bcfd776915081254a7c95094b80d50be2c5dc6bac1c1da1`, downloaded 2026-10-15).
- The bundle carries no licence file. Its use is governed by the branding guidelines, which require the standard-colour mark and forbid its modification, and by Google's Guidelines for Third Party Use of Google Brand Features, which the guidelines name for any use they do not cover; the guidelines page's own text is under CC BY 4.0.
- The label's font is Google Sans Medium, which the guidelines' Font section names for the button. `app/assets/fonts/GoogleSans-Medium.ttf`, which the phone bundles, and `GoogleSans-Medium.woff2`, which the web serves, are a subset of Google's variable `GoogleSans[GRAD,opsz,wght].ttf` at the commit and SHA-256 `app/pubspec.yaml` names: pinned at weight 500, its optical size and grade at their defaults, and cut to Basic Latin and the characters of the button's labels, a Modified Version the SIL Open Font License 1.1 in `OFL-GoogleSans.txt` permits, since the font has no Reserved Font Name. Google Sans has no Hangul, so a Korean label's other characters fall back to Pretendard.
- `tools/fonts/google_sans.py` writes both files with fontTools' instancer and subsetter, the tools of the font's own maintainers, at the fontTools and Brotli releases `tools/fonts/uv.lock` pins with each file's hash: `uv run --project tools/fonts --locked python tools/fonts/google_sans.py` from the repository's root. It downloads Google's file, fails on another hash, and fails when a label it covers is no longer in its source file. `scripts/check-generated.ts` reruns it and fails when either file differs. Dependabot proposes fontTools and Brotli bumps, which land with the rewritten files; the full variable file is never committed.
- The web declares the WOFF2 in the root layout through `web/src/styles/fonts/` without preloading it, so only a page drawing the button fetches it.

### Theme choice

The user picks 시스템 (the default), 라이트 or 다크 from the settings screen's "화면" section, whose "테마" row shows the choice and opens a sheet of the three. The choice is stored on the device with `shared_preferences`, read before the first frame, and applied at once. The web's is [`web.md`](../web.md)'s.

## Rationale

- [ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md) records the cobalt palette, why `accent` is apart from `primary`, why an edge is decoration, why Jua draws only what we write, and why the phone asks for Jua's own weight.
- [ADR 0151](../adr/0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md) records the grade line, the 기록 tab's redraw, and why the heat steps' second step is darker than the owner's.
- [ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md) records the rounder system, the two chart colours and why a fill under 3:1 is carried by its label, and a deck tile with no colour.
- [ADR 0139](../adr/0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md) records the warm tokens, why 모른다 moved to a crimson, and the rounder, taller buttons.
- [ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md) records why the web's tokens moved with the app's.
- [ADR 0103](../adr/0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md) records the deck palette and why it holds no green or red.
- [ADR 0104](../adr/0104-draw-the-streak-flame-in-five-stages-by-the-streak-s-days-burning-at-every-stage.md) recorded the streak flame's five stages; ADR 0151 records why the flame went.
- [ADR 0027](../adr/0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) records Pretendard and the token values with the three adjusted for contrast; issue #72 records them as the PM decided them on 2026-10-15.
- [ADR 0021](../adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md) records why the scales sit in the theme file; issue #58 records the scales as the PM decided them on 2026-10-15.
- [ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md) records why Google sign-in is Google's button with the bundle's PNG mark; issue #64 records it as the PM decided it.
- [ADR 0011](../adr/0011-shared-app-theme-bundled-font-and-today-builder.md) records why the theme is one file with a token extension, why the font is bundled, and why the choice is stored in `shared_preferences`.

## Open questions

None.
