# ADR 0178: Fill 홈's first screen with the hero, and reach the week card by scrolling

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #652.** On 2026-11-03 the owner wrote: "메인 화면이 처음엔 저 캐릭터랑 시작 부분만 있고 밑에서 위로 올려서 20일 연속이라던지 그런 부가적인 것들을 보여주는 형태가 좋을거같아." The PM's decisions on #652 follow from it.
- **Before this record**, [ADR 0165](0165-open-on-today-over-the-last-seven-days-move-the-notes-to-a-tab-and-open-settings-from-the-profile-button.md) put the hero and the week card together on the first screen, the fit of #610: the week card and the top bar kept their heights, and the mascot took what the hero's words and action left, from `mascotHero` (210) down to `mascotFloor` (64). Laid out by `app/test/home/hero_fold_test.dart` against main at 6b209acf, the mascot was drawn at text scale 1.0 at 75 at 667 pt with the owner's 481 cards on a 19-day streak, 117 there in a backlog and 109 with the day done, and 191 at 844 pt with the 481 cards; at text scale 3.12 it was at its floor of 64 in every state on every phone, and 홈 scrolled anyway.
- **The owner rejected a drawer** on #611, so what follows the hero is reached by an ordinary scroll, with no sheet and no "올려서 보기" label.
- **Alternatives considered:**
  - **Keep the fit, with a larger floor.** The mascot would still shrink as the week card and later cards take room; the owner asked for the mascot and 시작 alone first.
  - **A snap between the hero and the cards**, as the mockup's option A has. It is a second motion to learn, and a page that stops on its own reads as the drawer the owner turned down.
  - **A label or chevron saying more follows.** The PM ruled it out on #652; the week card's top edge says it without words.
  - **From 1024 px on the web, the hero and the week card side by side.** [`design/principles.md`](../design/principles.md) §One style on every client lets the web differ from 1024 px only by the side menu and wider columns, and 홈's column is one column; side by side would also put the week card beside 시작 on the first screen, which this record moves it off.

## Decision

- **The hero fills the first screen** on the phone and on the web below 1024 px: the screen above the tab bar, less the week card's top edge, 16 high, and the 16 over it. Its mascot is `mascotHero` (210) in every state, at every height and text size, the group centred in what the top bar leaves. Where the group needs more than the screen, at a large text size, the hero grows past it and the page scrolls; no word is cut and no part shrinks.
- **Below the hero,** on the ground, in one ordinary page scroll: the week card, then any card added later. The first screen shows the week card's top edge, 16 above the screen's foot, so the page reads as one that scrolls; there is no drawer, sheet, snap or label.
- **With no card,** the hero is the whole first screen with nothing under it, as before.
- **A count that cannot be read** keeps its reason in the week card's place, under the hero, its top edge shown as the week card's is.
- **From 1024 px on the web,** the hero takes its own height and the week card is stacked under it in the one column, as before.
- **Deleted:** the fit of the hero to what the week card leaves, `mascotFloor` on the phone and `mascot-floor` on the web. This supersedes ADR 0165's week card under the hero on the first screen and its fit.

## Consequences

- The mascot is always drawn at 210 on 홈; at 667 pt the hero still fits at text scale 1.0 in every state.
- The streak and the last seven days take a scroll to see whole; their top edge is on every first screen with a card.
- At the largest text size the hero is taller than the screen, and the week card's edge is not on the first screen.

## Signs the decision was wrong

- Users do not find the week card, or the owner asks for the streak on the first screen again.
- The empty space round a 210 mascot on a tall phone reads as unfinished.
- The week card's edge is read as a layout fault rather than as more to scroll to.
