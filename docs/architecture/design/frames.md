# Design frames

The layouts screens are built from on the phone and the web: each frame's parts in order, its tokens and the component that draws it. A screen names the frame it uses and describes only what is its own.

## Current decisions

Values are [`theme.md`](theme.md)'s tokens and components [`components.md`](components.md)'s. A screen that needs a layout no frame gives proposes one here first.

### Screen skeleton

The frame of a screen the user lands on: the 노트 tab, the deck screen, 설정.

1. Header: the title (`deckTitle` for a tab, `deckName` for a name the user wrote), and at its end the screen's own action, `AppButton` tonal at size `header`, then ⋯ holding the other actions (`ListHeaderActions`). The bar grows to the action's line at a large text size.
2. Search, where the screen lists what a user made: always shown under the header, `AppSize.search` high (`ListSearchField`).
3. Body: groups and rows (§Group and section), `AppSpace.sectionGap` between groups.
4. The primary, where the screen has one: in `BottomActions` at the foot, or inside the card it acts on.

Horizontal edges are `AppSpace.gutter` throughout. The 노트 tab and the deck screen use it ([ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md)).

### List row

One row of a list or a group: `AppListRow`.

1. Leading widget, optional, only where [`brand.md`](brand.md) §Icons allows one.
2. Title in `bodyStrong`, `ink` (red for a destructive row).
3. Second line, optional, in `caption`, `muted`, only where the title alone does not say what happens ([`copy.md`](copy.md) §Forms).
4. Trailing widget, optional: a chevron that leads on, a check, a switch, a value.

Inset `AppSpace.s16` at the start and `AppSpace.s12` elsewhere, `AppSpace.s12` between the parts; read as one node. Alone, a row is its own `surface` on the `row` radius over `edgeRow`, `AppSpace.rowGap` below it. A row with a layout of its own (a card row, a skeleton row) is `AppRowSurface` around it.

### Group and section

Rows that share one meaning: a settings section, a note's cards, one 칸 of a card.

1. Section label, optional: `AppSectionLabel`, in `section`, `muted`, read as a heading, inset `AppSpace.s4` with `AppSpace.s8` below it.
2. Group: `AppGroup` (`SliverAppGroup` for a long list), one `surface` on the `group` radius over `edgeCard`; its rows split by a `hairline` 1 px high, indented `AppSpace.s16`, under all but the first. A row inside draws no surface and no gap of its own.

One group per meaning; groups stand `AppSpace.sectionGap` apart. Inside a group a hairline separates the rows, never a border on each field.

### Sheet and dialog

Every modal on the phone: `AppSheet` opened by `showAppSheet`; the web's dialogs follow the same parts.

1. Drag handle, `AppSize.handle`.
2. Title in `title` (`deckName` when it holds a name the user wrote), named by [`copy.md`](copy.md) §Forms.
3. Body, optional: one or two sentences in `secondary`.
4. Content: rows (on `ground`), a field, a choice.
5. Actions, pinned above the keyboard, full width, the primary last; no cancel.

Insets `AppSpace.gutter` at the sides, `AppSpace.s12` above and `AppSpace.s16` below; the `sheet` radius; a blurred shadow, since a sheet floats. A confirmation is `showAppConfirm`: a question title, the consequence in one sentence, then a cancel and, last, the red `destructiveFinal` button.

### Form field

A field the user types in: `AppTextField`.

1. Label in `section`, `ink2`, once, above the field, starting on its left edge.
2. Field, `AppSize.field` high (`AppSize.search` for a search), its text in `body` inset `AppSpace.s16`, a hint inside.
3. Error in `caption` below, as [`copy.md`](copy.md) §Forms writes it; a counter below where a limit exists.

`AppSpace.s8` between label and field. Label, field and error are read as one.

### Empty and failure state

What a screen shows in place of content it has none of, or could not read.

1. Mascot, where [`brand.md`](brand.md) §Mascot names the moment: one, never beside an error's red.
2. One sentence, [`copy.md`](copy.md) §Forms's empty state or screen's error, wrapped between words.
3. The one action that leads out: an empty state's is the screen's primary ([ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)); a read failure's is "다시 시도" (`RetryButton` on the web).

A search with no match is one `muted` line saying to try other words, with no action.

## Rationale

- [ADR 0172](../adr/0172-make-a-note-with-the-choices-of-its-customization-head-the-notes-and-a-note-with-a-tonal-action-and-a-menu-over-an-always-shown-search.md) records the header's tonal action and ⋯ over an always-shown search.
- [ADR 0118](../adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) records one group of hairline rows per meaning.
- [ADR 0145](../adr/0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md) records the shape of an empty state.
- [ADR 0024](../adr/0024-one-voice-and-a-sheet-action-rule.md) records the sheet's action rule.
- The frames are the owner's direction of 2026-11-03 (#647).

## Open questions

- Each frame's generated image, once the PM approves the paths of its generator and check (#647).
