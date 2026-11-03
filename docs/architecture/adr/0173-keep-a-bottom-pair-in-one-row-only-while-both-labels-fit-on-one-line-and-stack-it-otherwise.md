# ADR 0173: Keep a bottom pair in one row only while both labels fit on one line, and stack it otherwise

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #606.** Where photo import is unavailable, the phone's failure screen and the reading screen's foot offer "엑셀·CSV 파일" beside "직접 입력", the primary.
- **The secondary was capped at half the row.** [ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md) gave the secondary of a bottom pair its label's width and the primary the rest, at most half for the secondary, and let a label wrap inside its button at text scale 2.0.
- **"엑셀·CSV 파일" is wider than half.** At text scale 1.0 on a 390 wide phone, in Jua at the cta size, the button is 179 wide against a half of 169, so the label broke inside "파일". The pair together is 179 + 12 + 126, inside the 350 the row holds.
- **The PM's decision on #606**: fix the shared rule rather than each foot, keep the label "엑셀·CSV 파일", and stack the pair where it does not fit, at the text size shown.

## Decision

`BottomActions` lays its two buttons in one row, the secondary at its label's one-line width and the primary the rest, only while both labels fit on one line there at the text size shown; otherwise both take the full width, stacked, the primary last.

## Consequences

- No label of a bottom pair wraps while the pair is in one row, at any width or text size.
- A larger system text size stacks a pair sooner: at 390 wide, 새 노트's and the card editor's Korean pairs stack from text scale 1.5, their English ones from 1.3, and the unavailable pair from 1.3 in Korean and at 1.0 in English.
- A stacked pair takes one cta height and a gap more of the screen, which the card editor's foot gives up above the keyboard.
- ADR 0150's "at 2.0 a label may wrap inside its button" no longer holds: at 2.0 every pair the app draws stacks.

## Signs the decision was wrong

- A stacked foot leaves too little of a screen for its content at a large text size, such as the card editor's fields above the keyboard.
- Users read a stacked pair as two unrelated actions, or reach for the top one as the primary.
