# ADR 0120: State today's progress once, put every study button in its card, name the record plainly, and draw photo import's bar, checks and moves as the other screens do

> Status: accepted
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #458 brings the screens the redesign had not reached to `design/copy.md` and `design/principles.md` (issue #454, [ADR 0118](0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md)): the 오늘 tab, the 기록 tab and photo import. The QA UX audit of 2026-10-27 found, on `origin/main` at `2661941`:
  - **오늘, today card (16a1).** The cards done, "2 / 4장", "약 1분 남음", the bar, and a status line, "거의 다 왔어요", state the same progress four ways. The status line ([ADR 0046](0046-state-where-the-user-stands-today-on-the-today-card-in-place-of-the-goal-s-numbers.md)) was chosen when the card showed no figures; since [ADR 0091](0091-draw-the-today-card-as-a-progress-bar-and-change-the-daily-study-minutes-only-in-settings.md) it restates them, and its streak variant restates the streak chip beside it.
  - **오늘, done card (16i).** "학습하기" sat under the last seven days, outside every card, the one study button on the tab not inside the card it acts on, so the tab had two focal points.
  - **오늘, backlog card (16d).** The button "84장 학습 · 약 14분" invited all 84 overdue reviews now, while the chart under it planned "하루 3장씩 하면 28일이면 따라잡아요", and its note said "하루 3장씩" again. The session over a backlog takes every due card ([`study.md`](../study.md), ADR 0025), and the user stops whenever they like, so the count on the button was the session's size, not a plan.
  - **기록 (16c–16f).** "목표 90%" twice, beside the figure and on the chart; "%p", a unit a learner does not use; "지금 기억하고 있을 확률" and "단단함" as names; and "4주 +2장" beside a chart whose first bar is labelled "7주 전".
  - **Photo import (21–27).** The list's top bar held the words "취소" and "다시 찍기" where every other screen's holds × or ‹; the edit sheet kept a meaning by a square Material checkbox while the list keeps a row by a round check, and moved it by a drag handle while the card editor moves a meaning through its ⋯ ([ADR 0117](0117-draw-the-card-editor-as-one-group-per-side-with-a-full-screen-preview-and-every-action-in-words-or-a-row-menu.md)); a read photo's check was green, which means 안다 alone.
  - **Word breaks.** A cloze sentence on the deck screen broke "낮 / 춤", and the photo permission error "허 / 용해".
- **Alternatives considered:**
  - **Keep the status line and drop the figures.** ADR 0046's choice, which ADR 0091 reversed by bringing the figures back; the figure and the bar say how far along the user is exactly, and a sentence picked from five says it vaguely.
  - **A backlog button with today's portion, "3장 학습".** The session would still hold every due card, so the button would name a count the session does not keep to; a daily portion is what the owner declined in ADR 0036.
  - **Keep "84장 학습" and drop the pace from the chart.** The chart would show nothing but a line falling to zero at an unstated rate; the pace is what makes it a plan.
  - **A backlog button "학습하기",** the done card's label. The backlog card stands where the today card does and opens the same session over every deck, so it takes that card's label.
  - **"%" as "포인트" in words.** Longer in a chip, and "목표보다 1% 낮아요" reads as a learner reads it.
  - **Keep "4주 +n장" and relabel the chart.** The gain would still cover half the bars; counting from the first bar makes the line and the chart one span.
  - **Retake as a second bottom button.** The bottom holds "사진 더 추가" and the primary already; a third full-width button is more chrome than an action used once per import.
  - **Keep the edit sheet's drag, adding a menu for a screen reader.** Two ways to move one meaning, against the editor's one.

## Decision

- **오늘.**
  - The today card states the progress once: the figure, "약 m분" and the bar, with "오늘 n장 더 했어요" under the bar while cards were studied past the day's plan. No status line. Supersedes ADR 0046 on the phone.
  - The done card holds "학습하기" at its end, under its chips, so every state of the tab has its one primary inside its card; the last seven days follow it.
  - The backlog card's button is "모두 학습", with no count and no minutes, as the today card's is. The catch-up chart's heading, "하루 n장씩 하면 m일이면 따라잡아요", is the one plan for today, and the note under the chart that repeated its pace is gone. The overdue count is said once, in the card's sentence.
- **기록.**
  - The target is named once, "목표 90%" on the chart's dashed line; the figure stands alone.
  - The gap's chip reads "목표보다 n% 낮아요" or "높아요", in whole percent.
  - The recall card is "기억 상태", its bands "좋음", "보통" and "곧 잊음".
  - The mastered card's line beside its heading is "7주 전보다 +n장": the cards mastered this week less those at the end of the chart's first week, the span the chart draws, shown while it is more. Refines [ADR 0037](0037-define-the-record-tab-s-retention-recall-bands-mastered-weeks-and-study-days-and-compute-them-on-the-device.md)'s record, whose first build drew it over four weeks.
- **Photo import.**
  - The list's top bar holds × at its left, which does what "취소" did, and, while the list holds one photo, ⋯ at its right holding the retake, "다시 찍기" or "다른 사진 고르기". The bar holds no words.
  - One selection control per role: the edit sheet keeps a meaning by the list's round check, filled in ink. No square checkbox.
  - One reorder pattern: a meaning in the edit sheet moves through its ⋯, "위로" and "아래로", as the card editor's does. No drag handle.
  - A read photo's check is ink. Green and red stay 안다 and 모른다.
  - Refines [ADR 0065](0065-import-a-photo-s-cards-from-one-list-of-sections-each-with-its-form-menu-row-checks-and-an-edit-sheet.md)'s edit sheet and [ADR 0089](0089-import-up-to-ten-photos-into-one-list-read-two-at-a-time-and-state-today-s-limit-before-reading.md)'s read state.
- **Word breaks.** The backlog card's sentence, which the redesign's screenshots showed breaking "카드 / 는", a whole card's cloze sentence and its blanks, and photo import's failure screen and a failed photo's line, break only between words, through `keepWords`. A whole card's title and table cells are left as they are: the audit found no break there.
- **Refines** `design/copy.md` §Forms's study buttons: "모두 학습" on the today and backlog cards, "학습하기" on the done card and the deck screen.

## Consequences

- Every study button on the 오늘 tab is inside the card it acts on, and the tab states each figure once.
- A user in a backlog no longer sees the session's full size on its button; the card's sentence and the chart's first bar still say it.
- `study`'s `TodayStatus` has no caller on the phone. The web's today page still draws its line after #460 brought the web to #454, so the type stays in `study` until the web follows this ADR in an issue of its own.
- The web's `/record` keeps "4주 +n장", "%p", "지금 기억하고 있을 확률" and "단단함" until that issue brings it to these words.
- The photo import list's top bar matches every other pushed screen's; its retake is one tap further.

## Signs the decision was wrong

- Users in a backlog start sessions they abandon early more often than before, missing the count on the button.
- Users read "목표보다 1% 낮아요" as a relative change and are confused by it.
- Users of a one-photo import look for the retake and do not find it in ⋯.
- Users report not knowing how far along today they are without the status line.
