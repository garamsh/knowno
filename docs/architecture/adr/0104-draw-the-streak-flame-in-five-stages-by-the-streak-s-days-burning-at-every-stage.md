# ADR 0104: Draw the streak flame in five stages by the streak's days, burning at every stage

> Status: superseded by ADR-0151
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #384.** The owner asked on 2026-10-26 for a streak flame that is designed rather than a single fixed icon: brighter as the streak lengthens, brightest from 30 days.
  - The issue set five stages by days: 1–2 an outline, muted; 3–6 a light fill; 7–13 a fuller fill; 14–29 solid with a warm core and a faint glow; 30 on the brightest, with a glow.
  - The owner then refined it: the flame burns at every stage, flickering, swaying and shifting its tip like a small fire, livelier as the stage grows. A static icon at any stage fails.
- **Where it shows.** The 오늘 tab's streak chip and the completion card drew `LucideIcons.flame` in `streak`.
- **Sourcing.** The owner allowed reusing open-source work under MIT, Apache-2.0, BSD, ISC, Zlib, CC0 or the Lottie Simple License, named with its version and license, the license text kept beside it.
- **Colour tokens.** A colour added to `AppColors` has to be added to the web's `globals.css` too: `web/src/styles/__tests__/theme-tokens.test.ts` expects the same 30 tokens on both clients. The web has no animated flame.
- **Tests.** `pumpAndSettle` waits until no frame is scheduled, and a flame that always moves always schedules one. Every test that shows a streak would time out.
- **Alternatives considered:**
  - **A Lottie animation with the `lottie` package (MIT).** It adds a dependency and an asset to license and keep, for one small mark.
  - **Lucide's flame path, filled.** Lucide's paths are drawn for a stroke. A fill, a core and a moving tip need a path built for them, and copying Lucide's would carry its ISC notice for a shape that no longer matches it.
  - **New hex tokens for the core and the glow.** They would need the web's token set changed, for a flame the web does not draw.
  - **Hold the flame still in each test that shows a streak.** That spreads one switch across many test files, and each new test would have to remember it.

## Decision

- **One widget.** `StreakFlame`, in `app/lib/design/streak_flame.dart`, draws a streak's flame at the stage its days give. The 오늘 tab's streak chip and the completion card draw it in place of `LucideIcons.flame`.
- **Drawn by hand.** It is a `CustomPainter` on a 24-unit square, in the flame icon's proportions and its 2-unit line, with no package and no asset. It does not reuse the icon's path, which differs from the issue's "drawn from the app's flame icon": the path has to fill, hold a core and move.
- **Stages:**
  - 1–2 days: an outline in `flameOutline`;
  - 3–6: `streak` at 35% inside its `streak` line;
  - 7–13: at 70%;
  - 14–29: solid `streak` with a `flameCore` core and a `flameGlow` glow at half strength;
  - 30 on: the same with its glow at full strength.
- **Motion, at every stage.** The tip sways and rises, a lick on its left side moves with it, and the sides breathe. The movement grows with the stage, from 35% of the liveliest at 1–2 days to all of it from 30. One cycle runs 2.4 s at the first stage and 1.2 s at the last.
- **Cost.** One animation controller per flame repaints the flame alone, under its own `RepaintBoundary`, with no rebuild per frame.
- **When it holds still:**
  - under reduce motion, one still frame of its stage;
  - while the app is not in the foreground, and wherever a `TickerMode` above it is off.
- **Screen readers.** The flame is hidden from them; the text beside it, "n일 연속", names the streak.
- **Colours.** `AppColors` derives the flame's three tokens: `flameOutline` is `muted`, `flameCore` is `streak` halfway toward `onHero`, and `flameGlow` is `streak` at 35%. The web's token set is unchanged.
- **Tests.**
  - A seam, `streakFlamesMove`, `@visibleForTesting`, is set false for every test file in `app/test/flutter_test_config.dart`, so a screen with a flame settles. There the flame shows its still frame, as under reduce motion.
  - `app/test/design/streak_flame_test.dart` sets it back to true. It checks each stage boundary, the motion, the still frame under reduce motion, the pause in the background and under `TickerMode`, and that the flame has no semantics node.

## Consequences

- A streak's length shows at a glance, and the flame is alive at every stage.
- The flame repaints at the display's frame rate while visible. Its cost is one small path a frame, held to its own layer.
- Screenshots and widget tests show each stage's still frame; only the flame's own tests run its motion.
- The "지난 7일" summary's streak line still draws `LucideIcons.flame`, outside this decision's places.

## Signs the decision was wrong

- Users find the moving flame distracting beside the today card's figures, or ask to turn it off.
- Profiling shows the flame's frames competing with a screen's scrolling or the study card's swipe.
- A test passes with a flame that never moves in the app, because the seam was left false outside the tests.
