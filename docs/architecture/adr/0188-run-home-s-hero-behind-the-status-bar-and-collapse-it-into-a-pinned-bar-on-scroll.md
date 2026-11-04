# ADR 0188: Run 홈's hero behind the status bar and collapse it into a pinned bar on scroll

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #728.** The owner's iPhone, TestFlight build 1, 2026-11-04: "위에가 색이 달라서 이상하고" — the status bar's band above 홈's hero was not the hero's blue, and scrolled, its dark glyphs sat on blue; "밑으로 내릴시 페이지가 내려가는 느낌인데 저 파란색 부분이 줄어드는 느낌으로 만들고싶어" — scrolling moved the whole page where the owner wants the blue to shrink. The first shot also showed 시작's raised edge cut by the hero's foot. The PM's decisions on #728 follow from it.
- **Before this record**, [ADR 0179](0179-fill-home-s-first-screen-with-the-hero-and-reach-the-week-card-by-scrolling.md) put the hero over the week card in one plain page scroll, "with no drawer, sheet, snap or label". The phone set no status bar style anywhere 홈 shows, so the glyphs kept whatever an earlier screen had left; the web's `theme-color` was the ground's on every page and its viewport did not cover the screen.
- **What each platform provides,** and this record follows:
  - Flutter: a `CustomScrollView` with a pinned `SliverPersistentHeader`, whose delegate builds the header at each shrink offset between its maximum and minimum extents (api.flutter.dev, `SliverPersistentHeader`, Flutter 3.47.7); `AnnotatedRegion<SystemUiOverlayStyle>`, which sets the status bar's style from what is drawn under it (api.flutter.dev, `AnnotatedRegion`, `SystemUiOverlayStyle`). Flutter lays every screen out under the status bar with the bar's height as `MediaQuery.padding.top`; on Android, edge to edge is the default for an app targeting SDK 35 and later (developer.android.com, "Display content edge-to-edge in views"), which `app/android/app/build.gradle.kts` takes from Flutter's `targetSdkVersion`, and a clear `statusBarColor` lets the hero show through on earlier versions.
  - The web: `viewport-fit=cover` with `env(safe-area-inset-top)` for the content's inset (CSS Environment Variables, `safe-area-inset-*`; the `viewport` meta's `viewport-fit`), and `<meta name="theme-color">` with a `media` attribute for the browser's bar (HTML Living Standard, `theme-color`), both written through Next.js 16's `viewport` export of the page.
- **Alternatives considered:**
  - **`SliverAppBar` with a `FlexibleSpaceBar`.** Its collapse fades a background and scales a title on a toolbar of its own; the hero's mascot, title, line and 시작 would each need overriding, and its snap needs `floating`, which shows the bar on any scroll up. A delegate draws the hero's own parts.
  - **`SliverResizingHeader`,** which measures prototypes of its largest and smallest content. Its prototypes are built into the tree, every word of the hero twice; the hero measures its own content instead.
  - **Snapping by `ScrollPhysics`.** A physics has no view of the hero's extents; settling once the user's scroll ends, as `ScrollEndNotification` reports it, does.
  - **A hero that shrinks from 1024 px on the web too.** From there the hero is a card in the side menu's column, with no status bar above it ([ADR 0179](0179-fill-home-s-first-screen-with-the-hero-and-reach-the-week-card-by-scrolling.md) "From 1024 px on the web"); it stays as it is.

## Decision

- **Edge to edge.** On the phone and on the web below 1024 px the hero's blue runs from the screen's top edge behind the status bar, its words in the safe area below it. Over the hero the status bar's glyphs are light; where the ground shows they are the theme's own, dark in the light theme and light in the dark, from one style at the app's root that every screen without its own keeps. The web's `theme-color` is `hero` below 1024 px and the ground's from it.
- **A collapsing hero.** Scrolled, the hero shrinks rather than moves, from its height at rest to a slim bar pinned at the top under the status bar:
  - the mascot shrinks to half and fades by 0.6 of the collapse; the app's name and the profile button fade by half of it; the line, the action and a failure's row fade by 0.4; the title shrinks to 0.6 and fades from 0.3 to 0.7; the face stays centred in the shrinking hero;
  - from half the collapse the bar fades in and is the hero's to read and press: today's cards and minutes in one line, "오늘 n장 · n분", in `title`, or the day's title in a backlog and once the day is done, beside a compact action at the header size, "시작" or "학습하기", with room under it for its edge;
  - the week card goes up beneath the bar; pulled down, the hero expands again;
  - a scroll the user started that ends part way collapses or expands the hero fully, by whichever is nearer, at once under reduce motion; a scroll a script makes is left where it ends.
- **Large text.** Where the hero's words need more than the first screen, the page scrolls by what they need past it, as a page does, before the hero shrinks; 시작 is whole on the screen there.
- **Room for the collapse.** What is under the hero is at least the screen less the bar, so the hero can collapse fully however short it is; with nothing under it, as with no card or a count that cannot be read, the hero is the whole first screen and does not collapse at text scale 1.0.
- **시작's edge.** At rest the hero leaves room under 시작 for its edge, as at its collapse the bar does under its action ([`design/principles.md`](../design/principles.md) §Nothing clipped).
- **Unchanged:** at rest the hero fills the first screen with the week card's top edge peeking, as ADR 0179 decides. This supersedes ADR 0179's "one plain page scroll" with "no snap": the hero collapses and settles; what follows it still scrolls as a page does.

## Consequences

- The pinned bar takes the top of every screen of 홈 after the first: 60 points at text scale 1.0 under the status bar on the phone, more at a larger text size.
- 홈 at 1.0 always scrolls by at least the collapse, with ground under the week card where the page is short.
- At a large text size the week card can be taller than the room under the bar; it is reached by scrolling, its top and its foot in turn.
- The profile button is on the hero at rest alone; collapsed, 설정 is a pull down away.

## Signs the decision was wrong

- The owner still reads the scroll as the page moving, or the settle as fighting the finger.
- Users miss the profile button once 홈 is collapsed.
- The status bar's glyphs show the wrong brightness on a screen opened from 홈.
