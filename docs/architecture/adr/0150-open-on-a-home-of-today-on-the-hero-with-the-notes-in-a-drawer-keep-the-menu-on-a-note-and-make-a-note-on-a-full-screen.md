# ADR 0150: Open on a home of today on the hero with the notes in a drawer, keep the menu on a note, and make a note on a full screen

> Status: accepted; the web's note page without a ⋯ superseded by ADR 0159
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #578**, under #570. On #570 the owner chose 홈 option 6, the menu 기록 / 홈 / 설정, the note screen's layout, one 카드 추가 sheet with no subtitles, and 새 노트 as a full screen. The binding screens are the final page `scratchpad/redesign/final/knowno-final.html`.
- **The 오늘 tab held more than option 6 draws.** Its backlog card and catch-up chart, done card, 지난 7일, 오늘 할 노트, unreadable-count card, cardless state and the first-run minutes step. The PM settled on #578 which of them stay.
- **A pushed route covers the tab bar.** The phone's note screen was a route on the app's one navigator, over the tabs, so the menu went with it.
- **The web has no note settings.** It has no rename, 꾸미기, 공개 or 삭제 for a note, so a ⋯ on its note page would hold nothing.
- **The theme files are another issue's this round** (#579 adds tokens), so this change adds and removes no token.
- **Two equal halves wrap a long label.** At text scale 1.0 on a 390 wide phone, `BottomActions` gave each button half the row, and "저장하고 다음 카드" in Jua at 23 wrapped to two lines (#574 review).
- **Alternatives considered:**
  - **Keep the 오늘 tab's charts under the hero.** The hero is the whole first screen, and 기록 already draws the record.
  - **Draw the tab bar inside the note screen and pop to the tabs on a tap.** Every place that opens a note would need a way back into the tab state; a navigator inside the tab keeps it by construction.
  - **A drag gesture for the web's drawer.** A page scroll is the pull-up a browser already has, with no gesture to make accessible.
  - **Map a stored sky or amber to the nearest of the four colours.** It needs the theme tokens changed or left unused, in files another issue holds this round.
  - **Keep the new-note option sheet before the name.** 저장하고 카드 추가 reaches every way to add cards to the new note through the one 카드 추가 sheet, so a second sheet before the name repeats it.
  - **Use the next type size down for paired buttons.** A label given its width keeps the button type the rest of the app uses.

## Decision

- **The menu is 기록 / 홈 / 설정, with 홈 in the middle**, on the phone's tab bar and the web's tab bar and side menu. The app opens on 홈. 설정 is the settings screen as a tab, in place of the account button. There is no 노트 tab, and the web's `/decks` redirects to `/`.
- **홈's first screen is today on the `hero` surface in large `onHero` text**: the app's name and the streak as a card chip with `accent` text, the mascot, and one `heroButton` action. Its words change with the day:
  - cards left: "오늘 N장", "약 N분이면 끝나요" and 시작;
  - in a backlog: the backlog's title and line, and 시작;
  - done: "오늘 할 카드를 다 했어요", the next review, and 학습하기;
  - no card in any note: "첫 카드를 만들어 볼까요?" and 카드 추가 with one note, or 노트에서 카드 추가, which opens the drawer, with several.
- **The first-run minutes step stays on 홈.** 지난 7일, the catch-up chart and 오늘 할 노트 leave it: the drawer's rows carry each note's count for today, and 기록 has the record.
- **A drawer at the foot holds the notes.** Closed, it shows 내 노트 N and one row. Pulled up, it holds the whole list, a magnifier that opens 노트 검색 with its no-match line, 새 노트 and 공개 노트 둘러보기. With no card due it opens higher. An unreadable count is a row at its top, since it asks the user to act. On the web below 1024 px the drawer is the section under the hero and a page scroll pulls it up; from 1024 px the hero is a card over the full list.
- **The first-run home is the final page's**: the mascot, "첫 노트를 만들어 볼까요?", 새 노트 만들기 as the primary and 공개 노트 둘러보기 as a quiet button.
- **On the phone, 홈 has a navigator of its own inside the tab**, so a note opens above the menu. Study, the card editor, 새 노트, the browse screen and the settings' own screens open over everything. Back pops 홈's navigator first; a tap on 홈 while a note is open returns to 홈.
- **The note screen**: the note's name in the top bar, a magnifier "카드 검색" that opens the field, and on the phone a ⋯ "노트 설정" holding 이름 바꾸기, 노트 꾸미기, 공개 and 삭제. Icon buttons are 44 square at least, raised as the chips are. Under the bar, 이 노트 학습 · N장, then "카드 N" with "M장 익힘", the 뒷면 보기 switch, the cards, and one 카드 추가 fixed at the foot above the menu. The tile and the 오늘 학습 card go. The web's note page has the magnifier and no ⋯.
- **The 카드 추가 sheet's rows are their names alone**: 직접 입력, 사진 찍기, 앨범에서 고르기, 엑셀·CSV 파일. The web lists the rows it supports.
- **새 노트 is a full screen shaped as 새 카드**: its title, the groups 이름 and 표지 색, and 저장 / 저장하고 카드 추가 at the foot. 저장 opens the new note; 저장하고 카드 추가 opens it with the 카드 추가 sheet up. The icon and the photo stay in 노트 꾸미기. The option sheet before the name goes.
- **The colour picker offers four colours**, t1 to t4, held by the keys blue, violet, sand and slate. A note that stored sky or amber keeps drawing its colour, and those tokens stay until a later issue removes them.
- **A pair of bottom buttons gives the secondary its label's width and the primary the rest**, so each label stays on one line at text scale 1.0 on a 390 wide phone; at 2.0 a label may wrap inside its button.

## Consequences

- 홈 states today once, on the hero; a reader looking for the last seven days goes to 기록.
- A screen pushed from 홈 shows the menu unless it is pushed on the root navigator, so each push site chooses.
- The web has no way to rename, decorate, publish or delete a note until the web note-settings issue lands.
- The tokens `deckSky` and `deckAmber` stay, used only by notes that stored those keys.

## Signs the decision was wrong

- Users miss the last seven days on 홈, or do not find the drawer.
- A screen that should cover the menu shows it, or one that should keep it covers it.
