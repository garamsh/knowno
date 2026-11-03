# ADR 0118: Name each concept once, write each role in one form, hold every screen to one set of visual details, and redraw settings and the deck screen by them

> Status: accepted; its term 덱 superseded by ADR-0148; the deck screen's "뒷면 보기" switch and its hidden back drawn as nothing superseded by ADR-0175
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The owner, 2026-10-27:** "추가할 때 문구나 이름도 중구난방이고". The QA UX audit of that day found one act named several ways in `app/lib/l10n/app_ko.arb` (#452):
  - three names for making a deck in three taps, 덱 만들기, 새 덱 만들기 and 새 덱;
  - 직접 만들기 for a new deck and for a new card;
  - 고치기 beside 편집, 지우기 beside 삭제, 공부 beside 학습;
  - a card's sides as 단어 and 뜻, and as 앞 and 뒤, on one photo import screen, and the deck screen's switch "뜻 보기" filling the blanks of a card with no meaning (#451, against [ADR 0079](0079-name-a-card-s-sides-front-and-back-and-its-grade-the-response-on-the-phone-the-web-and-in-the-docs.md));
  - 개 for words beside 장 for cards;
  - and, in one role, several forms: "공개" and "공개하기" both publish, a sheet title as a noun, a verb phrase or a statement, field errors in "…입력하세요" and "…해 주세요".
- `design.md` §Voice ([ADR 0024](0024-one-voice-and-a-sheet-action-rule.md)) fixes the endings, 해요체, and not the terms or the forms, so no rule a reviewer can check said which name or form is right.
- **The owner approved a standard** on 2026-10-27, issue #454: one term per concept, one sentence form per role, and the visual details that keep a screen calm rather than decorated, with drafts of the settings screen and the deck screen drawn by it. The owner's decisions on #452: 학습 everywhere, and the settings screen is titled 설정, its account section first.
- **The settings screen** was titled "계정" though it held the study settings and the theme. Each row was a rounded surface of its own; the theme was a boxed segmented control; "계정 삭제" carried a two-sentence note its confirmation repeats; the foot held the mascot, the version and two links on two lines.
- **The deck screen** stated the card count twice, in the line under the name and in "카드 n" over the list. Each row was its own surface, a hidden back drawn as a grey bar, a pencil at its end ([ADR 0095](0095-give-each-card-row-on-the-deck-screen-a-pencil-that-opens-the-card-in-the-editor.md)), and a tap showed or hid that row's back (issue #142). The today card held a progress bar under "n장 중 m장 익힘".
- **Alternatives considered:**
  - **Fix each string where it was reported.** Each screen was written alone, which is how the names diverged; without a table a reviewer can cite, the next screen diverges again.
  - **Keep 공부 for the daily minutes.** The owner chose 학습 everywhere.
  - **Keep a tap toggling one row's back.** With the switch it made two ways to show a back, and the editor reachable only by a pencil or a long-press. The draft makes the row's one tap open the card, which is the frequent act once the switch shows backs.
  - **Move the deck screen's search into ⋯.** It would cost a tap for a frequent act, and search is a platform icon ADR 0116 keeps. The bar holds back, search and ⋯, which is calm enough.
  - **Count the words on the photo import list's title in 장.** A word is not a card; the title would repeat the add button's count. The title says what was found, and the button alone counts.

## Decision

- **Terms and forms.** `design.md` §Copy holds the two tables of #454 §1 and §2 as the rule for every string on the phone. They are applied to every Korean and English string outside the card editor, its block-add sheet and the label presets, which #445, #447 and #450 change. The web's copy follows in its own issue.
- **Visual details.** `design.md` §Details holds #454 §3 as the rule every screen redesigned from now on follows. A shared `AppGroup`, and `SliverAppGroup` for a long list, draws rows as one white surface with radius 14, `AppRadius.group`, split by hairlines; a row inside draws no surface of its own. `AppType.figure` takes tabular digits. The other radii in §Details are reached screen by screen, as each is redesigned.
- **설정.** The screen the 오늘 tab's avatar opens is titled "설정", with three muted section labels over one group each: "계정", the email with the sync status under it, then "로그아웃"; "학습", "하루 학습 시간" with the minutes and a chevron, "앞면 소리 자동 재생" with its switch and no second line, and the labels' row; "화면", "테마" with the current choice and a chevron, which opens a sheet of 시스템, 라이트 and 다크 in place of the segmented control. Then "계정 삭제" alone in a group, in red, with no second line: its consequence is said by its confirmation alone. Then, centred and muted on one line, "버전 x.y.z · 이용약관 · 개인정보 처리방침". No avatar and no mascot.
- **The deck screen.**
  - The bar holds back, search and ⋯; search keeps its place.
  - Under it the deck's tile, its name, and one muted line, "카드 n장 · 익힌 카드 m장", with "· 공개" while published: the screen's one count of its cards.
  - The white card "오늘 학습", "약 m분" at its right, today's count large with "장" right after it, smaller and muted, and "▷ 학습하기". It holds no progress bar.
  - The pinned row: the section label "카드", and "뒷면 보기" with its switch, renaming "뜻 보기".
  - The cards as one group, each row its front alone, or its back muted after it while the switch is on; nothing stands for a hidden back. A tap on a row opens the card in the editor, read as one button with the hint "카드 편집". There is no pencil, no long-press and no per-row toggle.
- **Supersedes** ADR 0095. **Refines** ADR 0096 on the deck page, whose mastered count moves into the line under the name and whose bar goes; ADR 0098's deck page card, now "오늘 학습"; ADR 0091's settings, now 설정 with its "학습" section; ADR 0116's mascot at the settings screen's foot, now gone; and ADR 0067's sheet names, the new-deck sheet titled "새 덱" with "직접 입력", and the first-run home's "새 덱 만들기".

## Consequences

- A reviewer can cite one table for a term or a form, and one list for a visual detail.
- One count of a deck's cards, one way to show a back and one tap to edit, on the deck screen.
- A long front and back share the row's width with nothing else.
- Toggling one card's back alone is gone: a user who wants to test themselves on one card does so in study.
- Strings the editor's owners change keep their old terms until those changes land: "품사 표시" on the settings screen's label row and in the photo import menu (#447), and "음성" as the sound block's name (#445).
- The radius scale and the motion and haptics of `design.md` §Details are not yet what every screen draws; a screen not yet redesigned is not a defect against them until it is.

## Signs the decision was wrong

- Users ask how to see one card's back without opening it.
- Users miss the settings screen's sections, or take "테마" for something other than light and dark.
- Strings drift again: a new term for a concept `design.md` §Copy names lands without the table changing.
