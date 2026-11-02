# ADR 0147: Draw both clients in mint, with solid surfaces on hard edges, Jua for what we write and Pretendard for what a user wrote

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #569**, under epic #542. The owner moved the look to concept J, 말랑 젤리, replacing the colours and surfaces of [ADR 0141](0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md) and [ADR 0145](0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md). The mascot, the launcher icon, the splash and the lockups stay.
- **The mockup's lavender and purple were dropped mid-issue.** The owner found them too close to 말해보카 and chose mint, with its values given as the mockup's `data-pal="mint"`.
- **Jua does not cover what users write.** The `cmap` of `Jua-Regular.ttf` at google/fonts commit 6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec holds 2,367 of 11,172 Hangul syllables, KS X 1001's 2,350 and 17 more, no Hanja, no kana and ASCII but for the backtick. It holds all 452 syllables our own sources wrote at this ADR. It lacks `·`, `⋯`, `←` and `→`, which our strings use.
- **Flutter ignores a font's `weight` descriptor and thickens a face asked for above its own weight.** On Flutter 3.47.7, `학습 완료` at 64 px in Jua drew 5,762 dark pixels at w400 and 6,439 at w800, under `flutter test`.
- **Mint fails as a mark on white.** `#7FE0C3` is 1.47:1 on the light ground. It cannot carry text, a count, a chart bar or a progress bar.
- **Alternatives considered:**
  - **Jua for a card's front, as the mockup drew it, with a per-glyph fallback.** A learning card would mix two faces in one word, as 똠양꿍, and a Hanja or Japanese card would be all fallback. A user's text is Pretendard, always.
  - **Choose per string, by a coverage table at run time.** It costs a table and a branch to keep Jua on some user text, and a card's look would change with its spelling.
  - **Declare Jua at 800 on the phone too.** The descriptor is ignored and the face is thickened, which is the crude look the owner rejected.
  - **Rewrite Jua's weight class in a modified copy.** The bundled file would stop being byte-identical to its release, for a problem a second family name solves.
  - **Keep a `primary` bar on an `edge` track.** Light, it is about 1.3:1. A mark in the mint needs `accent`.
  - **Draw charts in `edge`, as the mockup did.** It is 1.47:1 on the light surface, and a chart's bars carry information. `edge` is decoration only.
  - **A class on each call site for a surface's edge on the web.** About sixty sites; selectors on the classes they already carry reach them once.

## Decision

- **Colour.** Light: ground `#EFFAF6`, surface `#FFFFFF`, edge `#BFE9DC`, line `#DDF3EC`, ink `#12332C`, ink-2 `#3F5F57`, primary `#7FE0C3` on its edge `#4FB89B`, on-primary `#12332C`, accent `#0B6B57`. Dark: ground `#10251F`, surface `#1B342D`, edge `#0A1714`, line `#2C4A41`, ink `#E9F8F3`, ink-2 `#A8C9BF`, primary `#7FE0C3` on `#4FB89B`, on-primary `#10251F`, accent `#7FE0C3`. Coral is the mascot's alone. 안다 and 모른다 take the mockup's values.
- **`muted` takes `ink2`'s value.** The mockup has one secondary text colour, and the name stays so no screen changes.
- **`accent` is every coloured mark and word:** text, a count, the current tab, a chart's stressed bar, a progress bar and the on switch. `primary` is a fill under its own label and never text. A primary button is told from the ground by its `onPrimary` label and its `primaryEdge`, not by the fill, which is 1.47:1 on the ground.
- **A solid object sits on a darker edge of its own colour**, a hard offset with no blur: 6 under a card, a group and a quiet button, 7 under a primary, 5 under a row and the tab bar. A press moves it down onto its edge, leaving 2, with no splash. Reduce motion keeps the dim alone. A disabled button has no edge. A row inside a group dims and does not move, since the group is the object.
- **`edge` is decoration.** No contrast is asked of it. A chart's bars and the recall bands take `chartQuiet` and `chartFading`, 3:1 on the surface and 1.5:1 from each other and from `accent`.
- **Type.** Jua draws only what we write: `display`, `title`, `deckTitle`, `figure`, `headline`, `label` and the new `button`. Everything a user wrote is Pretendard, always: a card's sides, a deck's name, a label, a search result, a file's name, an account's initial. `deckName` is Pretendard ExtraBold at a title's size, and `front` Pretendard ExtraBold at 42/46. A sheet whose title carries a user's name says so with `titleWritten`, and takes `deckName`.
- **A character Jua lacks falls back to Pretendard ExtraBold, per glyph.** The web declares Jua at 800 with `font-synthesis: none`, so the fallback takes 800. The phone asks for w400, Jua's own weight, and falls back to `PretendardExtraBold`, a family of that one face, so a w400 style takes it whole.
- **Three sizes per screen no longer count a button's label.** The mockup's button is 23 and its body 16, and the rule was written when a label was the body size.
- **The tab bar floats on its edge, each tab its name alone.** The side menu keeps its icons and tinted pill.
- **A sheet is the ground, and its rows the surface.** `AppRowSurface`'s `onSheet` goes.
- **The mockup's mint and rose deck tiles are not taken.** The palette holds no green or red ([ADR 0103](0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md)), which still mean 안다 and 모른다; `deckBlue`, `deckViolet` and `deckAmber` move to the mockup's other tiles.

## Consequences

- A colour change is one change: every colour is a token in `theme.dart` and `globals.css`, but for the web's `themeColor` and manifest, which cannot read a token.
- 안다's ground `#BFF0DC` shares mint's hue, at 1.25:1 from `primary` and 1.18:1 from the light ground. A shape and a word carry it where it is a card; a screen that changes its whole ground to it, as #570 plans, rests on the mascot and the word.
- `font-synthesis: none` on the web also stops a synthesized italic or bold anywhere else.
- The web loads the 2.1 MB Jua file whole, for about 450 syllables. A subset would be smaller and is a second copy to keep.
