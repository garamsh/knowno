# ADR 0193: Make 홈 one screen of sky over ground, with the mascot on a hill, the streak's days and one action

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #742.** On 2026-11-04 the owner reviewed concepts for 홈 and chose E: one screen with no scrolling, a cobalt sky over a white ground joined by a soft hill, the mascot on the hill, today's count in the sky, the streak and one button on the ground. The PM's decisions on #742 follow from it, and the owner's answer relayed there makes the done sky "오늘" / "다 했어요" / "n장", the cards done and no minutes.
- **Before this record**, [ADR 0179](0179-fill-home-s-first-screen-with-the-hero-and-reach-the-week-card-by-scrolling.md) had the hero fill the first screen with the mascot at 210 and the week card's bar chart a scroll away, its top edge showing. #728 then asked for the hero to collapse into a bar as the page scrolled; PR #739 built it and was closed for E.
- **The status bar.** The sky runs behind it, so its glyphs must be light there and the theme's elsewhere; on the web the browser's bar takes `theme-color`, which the root layout gives by `prefers-color-scheme` alone, while the user may choose 라이트 or 다크 (`data-theme`). PR #739's review found that, the photo import's bar, and the side and bottom insets under `viewport-fit=cover` unhandled.
- **Alternatives considered:**
  - **Keep ADR 0179's scroll to the week card**, or #728's collapse. The owner chose E over both.
  - **Shrink the mascot to fit.** The owner set one size, 140, across states and phones; at the largest text sizes the page scrolls instead.
  - **Scroll the ground alone under a fixed sky.** At text scale 3.12 the sky's words alone are taller than a 667 pt screen, so a fixed sky would cut them; the whole page scrolls there.
  - **Draw the today dot's label in the dot's coral.** It is 2.5:1 on the light ground; the label takes a darker coral of its own, and the dot is decoration beside it.

## Decision

- **One screen, no scroll,** on the phone and on the web, the web below 1024 px edge to edge and from 1024 px in the content column beside the side menu. The sky, `hero`, takes 58% of the screen where the ground's content leaves it room and shrinks to its own content where not; where the two need more than the screen, at the largest text sizes, the page scrolls, and nothing is cut.
- **The sky** runs up behind the status bar: light glyphs over it on the phone, and on the web `viewport-fit=cover` with the sky's colour as `theme-color` in the theme the page is drawn in, the ground's from 1024 px and while a photo import's bar heads the page; elsewhere the theme's own. The app's name and the profile button head it; under them, centred, "오늘" over today's count large, "n장", over "약 n분이면 끝나요".
- **The hill:** the ground rises into the sky's foot in a quadratic curve, 32 high at its crest. The mascot stands on the crest at 140 in every state and on every screen, thinking while cards are left or nothing is done yet, sleepy once the day is done; nothing else is drawn at its upper right, where the assistant's bubble is to go (#721).
- **The ground:** "n일 연속", its count in `accent`, over a dot a day for the last seven study days, today's last: a day with cards filled in `accent`, a day without one outlined, today outlined in `todayMark` and filled in it once the day is done, each over its weekday, today's "오늘" in `todayText`. Then the one action at the cta size on its edge.
- **By the day:** with cards left, the count and its minutes, and the primary "시작"; in a backlog, "다시 시작하면 돼요" and its sentence in the sky, and "시작"; with the day done, "오늘" / "다 했어요" / "n장", the cards answered today, or the next review where none was answered, and the secondary "학습하기"; with notes but no card, "첫 카드를 만들어 볼까요?" and "카드 추가" or "노트에서 카드 추가", with no streak; before the first note, "첫 노트를 만들어 볼까요?" and "새 노트 만들기", with the public notes as a secondary on the phone where sharing is on; a day that cannot be counted, why in the streak's place over "시작".
- **Deleted from 홈:** the week card's bar chart and its "지난 7일 n장", which 기록 keeps; the hero's rounded foot; the first-run screen's own layout; ADR 0179's fill of the first screen and its scroll to the week card. This supersedes ADR 0179.

## Consequences

- 홈 is read at a glance with nothing to scroll at the default text size on a 667 pt phone; at the largest text sizes it scrolls as one page.
- The mascot is drawn at 140 on 홈, below the 200 px from which it breathes; it blinks and glances.
- The happy mascot has no moment on 홈; the sleepy one gains 홈's done day.
- Two colour tokens join both themes: `todayMark`, the mascot's coral, and `todayText`, 4.5:1 on the ground. Coral, the mascot's alone until now, also marks today on 홈.
- The phone's 홈 and the web's draw every state in one composition, so a later state is drawn in it too.

## Signs the decision was wrong

- Users miss how many cards they studied over the week, which the bar chart showed and the dots do not.
- On a tall phone the empty sky above a 140 mascot reads as unfinished.
- The day dots are read as buttons, or today's coral as a warning.
