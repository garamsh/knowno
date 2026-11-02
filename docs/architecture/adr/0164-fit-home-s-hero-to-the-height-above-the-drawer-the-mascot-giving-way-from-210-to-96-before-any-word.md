# ADR 0164: Fit 홈's hero to the height above the drawer, the mascot giving way from 210 to 96 before any word

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #610.** On an iPhone 13 Pro (390 × 844 pt), with 481 cards today over 4 notes, 시작 was cut in half by the drawer's top edge. The owner asked to keep the style of [ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md) and [ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md) and fix the layout.
- **The cause.** The phone's hero laid out a fixed 210 mascot, the words and the action in a scroll view in the space above the drawer. Where they needed more, the hero scrolled, and at rest 시작 sat under the drawer. `app/test/home/hero_fit_test.dart`, run against the hero on main at bee3b03de28e38d62a61ac52aa56790748acb6f7 in the bundled fonts, measured the mascot at 210 while the hero scrolled in 22 of its 24 cases: 667, 844 and 932 pt, text scale 1.0 and 2.0, today, backlog, done and no cards.
- **The web's hero grew instead.** Its section had a least height and a 210 or 128 mascot, so at 375 × 667 the hero grew past its height and pushed the notes under the tab bar.
- **The drawer is left as it is.** Its peek and gesture are a separate decision, so this one fits the hero into what the drawer leaves.
- **Alternatives considered:**
  - **Scale the whole hero down to fit.** The title, its line and 시작 would shrink below their type sizes, which the issue keeps.
  - **Hide the mascot on short screens.** A screen of today on the hero without the mascot is not ADR 0150's hero.
  - **On the phone, a flexible mascot under `IntrinsicHeight` or `SliverFillRemaining`.** Both size the hero by its children's intrinsic heights; a mascot that takes a size from its constraints has none to give but its largest, so the hero still scrolls at 210.
  - **On the web, a shrinking flex item.** In the Chromium of Playwright 1.64.1, a column flexbox's `min-height: min-content` measured the mascot at 210 whether its basis was 210 or 0, so the hero still grew; a grid track `minmax(96px, 210px)` measures at its floor under min-content and grows to its ceiling given room.

## Decision

- **The hero's words and action keep their sizes; the mascot takes what they leave.** In the height above the drawer, the mascot is square, from `mascotHero` (210) down to `mascotMedium` (96), the floor, and the mascot, the words and the action are centred as one group.
- **The hero scrolls only once the mascot is at its floor**, at a large text size or the smallest heights, so 시작 is reached by the scroll, whole above the drawer; until then it may be cut at the drawer's edge.
- **The web's hero below 1024 px takes the same rule**, as mobile web is the app ([`design.md`](../design.md) §Principles 9): the height the drawer leaves, a grid whose mascot row is `minmax(mascot-medium, mascot-hero)` between two spaces, growing past that height only where the group at the floor needs it. Its mascot is the phone's in every state, so the backlog's and the no-card hero's 128 mascot goes.

## Consequences

- A taller title, a second line or a larger text size shrinks the mascot first; nothing else on the hero moves to make room.
- At 667 pt and text scale 1.0 the phone's hero still scrolls, by 9 to 47.5 pt in `hero_fit_test.dart`, since the drawer is left as it is; whether the hero fits there is the drawer's decision.
- The web's hero holds the mascot and at most three items under it, the grid's rows.

## Signs the decision was wrong

- The owner finds the mascot too small at 844 pt, or the group too low or too high in the space.
- A hero state needs a fourth item under the mascot, or the drawer's replacement leaves the hero no fixed height to fit into.
