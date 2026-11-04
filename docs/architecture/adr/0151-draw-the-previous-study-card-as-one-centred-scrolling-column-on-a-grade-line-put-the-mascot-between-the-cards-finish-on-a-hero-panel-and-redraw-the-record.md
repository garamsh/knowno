# ADR 0151: Draw the previous study card as one centred, scrolling column on a grade line, put the mascot between the cards, finish on a hero panel, and redraw the record

> Status: accepted; the mascot between the study cards superseded by ADR-0166; the previous card's front at `deckName` superseded by ADR 0176; the completion panel on the hero superseded by ADR-0189
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #579**, a sub-issue of #570 under epic #542. The binding drawing is the final screens page (`scratchpad/redesign/final/knowno-final.html`, published as artifact `T2BTdij5rzjXFREiXU7PZj`). Where it and the issue differ, a later owner comment on #570 wins, then the page, then the issue.
- **The previous card.** [ADR 0042](0042-show-only-the-previous-and-the-current-study-card-at-one-size-re-decide-the-previous-card-by-a-swipe-and-open-it-on-a-tap.md) split it into a front and a back half, each shrunk to a floor and then cut. [ADR 0099](0099-answer-study-cards-by-swipe-alone-and-grade-the-previous-card-by-its-colour-alone-on-the-phone.md) and [ADR 0105](0105-grade-the-web-s-previous-card-by-its-colour-alone-as-the-phone-does.md) graded it by a tinted fill inside a 1.5 px line. On #570 the owner asked for no visible label, a 3 px border in the grade's colour that follows a re-decide, content centred both ways, and a long answer that scrolls inside without clipping its top. A screen reader still hears "방금 본 카드" and the grade.
- **A card that scrolls and also takes a horizontal drag.** The phone's previous card re-decides on a horizontal drag. A scroll inside it must not answer or re-decide.
- **The mascot.** The page puts it between the two cards, reacting to a drag: happy to the right, sad to the left, thinking at rest. [ADR 0141](0141-polish-the-coral-mascot-make-coral-the-primary-action-and-place-its-expressions-on-both-clients.md) kept it off study cards. Its own motion is #573's. Here it is only placed and its expression switched.
- **학습 완료.** The page draws a full-screen hero with "오늘 끝!", tiles of 알아/몰라/걸린 시간 and one "홈으로". The PM ruled, on #579, that the full screen would drop two things the app does: re-deciding the last card after the day is done ([ADR 0035](0035-show-the-previous-and-current-study-card-reach-earlier-cards-three-at-a-time-re-decide-the-centred-card-and-grade-each-card-by-its-colour-and-a-chip.md)), and studying past today's cards ([ADR 0049](0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md)). So the panel keeps the app's heading, streak and actions, and takes the page's surface and tiles. The page's 알아/몰라 was illustrative, and the grade words stay 안다/모른다.
- **기록.** The owner found 좋음 and 보통 indistinct and asked for the whole tab redrawn, keeping its sections, data and strings: a period control on top, the target on its line, a stacked bar over tiles, a gain chip, weekly bars and a heatmap in four cobalt steps. The owner's light steps, `#E3E9F8` and `#B9C9F5`, are 1.36:1 apart, and the dark `#2C3858` and `#34508F` are 1.48:1. Both are under the 1.5:1 adjacent-level rule the record's tests hold.
- **The streak flame.** 홈 lost its flame in #578 (ADR 0150), and the completion panel draws the streak in words alone, since the flame's stages are drawn for a light surface and its first stage disappears on `hero`. The PM ruled on #579, on 2026-11-02, that #587 does not keep `StreakFlame` alive to satisfy a test, and deletes it with what only it used.
- **Input and style.** The owner ruled on #579, on 2026-11-03, that the web follows web usability: on a pointer device it studies by the arrow keys and buttons, not by a swipe, and its coach teaches that, while mobile web, used by touch, behaves exactly as the app. The coach's captions already split this way, but its card moved under a finger on a pointer too. The owner then completed the rule: the style is the app's on every web size, its tokens, colours, raised surfaces, type faces and sizes, mascot, copy and component shapes, and only input and the layout a width calls for may differ.
- **Three type sizes a screen** ([ADR 0119](0119-draw-every-screen-from-one-radius-scale-one-chip-three-type-sizes-a-press-dim-and-three-haptics-and-a-hidden-blank-as-an-empty-underlined-gap.md), counted by the phone's screenshot test and the web's `typeSizesOf`) exempt `figure` alone among large sizes. The page's 44 px figure and 24 px band counts would make four or five sizes on 기록.

## Decision

- **Previous card, on both clients.** Its front sits over its back in one column, or a whole card shows its 칸 revealed in place. The column is centred across and down: by `Center` around the scroll on the phone (`deck`'s `CardScroll`), and by auto margins on the web. Taller than the card, it scrolls inside from its top, uncut. The front is `deckName`, 28/36 Pretendard ExtraBold, the page's 26 rounded to the type scale's user-text style, and the back is the card body, 17, in `ink2`. The card sits on `surface`, raised on its edge, inside a 3 px line: `know` for 안다, `dontKnowText` for 모른다. The line follows a re-decide, and there is no tint fill. Its label is "방금 본 카드, {grade}. 앞면: … 뒷면: …", with "수정됨" when changed. The day's last card from an earlier session and the coach's sample card take the same face.
- **The gesture rule.** On the phone, the previous card's horizontal drag recognizer and its face's vertical scroll meet in Flutter's gesture arena. A vertical drag goes to the scroll and neither answers nor re-decides; a horizontal drag re-decides. On the web, `touch-action: pan-y` and `useSwipe`'s slop give a vertical touch to the face's own scroll.
- **Mascot.** While a card is studied, the mascot sits centred over the gap between the cards, 64 across, taking no touch. Its face follows the latest drag of either card past the drag-feedback distance (40): happy toward 안다, sad toward 모른다, thinking otherwise. It goes with the cards when the day is done.
- **학습 완료.** The completion panel takes the current card's place under the previous card, which can still be re-decided. It sits on `hero`, rounded as a card, and scrolls inside. It holds the happy mascot beside "오늘 학습 완료" in `display` and the streak line "n일 연속" in `label`, all in `onHero`, with no icon. Under them come three tiles on the surface, each raised on the card's edge, each a count in `display` over its name: 안다 in `know`, 모른다 in `dontKnowText`, and the minutes in `ink` over "걸린 시간", a new string. The actions are "학습하기" on `heroButton` with "그만하기" as hero text, or, with nothing left, "더 학습할 카드가 없어요" and "그만하기" on `heroButton` at the cta height.
- **기록, on both clients.** In order:
  - A segmented control of 7일, 30일 and 전체 under the title, raised on its edge, the chosen period on `primary` under `onPrimary`. It governs the retention alone, as before.
  - Every chart is a card raised on its edge, its heading's line at its right.
  - 복습에서 맞힌 비율: the figure in `figure`, and the gap as a round pill, green (`tintGreen` under `onKnowTint`) at or above the target and amber below it. A 110-high line in `accent` over a 10% `accent` fill, the target dashed in `ink2` and named "목표 90%" on its line at the left, and today ringed. No scale labels; only the axis's two ends are named.
  - 기억 상태: "평균 n%" at the heading's right, a 22-high bar of the three recall hues parted by 3, then three tiles on `ground`, each a swatch, the band's name and its count in `display`.
  - 익힌 카드: the figure with the gain pill beside it, eight 96-high bars in `heat1` with this week in `accent`, and the axis's ends.
  - 학습한 날: the twelve-week heatmap in `heat0` to `heat3`, today outlined in `ink` 1 px clear of its cell, and under it the first day's date, the 적게…많이 key and 오늘.
- **Heat tokens.** `heat0`–`heat3` are added to both clients' tokens. Light: `#E3E9F8`, `#AABEF3`, `#7D98EA`, `#2547D0`. Dark: `#2C3858`, `#365292`, `#5578C9`, `#8AB4FF`. The owner's second step in each theme is darkened just enough to clear 1.5:1 from the first: light 1.52 and 1.51 on either side, dark 1.53 and 1.77.
- **Sizes.** The figure is `figure` (38), and the band and tile counts are `display` (28), shrunk to their tile where wider. This keeps 기록 and the study screen at three sizes. The page's 44 and 24 are not taken.
- **One style on both clients.** The web draws every screen in the app's style at every width: the same tokens, colours, raised surfaces, type faces and sizes, mascot, copy and component shapes. It differs only in input, arrow keys and buttons by a pointer, and in the layout a width calls for, the side menu and wider columns from 1024 px. Mobile web, used by touch (`(pointer: coarse)`), is the app. `design/principles.md` holds this as the rule for every screen.
- **Input on the web's study screen.**
  - By a pointer: "모른다" and "안다" with their ← and → keys, and "마지막 응답 바꾸기" with Z, as before.
  - By touch, read once as the session starts: no answer button is drawn, as the phone draws none. "모른다", "안다" and "마지막 응답 바꾸기" stay as visually hidden buttons, so a screen reader still reaches them as the phone's reaches its actions, and "안내 다시 보기" is alone and centred under the card.
- **The coach.**
  - By a pointer there is no finger and no drag. Each step marks the control it names: "안다" with its → key, then "모른다" with its ←, then "마지막 응답 바꾸기" with its Z, shown for that step before any answer. The mark is a ring in `hero` with a press of the control just before the card moves; the card's move and its tint follow the press, as an answer does. Under reduce motion the ring holds and nothing moves. The caption sits over the controls.
  - By touch it is the phone's, unchanged: each move under a finger, the caption in the controls' row.
- **Style aligned to the phone.** Each of these differed in style, not in input or width, and the web now draws the phone's:
  - the resume notice in the progress bar's place, the bar hidden while it shows, in place of under the bar ([ADR 0093](0093-make-stopping-the-finished-completion-card-s-primary-and-show-the-resume-notice-in-the-progress-bar-s-place-on-the-phone.md));
  - the cards 16 apart in place of 28, and the controls 20 under them in place of 12, with 20 above the cards in place of 24;
  - the coach's caption: padded 20, 16, 16 and 12 with no edge under it, "건너뛰기" in `label` at full `onHero` in place of 14 bold at 80%, and "다음" at the button height in `button` on its raised edge;
  - the completion panel's tiles on the card's edge, 6, in place of a row's, 5;
  - the completion panel's and the coach's `heroButton` fills raised on `onHeroEdge`, as the phone's `AppButton` draws them: the stylesheet's rule named a class no button carries, `bg-on-hero`, so they had no edge. It now names `bg-hero-button`.
- **Deletions.** What this change leaves unused goes:
  - `StreakFlame`, `FlameStage` and the `streakFlamesMove` seam, with their tests and the tests' set-up line;
  - the colour tokens `streak`, `flameOutline`, `flameCore` and `flameGlow` on the phone and `--color-streak` on the web;
  - the grade fills' tokens `knowCard`, `knowLine`, `dontKnowCard` and `dontKnowLine`, and the web's `know-card`, `know-line`, `dont-know-card` and `dont-know-line`;
  - the contrast checks of all of these, in `theme_test.dart`, `hero_test.dart` and `contrast.test.ts`;
  - `AppChip`'s `leading` slot, which no chip fills since 홈's streak chip went and whose one purpose was the flame;
  - the export of the web's `previousLabel`, which only its own module reads.
- **Supersessions.**
  - The previous card's split halves, cut at their floors, from ADR 0042 and [ADR 0049](0049-study-in-one-flow-that-goes-on-past-today-s-cards-as-recorded-study-with-the-current-card-showing-its-front-alone.md).
  - The `knowCard`/`dontKnowCard` fill and 1.5 px line of ADR 0099 and ADR 0105.
  - ADR 0141's "never on a study card", for the study screen.
  - [ADR 0104](0104-draw-the-streak-flame-in-five-stages-by-the-streak-s-days-burning-at-every-stage.md) in full: no screen draws a streak flame.
  - [ADR 0084](0084-answer-the-web-s-current-study-card-by-a-touch-swipe-as-the-phone-does.md)'s and [ADR 0064](0064-teach-study-with-a-first-use-finger-coach-and-show-the-day-s-last-card-and-a-brief-notice-when-a-day-resumes.md)'s finger on the web's coach by a pointer, and the web's answer buttons drawn by touch.
  - [ADR 0147](0147-draw-both-clients-in-cobalt-with-solid-surfaces-on-hard-edges-jua-for-what-we-write-and-pretendard-for-what-a-user-wrote.md)'s `chartQuiet` for a past week's mastered bar.
  - [ADR 0120](0120-state-today-s-progress-once-put-every-study-button-in-its-card-name-the-record-plainly-and-draw-photo-import-s-bar-checks-and-moves-as-the-other-screens-do.md)'s target named in a row above the plot and the scale labelled at its left. ADR 0120's naming of the target once stands.

## Consequences

- A long previous card is read whole by scrolling it, and no longer cut at a floor.
- `SplitCard` still lays out the card preview and the card rows. Neither client holds a grade fill or a flame colour any more.
- A style difference between the clients is a defect of the web, so a later review of any web screen against the phone's needs no decision of its own.
- By touch the web draws no answer button, so a user on a touch screen with a mouse attached studies by the swipe, the keys, or a screen reader's buttons.
- The mascot sits over the cards' facing edges, 24 into each, which the cards' 16 padding nearly clears.
- The 기록 tab's period control reads as the whole tab's, though it governs the retention alone.
- The completion panel scrolls inside its place, so at a large text size its last action is reached by a scroll.

## Signs the decision was wrong

- People miss that the previous card scrolls, and ask for its answer to show whole.
- A vertical scroll on the previous card is reported to change an answer, or a horizontal drag fails on a scrolled card.
- The mascot hides a card's text often enough to be reported.
- People read the period control as changing every chart.
- The darkened second heat step is reported as a different colour from the page's.
- People studying on a pointer device miss the swipe, or people on a touch device ask for the answer buttons.
- A screen needs a style of its own on the web that the phone cannot take.
