# ADR 0095: Give each card row on the deck screen a pencil that opens the card in the editor

> Status: superseded by ADR-0118
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- On the deck screen a tap on a card row shows or hides its back, and a long-press opens the card in the editor. A screen reader reaches the editor through the row's custom action "카드 편집" ([ADR 0036](0036-organise-the-app-in-today-decks-and-record-tabs-and-define-the-daily-goal-forecast-and-card-progress.md); `design/principles.md` §Direct manipulation where it is natural).
- Nothing on the row shows that it can be edited. `design/principles.md` §Content over chrome rules out a line explaining the long-press. A sighted user who does not know the gesture has no way to find it, though the editor is the only place a card is corrected or deleted.
- Correcting a card is frequent: photo import writes cards from a model's reading of a page, and a wrong meaning or a typo is found while browsing the deck.
- Issue #322 proposed either a trailing edit control on each row, keeping the tap as the toggle, or a tap on the front that opens the editor. The PM accepted a visible, named way to edit each row, with the long-press kept as a shortcut. The shape was left to the worker.

## Decision

- **The pencil.** Each `CardBackRow` ends in an `IconButton` with Lucide's `pencil` in `ink2` and the tooltip "카드 편집", at Material's 48 pt target. It opens the card in the editor.
- **The tap is unchanged.** A tap anywhere else on the row still shows or hides its back, and the long-press and the screen reader's "카드 편집" action on the row stay as shortcuts.
- **Two nodes.** For a screen reader the row is two nodes: the toggle, read as before with its "카드 편집" action, and the pencil, a button named by its tooltip. The ink of the tap covers the toggle's part of the row and not the pencil.
- **Alternatives considered:**
  - **A tap on the front opens the editor, and a tap on the back's bar toggles it.** It changes what a tap does on a screen whose taps users already know, and the bar is a small target.
  - **A trailing "더 보기" menu holding "편집".** It costs two taps for the row's one action besides the toggle, and hides the word behind a second icon.
  - **A hint line on the screen about the long-press.** `design/principles.md` §Content over chrome rules it out.

## Consequences

- Editing a card is visible on every row and takes one tap.
- Each row gains one icon, and its front and back have 36 pt less width: the pencil's 48 pt less the 12 pt the content's right padding gave up.
- `CardBackRow` draws the row surface's ink itself, since the surface's own ink would cover the pencil and make the row one tappable node around it.

## Signs the decision was wrong

- Users tap the pencil when they meant to see the back, or the reverse.
- A long front or back wraps more often than before on a phone's width.
