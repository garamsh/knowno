# ADR 0152: Let the mascot blink and breathe from its own drawing, and put the launcher icon on cobalt

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #573**, under the cobalt look of [ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md). On 2026-11-02 the owner asked for the mascot to blink ("캐릭터도 눈 깜빡이거나 그런거 추가해도 좋을듯"), and the PM chose the launcher icon's option B from four rendered options.
- **The mascot was still** under [ADR 0141](0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md) ("still, so reduce motion asks nothing of it"), a PNG on the phone and an `<img>` of an SVG on the web.
- **The launcher icon and the favicon were the mark close up on the cream**, and Android's adaptive icon the mark over the cream ([ADR 0139](0139-draw-both-clients-around-the-coral-mascot-with-warm-colour-tokens-and-rounder-taller-buttons.md), ADR 0141), beside cobalt screens.
- **The splash's grounds were still ADR 0139's warm** `#FFF6E8` and `#1F1512`, not the screens' `#EEF3FF` and `#111A2E`.
- **The motion was settled from a working demo** on the repository's own drawings, the PM's comment on #573: per expression, by size, with reduce motion stopping everything.
- **A squashed eye alone reads as a white sliver**, in the demo, so the closed eye is a lid drawn over it, and the issue's eyelid in the body colour was dropped.
- **Alternatives considered:**
  - **Rive.** A designer-authored state machine in an editor of its own, with a runtime on each client. Nothing here needs a state machine; it is the path to revisit if motion later does.
  - **Lottie, or a generated video.** A second copy of the drawing in another format, which drifts from `tools/brand/`, adds a runtime, and leaves reduce motion to a player.
  - **`flutter_svg` on the phone.** A new dependency to draw what twenty shapes in a `CustomPainter` draw, and it moves no part on its own.
  - **Parse the SVG on the phone at run time.** Dart path data written by the generator keeps the phone free of XML.
  - **Close an eye by scaling it to 0.1.** The sliver above.
  - **Draw the inline SVG at every size on the web.** The screens' tests find the mascot by its file, and the still `<img>` is what it was; the inline drawing replaces it only while it moves.
  - **The mark close up on cobalt for Android's adaptive foreground.** The adaptive mask keeps the middle two thirds, so a close up would show only the face, cut at the foot; the mark alone over cobalt is option B's ground with the whole mascot.

## Decision

- **The drawing stays exact, and `tools/brand/` its one source.** The drawings name their moving parts by class: each eye, its pupil, the happy arms and the sleepy Z's. `tools/brand/generate.mjs` also writes the parts each client moves, with each eye's closed lid, an ink arc 20 wide across 0.72 of the white's radius each side of its centre, dipping half a radius: Dart shapes for the app and inline SVG markup for the web, both checked by `generate.mjs --check` like every other brand file.
- **The motion**, the same on both clients:
  - a blink shuts the open eyes in 70 ms, the eye scaled to 0.05 high about its centre and hidden at 60 ms behind its lid, holds 110 ms, or 160 ms when sad, and opens in 60 ms; one gesture every 3 to 7 s, a double blink one time in five, and a thinking mascot's glance of up to ±22 by ±14 units for 1.4 s about one time in eight;
  - at 200 and over: a breath of 1.012 by 0.982 about the feet on 3 s, thinking and sad; the happy one's hop on 1.6 s, squashing to 1.04 by 0.95, rising 46 units and landing at 1.03 by 0.97, its arms lifting 14 units; the sleepy one's deeper breath of 1.02 by 0.97 on 4.2 s, its Z's drifting up and fading;
  - from 41 to 199, the blink alone; at 40 or less, still.
- **Reduce motion stops everything**, and the mascot is the still image. So it is off screen: the phone stops its one ticker where a `TickerMode` is off or the app is in the background, and the web watches its one element with an `IntersectionObserver`.
- **The launcher icon and the favicon are option B:** cobalt `#2547D0`, the mark at `translate(-36 70) scale(1.08)`, cobalt showing around its head. iOS's dark icon is the same on `#111A2E`, and Android's adaptive icon the mark alone over cobalt. The lockups keep their cream circle.
- **The splash keeps the screens' grounds**, `#EEF3FF` and `#111A2E`, so no colour flashes before the first screen.
- **Supersedes** ADR 0141's "still, so reduce motion asks nothing of it" and its launcher icon and favicon on the cream, and ADR 0139's adaptive icon over the cream and its splash grounds.

## Consequences

- A change to the drawing is still one edit and `make brand`; a moving part is one class in a drawing and one case in each client's motion.
- The phone draws a moving mascot with a `CustomPainter` in its own layer and keeps the PNG where it stands still; the web swaps its `<img>` for the inline drawing while it moves.
- No mascot on a screen today is 200 or more, so only blinks show until #578 and #579 place larger ones.
- The phone's tests hold the mascot still on every screen but its own, as the streak flame's do; the web's test environment has no `IntersectionObserver`, so its screens' tests meet the still image.

## Signs the decision was wrong

- Users find a blinking mascot distracting on a screen they meet daily, or ask to turn it off apart from reduce motion.
- A blink at 48 px reads as a flicker rather than a blink.
- A designer needs motion the parts cannot express, such as a new pose, and the classes in the drawings grow into a state machine Rive would have held.
- The cobalt icon is lost among other blue icons on a home screen.
