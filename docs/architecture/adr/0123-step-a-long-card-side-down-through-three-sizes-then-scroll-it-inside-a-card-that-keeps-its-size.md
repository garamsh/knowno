# ADR 0123: Step a long card side down through three sizes, then scroll it inside a card that keeps its size

> Status: accepted; its three sizes chosen by fit alone superseded by ADR 0176
> Date: 2026-10-29

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- The owner reported on 2026-10-28 that a card is hard to read once its content passes 100 characters (issue #489).
- The audit in #489, at 100, 200 and 400 Korean characters on a 390 pt phone and the web's 390 and 1280 px, found:
  - The phone's current card and the editor's full-screen preview kept the front at 30 pt whatever its length. `CardText` shrank a side only until its widest word fitted. At 200 characters and more, the text was cut mid-line at the card's bottom edge, with nothing showing that more was below.
  - The web's current card grew with its text. At 400 characters on a 390 px screen the page was 2536 px tall, and 모른다 and 안다 were about three screens down.
  - Korean broke inside words on every card surface of both clients.
- #454 §3 decides that Korean wraps by word and that a screen uses at most three type sizes. It does not decide what a card does once its text is longer than the card.
- Three options went to the owner:
  - A: three fixed sizes, then scrolling.
  - B: shrinking one point at a time to a floor, then scrolling.
  - C: a long card growing into the previous card's place.
- The owner chose A on 2026-10-29.

## Decision

- **Three sizes.** A side of the current card or the full-screen preview takes the largest of three sizes at which it fits the card whole, its widest word inside the card's width:
  - a front: 30, 20, then 17;
  - a back: 20, then 17.
  - 30 is the front's size and 20 the back's. 17/27 medium is a new card body size, `AppType.cardBody` and `--text-card-body`.
  - No size lies between two steps.
- **Alignment.** At the body size the text is start-aligned and read as a paragraph. Above it the text is centred.
- **Scrolling.** Text that does not fit at the body size scrolls inside the card from the top. While more is below, the card's bottom edge fades into its surface. The card keeps its size; ADR 0042's two cards of one size stand.
- **The web's height.** The web's two card places take one height: a third of the screen, from 208 to 300 px. So 모른다 and 안다 stay on screen under the current card whatever it holds.
- **The previous card** keeps its rule: it shrinks to its floor, ends with "…", and a tap opens the whole card. On the web a whole card's sentence is clamped as the split sides are.
- **Line breaks.** On every card surface of both clients, lines break only between words. The phone uses `keepWords`; the web uses `word-break: keep-all`. A word wider than the card at the body size breaks inside itself.
- **Refines** ADR 0042: the current card's text sizing. The cards' layout is unchanged.

## Consequences

- A front of up to about 200 characters reads centred at 20 pt on a phone. A longer one reads as a start-aligned 17 pt paragraph that scrolls, rather than being cut.
- A screen's card text uses one of three sizes. The previous card's shrink to its floor is the one continuous size left.
- On the web a short front sits in a card shorter than before on a tall screen, since the card no longer grows. A long one scrolls inside the card instead of the page.
- A side that holds a photo, a sound or a block this version cannot show is still laid out block by block.

## Signs the decision was wrong

- Users miss the end of a long front, not noticing the fade, and answer before reading it.
- Users find the step from 30 to 20 between two consecutive cards jarring.
- Users on short web screens find the 208 px card too small for ordinary cards.
