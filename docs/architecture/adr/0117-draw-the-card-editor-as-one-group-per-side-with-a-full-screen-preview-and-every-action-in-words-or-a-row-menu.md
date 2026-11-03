# ADR 0117: Draw the card editor as one group per side, with a full-screen preview, and every action in words or a row's menu

> Status: accepted; its one group per side superseded by [ADR 0137](0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md), keeping its groups, preview screen and menus; its preview's front then back, under the side's name, superseded by [ADR 0168](0168-draw-the-card-editor-s-preview-with-study-s-own-faces-at-study-s-size-exported-by-study-and-handed-to-the-editor-by-home.md), keeping its full screen and its turn; its add sheet with no icons and no line for 글 superseded by [ADR 0171](0171-give-every-type-in-the-add-sheet-an-icon-and-a-line-and-keep-a-field-s-selection-through-a-scrolling-drag.md), keeping its one grouped list
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #454** is the design standard the owner approved on 2026-10-27, with the drafts of this editor ("좋은 시안이야. 저렇게 진행하거나…"). Its §3 asks for one white group per meaning, rows split by hairlines, fields borderless until focused, one primary fill per screen, destructive actions as red text at a screen's end or inside ⋯, shadows only on what floats, and a 3D flip of the preview card skipped under reduce motion.
- **Issue #450** (the owner, 2026-10-27: "조잡한 UI를 만들지 말라고") found the editor hard to read:
  - the split preview at its top named neither half, and the fields under it repeated it;
  - the full-width outlined "+ 앞면에 추가" read as the line between the sides, and on an empty back it was the back;
  - one viewport held seven to nine bordered shapes of similar weight.
- **Issue #449** found two defects against `design.md` §Principles:
  - a one-meaning 뜻 목록 labelled its field with the side's name, under the side's own label;
  - the 빈칸 문장 bar's "빈칸 넣기" was a second navy fill beside "저장하고 다음 카드".
- **Issue #445** applies [ADR 0116](0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md) to the editor. A type icon on each block's header, the tinted icon squares in the add sheet, the layers icon before the deck's name and each sense's ↑ ↓ 🗑 buttons all say what words beside them say.
- **Alternatives considered:**
  - **Name the halves of the editor's split preview** (#450, option 1a). The preview would still restate the fields under it at 30 px, and still be the screen's largest shape.
  - **Keep a smaller preview at the top.** A preview shows only what study shows when it is drawn as study draws it: one card at study's size, its front and then its back. That needs the whole screen.
  - **Keep each block's own outline inside the side's group.** The group's hairlines already part the blocks, and outlines on every field are the noise #450 counts.
  - **Show "빈칸 넣기" and "빈칸 풀기" side by side under the line**, each disabled where it cannot act. [ADR 0101](0101-edit-a-cloze-as-one-face-with-its-blanks-as-blocks-in-the-line-and-a-single-insert-blank-action.md) chose one action that follows the caret, and nothing here asks to reopen that choice.

## Decision

- **Each side is one group.** "앞면" or "뒷면", muted, heads a white group of radius 14 with no shadow. Its blocks are rows in it, parted by hairlines, and the group ends with a quiet "+ 추가" row. Fields in a group have no border until focused, when a 1.5 px ink outline shows.
- **A block's row** carries a ⋯ menu of "위로", "아래로" and a red "삭제". A 글 is its field and the ⋯. Any other type is named in muted text over its fields, with no icon.
- **A 뜻 목록's senses are rows.** Each row is a label chip on `brandTint`, of radius 6, a line of body text high and as wide as its text, inline before the meaning field on its baseline, its tap target made up by the space around it; then the meaning field hinted "뜻" or "뜻 n", and, with more than one sense, a ⋯ of "위로", "아래로" and "삭제". No field inside a side is named by the side. The block ends with "+ 뜻 추가" in ink-2.
- **The add sheet** is titled "앞면에 추가" or "뒷면에 추가". It lists the types in one grouped list with no icons. Each type has one 해요체 line under it, but 글, whose name says enough.
- **A 빈칸 문장's one action** is a small outlined chip right under its line while the line has focus. It follows the caret as ADR 0101 has it, and is never a primary fill. While the card holds a cloze and its back holds nothing to save, a muted line under the back says the back may stay empty.
- **The preview.** The editor draws no preview of its own. "미리보기" in its top bar opens a full screen holding one card as study's current card draws it, at that card's size, centred, its side named above it and what a tap does below. The card is on the surface with study's radius and shadow. Its sides come from `oneFaceOf`, drawn through `WholeCardView` and `ContentView`.
  - A tap turns the card over in 3D in 220 ms, or switches it at once under reduce motion.
  - A card of two sides shows "앞면" or "뒷면" over the card. A card studied on one face shows its face, its blanks empty and then filled.
  - A muted line under the card says what the next tap does.
- **The top bar and the foot.** The deck's name is muted caption text with no icon. Editing a card ends the form with a red "카드 삭제", and the bar holds no delete icon. The bottom bar is unchanged: "저장" alone when editing, and "저장" outlined beside "저장하고 다음 카드" for a new card.
- **The "라벨" screen** takes the same shapes. It is one group of rows parted by hairlines, each row a drag handle, a label chip, the name and a ⋯ of "위로", "아래로" and "삭제", and the group ends with "+ 라벨 추가". The delete button and the handle's menu go.
- **This refines:**
  - [ADR 0108](0108-add-a-free-template-and-an-add-control-that-puts-any-block-on-either-side-of-every-template.md)'s add control and block menu;
  - [ADR 0114](0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md)'s editor layout;
  - [ADR 0101](0101-edit-a-cloze-as-one-face-with-its-blanks-as-blocks-in-the-line-and-a-single-insert-blank-action.md)'s action bar above the keyboard;
  - [ADR 0100](0100-merge-the-word-kind-into-basic-type-each-sense-s-label-and-offer-the-user-s-labels-above-the-keyboard.md)'s sense buttons and the presets' delete button and handle menu.
- Their blocks, templates, saves and storage are unchanged.

## Consequences

- The sides read as two shapes, and the screen's one primary is "저장하고 다음 카드" in every state.
- The card as study shows it is one tap away, at study's size, rather than always on screen at a smaller one. A user who wants to check the card while typing leaves the form to do it.
- Reordering and deleting keep a way that needs no drag (WCAG 2.2, 2.5.7): the row's ⋯, whose items a screen reader reaches by name.
- The group, its add row, its field theme and the row menu live in `deck/src/editor_group.dart`, used by the editor and the "라벨" screen. They move to `app/lib/design/` when a screen outside `deck` needs them.
- The duplicate sheet and a read-only card still draw `CardPreview`, the split card.

## Signs the decision was wrong

- Users add cards whose two sides they cannot tell apart in study, which the always-visible preview showed before.
- Users miss the ⋯ and cannot find how to delete or reorder a block or a sense.
- The "+ 추가" row is overlooked, and users ask how to add a second block to a side.
