# ADR 0093: Make stopping the finished completion card's primary, and show the resume notice in the progress bar's place, on the phone

> Status: accepted
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #318**, filed by QA and accepted by the PM. It found two places where the phone's study screen breaks `design/principles.md`.
- **The finished completion card.** With no new card left past today's, the completion card shows "더 학습할 카드가 없어요" as text ([ADR 0049](0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md)).
  - Its only action is then "그만하기", which [ADR 0035](0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md) set at 44 high on both clients, as a quiet text button.
  - At the session's natural end, the one thing left to do was the least prominent element on the card, against `design/principles.md` §One primary action per screen.
- **The resume notice.** [ADR 0064](0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md) shows "이어서 해요 · 남은 n장 · 약 m분" for 3 s under the progress bar.
  - Drawn 8 pt under the top bar across the cards' margins, it landed on the day's last card, flush against its "안다" chip, for those 3 s.
  - The gap above that card is 20 pt and the notice is about 36 pt tall, so it cannot sit in the gap.
- **Alternatives considered:**
  - **The notice over the whole top bar.** It would cover the close button and the count for 3 s.
  - **The notice in the top bar's row in place of the progress bar and the count.** A reopened session's tests read the count, "3/6", while the notice shows, and that count is what ADR 0062 made the top bar carry. The count stays.
  - **Push the cards down while the notice shows.** Both cards would move twice in 3 s.

## Decision

- **The finished completion card.** Where no new card is left past today's, "그만하기" is the card's one primary: the navy fill at the cta height, under "더 학습할 카드가 없어요". While new cards are left, "학습하기" stays the primary and "그만하기" the quiet text button, 44 high, as ADR 0035 has it.
- **The resume notice** shows in the top bar's row, in the progress bar's place, between the close button and the count, for ADR 0064's 3 s:
  - it is scaled down to one line where the text is too long;
  - it is still announced by screen readers as a live region;
  - it slides in and out, or fades under reduce motion;
  - it never overlaps the cards.
- **Scope.** Both apply to the phone. The web's completion card and its notice are unchanged; `web-study.md` describes them.

## Consequences

- At a session's end with nothing more to study, the card's most prominent element closes the screen.
- For 3 s after a session reopens, the progress bar gives way to the notice, which states the cards left. The count beside it stays.
- This supersedes ADR 0035's "그만하기" 44 high where no new card is left, and ADR 0064's notice under the progress bar, on the phone.

## Signs the decision was wrong

- Users press "그만하기" by mistake when "학습하기" is absent and expected more cards.
- Users miss the notice in the top bar, which ADR 0064's own sign already names.
