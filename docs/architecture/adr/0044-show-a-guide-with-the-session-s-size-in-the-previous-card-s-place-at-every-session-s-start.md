# ADR 0044: Show a guide with the session's size in the previous card's place at every session's start

> Status: accepted; its exclusion of practice and its line on revealing superseded by ADR-0049; its guide text for a session that resumes a day superseded by ADR-0062; its guide superseded by ADR-0064
> Date: 2026-10-17

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Since [ADR 0042](0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md), the previous card's place is empty from a session's start until its first answer. The first-run guide of [ADR 0035](0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md), the mascot and two lines (ADR 0042 "First session"), fills it only while the user has no stored answer at all; for every other session the place stays blank.
- Issue #145 records the owner's direction of 2026-10-17, on the device, from a screenshot of a session start (0/5, a large blank area above the current card): fill that space with a short explanation when a session starts. The owner's earlier rule allowed no usage hint on any screen but the first session's guide (ADR 0035, [`design/principles.md`](../design/principles.md) §Content over chrome); this widens it, and nothing else changes.
- The PM's design in the issue: the panel sits at the previous card's size, drawn with a dashed outline and no fill, so it never reads as a card. It shows the session's size first, "오늘 n장 · 약 m분", the queue's count and its minutes at the user's pace, as the today card computes them ([ADR 0043](0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md)). Then come three lines with icons: an eye, "카드를 누르면 답이 보여요"; left-right arrows, "알면 오른쪽, 모르면 왼쪽으로 밀어요"; an up arrow, "답한 카드는 여기로 올라와요. 밀어서 바꿀 수 있어요". It shows from the session's start until its first answer and does not return; practice starts with the stack and shows none. The first-run guide merges into it, so there is one guide. On the web the arrows' line names the keys and the buttons, since the web answers the current card without a swipe.
- Alternatives the issue rules out: keeping the guide to the first session leaves the blank the owner reported; a filled panel reads as a card in the place where answered cards appear.

## Decision

- **Guide.** From every session's start until its first answer, the previous card's place holds the session's guide, at that place's size. It is a panel with a 1.5 px dashed outline in the `outline` colour, rounded as the previous card is, with no fill and no mascot. It shows the session's size and the three lines of the issue, and scrolls inside where its content is taller than the place.
- **Size.** The size is the cards the session opened with and their whole minutes, rounded up: the reviews at the review pace and the new cards at the first-answer pace, through the same function the today card uses (`Pace.minutes` on the phone, `sessionMinutes` on the web).
- **When.** The guide shows while the session is studying, not practising, and has no answer of its own. The first answer takes it away and it does not return, a "Don't know" that puts a card back included. Practice shows none, even when the session opened on the completion card with no answer of its own.
- **Reading.** A screen reader reads the guide once, as one block: on the phone one semantics node whose label is its lines; on the web a region named "학습 안내" holding them. Its text is `ink` and `ink2` on the ground, checked for contrast in both themes.
- **Web.** The same place, size and lines, but the line on answering is "알면 안다(→), 모르면 모른다(←)를 눌러요". The study page passes the user's pace in the session's plan, and the request that only said whether any answer is stored before today goes. The study skeleton outlines the previous card's place as the guide holds it.
- **Supersessions.** This replaces ADR 0035's first-session condition for its guide and the guide's mascot, and ADR 0042's "First session" guide of two lines.

## Consequences

- Every session starts with three more lines on screen. A returning user reads the same guide each time, until the first answer.
- The phone's session no longer reads whether any answer was stored before it opened, and the web's study page drops one request.
- The guide's minutes and the today card's agree for the same selection, since both count the same queue through one function.
- The web no longer draws the mascot at 64 px, so its `mascot-guide` size token goes; the phone keeps the size for the 오늘 tab's backlog card.

## Signs the decision was wrong

- Users report the guide as noise once they know the screen, or ask to turn it off.
- Users take the dashed panel for a card, or try to answer it.
- The guide's minutes differ from the today card's for the same decks.
