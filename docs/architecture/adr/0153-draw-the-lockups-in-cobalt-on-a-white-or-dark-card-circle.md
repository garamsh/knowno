# ADR 0153: Draw the lockups in cobalt on a white or dark card circle

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #584**, under the cobalt look of [ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md). The horizontal and stacked lockups were still the mark on a cream circle with cocoa `#3B2118` words in light and cream `#FFF1E3` words in dark, the warm colours of [ADR 0139](0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md), beside cobalt screens and the cobalt launcher icon of [ADR 0152](0152-let-the-mascot-blink-and-breathe-from-its-own-drawing-and-put-the-launcher-icon-on-cobalt.md), which kept "their cream circle".
- **The dark splash** drew the mark on the same cream circle.
- **The PM chose option C** of four rendered options, on the stacked lockup on both grounds.
- **Alternatives considered:**
  - **A, the mark on a `#EEF3FF` or card circle with ink words.** Calm, but it drops the brand colour for ink.
  - **B, no circle, ink words.** The mark is then visibly larger than the words in the inline lockup at 30 high.
  - **The current cream and cocoa.** The only warm pairing left on a cobalt screen.

## Decision

- **Light lockups:** the mark on a `#FFFFFF` circle, 알아몰라 and knowno in cobalt `#2547D0`.
- **Dark lockups:** the mark on a `#232F4E` circle, the dark card, the words in the dark accent `#8AB4FF`.
- **The dark splash's circle**, in the iOS and Android sources and Android 12's icon, is `#232F4E`. The light splash stays the mark alone.
- **The mark's drawing and the launcher icon stay as they are.** `tools/brand/generate.mjs` takes the circle's fill and the words' colour as arguments, and `make brand` writes the lockups, the splash sources and the native splash files from them.
- **Supersedes** ADR 0152's "The lockups keep their cream circle" and ADR 0139's cocoa and cream lockup words and dark splash circle.

## Consequences

- Words and circle are the colours of the icon and the screens' own tokens, so a lockup reads as part of the cobalt look on both grounds.
- Words against their ground, WCAG relative luminance: `#2547D0` on `#EEF3FF` 6.54:1 and on `#FFFFFF` 7.26:1; `#8AB4FF` on `#111A2E` 8.30:1 and on its circle `#232F4E` 6.33:1.
- The white circle is 1.11:1 against the light ground and the dark card 1.31:1 against the dark one, so a circle reads by the mark and the words beside it, not by its own edge.

## Signs the decision was wrong

- A lockup's circle vanishes into its ground on a real device so that the mark reads as floating.
- A legal or sign-in screen is repainted on a ground where either word colour falls under 4.5:1.
