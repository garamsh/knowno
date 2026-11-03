# ADR 0168: Draw the card editor's preview with study's own faces at study's size, exported by study and handed to the editor by home

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The owner, on issue #613, 2026-11-03:** "카드 편집에서 미리보기가 실제 카드와 다른거같아. 크기라던지 배치라던지 실제 카드에 맞춰".
- **The preview was a copy.** [ADR 0117](0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md) put it in `deck`. There it drew its own face and took its height from its own sum of study's gaps, because `deck` cannot import `study`. Each change to study's card had to be made twice.
- **Study never shows a back alone.** Once a card is answered, study shows the previous card: the front over the back, or the 칸 revealed, on a 3 px line in the grade's colour. The preview's turned side was the back alone in the back's type, under "뒷면", a view study does not have.
- **Where the shared drawing can live.** `structure.md` keeps the domain graph acyclic, and `study` depends on `deck`, so `deck` cannot reach study's faces. Its rule for this case: a domain widget with a place for something another domain draws takes it as a constructor argument from its caller in `home/`.
- **Alternatives considered:**
  - **Move the faces and study's layout numbers down into `deck`**, where both could draw them. That puts study's subject in `deck`, a file belonging to two domains. The PM rejected it.
  - **Move the preview into `home/`.** `home/` holds no screen of its own beyond composition, and the preview needs study's internals, not only its surface.
  - **Keep the back alone on study's current-card face.** It would be study's component, but not a view study shows. The PM chose the answered face instead (#613, 2026-11-03).

## Decision

- **`study` owns the preview.** It exports `CardPreviewScreen` over a card's 칸.
  - The front is the face study's current card draws.
  - After a tap, the preview shows the face study's previous card draws: front over back, or the 칸 revealed. Its line is the theme's `edge` at the same 3 px, since the preview has no answer.
  - The card is sized by the same function the study screen sizes its cards with, under a top bar of study's height, and centred.
- **The turn stays as ADR 0117 has it:** 3D in 220 ms, or at once under reduce motion.
- **No side is named.** "앞면" and "뒷면" go from over the card.
  - The line under the card reads "카드를 탭하면 답이 보여요" on the front.
  - Once turned, it reads "다시 탭하면 앞면으로 돌아가요", or for a card drawn whole "다시 탭하면 빈칸으로 돌아가요".
  - "카드를 탭하면 뒷면이 보여요" is removed.
- **`deck`'s editor takes the preview as an argument.** `CardEditorScreen` takes a `preview` built from the card's 칸, and `home/`'s deck screen passes study's.
- **Superseded:** ADR 0117's preview showing "its front and then its back", with the side named above the card. ADR 0117's full-screen preview, its turn and its line under the card stay.

## Consequences

- The preview and study draw a card from one component at one size. A change to study's card reaches the preview with no second edit.
- `deck` holds no knowledge of study's layout. The editor cannot open its preview without a caller that hands one in, so its tests pass study's.
- The preview's turned side reads as study does after an answer. A user no longer sees a back alone, which study never shows.
- `study`'s surface gains a screen that only `home/` opens.

## Signs the decision was wrong

- Users ask where the card's back is in the preview, or read the front-over-back face as a second card.
- A second screen outside `study` needs study's card faces, and grows its own argument or copy to get them.
- The preview's card and study's diverge again, for example through a top bar of another height.
