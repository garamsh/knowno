# ADR 0086: Show and change the daily study minutes on the today card, the completion card, a one-time first-run step, the account screen and the web's today page

> Status: accepted; its six choices, its custom value in steps of 5 with no typed value, and its preview's sentences superseded by ADR-0090; its control on the today, backlog and done cards, its completion card's line, its web control on the 오늘 page, and the sheet its account row opens superseded by ADR-0091
> Date: 2026-10-20

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #271**, the owner's decision of 2026-10-19. The daily study minutes fill each day's new cards ([ADR 0085](0085-fill-each-day-s-new-cards-from-the-daily-study-minutes-the-user-sets-stored-per-user-on-the-server-and-synced.md)). The owner stressed the screens: the setting must be easy to see and to change, and never hunted for.
- **The places #271 names:**
  - a control on the today card, "하루 20분 ✎", read as "하루 공부 시간 20분, 바꾸기";
  - a sheet with large choices and a custom value, a live preview, "오늘 새 카드 약 n장 · 복습 m장" and "이대로면 남은 새 카드 k장을 M월 D일쯤 다 시작해요", and "저장", after which today's count changes at once;
  - a one-time first-run step, "하루 몇 분 공부할까요?", once the first deck has cards or at the first session, skippable, keeping 20;
  - a quiet line on the completion card, "내일도 하루 20분 · 바꾸기";
  - the web's 오늘 page, with the same control and dialog;
  - the account or settings screen, which lists the setting too.
- **The app's idioms** ([`design/principles.md`](../design/principles.md)): one primary action per sheet, actions pinned at the bottom with the primary last, no cancel in a sheet, 44 pt targets, plain-language states, tokens only.
- **The 오늘 tab stays built behind the 덱 tab** (`IndexedStack`, [`home.md`](../home.md)). A step that asked as soon as a deck had cards would open over whatever screen the user was on.
- **Alternatives considered:**
  - **A custom value typed into a field.** The keyboard would cover the preview the value moves, and a field needs its own validation message. Steps of 5 from 5 to 180 reach every preset and the bounds with two large buttons.
  - **The control in the today card's top row, beside the count.** That row also holds the goal ring, and a longer label, English among them, did not fit beside it on a phone. The control takes a line of its own under the count.
  - **The first-run step inside the study screen.** The session builds its queue when the screen opens, so a setting chosen there would not reach the session it was asked for. The step runs before the screen is pushed.
  - **A settings screen of its own.** The account screen already holds the device's display setting. The study setting sits there under a section of its own, rather than on a new screen that hides it a level deeper.

## Decision

- **The control.** "하루 n분" after Lucide's pencil, in a pill at least 44 high, read as one button, "하루 공부 시간 n분, 바꾸기".
  - On the today card it takes a line under the count; on the backlog card it sits beside the streak.
  - On the navy cards it is outlined in white. On the done card it has the surface fill inside the outline, as that card's pills do.
- **The sheet**, `showDailyMinutesSheet`, an `AppSheet`:
  - the title "하루 공부 시간", and one sentence, "복습을 먼저 하고, 남는 시간에 새 카드를 시작해요.";
  - the six choices, 10, 15, 20, 30, 45 and 60 minutes, three to a row, each 56 high, and under them "직접 정하기", then "직접 · n분" once chosen, with a minus and a plus that move the minutes by `dailyMinuteStep`, 5, within 5 to 180;
  - each choice is read as a button in a group of which one is selected; the chosen one takes the primary fill;
  - the preview on the brand tint, which a screen reader hears again when it changes:
    - "오늘 새 카드 약 n장 · 복습 m장": today's new cards left at the chosen minutes, and the reviews left today;
    - "이대로면 남은 새 카드 k장을 M월 D일쯤 다 시작해요", the day of ADR 0085's last new card, or "남은 새 카드 k장을 오늘 다 시작해요" when that day is today;
    - "새 카드를 모두 시작했어요" with none left, and "이 시간은 복습으로 차서 새 카드는 시작하지 않아요" when the reviews fill the minutes;
    - in a backlog, "밀린 복습을 마칠 때까지 새 카드는 쉬어요." alone;
  - "저장", the one primary, stores the minutes on the device and closes the sheet. A failed write says so in the sheet and keeps it open. Nothing is stored before "저장".
- **Today's count updates at once.** The 오늘 tab, the 덱 tab's rows and the deck screen read their counts again when the sheet closes over them, as they do when any screen closes.
- **The first-run step.** The same sheet, titled "하루 몇 분 공부할까요?", with "건너뛰기" above "저장".
  - Skipping keeps the minutes unset, which reads as 20.
  - It shows once per device, and only while no minutes are stored from any device.
  - It shows at the first of:
    - the 오늘 tab showing a day with cards while it is the selected tab and no screen is open over it;
    - a study button pressed, before the session opens, so the session takes the minutes chosen.
  - Every study button the shell holds opens the session through `openStudy`, which asks first where the step has not shown.
- **The completion card.** "내일도 하루 n분 · 바꾸기", quiet, between the day's counts and "학습하기", read as one button, "내일도 하루 n분, 바꾸기". It opens the sheet and shows the minutes saved. Studying past today's cards does not change the setting.
- **The account screen** lists the setting under "공부", above "화면": a row "하루 공부 시간" with the minutes and a chevron, which opens the sheet. `home` passes `study`'s `DailyMinutesRow` to the account screen as it passes sync's status.
- **The web's 오늘 page** has the same control on its today card. It opens a dialog with the same choices, steps, preview and "저장":
  - each choice is a button with `aria-pressed`, and the preview is a `status`;
  - Escape, the close button or a click outside closes it without saving, and focus returns to the control;
  - "저장" calls `saveDailyMinutes`, then reads the page again.
- **Both clients compute the preview the same way** (`MinutesPlan.at` in the app, `minutesPreview` on the web), and `rules.test.ts` compares `dailyMinuteStep` with the other shared rules.

## Consequences

- A user meets the setting before the first session and on every 오늘 tab, so the default of 20 minutes, 120 new cards on the first day, is a choice the user has seen.
- The today card and the backlog card are one line taller.
- The account screen has a section more above the display setting, so its foot sits lower.

## Signs the decision was wrong

- Users skip the first-run step and still keep a daily figure they never finish.
- Users look for the setting in the account screen first, rather than on the today card.
- Steps of 5 minutes are too coarse at the bottom of the range, or too fine at the top.
