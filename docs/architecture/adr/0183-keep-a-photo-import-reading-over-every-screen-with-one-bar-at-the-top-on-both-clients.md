# ADR 0183: Keep a photo import reading over every screen with one bar at the top on both clients

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #692.** The owner, 2026-11-04: "사진 변환시 학습 할 수 있도록 해줘. 약간 백그라운드 작업처럼 해놓으면 될거같아." The user leaves the import while photos are read, studies or uses any screen, and comes back to the read cards.
- **The PM's decisions on #692**, with the revision of 2026-11-04 on #690 and #692:
  - in-app background only: the OS is not asked to keep a job alive;
  - one quiet indicator, visible from every screen, study included, covering none of study's controls; a tap returns to the import;
  - reading that ends interrupts nothing: no dialog, no navigation;
  - one job at a time: starting an import while one runs opens the running one;
  - the close (×, "닫기") and the back leave a running import reading; "취소" ends it; a failed import is dismissed on leaving (#690, fixed in #693);
  - both clients, the same rules; on the web the job lives in the tab, and reloading it ends the job, which the import says.
- **What the phone had** ([ADR 0094](0094-read-a-photo-import-of-up-to-fifty-photos-three-at-a-time-as-an-app-level-job-kept-on-the-device-and-offered-again-after-a-restart.md)): the job already belonged to the app and read on while the user left the screen. Its bar sat above the tab bar inside the home shell, so study, 설정 and every other screen pushed over the tabs covered it. A second import was refused with a snack bar. The bar read "사진 읽는 중 0/n" for a job whose photos had all failed while the user was away.
- **What the web had:** the job lived in the import's own component inside the note page's "카드 추가" button, so leaving the page or closing the screen ended it.
- **Where one bar can stand on every screen.** Study has controls at both ends of the screen: × and the progress bar at the top, the card and its answers below. A bar laid over either end covers them. A bar that takes its own height at the top, with each screen laid out below it, covers nothing at any text size.
- **Alternatives considered:**
  - **Above the tab bar, and also on each screen with no tab bar.** Two places to keep in step, and study, which has no tab bar, would need its own; the issue asks for one indicator.
  - **A floating chip over the screens.** It covers whatever is under it, study's controls included, at some size or text scale.
  - **On the 노트 tab's label.** Not visible from study or any pushed screen.
  - **At the foot of every screen.** It sits under study's answers and a sheet's actions, and the keyboard covers it.
  - **On the web, a bar fixed over the page.** It covers the page's top. The bar instead heads the page in its flow and sticks while the page scrolls, and what itself sticks to the page's top (the side menu, 이번 학습, a note's card toolbar) sits below it.
  - **Joining a second import into the running one.** ADR 0094 rejected it: one job saves into one deck.

## Decision

- **The job reads on wherever the user goes.** On the phone it stays the app's `ImportJob`; on the web the tab's photo import is held above every page by the root layout, so moving between pages, study included, keeps it reading. Neither client asks the OS or the browser to keep it beyond the app or the tab; a reload of the tab ends the web's, and its reading screens say "이 탭을 닫거나 새로 고치면 읽기를 멈춰요".
- **Leaving keeps a running import; "취소" ends it.** The close and the back leave an import with photos left to read, or with a list, reading or waiting. "취소" ends it: calls in flight are cancelled and a late reply changes nothing. An import of only failed photos is dismissed on leaving, as #693 made it. A list's own × keeps asking before it discards, as before.
- **One bar at the top of every screen.** While a job holds photos or a list and its screen is not open, one bar heads the screen. The screen lays out below it, so the bar covers nothing:
  - on the phone, above the app's navigator, under the status bar; every screen, study included, is laid out in the space below;
  - on the web, first in the page, sticking to the top as the page scrolls; what sticks to the page's top sits below it.

  It reads "사진 읽는 중 k/n" over a bar of the k photos read, "사진 n장을 읽지 못했어요" once only failed photos are left to read, "카드 n장 확인하기" once its list waits, or, on the phone, "읽던 사진 k장 이어서 읽기" for a job a closed app left. It is one button, announced politely as it changes, and a tap opens the import.
- **The bar shows only where it can open the import.** On the phone, the signed-in shell sets how the bar opens the job; with no shell up, as when signed out, no bar shows. An import opened from it and saved opens its note on 노트, as before, under whatever screen was over the tabs.
- **Finishing interrupts nothing.** Reading that ends changes the bar's words and nothing else: no dialog, no navigation. The read cards wait unsaved until the user opens the import and saves or discards them.
- **One job at a time, by opening it.** Starting an import while one is under way opens the running one and takes no photo: on the phone in place of the picker, on the web from the "카드 추가" sheet's photo rows, which open it instead of the browser's picker.
- **Superseded:** ADR 0094's bar above the tab bar, or at the foot of the first-run home, and its refusal of a second import with "읽고 있는 사진이 있어요. 끝난 뒤에 새로 가져올 수 있어요."

## Consequences

- A user can start an import, study, and come back to the cards without waiting on the import screen, on either client.
- Every screen loses the bar's height while a job is shown. 홈's hero, which fills the first screen (ADR 0179), fills what is left below the bar.
- On the phone the bar sits under the status bar and takes its colour, `ground`, in place of the screen's own top; 홈's hero then starts below the bar.
- On the web the bar's height is published as `--photo-import-bar`, which the side menu, 이번 학습 and a note's card toolbar read to stick below it. A new part of the page that sticks to the top reads it too.
- The phone's string "읽고 있는 사진이 있어요. 끝난 뒤에 새로 가져올 수 있어요." is no longer shown.
- A web page that leaves the tab, by a full load or a link outside the app, ends the job, as a reload does.

## Signs the decision was wrong

- Users miss the bar, or start a second import expecting a new one and find the running one.
- The bar's height crowds a screen at the largest text size, study most of all.
- Users lose a web import by reloading or following a full-page link, despite the line saying so.
