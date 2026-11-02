# ADR 0158: Open the web's authoring flows as full screens below 1024 px, with the browser's back as the phone's back

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #593.** At 390 px the web opened 새 노트, 새 카드, photo import and spreadsheet import in one bottom sheet, `AuthoringSheet`, as ADR 0122's "grouped app-aligned sheets" had them, while the phone pushes each as a screen: a title bar, the fields, and its actions in a bar at the foot. The owner's rule of 2026-11-03, recorded on #579 and in `design.md` §Principles 9, makes mobile web the app: the web differs only in input and in what a width calls for.
- **The browser's back left the page.** A sheet was component state, so the back closed nothing: it left the note, and an edited card with it, without the question the phone's back asks.
- **The phone's sheets stay sheets.** 카드 추가, 칸 추가, 추가할 노트, photo import's 새 노트 and card edit, 파일에서 카드 추가 and every discard question are sheets on the phone too.
- **Next.js 16.4.1 keeps a page's own history entries.** Its `pushState` patch copies the router's state into an entry the page pushes, a same-address entry included, and a traversal to one restores the page from the tree it holds (`dist/client/components/app-router.js`, `copyNextJsInternalHistoryState` and `handlePopState`).
- **Alternatives considered:**
  - **A route per flow, as `stack-nextjs.md` §10's modal pattern.** A flow's state, the chosen photos and the reading job among them, lives in the page and cannot survive a refresh or a shared address, which is what the pattern is for; each route would also refetch the note.
  - **A search parameter per flow.** The back would remove it before the screen could ask, and each change reads the page again on the server.
  - **Keep the sheet and draw it taller.** It is still a sheet: no title bar, no foot, no back.

## Decision

- **Below 1024 px each flow is a full screen**, `AuthoringScreen`: the phone's title bar, "닫기" or, for 새 노트, "뒤로" before the title; the fields scrolling under it; and its actions fixed at the foot, outside the scroll, as the phone's bottom bar: 저장 / 저장하고 카드 추가, 저장 / 저장하고 다음 카드, n장 추가, 카드 n장 추가, or a reading or failed photo's actions. **From 1024 px the same screen is a dialog**, centred at the list width. Every other authoring dialog stays `AuthoringSheet`.
- **Spreadsheet import keeps the phone's two steps**: 파일에서 카드 추가 is a sheet, and the review, 카드 확인, a screen.
- **Every authoring dialog holds one history entry while it is open** (`useBackEntry`). The browser's back answers the top one as its close button does: a screen with a change asks first, and stays with its entry; a question closes and the screen behind it keeps writing. Escape does the same. A dialog that closes itself drops its entry, and one that opens in the same commit takes it over, so a sheet leading on to a screen leaves one entry.
- **A save that opens another page leaves the dialogs' entries first** (`leaveThen`), as the phone pops its screens before pushing the note, so a back from that note returns where the flow started.
- Focus moves into each dialog and returns to what opened it, as before.

## Consequences

- The web's authoring flows draw the phone's screens at a phone's width; ADR 0122's sheets for direct entry and photo review hold from 1024 px only.
- The browser's back passes over a closed flow: no entry is left behind it. A drop is a traversal back, so the closed flow's entries stay ahead of the page until the next push replaces them; a forward press lands on one and opens nothing.- A flow opened from a page leaves that page's history one entry deeper while it is open; a link inside a flow that navigated away would leave that entry behind, and no flow holds one.

## Signs the decision was wrong

- The back from a flow leaves the note, or a second back is needed after a flow closes.
- A save lands on a page whose back reopens an empty flow.
- A phone-width user meets a screen where the phone draws a sheet, or a sheet where it draws a screen.
