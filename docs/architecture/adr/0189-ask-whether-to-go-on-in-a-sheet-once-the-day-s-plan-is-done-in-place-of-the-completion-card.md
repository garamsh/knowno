# ADR 0189: Ask whether to go on in a sheet once the day's plan is done, in place of the completion card

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #719.** The owner, 2026-11-04: "학습 완료시 저런식보다 모달 형태로 오늘 학습 완료했다고 이어서 할거냐고 물어보는게 좋을거같아." When the day's planned cards are done, a modal should say so and ask whether to go on.
- **What it replaces.** Since [ADR 0151](0151-draw-the-previous-study-card-as-one-centred-scrolling-column-on-a-grade-line-put-the-mascot-between-the-cards-finish-on-a-hero-panel-and-redraw-the-record.md), the completion panel has taken the current card's place on `hero`. It has the happy mascot ([ADR 0141](0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md)), "오늘 학습 완료" with the streak, and three tiles: 안다, 모른다 and 걸린 시간. Under them it has "학습하기" ([ADR 0049](0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md)) and "그만하기" ([ADR 0035](0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md)). Where no new card is left, it has "더 학습할 카드가 없어요" and "그만하기" as its one primary, as [ADR 0093](0093-make-stopping-the-finished-completion-card-s-primary-and-show-the-resume-notice-in-the-progress-bar-s-place-on-the-phone.md) set on the phone.
- **The PM's decisions on #719:**
  - a modal sheet over the study screen, drawn by the shared sheet (`AppSheet`, the web's `Sheet`) over the dark scrim of #717;
  - the title "오늘 학습을 다 했어요", one line of today's 장 · 분 · n일 연속, then "이어서 더 할까요?";
  - "그만하기" the primary, keeping ADR 0093's choice of stopping as primary on a finished day, and "이어서 하기" secondary, going on past the day's plan as ADR 0087's continue does;
  - with nothing left to study, no "이어서 하기", and one primary, "완료", which closes;
  - the scrim, the back and Escape mean 그만하기 and leave for 홈, and a screen reader hears the title first;
  - the same on both clients;
  - the panel's other content goes in only if it fits one line, and 기록 keeps it otherwise.
- **The owner's decision on #711:** no mascot on the study or completion screens.
- **The per-answer counts and the time** do not fit the one line beside the cards and the streak, so they leave the screen. 기록 counts each day's answers, retention and time.
- **What the sheet's line counts.** The panel's tiles counted answers, a re-shown card once each time. "장" counts cards ([`design/copy.md`](../design/copy.md) §Terms), so the line counts each card answered today in the session's decks once, as 기록's study days do.
- **Nothing left to study.** The PM's content puts "이어서 더 할까요?" above the actions, but with nothing left there is nothing to go on to. In that case the question's place says "더 학습할 카드가 없어요", the sentence ADR 0049 gave that case.
- **Alternatives considered:**
  - **Keeping the panel and adding a sheet over it.** The day's facts would be drawn twice on one screen, against `design/principles.md` §Content over chrome.
  - **A centred dialog on the phone.** The phone has one modal, the sheet (`design/frames.md` §Sheet and dialog).

## Decision

- **Once no card of the day is left, the completion sheet opens** over the study screen on both clients: `CompletionSheet`, in `app/lib/study/src/completion_sheet.dart` and `web/src/features/study/components/completion-sheet.tsx`. It opens when the session reaches its completion, and not before. The previous card stays behind it. Nothing takes the current card's place.
  - Its title is "오늘 학습을 다 했어요", a heading read first.
  - Its body is one line: "n장 · m분 · k일 연속". n counts the cards answered today in the session's decks, each once. m is their minutes on screen, rounded up. k is the streak.
  - Under the line, "이어서 더 할까요?" while new cards are left past today's, or "더 학습할 카드가 없어요" where none is.
  - Its actions, full width, the primary last: "이어서 하기" (secondary) over "그만하기" (primary) while new cards are left; "완료" (primary) alone where none is.
  - No mascot.
- **"이어서 하기"** closes the sheet and goes on in the same session with the new cards past today's, as ADR 0049 and [ADR 0087](0087-count-the-cards-studied-past-the-day-s-plan-apart-so-they-never-reopen-the-day-or-grow-its-goal.md) have it. When those are done, the sheet opens again, with "완료" alone.
- **Stopping:** "그만하기", "완료", a tap on the scrim, a drag down, the back, and on the web "닫기", Escape and the browser's back all leave the study screen for where it was opened from. On the web, leaving sends the waiting answers first, as every other way out does.
- **The web** focuses the primary when the sheet opens.
- **Supersedes:**
  - ADR 0151's completion panel on `hero`, its tiles and its place;
  - ADR 0141's happy mascot on the completion card;
  - ADR 0049's "학습하기" on the completion card, now "이어서 하기" in the sheet;
  - ADR 0035's "그만하기" as a quiet button while new cards are left;
  - ADR 0093's finished completion card. Its choice of stopping as the primary stands, now on both clients and whether or not new cards are left.

## Consequences

- The day's end is one sheet, with one question and one primary, on both clients.
- While the sheet is open, the previous card cannot be changed, and the only ways on are going on or leaving. A wrong last answer of the day is changed in a later session, or by "이어서 하기" first.
- The completion's answer counts and the panel's tiles go. `Completion` carries the cards counted once, the time and the streak.
- The web's study keys do nothing while the sheet is open. The sheet takes Escape.

## Signs the decision was wrong

- Users who meant to go on press "그만하기" because it is the primary, and reopen study at once.
- Users miss changing the day's last answer, which the panel allowed.
- Users miss the day's 안다 and 모른다 counts and look for them in 기록.
