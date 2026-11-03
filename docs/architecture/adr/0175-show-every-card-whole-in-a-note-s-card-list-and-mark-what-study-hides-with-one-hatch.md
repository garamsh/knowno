# ADR 0175: Show every card whole in a note's card list, and mark what study hides with one hatch

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #629.** The owner asked on 2026-11-03: "뒷면 보기 버튼 없애고 기본적으로 모두 보이게 해줘. 이 때 어떤게 가려지는지도 표시 되어야겠지." The owner then chose section 3 of the PM's mockup (https://claude.ai/artifact/278KmJ63jVw7FYNTeVrv8B): "빗금 배경이 좋긴 한데 그 가리는것들도 빗금 배경으로 통일하자."
- **Before this record**, a note's card list showed each card's front alone. The "뒷면 보기" switch in the pinned row showed every back muted after its front, and a hidden back was drawn as nothing ([ADR 0118](0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md), issues #142 and #451). A card with a blank showed its blanks empty until the switch filled them.
- **Rows had no line limit.** With every back shown, a long card makes a long row, and a note can hold thousands of cards. The PM settled on #629 how a row is cut.
- **Alternatives considered:**
  - **A separate mark for each kind**, as the issue first decided: a hairline and an eye-off icon over a 글's revealed part, study's tint on a blank, the editor's outline on a photo's box. The owner chose one hatch for all of them instead, so a row marks what is hidden in one way.
  - **Study's own blank drawing in the list.** Study draws a revealed blank on `brandTint`, which also tints chips and the side menu. It would not read as "hidden in study". The hatch is used in the list alone, and study's drawing stays as it is.
  - **A copy of the editor's box marks on a listed photo.** The editor's marks are `image_block.dart`'s, which the photo import work was changing at the same time. A box on the hatch alone, with its answers under the photo, copies nothing of them.
  - **Keep the switch, on by default.** It would keep a control that hides what the owner asked to see.

## Decision

- **No 뒷면 보기.** A note's card list has no switch on either client. Its string, its state and its tests are deleted. A row is read as "{front}, 뒷면 {back}".
- **Every row shows the whole card**: what study shows first, then what the reveal adds. A tap on a row still opens the card in the editor.
- **One mark for what study hides: a light diagonal hatch.** Stripes 6 wide every 12 across their direction, running up to the right, of `hatchStripe` over `hatch`. It is a theme token defined once on each client, in light and dark: `AppHatch` and `HatchDecoration` in `theme.dart` over the colours `hatch` and `hatchStripe`, and the web's `hatch` utility in `globals.css` over `--color-hatch` and `--color-hatch-stripe`. It is drawn in the card list alone.
  - A split card, a 글's or a 단어's: its front, then its back in a hatched box.
  - A whole card, through `deck`'s `WholeCardView.listed` and the web's `ListedCells`: each blank of a 빈칸 and each hidden cell of a 표 filled on the hatch, each added part in a hatched box, and each box of a 사진 on the hatch over the photo, with no border and no label, and the boxes' answers in a hatched box under the photo.
- **Rows stay compact.** A shown part is cut at two lines and a hatched box at three, each ending in an ellipsis. Korean breaks only between words. A 표 shows its first three rows, then "외 n행". A 사진 is a thumbnail: its photo 96 high, its width following from its aspect ratio, at the start of the row, a size token on each client (`AppSize.listedPhoto`, `--spacing-listed-photo`), and its answers' box cut at three lines like any hatched box.

## Consequences

- A note's list reads like the cards: a glance tells what each card asks and what it answers.
- A note with long cards scrolls further than with the backs hidden, though each row is cut.
- The theme carries a pattern as well as colours, and both clients' token tests check it.
- A screen reader hears every row's back, where it used to hear "뒷면 가려짐".

## Signs the decision was wrong

- Users ask for a way to hide the answers in the list, for example to quiz themselves.
- The hatch is reported as noise, or as hard to read on in either theme.
- A row cut at two and three lines hides what users look for, or users open cards just to read them.
