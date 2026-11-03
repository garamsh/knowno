# ADR 0101: Edit a cloze as one face, with its blanks as blocks in the line and a single insert-blank action

> Status: accepted; its action bar above the keyboard refined by ADR-0117, which draws the one action as a chip under the line
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **[ADR 0092](0092-make-each-chosen-cloze-word-a-blank-of-its-own-without-its-punctuation-narrowable-to-letters-and-keep-stored-blanks-through-an-edit.md)** shows a cloze line's words as toggle chips under the line. Each chosen chip is a blank, listed in order as "빈칸 n: answer". "글자 고르기" narrows a blank inside one word to a run of its letters. Blanks are spans of the line, so a stored card keeps them through an edit elsewhere.
- **Issue #377** records the owner's decisions of 2026-10-26:
  - the preview is the card's single face, each blank a block in place;
  - the line is edited as text, its blanks inline blocks, each removable by its own control;
  - the one action is "빈칸 넣기". It makes the selected characters a blank, or, with nothing selected, inserts an empty blank at the cursor to type into. Selection works on characters, so any run is possible, punctuation and special characters included;
  - the form shows no counts and no explanatory lines;
  - storage is unchanged.
- **The PM's amendment of #377** (2026-10-26, from the review of #386) meets "each removable by its own control" through the one action, which follows the caret. Inside a blank it reads "빈칸 풀기" and turns that blank back into text; elsewhere it reads "빈칸 넣기". There is no row of chips under the line, which keeps the owner's "빈칸 넣기 버튼만".
- Alternatives considered:
  - **A remove control drawn inside the line field, beside each block.**
    - A Flutter text field draws only text: a widget placed in its text counts as a character, which would shift every caret position against the line it edits.
    - A control laid over the field at a block's end would sit inside text the user taps to place the caret.
    - Such a control would fall below the 44-point minimum target ([`design/principles.md`](../design/principles.md) §One visual language).
  - **A row of chips under the line, one per blank, each with a remove button.** It was built first and rejected in review. It repeats every blank a second time, the clutter the owner asked to remove, when the blocks in the line already show where each blank is.
  - **An editor of separate fields between the blocks.** A selection could not cross a block, which the "any run" rule needs.
  - **Keep "글자 고르기" beside the selection.** A selection in the line already chooses any run of characters, which is what "글자 고르기" existed for.

## Decision

- **The line** is the front field. Its blanks are drawn in it as blocks: their text on `brandTint`, in ink.
- **One action** sits in a bar right above the keyboard, and follows the caret.
  - **Inside a blank** it reads "빈칸 풀기", is named for a screen reader as "빈칸 풀기, {answer}" ("빈칸" for an empty one), and turns exactly that blank back into text. The caret is inside a blank when it is strictly between the blank's ends, or anywhere in the blank just opened. A selection is inside one when the blank holds all of it.
  - **Elsewhere** it reads "빈칸 넣기". With characters selected, it makes exactly them a blank, replacing the blanks they overlap. With none selected, it opens an empty blank at the cursor: what is typed at its end becomes its answer until the cursor leaves it, and a blank left empty goes.
- **The preview** draws the cloze whole on its one face, each blank a block in place with its answer, an empty one as an empty block.
- **No counts and no explanatory lines.** Only the save's validation messages remain: no blank holding text, and `___` in the line (issue #306).
- **Blanks stay spans of the line**, as ADR 0092 has them. A stored cloze opens with each blank where the card has it, and an edit keeps every blank it leaves whole.
- **Storage is unchanged:** ADR 0068's cloze block, a blank that holds text saved as `___` with its answer.
- **Supersedes** ADR 0092's word chips, its numbered blank list and "글자 고르기", and the rule that a tap makes a word a blank without its punctuation. The rest of ADR 0092 stands.

## Consequences

- Any run of characters can be a blank, part of a word or a run with punctuation included, in one step.
- Making a blank needs a text selection. On a phone that is a long-press and its handles, where a word chip was one tap.
- Removing a blank takes putting the caret in it first, where a control on the block would take one tap.
- An empty blank is drawn in the preview; the line field shows only the caret where it is.

## Signs the decision was wrong

- Users make blanks one word at a time and find the selection slow, which would ask for a one-tap way to blank the word under the cursor.
- Users tap a block in the line expecting to remove it, and do not find "빈칸 풀기" when the button changes under the caret.
- Blanks are saved with stray spaces or punctuation that a word chip would have left outside.
