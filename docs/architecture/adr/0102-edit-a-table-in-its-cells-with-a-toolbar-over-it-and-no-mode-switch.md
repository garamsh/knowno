# ADR 0102: Edit a table in its cells, with a toolbar over it and no mode switch

> Status: accepted; its "빈칸" toggle refined by [ADR 0110](0110-blank-a-span-of-a-table-cell-s-text-stored-at-table-block-v2-beside-whole-cell-blanks.md); its question before removing a row or column that holds text superseded by [ADR 0174](0174-undo-every-delete-in-the-card-editor-focus-what-an-add-makes-and-show-what-a-refused-save-refuses.md)
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **[ADR 0083](0083-write-every-card-kind-by-hand-in-a-form-of-its-own-chosen-by-a-kind-switch-each-deck-remembers.md)**'s table form switches between two modes, so that one gesture serves each region:
  - "칸 입력", where every header and cell is a field, with delete buttons over each column and after each row;
  - "빈칸 고르기", where each cell is a tile that a tap makes a blank.
- **Issue #378** records the owner's decisions of 2026-10-26:
  - a table is edited like a spreadsheet: a tap on a cell edits it in place;
  - a toolbar above the table offers "행 추가", "열 추가", "빈칸", which toggles the selected cell as a blank, and "지우기", which removes the selected cell's row or column, asked first where cards would lose content;
  - the mode switch is removed;
  - blanks are drawn as tinted cells;
  - storage is unchanged.
- Alternatives considered:
  - **Keep a delete button over each column and after each row.** The toolbar's "지우기" acts on the selected cell, and the owner asked for the toolbar.
  - **"지우기" removing a fixed one of the two, the row for a body cell.** A body cell sits in both a row and a column, so the choice is offered as a menu of both. A header lies in no row, so its menu holds the column alone.
  - **Ask before every removal.** The owner asked only where content would be lost, so an empty row or column goes at once.

## Decision

- **Cells.** Every header and cell is a field edited in place.
  - A tap selects a cell and edits it. The keyboard's next moves to the next cell, and every edit stays in its cell.
  - The selected cell is outlined in ink, and it stays selected while a toolbar button is pressed.
  - A blank is a cell tinted `brandTint`.
  - Each cell is read with its place, and ", 빈칸" after it when it is a blank.
- **The toolbar** sits over the table, read as "표 도구".
  - "행 추가" and "열 추가" add a row or a column at the end.
  - "빈칸" is a toggle that shows whether the selected cell is a blank, and makes it one or a plain cell again. It is offered on a body cell alone: headers are never blanks ([ADR 0068](0068-store-a-table-or-cloze-card-as-typed-content-blocks-and-draw-it-whole-its-blanks-filled-in-place-once-answered.md)).
  - "지우기" opens a menu of the selected cell's row and column, each disabled while it is the last one left.
    - Removing one that holds text asks first through `showAppConfirm`; an empty one goes at once.
    - Removing moves the blanks with their cells and drops those removed.
- **No mode.** No action needs a mode, and the switch is removed.
- **Storage is unchanged:** ADR 0068's table block.
- **Supersedes** ADR 0083's table form switch between typing the cells and choosing the blanks, with its per-row and per-column delete buttons and its blank tiles. The rest of ADR 0083 stands.

## Consequences

- One tap edits a cell, and one more makes it a blank, with no switch between them.
- Removing a row or a column takes a selection and a menu choice, where a button beside it took one tap.
- A blank on a cell that has no text is still refused on save, its cell outlined in red.

## Signs the decision was wrong

- Users remove the wrong line because the menu offers both the row and the column.
- Users miss "빈칸" because the toggle sits apart from the cell, and blanks are set less often than they were.
- Wide tables become hard to edit, because a selected cell scrolls away from the toolbar.
