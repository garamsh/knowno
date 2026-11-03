# ADR 0119: Draw every screen from one radius scale, one chip, three type sizes, a press dim and three haptics, and a hidden blank as an empty underlined gap

> Status: accepted; its button radius of 12 superseded by ADR-0139; its radii of 14, 6 and 22 superseded by ADR-0145; a press with no movement and three sizes counting a button's label superseded by ADR-0147; its hidden blank as an empty underlined gap, on study's cards, superseded by ADR 0176
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0118](0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) wrote issue #454 §3 into `design/principles.md`, and left the radius scale, the motion and the haptics to be reached "screen by screen". The editor redesign (#456) found that a screen-by-screen reach leaves the shared layer, which every screen draws from, off the standard. Issue #457 brings that layer to it.
- **What the layer drew on 2026-10-27**, `app/lib/design/theme.dart` at `ea14ba6d575f9874200cf8c07a6b47860ae02e21`:
  - radii of button 16 and sheet 28, chips fully rounded, and the editor's label chip at a radius of its own, 6;
  - four chip shapes: `AppChip`, the today tab's `_Pill`, the record tab's retention chip, and Material's `Chip`, `ActionChip`, `FilterChip` and `ChoiceChip` in the study card's drag hint and the editor's cloze, table and label tools;
  - type of 15 for a button, 14 for secondary text and 12 for a chip, beside 16 and 13. The screenshot run of `app/test/screenshots/` measured four to six sizes on 57 of its 98 screens and sheets;
  - Material's ripple on every press, and a light haptic from every filled `AppButton` on iOS, whatever it did;
  - an empty blank as its answer drawn in `hairline` on a `hairline` fill: a grey bar, which #454 §3 says reads as loading.
- **The web mirrors the app's tokens**: `web/src/styles/__tests__/theme-tokens.test.ts` fails when a `--radius-*` or `--text-*` value of `web/src/styles/globals.css` differs from `theme.dart`. The web follows #454 in its own issue (#446), so the PM chose to move both together over keeping the old values for the web.
- **Alternatives considered:**
  - **New tokens beside the old ones**, `AppRadius.button12` and new type roles, so the web keeps its values. Two scales would stand side by side, and #454 asks for one.
  - **Remove the type roles whose values now equal another's**, `label` beside `bodyStrong` and `secondary` and `micro` beside `caption`. Every screen that names a role would change for a rename alone; a role names a use, and two uses may share a size.
  - **Dim a press by opacity.** It needs a pressed state in each widget that draws a press, and leaves every `InkWell` a screen draws itself without one. A highlight from the theme reaches every `InkWell` and Material button.
  - **Keep the filled button's haptic on iOS.** #454 §3 names three haptics and no other; a haptic on every filled button made a save, a sign-in and a "건너뛰기" feel the same.
  - **Draw an empty blank as a muted bar of lower contrast.** It is still a bar. An underline marks a gap to fill, as on paper.

## Decision

- **Radii.** `AppRadius` holds one scale: `group` 14, `button` 12, `chip` 6 for a chip and a label, `sheet` 22. The theme draws Material's buttons, sheets and chips in them, and the editor's group and label chip take `group` and `chip`. The other radii, of cards, the previous card, a lone row, a field, a menu and the sign-in panel, are not part of #454's scale and keep their values.
- **One chip.** `AppChip` is the only chip: radius 6, the `section` type, padding of 8 by 4, in a tone of neutral, brand, amber, know or don't-know, after an optional leading mark such as the flame. `AppChip.action` is the same chip pressed to act or to toggle, its tap target made up to Material's 48 around it, selected in the brand tint. The today tab's chips, the record tab's retention chip, the drag hint and the editor's tools use it. `app/test/design/theme_test.dart` fails on a Material chip under `app/lib/`.
- **Three sizes per screen.** A screen's chrome draws in a title, the body and a caption. The title's size is the screen's own: 22 for a pushed screen, 26 for a tab, 18 for a sheet. The body is 16, `body`, `bodyStrong` and `label`, so a button's label is the body size. The caption is 13, `caption`, `section`, `secondary` and `micro`. Outside the count:
  - a large figure, `AppType.figure`, with its unit;
  - a card's own content on the study and preview cards;
  - Google's button, drawn to Google's guidelines.
- **The screens a role changed on**: a text block of a whole card in a deck screen's row draws in the row's style in bold, not the headline; the record tab's target percent and a photo group's header take `bodyStrong` in place of the headline; the tab bar's label shrinks to its tab, on one line, where a large text size is wider than it.
- **Press.** A pressed button or row is drawn under its text's colour at 10%, at once, with no splash and no change of size: the theme's `splashFactory` is `NoSplash` and its `highlightColor` is `AppColors.pressed`, `ink` at 10%, which Material's buttons already draw from their label's colour. Reduce motion needs nothing, since nothing moves.
- **Haptics.** A light haptic on answering a card (unchanged), on saving a card in the editor, and on the red button of `showAppConfirm`, on every platform. `AppButton` gives none of its own.
- **A hidden blank** in `WholeCardView` is a gap of its answer's width over a `muted` underline, its answer not drawn; a filled one is unchanged, the answer on `brandTint`. Study, the editor's preview, the photo import list and the deck screen's rows draw it alike.
- **Refines** ADR 0118's [`design/principles.md`](../design/principles.md), now held by the shared layer rather than reached screen by screen; ADR 0068's empty blank; ADR 0021's type scale and radii; and ADR 0027's token values.

## Consequences

- A new screen built from the shared components meets the radius scale, the one chip, the press and the type of [`design/principles.md`](../design/principles.md) without a fix of its own.
- The web's buttons, sheets and the text in the `label`, `secondary` and `micro` styles change with the app's: buttons 12 in radius, sheets 22, button labels 16, secondary text and chips 13.
- A sheet's body, a line under a title and a row's back in a list are 13 where they were 14, and a chip's text 13 where it was 12.
- The screenshot run fails on a screen that draws a fourth size, so a new screen is checked whenever the screenshots are taken; the test suite checks the scale, not each screen.
- Filled buttons on iOS lose their haptic, and Android gains the save and destructive-confirm haptics.

## Signs the decision was wrong

- Users miss a press: a pressed row or button reads as unpressed without the ripple.
- Users take an empty blank's underline for a link, or miss that a gap is there.
- The 13 px secondary text is reported as hard to read in a sheet's body.
- A screen needs a fourth size to say what it must, and the count is worked around rather than met.
