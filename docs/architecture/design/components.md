# Design components

The shared components of the phone and the web: which one draws each UI job, where each lives, and when each is used. Each component's anatomy is its doc comment.

## Current decisions

### Where they live

- `app/lib/design/` is the app's foundation of shared, domain-free components, one file per component, tested under `app/test/design/` ([ADR 0021](../adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md), [ADR 0039](../adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md), [`structure.md`](../structure.md)). It imports no domain and holds nothing one domain alone uses. It holds `app_button.dart`, `app_chip.dart`, `app_choice.dart`, `app_list_row.dart`, `app_menu.dart`, `app_raised.dart`, `app_search_field.dart`, `app_section_label.dart`, `app_sheet.dart`, `app_text_field.dart`, `bottom_actions.dart`, `dashed_outline.dart`, `keyboard_dismissal.dart`, `mascot.dart`, `mascot_drawings.dart`, `round_check.dart`, `theme.dart`, `theme_choice.dart` and `word_break.dart`.
- `web/src/design/` is the web's foundation ([`web.md`](../web.md)), one file per component or helper that two or more features or routes draw through; [`structure.md`](../structure.md) §Top-level folders is the one list of its files.
- A piece one domain or feature alone uses stays in it: `CardText` and `HatchedBox` in `deck` ([`deck.md`](../deck.md)); `ListMessage` in `sharing`; `GoogleButtonStyle` in `account` ([`theme.md`](theme.md)); `ListHeaderActions` in `app/lib/home/src/list_header.dart`, which `home` alone draws today.

### One component per job

A screen draws each job through the component named here, not from Material widgets or raw elements ([`principles.md`](principles.md) §One component per UI job). Where the web column says "none yet", the web repeats the job per site today.

| Job | Phone | Web |
|---|---|---|
| A button, every one in content and in bars | `AppButton`; `AppButtonVariant` and `AppButtonSize` say which variant and size a use takes | `buttonClass` (`button.ts`), a closed `ButtonVariant` of the roles the web draws at a `ButtonSize`, on a button, a link or a file input's label (#642) |
| A solid object on its edge, moved down by a press | `AppRaised` | `shadow-card`, `shadow-row` |
| A text field | `AppTextField`, `AppSize.field` high | none yet |
| A list's search field | `AppSearchField`, `AppSize.search` high, 48, since the whole field is its tap target (#645) | `SearchField` |
| A row choosing one of several options, and its sheet | `AppChoiceRow`, opening `showAppChoice`, whose rows are `AppListRow`s, the current one checked | none yet |
| A row marked as chosen in a list | `RoundCheck` | none yet |
| A modal | `AppSheet` opened with `showAppSheet`; no dialog | `Sheet` (`sheet.tsx`), a native modal `<dialog>` at the foot below 1024 px and centred from 1024 px, its title beside "닫기" over an optional one or two sentences of body; `decks`' full-screen authoring screens open through its `useModalDialog` |
| A pull-down menu | `AppMenu`, held `AppSpace.gutter` inside the screen's sides | `RowMenu` (`row-menu.tsx`), behind ⋯: a 칸's, the note's settings, the 노트 page's, photo import's and the chat's; `raised`, its trigger on a page's header |
| A confirmation of what cannot be undone | `showAppConfirm` | `Confirm` |
| A screen's frame: title, actions, search, body, primary | `ScreenSkeleton` | none yet |
| A screen's bottom bar | `BottomActions` | none yet |
| A list row | `AppListRow`, or `AppRowSurface` for a row with its own layout (a card row, a skeleton row) | none yet |
| A group of rows | `AppGroup`, `SliverAppGroup` for a long list | the `group` radius and hairlines per site |
| A section label over a group | `AppSectionLabel` | `Section` |
| A chip, status or action | `AppChip`, `AppChip.action`; tones `AppChipTone`, `knowTint` the green tint 기록's gain draws | `Chip`, in `AppChipTone`'s tones and `knowTint` |
| What study hides, in a card list's row | `HatchedBox` (`deck`), on `AppHatch` | the `hatch` utility |
| An outline that is not an object, a place to come | `DashedOutline` (`study`, which alone draws one since 홈's week card went, ADR 0193): its place for the previous card | per site |
| A read failure with "다시 시도" | `ListMessage` (`sharing`), in place of browse's decks and a public deck's cards | `ReadFailureMessage`, a sentence over "다시 시도" (`RetryButton`), a way to sign in, or nothing more |
| A skeleton while content loads | `AppRowSurface` rows (photo import) | `Skeleton`, `SkeletonLine` |
| A figure or label fitted to a narrow column | `FittedBox` with `BoxFit.scaleDown` | `FittedLine` |
| A card text the engine read, its marks, lists and clozes | `markupSpan` | `MarkupText` |
| The keyboard's dismissal | `KeyboardDismissal`, wrapping every route from `KnownoApp` | the browser's |
| The mascot | `Mascot` | `Mascot` |
| A card side's text | `CardText` (`deck`) | `decks`' card blocks |

### When each is used

- `AppButton`: every button; no screen draws Material's `TextButton`. The quiet variants: `text` for an action in a bar or beside content, as the spreadsheet import's "다른 파일" and the coach's "이전"; `faint` for an offer made in passing, study's "안내 다시 보기"; `link`, underlined, for the terms and the privacy policy on sign-in and in the settings' foot. Photo import's list keeps two `TextButton`s (#645): the chosen note's name set inside its sentence at the sentence's size, and a section's form menu anchor in the caption size with its chevron, neither a button size. One primary fill per screen or sheet ([`principles.md`](principles.md) §One primary action per screen). Size `cta` for the actions at the bottom of a screen or sheet, `regular` elsewhere, `header` for the tonal action beside the 노트 tab's and the deck screen's title ([ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md)). A pressed button dims under its label's colour with no splash and gives no haptic of its own; its loading state shows the work it started.
- `AppTextField`: every text field. Focused, it draws a 2 px ink ring; a field inside a group draws no border until focused, then a 1.5 px ink outline and no shadow, which `AppTextField` takes on when the card editor's redesign brings it there. Inside a white group whose fields have none, as 새 노트's name, the field takes the `ground` fill and the label the group's inset ([ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md)).
- `KeyboardDismissal` (issue #437, issue #479, [ADR 0171](../adr/0171-give-every-type-in-the-add-sheet-an-icon-and-a-line-and-keep-a-field-s-selection-through-a-scrolling-drag.md)): no screen has its own. A multi-line field keeps its newline key, but a table cell, whose "next" moves to the next cell ([ADR 0102](../adr/0102-edit-a-table-in-its-cells-with-a-toolbar-over-it-and-no-mode-switch.md)); a single-line field's action key is "next" where a form names the field after it, as the publish sheet does, and otherwise closes the keyboard.
- `AppSheet` ([ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md)): every modal; a sheet's actions hold no cancel.
- `showAppConfirm`: every irreversible action ([`principles.md`](principles.md) §Correct, don't confirm); the one sheet with a cancel, "취소" unless the caller names it, its red final button last, which gives a light haptic.
- `AppListRow`: the option sheets' rows (`showAppChoice`), the browse rows, the photo import source sheet and deck chooser, and the settings screen's rows, each its words alone; the card editor's "칸 추가" sheet alone passes a leading icon, its rows one `AppGroup` ([`brand.md`](brand.md) §Icons). A destructive row, the deletion, is red ([ADR 0026](../adr/0026-delete-the-account-through-an-edge-function.md)). On a sheet a row takes the `ground` colour.
- `AppChoiceRow`: the settings' "하루 학습 시간" and "테마", and the spreadsheet import's sheet, columns and note. Its value and chevron go under its title, at the row's end, where the two do not fit one line; the title stays at the row's start. Disabled, its title, value and chevron are `muted`, as a disabled `AppChip`'s label, and it reads as disabled.
- `AppGroup`: one group per meaning; the settings screen's sections, a public deck's previewed cards, and the deck screen's cards as a `SliverAppGroup` ([ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md)).
- `AppSectionLabel`: "계정", "학습", "화면", the import sheet's duplicate options, and the front and the back in the whole-card sheet.
- `ScreenSkeleton`: the 노트 tab, the deck screen, 설정, 둘러보기, a public deck and 새 노트 ([`frames.md`](frames.md) §Screen skeleton); it owns the gutters and the bar's height, so a screen passes slivers and no padding of its own.
- `BottomActions`: 새 노트, the card editor, and photo import's failure and reading screens where it is unavailable ([ADR 0150](../adr/0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), [ADR 0173](../adr/0173-keep-a-bottom-pair-in-one-row-only-while-both-labels-fit-on-one-line-and-stack-it-otherwise.md)).
- `AppChip` ([ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)), 12 by 4 around its words, which break only between words: the "오늘 n" and "공개" chips, the 기록 tab's retention gap and mastered gain, amber for a shortfall and `knowTint` for a gain, and the study card's drag hint. The 라벨 screen's labels, drawn by hand on the brand tint, become `AppChip`s once #706 has changed that screen (#645). On the web, 기록's gap and gain chips and the admin menu's count of new reports, neutral, are `Chip`s too. `AppChip.action`, its tap target made up to 48: the cloze's and the table's tools and the label strip's labels. No screen draws a Material chip.
- `CardText` ([ADR 0027](../adr/0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md)): a card side's text, centred, scaled from its style's size to a floor (front 42 to 18, back 20 to 15) until its widest word fits the half. The current card and the full-screen preview step their text instead, through `cardSteps` and `steppedStyle`: the largest of the steps `front`, `deckName`, `back` and `cardBody`, from the one the caller starts at, at which the side fits whole, its widest word inside the card's width; study starts its front at the step its length gives ([ADR 0176](../adr/0176-start-study-s-front-at-a-size-its-length-gives-and-draw-what-study-hides-on-the-hatch.md)); centred above the body size and start-aligned at it; past it `CardScroll` scrolls the side inside the card, its bottom edge fading into `surface` ([ADR 0123](../adr/0123-step-a-long-card-side-down-through-three-sizes-then-scroll-it-inside-a-card-that-keeps-its-size.md)). The previous card's sides, run together as one paragraph, are scaled further, as far as the floor, until they fit their half's height, and cut there ([ADR 0042](../adr/0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md)). A whole card's sentence is drawn through it as a span ([ADR 0068](../adr/0068-store-a-table-or-cloze-card-as-typed-content-blocks-and-draw-it-whole-its-blanks-filled-in-place-once-answered.md)).
- `keepWords` (`word_break.dart`): every Korean string the app lays out, read by a screen reader as written ([`principles.md`](principles.md) §Nothing clipped).

### Material widgets

- Those a screen still draws directly, `IconButton`, `PopupMenuButton`, `SegmentedButton`, `Checkbox` (the publish sheet's `CheckboxListTile`), `Switch` and `LinearProgressIndicator`, are themed in `theme.dart`. The public-deck import sheet's `DropdownMenu` and `RadioListTile` in a `RadioGroup` take the theme's colour scheme.
- `AppMenu`, over `MenuAnchor`, is an iOS pull-down menu: the 노트 tab's and the deck screen's ⋯ and the photo import list's form menus. It hangs `AppSpace.s4` under its anchor and keeps `AppSpace.gutter` from the screen's sides, where `MenuAnchor` alone keeps none (issue #661), placed at its anchor rather than by each menu ([ADR 0065](../adr/0065-import-a-photo-s-cards-from-one-list-of-sections-each-with-its-form-menu-row-checks-and-an-edit-sheet.md)): on `raised` with the `menu` radius and a soft shadow, its items body text at least a tap target high; the screen draws the leading checks and the heavier separator between groups.
- The switch, on the deck screen, is the ink track under an `onInk` thumb when on, and the surface track inside a `muted` outline under a `muted` thumb when off.
- A segmented control (the web admin's view switch) keeps one edge, its bar's: the current segment is a flat `brandTint` fill with no raised edge of its own.
- The current tab or menu item is `accent` in Jua, the others `ink2`; a tab is its name alone on a bar floating on its edge, and the side menu keeps its icons, the current one's on a `brandTint` pill ([ADR 0147](../adr/0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)).

## Rationale

- [ADR 0021](../adr/0021-type-and-spacing-scales-and-a-shared-component-layer.md) records why the components are a shared layer of their own and why every modal is a sheet; issue #58 records the component set as the PM decided it on 2026-10-15.
- [ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md) records why a sheet has a cancel only when it confirms an irreversible action; issue #64 records the sheet rule.
- [ADR 0119](../adr/0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md) records why there is one chip.
- [ADR 0123](../adr/0123-step-a-long-card-side-down-through-three-sizes-then-scroll-it-inside-a-card-that-keeps-its-size.md) records why a long card side steps down through three sizes and then scrolls.
- [ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md) records the tonal header action and the always-shown search.

## Open questions

- Whether `EditorGroup` is `AppGroup` with a field theme or a job of its own, and whether 기록's period choice is `AppChip.action`, `SegmentedButton` or a component of its own (#645, the PM's).
