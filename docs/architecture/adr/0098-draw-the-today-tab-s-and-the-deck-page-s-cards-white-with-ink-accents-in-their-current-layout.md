# ADR 0098: Draw the 오늘 tab's and the deck page's cards white with ink accents, in their current layout

> Status: accepted; its `onHeroText` variant superseded by ADR 0189, which removed the completion panel that drew it (#737)
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0036](0036-organise-the-app-in-today-decks-and-record-tabs-and-define-the-daily-goal-forecast-and-card-progress.md) draws the 오늘 tab's today card and the deck page's card on the navy `hero` token. Their quiet text and tracks are `onHero` at 80% and 16%, and their button is `onHero`'s white fill. [ADR 0091](0091-draw-the-today-card-as-a-progress-bar-and-change-the-daily-study-minutes-only-in-settings.md) draws the today card's bar white on the navy's faint track. The backlog card, the card that says why a count cannot be read, and the placeholder while the count is read share the same navy card.
- The owner rejected the navy-filled cards on 2026-10-26 (#374) and chose a white card with navy accents for the today card. The layout stays as it is: no row moves or merges.
- The PM decided on #374 that every navy card on the 오늘 tab and the deck page turns white, so one surface does not carry two card styles.
- Two later decisions on #374 narrowed the issue:
  - the streak chip keeps its flame;
  - the deck tile stays, since #382 gives it a chosen icon and colour.
- `hero` and `onHero` are still drawn by the study coach and the study screen's notice, in `app/lib/study/`.

## Decision

- **The cards.** These five cards are drawn on `surface`, with the today card's card shadow, which the deck page's card now takes too:
  - the today card;
  - the backlog card;
  - the card that says why a count cannot be read;
  - the placeholder while the count is read;
  - the deck page's card.

  Each keeps its current layout.
- **The accents are ink:**
  - the large count and the day's cards' figure;
  - the today card's bar, on the `hairline` track;
  - the deck page's progress bar in its default ink and hairline;
  - the pills' labels;
  - the button, which is the primary variant, the navy fill inverted in the dark theme, and the one primary action on the card.
- **Quiet text** is `muted`.
- **Pills.** The streak and the "더 했어요" pills are an outline in `outline` on the white.
- **The mascot.** The backlog card's mascot sits in a `brandTint` circle.
- **Tokens.** `heroQuiet` and `heroTrack`, used only by these cards, are removed. So are `ProgressBar`'s `ink` and `track` overrides, which only the deck page's navy card passed. `hero`, `onHero` and the button variants `onHero` and `onHeroText` stay, for the study coach and the study screen's notice.
- **What is unchanged:**
  - `_StreakChip` and its flame;
  - `DeckTile`;
  - the done card on the brand tint;
  - the rows' and the chart's surfaces.
- **Alternatives considered:**
  - **Only the today card white.** It would leave the backlog card and the deck page navy, two card styles for one surface, which the PM declined on #374.
  - **A rebalanced layout with the status line beside the figure.** The owner saw it and declined it on #374.
  - **Remove `hero` and `onHero`.** The study screens still draw them, and they belong to another area.

## Consequences

- The 오늘 tab and the deck page read as one set of white cards over the ground. Their one navy fill is the primary button, as on every other screen.
- `app/test/home/home_screen_test.dart` and `app/test/home/deck_screen_test.dart` check each card's fill and button, and that every text outside the button reaches 4.5:1 on the card in both themes. `textContrastGuideline` alone cannot fail text drawn in the card's own colour.
- The web's 오늘 page and deck page keep the navy until the issue that follows this one.

## Signs the decision was wrong

- The today card no longer stands out from the "지난 7일" card under it, and users miss "모두 학습".
- The outlined pills read as buttons.
