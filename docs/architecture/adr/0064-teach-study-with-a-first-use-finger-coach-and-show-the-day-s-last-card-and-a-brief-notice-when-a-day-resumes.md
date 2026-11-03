# ADR 0064: Teach study with a first-use finger coach, and show the day's last card and a brief notice when a day resumes

> Status: accepted; on the phone, its notice under the progress bar superseded by ADR-0093; its coach's 건너뛰기, its finger and its caption on the hero superseded by ADR-0166
> Date: 2026-10-18

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #199 records the owner's approval, on 2026-10-18, of two canvas boards: "학습 A. 처음 쓸 때 손가락 안내" and "학습 B. 이어할 때". The canvas is the PM's private `https://claude.ai/artifact/9GxVB2RjZ36BtgcyBr6UmD`, titled "smartman 사진 대화 시안".
- Since [ADR 0044](0044-show-a-guide-with-the-session-s-size-in-the-previous-card-s-place-at-every-session-s-start.md), every session opens with a guide in the previous card's place: a dashed panel with the session's size and two lines on how to study. [ADR 0062](0062-take-the-study-queue-and-the-top-bar-s-count-from-today-s-list-so-a-reopened-day-goes-on-in-the-app-and-the-web.md) made its first line read "이어서 해요 · 남은 n장 · 약 m분" when a day resumes. The owner replaces both.
- Photo import's Review already teaches its gestures with a three-step coach: a finger on a card, a navy caption, shown once per device ([ADR 0057](0057-group-a-photo-s-cards-by-topic-on-review-with-a-switch-per-topic-and-swipes-per-card.md)). The issue asks study to follow it.
- **The PM's decisions on 2026-10-18, before the build:**
  - The web keeps the coach's three steps and motion, with lines true to its controls. Its current card is answered by buttons and keys, not a swipe, and a mouse cannot swipe its previous card.
  - The day's last card from an earlier session is display-only. Changing a review of an earlier session would mean rewriting a stored review and rescheduling from a state nothing keeps.
- Alternatives considered:
  - **Keeping the guide panel.** A returning user reads the same lines at every session's start; the coach teaches once and can be replayed.
  - **Not showing the coach under reduce motion**, as Review does. The owner asked for still images instead, so users who reduce motion are taught too.
  - **Re-deciding the day's last card** by the previous card's rules. Ruled out above.

## Decision

- **The empty place.** While the session has no answer of its own and no card of the day was answered earlier, the previous card's place shows only a 1.5 px dashed outline in `outline`, an up arrow and "답한 카드가 여기에 쌓여요", read as one block. It replaces ADR 0044's guide.
- **The coach**, on a device's first session, once a card is on screen:
  1. the current card moves right over the green tint and "안다": "알면 오른쪽으로 밀어요";
  2. it moves left over the red tint and "모른다": "모르면 왼쪽으로 밀어요";
  3. a sample card answered "안다", "deadline" and "마감 기한", takes the previous card's place and moves left over "모른다로 바꿔요": "답한 카드는 위로 올라와요. 밀어서 답을 바꿀 수 있어요".
  - A finger moves with the card. Steps 1 and 2 dim what is above the current card.
  - The caption is Review's: a navy panel in the answer buttons' place with the step's line, step dots, "건너뛰기" and "다음", the last step "시작하기". A screen reader hears "사용 방법, 3단계 중 n단계" as it changes. The caption, the finger and the demonstration's curve are one shared component, which Review uses too.
  - **Motion.** The card moves out with an ease, holds, and springs back over 2.8 s, as in Review. Under reduce motion each step is a still image, the card held out under the finger.
  - **Once per device.** The device stores that the coach has shown as soon as it shows. Only an answer, or a drag of the current card, ends it; a drag or a tap of the previous card leaves it running.
  - **Replay.** "안내 다시 보기", a small text button between the answer buttons, starts it again.
- **A resumed day.**
  - **The day's last card.** While the session has no answer of its own, the previous card's place shows the day's last answer to the decks' cards from an earlier session: graded as a previous card is, with its chip, and labelled "지난번 마지막 카드". A tap opens it whole. It has no swipe and no change action, and no stored review of an earlier session is rewritten. The session's first answer replaces it.
  - **The notice.** "이어서 해요 · 남은 n장 · 약 m분" shows for 3 s under the progress bar, as a status a screen reader announces. It shows under ADR 0062's condition, a card of the day done, and only when the session opened with cards left.
- **The web**, for parity:
  - the same empty place, notice and day's last card;
  - the same coach, its motion from theme animations, held still under reduce motion;
  - the lines true to the web's controls:
    - "알면 안다(→)를 눌러요";
    - "모르면 모른다(←)를 눌러요";
    - "답한 카드는 위로 올라와요. '마지막 답 바꾸기'나 Z로 답을 바꿀 수 있어요";
  - the browser keeps that the coach has shown;
  - the study page's server sends the day's last answer with its card in the session's plan.
- **Supersessions.** This replaces ADR 0044's guide, and ADR 0062's placement of the resume line in that guide.

## Consequences

- A session opens on its cards with one line above them at most. Usage is taught once, on the cards themselves, and can be replayed.
- Coming back the same day shows where the user left off, and says for a moment that the day goes on.
- Review and study share one coach component, so the two coaches look and move alike.
- A device whose stored flag is lost, or a browser that keeps nothing, shows the coach again.

## Signs the decision was wrong

- Users skip the coach and still do not find the swipe, or the previous card's change.
- Users try to change the day's last card and are confused that it does not move.
- Users miss the notice, or take the day's last card for this session's answer.
