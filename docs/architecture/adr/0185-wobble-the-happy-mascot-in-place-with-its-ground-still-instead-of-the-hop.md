# ADR 0185: Wobble the happy mascot in place with its ground still, instead of the hop

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #723.** The owner, 2026-11-04: the happy mascot's jump looks ugly and does not read as a jump. Of the motion options on the reference page (https://claude.ai/artifact/4JwEFRnxndDDhYHMjnv2Pb), option 1, "말랑 출렁", is chosen.
- **Why the hop failed**, as the reference page puts it: it rises 46 of 1024 units, about 4.5% of the body; one ease-out curve slows the fall too, so it floats down instead of landing; and the ground ticks under its feet sit in the group that moves, so they rise with it and the lift does not read.
- [ADR 0152](0152-let-the-mascot-blink-and-breathe-from-its-own-drawing-and-put-the-launcher-icon-on-cobalt.md) set the hop: 1.6 s, squashing to 1.04 by 0.95, rising 46 units, landing at 1.03 by 0.97, its arms lifting 14 units.

## Decision

- **The happy mascot wobbles instead of hopping**, the same on both clients, as the reference's option 1 draws it. The loop is 1.8 s: 1.1 s of motion, then still to its end.
  - The body scales about its feet, which never leave the ground. The scales are 1.12 by 0.85 at 11%, 0.91 by 1.11 at 26%, 1.06 by 0.95 at 37%, 0.97 by 1.03 at 46%, 1.015 by 0.99 at 54%, and 1 from 61%.
  - Each step eases on `cubic-bezier(.45, 0, .55, 1)`, except the spring out of the squash, which eases on `cubic-bezier(.2, .9, .3, 1.25)`.
  - The scale's origin is the foot of the drawing's moving box: 502.8 by 860.8 in the 1024 drawing, where the tilted body's box ends under its feet.
  - Each arm turns about its own shoulder, 92% across its box for the left arm and 8% for the right, both 79% down. The left arm turns -10° at 12%, 14° at 28%, -4° at 40%, 2° at 52% and 0 from 62%, and the right arm turns the other way. The spring at 12% eases on `cubic-bezier(.2, .9, .3, 1.3)`, and the step from 52% on CSS's `ease`.
- **The ground stays still.** The source drawing marks its ticks as `ground`. `tools/brand/generate.mjs` puts them outside the web's breathing group and marks their shapes `_Move.ground` for the phone, which paints them without the drawing's motion.
- **Unchanged from ADR 0152:** the drawings and faces, full motion only from 200 px, and the still image at 40 px or less, under reduce motion and off screen.
- **Supersedes** ADR 0152's happy hop on 1.6 s: the squash to 1.04 by 0.95, the 46-unit rise, the landing at 1.03 by 0.97 and the arms lifting 14 units.

## Consequences

- The web scales the breathing group in the drawing's own space, about one point. The reference scales a group inside the tilted body's transform, so its axes lean by the body's 2°. The difference is a shear of about 1% at the deepest squash, which nothing at the mascot's sizes shows.
- The phone's pose no longer has a rise or an arm lift. It has a scale about a point that the loop names, and one arm turn that the right arm mirrors.
- An expression that gains ground marks in its drawing keeps them still by naming their group `ground`. No client code changes.

## Signs the decision was wrong

- The owner still reads the motion as ugly or unclear on 홈's hero at 210 px.
- A screen where the happy mascot sits beside text shows the wobble's 12% widening crowding it.
