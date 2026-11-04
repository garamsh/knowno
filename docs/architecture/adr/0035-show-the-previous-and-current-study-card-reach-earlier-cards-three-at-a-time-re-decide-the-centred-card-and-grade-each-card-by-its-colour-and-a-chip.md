# ADR 0035: Show the previous and the current study card, reach earlier cards three at a time, re-decide the centred card, and grade each card by its colour and a chip

> Status: accepted; its "Rest", "Earlier cards" and "Re-deciding", its first-run guide's line on reaching earlier cards, and the web's keys, wheel and drag to earlier cards and the centred card's change button superseded by ADR-0042; its guide's first-session condition and mascot superseded by ADR-0044; the eye in the hidden answer's half and the web's 답 보기 button and Space key superseded by ADR-0049; on the phone, its "그만하기" 44 high where no new card is left superseded by ADR-0093; on the phone, its answer buttons under the current card and its grade chip superseded by ADR-0099; on the web, its previous card's grade chip superseded by ADR-0105; its "그만하기" as a quiet button on the completion card while new cards are left superseded by ADR-0189
> Date: 2026-10-16

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #88 records the owner's study screen for the v3 canvas, approved on 2026-10-16 (the artboards `Study`, `StudyScrolled`, `StudyFirst`, `WebStudy` and `WebStudyMobile`). On `main` at `4a8890682b5fc6cfe23e4dc8a9f60580d41a6c56`, the screen shows every answer of the session above the current card in one scroll view, each with an 8 px dot for its answer, greyed and blurred by depth, and toggled by a tap ([ADR 0007](0007-study-swipe-screen-and-session-toggle.md), [ADR 0023](0023-scroll-the-current-study-card-with-the-stack-and-centre-each-half.md)); a hint row of chevrons and the words 모른다 and 안다 sits under the card ([ADR 0027](0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md)).
- The owner decided:
  - at rest, the previous card and the current card are visible; the previous card is smaller, flat, and shows its answer; the current card is large, white and raised, its answer hidden until a tap;
  - dragging down brings older cards into view; scrolled, three cards are visible, the centred one the largest and fully opaque, the others smaller and dimmed;
  - the centred previous card is dragged left or right to change its answer, revealing the target answer behind it, replayed as a toggle is; "지금 카드로" returns to the current card;
  - each answered card shows its grade by a light fill and a border in its colour, and by a corner chip with an icon and the word, so the grade never rests on colour alone; no dot;
  - on the first session only, a guide of three lines; no hint text anywhere else;
  - the web follows the same model with keys, a list of the session's answers beside the cards on a wide screen, and the phone layout with large answer buttons at a phone's width.
- The PM settled the points the issue left open, on the worker's questions in the dispatch of issue #88:
  - the 44 px 모른다 and 안다 pill buttons the phone artboards draw under the current card are answer controls, not hint text, and replace the hint row;
  - the hidden answer's half shows an eye alone, named "답 보기" for screen readers; the web's desktop keeps its visible "답 보기" button with its Space key, as ADR 0022 gives every shortcut a visible control;
  - the first session is the one where the user has no stored answer at all, read from the stored reviews on both clients, so it needs no new storage and holds across devices; the guide shows the mascot and the three lines, and no deck name;
  - the completion card follows the artboard: a streak colour for its flame, an 84 px mascot circle, and "그만하기" 44 px high on both clients;
  - the grades' fills, lines and the answer buttons' words take new colour tokens, in light and dark, checked for contrast in tests;
  - the web's study screen names no deck.
- Alternatives considered for reaching earlier cards:
  - A separate list or sheet of the session's answers. It splits the session into two surfaces, where the owner asked for one column the current card belongs to.
  - A wheel picker (`ListWheelScrollView`). It centres every item, the current card included, on one fixed height, where the current card grows with its content and rests low on the screen.
  - Emphasis by layout, each card resized as the column scrolls. Every frame of a scroll would lay out the column again; painting each card's scale and opacity from its distance to the centre changes nothing but paint.
- Alternatives considered for re-deciding:
  - A tap that toggles, as before. A tap on a card scrolled past by accident changes an answer; a drag on the centred card names the answer it gives before it is released.
  - Dragging any visible previous card. The card at rest above the current card sits where a swipe on the current card may start, so only the centred card, while the column is scrolled back, is dragged.

## Decision

- **Rest.** At the column's end the newest previous card sits above the current card, smaller, on its grade's fill, without a shadow and with both sides shown; older cards lie above the view. Each previous card takes a slot of 36% of the column's height, so at rest only one is in view.
- **Earlier cards.** Dragging down scrolls the column; released, it comes to rest with a previous card at the column's centre, or at its end. Scrolled back, the centred card is at full size and opacity and every other card, the current card included, is smaller and dimmed; the scale and the opacity are painted from each card's distance to the centre. "지금 카드로" returns to the end, at once under reduce motion.
- **Re-deciding.** The centred previous card, while the column is scrolled back, follows a horizontal drag; past 100, or flung, toward the answer it does not have, it changes to that answer, and the answer it would give shows behind it from the start of the drag. Toward the answer it has, it follows the finger a quarter as far and changes nothing. A change replays the card's session answers as a toggle does ([ADR 0007](0007-study-swipe-screen-and-session-toggle.md)) and leaves the view where it is. A screen reader changes any previous card through its action, "안다로 바꾸기" or "모른다로 바꾸기".
- **Grading.** A previous card shows its grade by its fill and its line, `knowCard` and `knowLine` or `dontKnowCard` and `dontKnowLine`, and by a chip on its top edge with a check or a cross and the word, white on the grade's colour; its label names the grade. There is no dot, no greying and no blur by depth.
- **Answering.** Under the current card, "모른다" and "안다" buttons answer it as a swipe does. The hidden answer's half shows an eye.
- **First session.** While the user has no answer stored, in any deck, and none given yet, the mascot and three lines on revealing, answering and reaching earlier cards sit above the first card, until the first answer.
- **One split card.** The split card is drawn by `deck`, which owns a card's content: `SplitCard` lays out the two halves, side by side or stacked, and `ContentView` renders a side's blocks, through `deck`'s surface. The study cards, the card preview and the card rows draw through them.
- **Completion.** The completion card moves to a file of its own, its flame takes the `streak` token, its mascot circle is 84, and "그만하기" is 44 high on both clients.
- **Web.** The same model, with keys: Space shows the answer; ← and → answer, or change the centred card's answer while an earlier card is centred; ↑, the wheel or a downward drag reaches earlier cards, three at a time, and ↓ or "지금 카드로" returns. The centred card also offers its change as a button. From 1024 px wide, this session's answers are listed beside the cards, each a button that changes it; narrower, the list is hidden. The answer buttons are 56 high, tinted by their grade. Every movement is under `motion-safe`.
- **Supersessions.** This replaces ADR 0007's stack of every answer above the current card, its dots, its greying and blur by depth and its toggle by tap; ADR 0023's "Gestures", as a horizontal drag on the centred previous card now changes its answer, and its bottom gap, now under the answer buttons; and ADR 0027's study hint row.

## Consequences

- The screen at rest shows two cards, where it showed the whole session; the session stays one scroll away.
- An answer is changed by a deliberate drag on one card, or by an action, so a stray tap no longer changes one; changing an answer needs two steps, a scroll and a drag.
- The grade reads from colour and word together, in both themes; seven colour tokens join the theme, and `knowDot` and `depth` with the dot size leave it.
- The first-run guide depends on the stored reviews read when a session opens, so a user whose first answers were given on another device and not yet synced sees it once more.
- The web's list beside the cards gives a mouse a one-click change of any answer; at a phone's width, the change is reached by scrolling back.

## Signs the decision was wrong

- Users at rest look for the answers before the previous one and do not find the scroll.
- Users scroll back, drag a card that is not quite centred, and see nothing happen, or ask for a tap to change an answer again.
- The 36% slot leaves long sessions slow to scroll through, or the resting view shows part of a third card on screens the slot was not checked on.
- The light fills read as one colour to users who cannot tell green from red, and the chip is overlooked.
- Returning users see the first-run guide on a new device before sync, often enough to report it.
