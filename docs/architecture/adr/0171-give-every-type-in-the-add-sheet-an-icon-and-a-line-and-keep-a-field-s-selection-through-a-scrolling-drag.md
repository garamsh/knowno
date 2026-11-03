# ADR 0171: Give every type in the add sheet an icon and a line, and keep a field's selection through a scrolling drag

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The owner, on issue #621, 2026-11-03:** "카드에서 칸 추가시 어떤건 설명있고 어떤건 없는데" and "빈칸 넣을때 아래로 스크롤시 빈칸 선택이 풀리는등 그런 사소한 것들이 불편해".
- **The add sheet.** [ADR 0117](0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md) lists the types "in one grouped list with no icons", each with one line "but 글, whose name says enough", by [ADR 0116](0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md)'s rule that an option row keeps a second line only where its title does not say what happens. The owner read the one row without a line as inconsistent.
  - The PM decided on #621: every row gets the line, since it tells a new user what 빈칸, 표 or 단어 makes, and every row gets an icon, which speeds scanning on a repeat visit.
- **The selection.** `KeyboardDismissal` takes the focus from the focused field when a drag scrolls a scrollable holding it, unless the drag starts on that field (issue #437). In a 빈칸 문장, a drag elsewhere on the form therefore ends the line's focus: the field stops drawing the selection, and the "빈칸 넣기" chip, shown while the line has focus, goes.
  - `app/test/deck/cloze_block_test.dart` shows it: on iOS and Android, a drag from "+ 칸 추가" after a double-tap selected a word leaves the line unfocused. The selection itself was not lost on a rebuild, and the keyboard's inset did not move it.
- **Alternatives considered:**
  - **Icons in the tinted squares the sheet had before ADR 0117.** ADR 0116's "no icon in a tinted square at the start of an option row" stays. A plain icon in `ink2` carries the scanning cue at less weight.
  - **Keep the cloze's chip and redraw its selection while the line is unfocused.** That works against the text field's own drawing, in one 칸 type alone. The PM rejected it.
  - **Stop closing the keyboard on a scrolling drag.** A caret alone has nothing to keep, and the rule that a drag closes the keyboard, which #437 asked for, still holds for it.

## Decision

- **The add sheet's rows.** Each type's row in "칸 추가" is its icon, its name and one 해요체 line under it, on the phone and the web, with the same text on both.
  - The icons are Lucide's, drawn plain in `ink2`, with no tinted square: 글 `type`, 단어 `book-a`, 빈칸 문장 `text-cursor-input`, 표 `table`, 사진 `image`, 소리 `audio-lines`.
  - 글's line is "앞면과 뒷면에 글을 적어요". The other lines are unchanged.
- **A selection survives scrolling.** A drag that scrolls a scrollable holding the focused field keeps the focus while that field holds a selection of characters. With a caret alone, the drag closes the keyboard, as before.
- **Superseded:**
  - ADR 0117's add sheet "with no icons", and its line for every type "but 글". Its one grouped list stays.
  - ADR 0116's "Otherwise text alone", for the add sheet's rows only. Its rule elsewhere stays, including no tinted square.

## Consequences

- Every row in "칸 추가" reads the same way, and a type is found by its icon as well as its name.
- The rows are one form across the clients. A new 칸 type adds an icon and a line on both.
- A selection in any text field, a table cell's included, can be scrolled past and acted on. While it is held, a scrolling drag no longer closes the keyboard; a tap that nothing under it handles still does.

## Signs the decision was wrong

- Users read the icons as buttons of their own, or the sheet is reported as busier than before.
- A user who scrolls with a selection held expects the keyboard to close, and cannot find how to close it.
