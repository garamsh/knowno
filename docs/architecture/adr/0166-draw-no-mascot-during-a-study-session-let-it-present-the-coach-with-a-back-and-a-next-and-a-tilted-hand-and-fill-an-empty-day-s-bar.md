# ADR 0166: Draw no mascot during a study session, let it present the coach with a back and a next and a tilted hand, and fill an empty day's bar

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The mascot between the cards.** [ADR 0151](0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md) put it centred over the gap between the two study cards, its face following a drag. The owner, on issue #612, 2026-11-03: "학습에서도 말랑이가 정 중앙에 있는게 거슬려". The issue weighed three places (the edge a card is dragged toward, the progress bar, none during study). The owner then ruled on #612: no mascot during a session, and the mascot presents the first-use coach.
- **No space was the mascot's.** It was drawn over ADR 0042's 16 px gap and reserved nothing, so taking it out frees nothing. The PM kept the gap at 16.
- **The coach.** It was a caption on `hero` with "건너뛰기" and "다음", which moved on by itself only through those buttons. Its touch was Lucide's `pointer`, a cursor hand in a thin outline, which the web drew under a blurred shadow. The owner found it unnatural and faint, "손이 부자연스러워 좀 흐리다". An upright drawn hand, tried after that, read as a rude gesture. The owner chose option A1 of a set of pointing hands on #612: the index raised at an angle, three knuckles beside it, the thumb out to the side.
- **An empty day's plan.** A session with no card in the day's plan, when another deck's answers took the day's new cards and this deck's new cards are studied past the plan, drew its bar full on the phone and empty on the web. `design/principles.md` §One style on every client makes that a defect of the web. Neither `study.md` nor `web-study.md` named the case.
- **Alternatives considered:**
  - **The edge a card is dragged toward, or the progress bar's leading edge**, each still reacting to a drag. The owner ruled both out: during a session the cards take the screen alone.
  - **A bare touch ring with no hand.** The owner preferred a hand, for reading as a finger at once.
  - **The hand drawn in each client's own code.** One drawing, generated into both clients' files as the mascot's are ([ADR 0152](0152-let-the-mascot-blink-and-breathe-from-its-own-drawing-and-put-the-launcher-icon-on-cobalt.md)), keeps the two hands the same.
  - **A face per step**, happy for 안다 and sad for 모른다. The owner ruled the mascot keeps its own thinking face throughout.

## Decision

- **No mascot during a session.** The study screen draws none while a card is studied, at rest or under a drag of either card. The drag that fed its face goes on both clients. 학습 완료's happy mascot and the empty state's sleepy one stay.
- **The coach, presented by the mascot.** On first use and from "안내 다시 보기", the mascot in its thinking face, 56 across, stands at the left of the coach's caption in the guide's row's place. The caption is its speech bubble on `surface`, rounded as a row on a row's edge, with a tail toward the mascot. The bubble holds the step's line, the same lines as before, by touch or by pointer, then one row:
  - "이전", quiet `ink2` text, disabled at 35% on the first step;
  - the step dots, the current one drawn long in `accent` and the others in `edge`;
  - "다음" in the primary fill, which reads "시작하기" on the last step and ends the coach.

  There is no "건너뛰기". The coach ends on an answer or a drag of the current card, on "시작하기", or when the screen closes. Each step's demonstration loops until the user moves on.
- **Motion.** The mascot and the bubble rise in and fade in over 300 ms as the coach starts. Under reduce motion they show at once, and each step stays the still image it already was.
- **The touch, on the touch coach alone.** The pointer coach keeps its marks and draws no hand.
  - The hand is A1 redrawn for knowno in `tools/brand/coach-hand.svg`, on a 120 square, in simple strokes that stay crisp at the 44 it is drawn: an outline, the creases between the knuckles, and its tip. Each client draws it in its theme's tokens: the outline filled in `surface` and drawn in `ink`, 5 of 120 wide, about 1.8 px at 44, as the mascot's 20 of 1024 come to at 96; and the outline again under it, 6 right and 6 down, in `edge`, a hard edge with no blur. The reference's colours map to those tokens: its navy to `ink`, its white to `surface` and its blue offset to `edge`.
  - `tools/brand/generate.mjs` writes its paths into `app/lib/study/src/coach_hand_drawing.dart` and `web/src/features/study/components/coach-hand-drawing.ts`, and its `--check` covers both.
  - The fingertip is the anchor: it sits on the ring's centre, and the hand moves with the card and the trail.
  - Under the fingertip sits a 40 ring in `accent` with a solid centre dot, over the accent at 18% and on a hard edge of `primaryEdge` at 35%. A dashed trail in the accent runs back to where the touch began, drawn out as the card moves.
  - Under reduce motion the hand, the ring and the trail hold where the card is out.
- **An empty day's bar is full on both clients**, since nothing of the day's plan is left. The web now draws the phone's.
- **Superseded:** ADR 0151's mascot between the cards, and [ADR 0064](0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md)'s coach 건너뛰기, finger and caption on the hero.

## Consequences

- The cards take the whole study screen, and the mascot appears in a session only while it teaches.
- The coach no longer runs on by itself, and a user can step back to a step they missed.
- A user who wants out of the coach early answers a card or steps through to "시작하기"; nothing skips it in one press.
- The bubble is narrower than the caption was, by the mascot and its gap, so a step's line can take one more line and the current card is that much shorter while the coach shows.
- The hand is one more brand drawing to keep: a change to it is a change to `tools/brand/` and `make brand`.

## Signs the decision was wrong

- People ask how to leave the coach without stepping through it.
- People miss the mascot during a session, or find the screen without it bare.
- The tilted hand is still read as anything but a finger pressing the card.
- A step's line in the narrower bubble pushes the current card short enough to be reported.
