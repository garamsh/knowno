# ADR 0021: Draw every screen from one type, spacing, radius and height scale in the theme file, and build every button, field, row and modal from a shared component layer in `app/lib/shared/ui/`

> Status: accepted; its type values, field radius and height, and `study` button variant superseded by ADR-0027; its folders `app/lib/shared/ui/` and `app/lib/shared/theme.dart` superseded by ADR-0039
> Date: 2026-10-15

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #58: after using a release build, the owner found the modals, such as "새 덱", inconsistent and not designed by one hand, and asked for a professional-grade visual pass.
- The PM's audit of `main` before this change:
  - seven modals were built by hand in their screens: four Material `AlertDialog`s (the deck name dialog, the card delete, the deck delete and the sign-out warning) and three bottom sheets (the duplicate sheet, the photo import deck chooser and the study screen's whole-card sheet);
  - `app/lib/shared/theme.dart` held the colours of [ADR 0011](0011-shared-app-theme-bundled-font-and-today-builder.md) and two radii, but no text theme, so screens drew Material's default sizes;
  - 42 `EdgeInsets` and 15 spacer `SizedBox`es under `app/lib/` were written as literal numbers;
  - the owner-approved canvas itself used four title sizes (22, 24, 26, 28) and six radii (14 to 24).
- ADR 0011 allowed sizes and timings to stay as constants beside the screen that uses them. That left the values above free to drift, one screen at a time.
- The PM decided the scales and the component set in issue #58; this ADR records them as the project's rule. Alternatives considered:
  - Keep Material's widgets and theme them only through `ThemeData`. A theme can set a dialog's colours but not its layout: the "새 덱" dialog would still put two small text buttons at the top of the screen, against [`design/principles.md`](../design/principles.md) §One primary action per screen.
  - Put the components in a domain, or in each domain. They serve every domain, so in one domain the others would depend on it for buttons; in each, they would drift apart again.
  - A third-party component library. It would bring its own visual language to restyle, and a dependency to pin and move, for widgets that are each a few dozen lines over Material.

## Decision

- **Scales.** `app/lib/shared/theme.dart` holds, beside the colours:
  - the type scale as `AppType`, all IBM Plex Sans KR with explicit line heights, and as the theme's `TextTheme`: display 28/700, title 22/700, headline 20/700, body 16/400, body-strong 16/600, label 15/600, secondary 14/400, caption 13/400, section 13/600 and micro 12/400, with letter-spacing −0.5 at 28 and −0.3 at 22;
  - the spacing scale as `AppSpace`, on a 4 px base (4, 8, 12, 16, 20, 24, 32, 40), with a screen gutter of 20 and a row gap of 8;
  - the radii as `AppRadius` (sheet 28, card 24, row 18, button and field 16, a chip fully rounded), the heights as `AppSize` (call to action 56, button 52, field 48, tap target 44) and the two shadows as `AppShadow` (card, raised).
- **No literal outside the theme.** No file under `app/lib/` outside `shared/theme.dart` and `shared/ui/` writes a spacing or font-size number. The study screen's computed geometry is the one listed exception. This replaces ADR 0011's "Sizes and timings may stay as constants beside the screen that uses them" for spacing, type, radii, heights and shadows; timings and the study screen's own geometry stay in `study_style.dart`.
- **Components.** `app/lib/shared/ui/` holds the shared, domain-free components every screen builds from: `AppButton`, `AppTextField`, `AppSheet` with `showAppSheet`, `showAppConfirm`, `AppListRow` with `AppRowSurface`, `AppSectionLabel` and `AppChip`. Like the theme, it sits below every domain: it imports only Flutter, the theme and the shared strings.
- **Every modal is an `AppSheet`.** No screen builds an `AlertDialog`, calls `showDialog`, or calls `showModalBottomSheet` other than through `showAppSheet`. Every irreversible action is confirmed through `showAppConfirm`.
- **Checks.** `app/test/shared/theme_test.dart` fails on a spacing or font-size literal outside the theme and the components, and on a dialog or a sheet opened other than through `showAppSheet`.

## Consequences

- A change to a size, a radius or a modal's layout is one edit in one file, and reaches every screen.
- A new screen picks its values from a short list rather than inventing them, and a reviewer has a rule to cite when it does not.
- The components are a layer every domain depends on; a change to one is reviewed against every screen that uses it.
- A value the scales do not hold needs an edit to the theme file first, which makes an exception visible rather than local.
- Material widgets a screen still uses directly, such as `SegmentedButton`, `PopupMenuButton` and `IconButton`, are themed in the theme file but are not components.

## Signs the decision was wrong

- Screens need values between the steps often enough that the scales grow a step per screen, or the literal scan gathers exceptions beyond the study screen's geometry.
- A component grows parameters that one caller uses, or two screens wrap one component in the same extra layout, so the component no longer matches the pattern it was drawn from.
- A modal's content needs a form `AppSheet` cannot hold, such as a full-screen editor, and screens start working around `showAppSheet`.
- The owner still finds two screens that look designed by different hands.
