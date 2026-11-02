# ADR 0147: Draw both clients in cobalt, with solid surfaces on hard edges, Jua for what we write and Pretendard for what a user wrote

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #569**, under epic #542. The owner moved the look to concept J, 말랑 젤리, replacing the colours and surfaces of [ADR 0141](0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md) and [ADR 0145](0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md). The mascot, the launcher icon, the splash and the lockups stay.
- **The mockup's lavender and purple were dropped mid-issue.** The owner found them too close to 말해보카, chose mint, then aqua, and settled on cobalt, on the final page `scratchpad/redesign/final/knowno-final.html`; its dark set was lightened after the menus read too dark.
- **Jua does not cover what users write.** The `cmap` of `Jua-Regular.ttf` at google/fonts commit 6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec holds 2,367 of 11,172 Hangul syllables, KS X 1001's 2,350 and 17 more, no Hanja, no kana and ASCII but for the backtick. It holds all 452 syllables our own sources wrote at this ADR. It lacks `·`, `⋯`, `←` and `→`, which our strings use.
- **Flutter ignores a font's `weight` descriptor and thickens a face asked for above its own weight.** On Flutter 3.47.7, `학습 완료` at 64 px in Jua drew 5,762 dark pixels at w400 and 6,439 at w800, under `flutter test`.
- **The colour of a fill and of a mark can differ.** A full-screen colour surface, a button and a mark each need their own pair, so `hero`, `primary` and `accent` are three tokens even where two share a value.
- **Alternatives considered:**
  - **Jua for a card's front, as the mockup drew it, with a per-glyph fallback.** A learning card would mix two faces in one word, as 똠양꿍, and a Hanja or Japanese card would be all fallback. A user's text is Pretendard, always.
  - **Choose per string, by a coverage table at run time.** It costs a table and a branch to keep Jua on some user text, and a card's look would change with its spelling.
  - **Declare Jua at 800 on the phone too.** The descriptor is ignored and the face is thickened, which is the crude look the owner rejected.
  - **Rewrite Jua's weight class in a modified copy.** The bundled file would stop being byte-identical to its release, for a problem a second family name solves.
  - **Keep a `primary` bar on an `edge` track.** Light, it is about 1.4:1. A mark in the fill's colour needs `accent`.
  - **Draw charts in `edge`, as the mockup did.** It is under 2:1 on the light surface, and a chart's bars carry information. `edge` is decoration only.
  - **A class on each call site for a surface's edge on the web.** About sixty sites; selectors on the classes they already carry reach them once.

## Decision

- **Colour.** Light: ground `#EEF3FF`, surface `#FFFFFF`, edge `#C9D6FB`, line `#DCE5FD`, ink `#13224A`, ink-2 `#44527A`, hero, primary and accent `#2547D0`, primary edge `#172E94`, on-hero and on-primary `#FFFFFF`. Dark: ground `#111A2E`, surface `#232F4E`, edge `#0A1020`, line `#34405F`, raised `#2E3B60`, ink `#EEF2FF`, ink-2 `#B3BEDC`, hero `#1A2F78` under white, primary and accent `#8AB4FF` on `#4A78D6`, on-primary `#0D1424`. The tab bar is `bar`, the surface light and `#2C3A60` dark. A button or chip on the hero is `heroButton` under `onHeroButton`, white under `#2547D0` light and `#8AB4FF` under `#0D1424` dark, never white under a light blue. Coral is the mascot's alone. 안다 and 모른다 take the mockup's values.
- **`muted` takes `ink2`'s value.** The mockup has one secondary text colour, and the name stays so no screen changes.
- **`accent` is every coloured mark and word:** text, a count, the current tab's label, the progress bars' fill, a chart's today bar, a selected ring, a quiet button's label on a coloured ground, and the on switch. The fill colour never carries text or a thin mark on a light surface. `primary` is a fill under its own label and never text. 
- **A solid object sits on a darker edge of its own colour**, a hard offset with no blur: 6 under a card, a group and a quiet button, 7 under a primary, 5 under a row and the tab bar. A press moves it down onto its edge, leaving 2, with no splash. Reduce motion keeps the dim alone. A disabled button has no edge. A row inside a group dims and does not move, since the group is the object.
- **`edge` is decoration.** No contrast is asked of it.
- **A chart's other bars take `chartOther`**, carried by the count beside each and 1.5:1 from `accent`: `#9DB1F0` light, `#3D568F` dark. A mark with no count of its own, a past week's mastered bar or a deck's learning share, takes `chartQuiet`, 3:1 on the surface.
- **The recall bands take three hues of their own**, since `accent` and `primary` are one cobalt: `recallStrong` `#1E9E6A`, `recallFair` `#F5B731` and `recallFading` `#E8516A` light, `#4FD69C`, `#F7C64F` and `#FF7F96` dark. They are told apart by hue, 45 degrees or more, and each count beside its band stays in ink. As marks they are 3.41, 1.79 and 3.61:1 on the light surface and 7.20, 8.28 and 5.50:1 on the dark; light 보통 is under 3:1, and its count carries it.
- **Type.** Jua draws only what we write: `display`, `title`, `deckTitle`, `figure`, `headline`, `label` and the new `button`. Everything a user wrote is Pretendard, always: a card's sides, a deck's name, a label, a search result, a file's name, an account's initial. `deckName` is Pretendard ExtraBold at a title's size, and `front` Pretendard ExtraBold at 42/46. A sheet whose title carries a user's name says so with `titleWritten`, and takes `deckName`.
- **A character Jua lacks falls back to Pretendard ExtraBold, per glyph.** The web declares Jua at 800 with `font-synthesis: none`, so the fallback takes 800. The phone asks for w400, Jua's own weight, and falls back to `PretendardExtraBold`, a family of that one face, so a w400 style takes it whole.
- **Three sizes per screen no longer count a button's label.** The mockup's button is 23 and its body 16, and the rule was written when a label was the body size.
- **The tab bar floats on its edge, each tab its name alone.** The side menu keeps its icons and tinted pill.
- **A sheet is the ground, and its rows the surface.** `AppRowSurface`'s `onSheet` goes.
- **A deck's tile takes the four note colours** `t1` to `t4`: blue `#DCE6FF`, peach `#FFE3DC`, sand `#F2EAD8` and slate `#E3E8F2` light, `#2C3A66`, `#4A3330`, `#433C30` and `#323B52` dark, held by the stored keys blue, violet, sand and slate. The keys sky and amber keep their earlier colours until the picker offers four, so a deck that chose one still draws it.

## Consequences

- A colour change is one change: every colour is a token in `theme.dart` and `globals.css`, but for the web's `themeColor` and manifest, which cannot read a token.
- `font-synthesis: none` on the web also stops a synthesized italic or bold anywhere else.
- The web loads the 2.1 MB Jua file whole, for about 450 syllables. A subset would be smaller and is a second copy to keep.
