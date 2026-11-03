# ADR 0176: Start study's front at a size its length gives, and draw what study hides on the hatch

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #635.** On 2026-11-03 the owner sent an iPhone shot of a 빈칸 card ("양성모음: ___, ___, ___, ___ / 음성모음: … / 중성모음: ___") and wrote: "글씨가 많은데 큰데다가 빈칸도 저런식이여서 보기 불편해. 차라리 지금 추가되는 그 배경으로 저것도 통합하고 글자 크기가 글자 수에 반비례하도록 … 일정치까지만 작아지도록 … 글이 아주 긴 경우도 있을테니 그때는 스크롤로". The PM's decisions on #635 follow from it.
- **Before this record**, the current card's front took the largest of three sizes at which it fit (front 42, back 20, card body 17), whatever its length ([ADR 0123](0123-step-a-long-card-side-down-through-three-sizes-then-scroll-it-inside-a-card-that-keeps-its-size.md)). The owner's card fits at 42, so three lines of mostly blanks filled the card in display type.
- **An empty blank** was a gap of its answer's width over a `muted` underline ([ADR 0119](0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md)). It was filled on `brandTint` after the reveal ([ADR 0068](0068-store-a-table-or-cloze-card-as-typed-content-blocks-and-draw-it-whole-its-blanks-filled-in-place-once-answered.md)). A photo's box was filled in `hero`, and outlined with its answer once revealed ([ADR 0109](0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)). Seven underlines read as a row of dashes, not as places to fill.
- **The previous card** set its front at `deckName`, 28, shrunk only until its widest word fit, over its back at the card body size, and a whole card's revealed face at 28 with no fit check ([ADR 0151](0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md)). After the current card took the length rule, the owner's card still read at 28 there once answered.
- **The hatch** marked what study hides in a note's card list alone ([ADR 0175](0175-show-every-card-whole-in-a-note-s-card-list-and-mark-what-study-hides-with-one-hatch.md)).
- **Alternatives considered:**
  - **A continuous size**, scaled down a point at a time by length. The issue rules it out: the steps stay on the app's type tokens.
  - **A blank as wide as its answer, on the hatch.** It would hint at the answer's length, as the underline did. A fixed width hints at nothing.
  - **A box 3 em wide.** In the PM's look at the shots at 390, the fourth blank of "양성모음: ___, ___, ___, ___" fell alone onto the next line. At 2 em each 모음 line lays out whole.
  - **Counting a blank as its answer's characters.** The face draws a box, not the answer, so the box's width is what the reader sees.

## Decision

- **The front starts at a size its length gives.** Study's current card, and the card editor's preview through it ([ADR 0168](0168-draw-the-card-editor-s-preview-with-study-s-own-faces-at-study-s-size-exported-by-study-and-handed-to-the-editor-by-home.md)), take the front's starting size from its length in characters:
  - up to 12: `front`, 42;
  - up to 40: `deckName`, 28, the size and weight of a title a user wrote;
  - up to 100: `back`, 20;
  - past 100: `cardBody`, 17, the floor, no smaller than the body size.
  - The length is what each 칸 shows before the reveal. A text block, a senses block and a table count their characters, and a photo or a sound counts nothing.
  - Each empty blank counts as 2, its box's width.
- **The fit check still applies.** From the starting size the front takes the largest step at which it fits whole, never below the floor. The ladder is `front`, `deckName`, `back` and `cardBody` on both clients. ADR 0123's three sizes become these four.
- **Past the floor it scrolls**, as ADR 0123 has it: inside the card, from the top, its bottom edge fading while more is below, the card keeping its size.
- **The previous card takes the same rule.** Its face starts at the size its length gives, the same length the current card counts, and takes the largest step from there at which it fits, never below the floor, scrolling past it:
  - a whole card's revealed face starts as the current card's front does;
  - a front over its back starts no larger than `deckName`, 28, and is fitted together with its back, which stays at the card body size.
- **What study hides is on the hatch.** On study's cards and the preview, `AppHatch` on the phone and the `hatch` utility on the web mark what study hides:
  - An empty blank, a table's hidden cell or span included, is a box on the hatch, 2 em wide at its line's height less 4, its corners rounded 4. It holds no answer, and it keeps to the word or punctuation it touches.
  - A filled blank is its answer on the hatch.
  - A photo's box is on the hatch over what it hides. Once revealed, its answer is on the same hatch.
  - The underline goes, on both clients.
- **The rule lives in study's one card face**: `CardFace` on the phone and the web's current card. The phone's previous card and its sheet draw the revealed face the same way, through `WholeCardView.studied`. The web's previous card and its dialog do the same through `WholeCells` with `studied`.
- **Unchanged.** The card editor's own drawing of a card (`CardPreview`, the web's read-only card), photo import's list and a note's card list keep their looks. No stored format changes.
- **Supersedes** ADR 0123's three sizes chosen by fit alone; ADR 0119's hidden blank as an empty underlined gap, on study's cards; ADR 0068's filled blank on `brandTint` and ADR 0109's `hero` box and outlined answer, on study's cards; and ADR 0175's hatch "drawn in the card list alone"; and ADR 0151's previous card front at `deckName` and its whole card's face at that size, unfitted.

## Consequences

- A short front still reads at 42. A sentence reads at 28 or 20, and a paragraph at 17, even where it would fit larger.
- Once answered, a card reads at the size it read at as the current card, or smaller where its back needs the room.
- A 빈칸 card reads as words with places to fill, and a blank no longer hints at its answer's length.
- Study and the card list mark what study hides with one hatch.
- A card's size can change between two edits that only lengthen it past a step.

## Signs the decision was wrong

- A short card with long words reads too small, or users ask for the larger size back.
- A 2 em box reads as too short for long answers, or users take its width as a hint.
- The hatch on the current card is reported as noise, or as hard to read on in either theme.
