# ADR 0249: Say only praise in 홈's chat bubble once the day's cards are done

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #923, the app's follow-up to #924.** [ADR 0248](0248-meet-malangi-on-home-alone-offer-the-chat-once-a-day-in-a-bubble-over-the-mascot-and-open-it-naming-no-note.md) set 홈's chat bubble line for the day's cards done to "수고했어요. 얘기 좀 할래요?". The owner read it as pushy: the "좀" sounds like a demand.
- **A tap on the bubble opens the chat** (ADR 0248), so the line need not ask for one.
- **Alternatives considered:**
  - **Keep the line.** Rejected: it is the owner's reading that it pushes.
  - **Soften the ask while keeping it.** Rejected: any ask repeats what a tap already offers; the owner chose, from three options, a line that praises alone.

## Decision

- **Once the day's cards are done, 홈's chat bubble says "오늘도 수고 많았어요!"** The English string says "Great work today.".
- **Supersedes** ADR 0248's done-day line alone. Its other two lines, "오늘 배운 거, 같이 카드로 만들까요?" and "말랑이와 대화해요", and every other rule of ADR 0248 stand.
- **The web follows in #928** with the same line and this record cited.

## Consequences

- On the day the cards are done, the bubble praises and does not invite; the way into the chat is the tap on the bubble or the mascot, as before.
- Not verified here: the bubble on a device; the widget test drives it with a substituted clock and the screenshot is of the test's render.

## Signs the decision was wrong

- People tap the bubble less on days the cards are done, and chats begin less often on those days than on the days of the other two lines.
- The line is read as a message with nothing behind it.
