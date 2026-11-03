# ADR 0165: Open on today over the last seven days, move the notes to a tab, and open 설정 from the profile button

> Status: accepted; the 노트 tab's 새 노트 chip and 공개 노트 둘러보기 under its rows superseded by ADR 0172
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #611**, with #610. On an iPhone 13 Pro (390 × 844 pt), with 481 cards today over 4 notes, 시작 was cut in half by the drawer of [ADR 0150](0150-open-on-a-home-of-today-on-the-hero-with-the-notes-in-a-drawer-keep-the-menu-on-a-note-and-make-a-note-on-a-full-screen.md), and pulling the drawer up felt detached ("화면에 착 안 달라붙어 있는 느낌"). The owner chose option B' of the home mockup over the drawer on 2026-11-03. The style stays as [ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md) draws it.
- **The cause of the cut.** The phone's hero laid out a 210 mascot, the words and the action in a scroll view in the space above the drawer, so where they needed more the hero scrolled and 시작 rested under the drawer. `app/test/home/hero_fit_test.dart`, run against `home_tab.dart` at main bee3b03de28e38d62a61ac52aa56790748acb6f7, failed 23 of its 24 cases: 667, 844 and 932 pt, text scale 1.0 and 2.0, today, backlog, done and no cards, 22 of them on a mascot of 210 while the page scrolls.
- **#610's branch** (`fix/hero-fit-610`) fitted the hero above the drawer with a floor of 96. With the drawer gone, a week card takes its place, and at 667 pt and text scale 1.0 the words, the action and the week card leave the mascot less than 96, so the floor is 64.
- **The data.** The streak and the per-day counts are what 기록 already reads: on the phone `study`'s `studyDayCounts`, on the web `study_record_days` counted by `studyDayCounts`.
- **Alternatives considered:**
  - **Keep the drawer and fit the hero above it (#610).** It cures the cut, not the detached pull the owner reported.
  - **A week card in the first-run step's place on a cardless 홈.** The PM ruled on #611 that a cardless 홈 has one way out, the hero's ([ADR 0145](0145-redraw-the-screens-for-the-coral-mascot-rounder-with-one-current-tab-two-chart-colours-and-one-way-out-of-an-empty-state.md)); a placeholder card would be a second sentence and no new information.
  - **Shrink the words or the action to fit.** They keep their type sizes; only the mascot gives way.
  - **A flexible mascot under `IntrinsicHeight` on the phone.** It sizes the hero by the mascot's largest; the hero reports its least height, the words with the mascot at its floor, and a fit lays the hero out in what the week card leaves.
  - **On the web, the 홈 page calling `readRecord`.** It folds every card through the engine for seven numbers; `readToday` reads the week with one more request.

## Decision

- **The menu is 기록 / 홈 / 노트**, with 홈 in the middle, on the phone's tab bar and the web's tab bar and side menu. 설정 leaves the menu; it opens over the menu from a **profile button**, the account's initial in a round button, at the right of 홈's top bar, and on the web from 1024 px at the foot of the side menu. This supersedes ADR 0150's menu of 기록 / 홈 / 설정.
- **홈, top to bottom:** the hero on `hero`, rounded at its foot, its top bar the app's name and the profile button; the mascot, the words and the one action as now; and under it, on the ground, the **week card**: "n일 연속" with n in `accent`, "지난 7일 n장" at its right, and seven day bars, today's last and in `accent`, the others in `heat1`, each under its count and over its weekday, a day with no card a dashed outline. The streak chip leaves the top bar.
- **The week card is drawn whenever any note holds a card**, a week with no study included, all dashed on "0일 연속". With no card in any note it is not drawn, and the hero's own content and action fill the space. A count that cannot be read puts its reason in the week card's place.
- **The fit.** The week card and the top bar take their own heights; the hero takes the rest. Its words and action keep their sizes, and the mascot, square, takes what they leave, from `mascotHero` (210) down to `mascotFloor` (64), the group centred. Only once the mascot is at its floor does 홈 scroll, the hero and the week card together, so 시작 and the week card are never cut or overlapped.
- **The 노트 tab** holds the title 노트 with 새 노트, the 노트 검색 field, every note's row as the drawer drew it, and, with sharing, 공개 노트 둘러보기. A note opens inside the tab's own navigator, above the menu; 홈 keeps no navigator. A deck 홈 or a photo import opens, and 새 노트's, opens on the 노트 tab. "노트에서 카드 추가" shows the 노트 tab.
- **The web** is the same at every width below 1024 px, mobile web being the app ([`design/principles.md`](../design/principles.md) §One style on every client): 홈 the screen above the tab bar, fitted as the phone's, by a grid whose mascot row is `minmax(mascot-floor, mascot-hero)`; `/decks` is the 노트 page. `readToday` reads the last seven study days with `study_record_days`, counted as 기록 counts them.
- **Deleted:** the drawer, its peek, its handle and "올려서 보기"/"접기", the hero band over the open drawer, the 설정 tab, "내 노트 n", the streak chip, and the web's redirect of `/decks` to `/`.

## Consequences

- 홈 shows today and the habit with nothing to drag; finding a note is one tap more, on 노트.
- At 667 pt and text scale 1.0 the mascot on 홈 is near its floor of 64; at 2.0 홈 scrolls on every phone height.
- A screen pushed from 홈 is pushed over the menu; a note is always on the 노트 tab.
- The phone's and the web's week card read the counts 기록 reads, so the two cannot disagree.

## Signs the decision was wrong

- Users miss their notes on 홈, or open 노트 first on most visits.
- The owner finds the mascot too small at 667 pt, or the week card read as a chart nobody looks at.
- 설정 is not found from the profile button.
