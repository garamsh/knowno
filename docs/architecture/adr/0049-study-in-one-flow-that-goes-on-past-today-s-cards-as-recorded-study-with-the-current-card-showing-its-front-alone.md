# ADR 0049: Study in one flow that goes on past today's cards as recorded study, with the current card showing its front alone

> Status: accepted; its counting of answers past today's cards in the daily goal superseded by ADR-0087; on the phone, the answer buttons among its ways to answer superseded by ADR-0099; the completion card's "학습하기" superseded by ADR-0189
> Date: 2026-10-18

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0033](0033-count-cards-left-per-study-day-from-04-00-and-continue-as-unrecorded-practice.md) ends the day's cards on the completion card. Its "계속 학습" goes on as practice over the cards answered today, which writes nothing. [ADR 0044](0044-show-a-guide-with-the-session-s-size-in-the-previous-card-s-place-at-every-session-s-start.md) leaves practice out of the session's guide, so practice that opens with no answer of its own shows a blank upper half (issue #162).
- The owner, on 2026-10-18 (issue #163), after seeing that blank:
  - Studying is one screen, not two that differ, and both are called "학습하기". There is only today's amount.
  - Study past it is recorded and goes on to the next cards; the owner chose this from the PM's recommendation.
  - The current card loses its preview, the eye half that reveals the answer, and puts its text in the card's exact centre. The user answers by a swipe, and the result shows on the card above, so the answer need not show before. Only the current card changes: the previous card keeps showing its meaning.
- The PM's direction in the issue:
  - Past today's amount, the session goes on with the next new cards, oldest first across the selected decks, the order the daily quota takes them in, each answered and recorded like any other.
  - A card answered today is not shown again past the amount, except as the re-show after "모른다".
  - With no card left to take, the session ends on the completion card, which says so.
  - Answers past the amount count in the daily goal's done, the streak and 기록. [ADR 0043](0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md)'s next-day figure already absorbs the reviews they create.
  - The guide shows at every session's start until the first answer, with no practice case, and its lines change to what is true.
  - The web follows the same model.
- The issue left a choice to this ADR: stop on the completion card at the amount and go on with "학습하기", or go on without a stop. The PM, asked, kept the stop for a session that runs out of today's cards. For a session opened with nothing left today, the PM decided that it starts on the next cards at once: opening it is already the choice to go on, and a stop there would ask for "학습하기" twice. The PM also decided that the today card's done button is called "학습하기" too, and that the guide's heading reads "오늘 할 카드를 다 했어요" where the session's opening size holds no card.

## Decision

- **One flow.** There is no practice. A session studies today's cards, then stops on the completion card. Its primary button, "학습하기", goes on in the same session, screen and route with the cards never reviewed that the queue did not take, oldest first by creation time across the selected decks. They come in that order, not shuffled, and each is answered, written and synced as any other card. The top bar's count takes them in.
- **The stop.** The completion card marks today's amount. Going on is the user's choice, since each new card adds reviews to the coming days. With no new card left to take, the card shows "더 학습할 카드가 없어요" in place of "학습하기". "그만하기" closes the screen in either case.
- **Opening with nothing left today.** A session opened with no card left today starts on the next new cards at once, under the session's guide. With none to take, it opens as before: on the completion card where a card of the decks was answered today, otherwise on "오늘은 학습할 카드가 없어요".
- **No repeat.** The cards past today's are those with no stored state, so a card answered today is not among them. It comes back only as a "모른다"'s re-show.
- **Counts.** Answers past today's cards are stored answers, so they count in the daily goal, the streak and 기록 as any other.
- **Current card.** It shows its front alone, centred across and down, shrunk toward the question's floor until its widest word fits the card. It has no split, no eye, and nothing a tap reveals. Its label names its front, and it has no tap action. A swipe, the answer buttons, and on the web the keys answer it, as before. The previous card is unchanged: both sides, split, its meaning included.
- **Guide.** It shows from every session's start until its first answer. Its heading is the session's size, or "오늘 할 카드를 다 했어요" where the session opened with no card left today. Two lines follow:
  - "알면 오른쪽, 모르면 왼쪽으로 밀어요", which on the web names its keys and buttons;
  - "답한 카드는 뜻과 함께 여기로 올라와요. 밀어서 바꿀 수 있어요".
  The reveal line is gone.
- **Names.** The completion card's "계속 학습" and the today card's done button are both "학습하기".
- **Web.** The same, in `web/src/features/study/`. The study page passes the new cards past today's in its plan. Space reveals nothing, and the shortcut list drops "답 보기".
- **Supersessions.** This replaces:
  - ADR 0033's practice and its "계속 학습";
  - ADR 0044's exclusion of practice and its line on revealing;
  - the parts that give the current card its split and reveal: [ADR 0007](0007-study-swipe-screen-and-session-toggle.md)'s split current card with its answer shown on tap, [ADR 0023](0023-scroll-the-current-study-card-with-the-stack-and-centre-each-half.md)'s centring of the current card's halves, [ADR 0035](0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md)'s eye in the hidden answer's half with the web's "답 보기" button and Space key, and [ADR 0042](0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md)'s tap on the current card that shows its answer.

## Consequences

- Every answer is recorded, so the server, sync and 기록 see all of a user's studying. Nothing in a session is discarded on closing.
- A user who studies past today's cards takes on more new cards, and so more reviews in the coming days. The next day's new cards follow the study time (ADR 0043).
- Past today's cards a session offers only new cards. Cards due on later days are not brought forward.
- A user cannot check the answer before answering. "모른다" and the previous card's change are how a wrong guess is corrected.

## Signs the decision was wrong

- Users go on past today's cards so often that the reviews it creates push later days into backlog.
- Users ask to see the answer before answering, or answer "안다" by habit and change it on the previous card.
- Users who open a session with nothing left today close it at once, having wanted to see the completion card.
