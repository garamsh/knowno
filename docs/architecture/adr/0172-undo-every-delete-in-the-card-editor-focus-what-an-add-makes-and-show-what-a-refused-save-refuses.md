# ADR 0172: Undo every delete in the card editor, focus what an add makes, and show what a refused save refuses

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #622**, filed by QA for #621, lists 14 frictions in the card editor on both clients. The PM accepted all 14 on #622. Issue #624 adds the drift of `deck.md` and `design.md` §Copy from what the editor draws.
- **Deletes.** On both clients, deleting a 칸, a 뜻, a photo's 빈칸 or a sound acted at once with no way back. Removing a 표 row or column that held text asked first, by [ADR 0102](0102-edit-a-table-in-its-cells-with-a-toolbar-over-it-and-no-mode-switch.md). `design.md` §Principles 5 prefers an undo to a confirmation, and nothing in the app offered an undo.
- **Focus.** "+ 칸 추가", "+ 뜻 추가", "행 추가", "열 추가" and a new box on a photo left the focus where it was. The 단어 field's action key closed the keyboard, though `design.md` §Components says a single-line field's key is "next" where the form names the field after it.
- **A refused save** showed its error where it was drawn, which on a long card was off screen. On the phone, a 소리 칸 still recording made 저장 do nothing visible.
- **Media.** A 사진 칸 could not change or remove its photo, while a 소리 칸 could. "소리 빼기" used 빼기, which §Copy keeps for the import lists. The editor's exemption from §Copy named #445, #447 and #450, all closed.
- **Alternatives considered:**
  - **Keep the 표's question and add an undo to the other deletes.** That leaves two forms for one step. The PM decided on #622 that every delete behaves the same way.
  - **One undo snack bar for the whole app, on the root messenger.** On the root messenger, a bar outlives the editor that showed it, and its 되돌리기 would act on a closed editor's 칸. It would also cover the editor's actions, which sit at the foot of its body (issue #307).

## Decision

- **Every delete in the editor acts at once and offers 되돌리기.** That covers a 칸, a 뜻, a photo's 빈칸, the photo, the sound, and a 표 row or column. A snack bar says what went: "칸을 삭제했어요", "뜻을 삭제했어요", "빈칸을 삭제했어요", "사진을 삭제했어요", "소리를 삭제했어요", "n행을 삭제했어요" or "n열을 삭제했어요".
  - 되돌리기 puts back exactly what went, where it was, with its text, blanks, boxes and answers. The bar goes after four seconds. A newer delete replaces it, so only the latest delete can be undone.
  - Nothing asks first. This supersedes ADR 0102's question before removing a row or column that holds text.
  - On the phone, `showUndoSnackBar` in `app/lib/design/` draws the bar. The editor gives its form a messenger of its own, so the bar sits above the actions and goes with the editor. "저장하고 다음 카드" clears a pending undo.
- **What an add makes takes the focus, and is scrolled into view.**
  - "+ 칸 추가" focuses the new 칸's first field. A 사진 or 소리 칸 has no text field: on the phone the keyboard closes and the 칸 is scrolled into view, and on the web its pick button takes the focus.
  - "+ 뜻 추가" focuses the new 뜻. "행 추가" focuses the new row's first cell, and "열 추가" the new column's heading, scrolled sideways into view whole.
  - A box drawn or added on a photo focuses its "정답 (선택)".
  - The 단어 field's action key is "next", and goes on to its 뜻.
- **A refused save shows what it refuses.** It scrolls to the first 칸 that cannot be saved and focuses its field, or, with every 칸 complete, scrolls to the card's error under the column.
- **On the phone, 저장 while a 소리 칸 records** ends the recording, keeps it, then saves.
- **A 사진 칸 holding a photo** offers "다른 사진 고르기" and "다시 찍기", which replace the photo and keep its boxes and answers, and "사진 삭제". A pick being stored shows its button's progress.
- **"소리 빼기" becomes "소리 삭제".** This supersedes ADR 0112's "소리 빼기". The editor is bound by `design.md` §Copy: its exemption named closed issues.

## Consequences

- A delete in the editor is never lost by a slip, and the editor confirms nothing.
- The editor's undo bar is scoped to it: no other screen shows one, and a later screen that wants one uses `showUndoSnackBar`.
- A test reading the editor's snack bars finds the form's messenger. A test that deletes in its setup lets the bar run out first.

## Signs the decision was wrong

- Users miss the bar's four seconds and lose a 칸 they meant to keep. Then the bar should stay until the next edit.
- A focus moved by an add opens the keyboard over what the user meant to see. Then a media 칸's or a box's add should leave the keyboard closed.
