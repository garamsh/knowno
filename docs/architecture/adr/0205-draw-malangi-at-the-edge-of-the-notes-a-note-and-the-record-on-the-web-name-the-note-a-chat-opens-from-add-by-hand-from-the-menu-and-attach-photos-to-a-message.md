# ADR 0205: Draw 말랑이 at the edge of the notes, a note and 기록 on the web, name the note a chat opens from, add by hand from ⋯ and attach photos to a message

> Status: accepted; superseded in part by [ADR 0248](0248-meet-malangi-on-home-alone-offer-the-chat-once-a-day-in-a-bubble-over-the-mascot-and-open-it-naming-no-note.md) where it places the edge character and names the note a chat opens from
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #722, PR 2**, part of epic #711, after [ADR 0200](0200-chat-with-malangi-on-the-web-in-an-assistant-feature-streamed-through-a-route-handler-kept-in-the-browser-beside-the-side-menu-from-1024-px.md): the chat and 홈's mascot are built. The web follows the phone's [ADR 0204](0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md), which records what the owner decided on 2026-11-04: the edge character, the one-time hint, the note a chat opens from, "직접 추가" in ⋯, and photos read in a background job ([ADR 0198](0198-read-the-chat-s-photos-in-a-background-job-on-supabase-queues-each-photo-a-step-of-the-assistant-s-model-charged-against-the-day-s-tokens.md), [`assistant.md`](../assistant.md) §Photo jobs). This record holds what the web had to settle for itself.
- **The web is not the phone:** the page scrolls in the window, not in a list; the shell draws a side menu from 1024 px; a modal dialog, which the editor and photo import are, lies over the page; the chat is a page, and the browser's back is the way out of it; a browser reaches Supabase Storage with the session it holds, and the browser's JPEG is made by a canvas.
- **A floating character over a scrolling page** covers a row wherever it rests. "Never covers content" can hold for what the page ends on, and the owner's words have it tuck while the page scrolls and return when it stops.
- **Alternatives considered:**
  - **The character in the `(shell)` layout, shown by the path.** The layout does not know whether a first note exists, which the hint needs, nor the note's id, and it would carry a rule for each path; each page that draws it renders it instead, as the phone's screens wrap their bodies, and a page that does not read cannot show it.
  - **The character `position: sticky` in the page's flow.** It would never cover a short page, but at 1024 px and over it the column is narrower than the window, so it would tuck into the column's edge and not the window's; it stays `fixed`, with the room under the page's last row.
  - **The room under the last row as a fixed height.** The hint over the character is taller than the character, so a fixed 96 px left the last row under it at 200%; the room is the height of what the character draws, measured, and 24 px.
  - **The chat reading the note's name from the browser.** The name is the note's own and may have changed; the page reads it, as the 노트 page does, and a note that is not the user's, was deleted or is no id opens the chat from nowhere.
  - **Photos through a Server Action, as `readPhoto` takes one.** A chat photo is read by the function from the bucket, not by the app, and a Server Action's body is limited; the browser uploads to `assistant-photos` with the session it holds, as the bucket's policy expects, and nothing of the photo passes through the app's server.
  - **A second JPEG routine for the chat.** Photo import's `preparePhoto` is the browser's `downscalePhoto`; its body moves to `web/src/design/prepare-photo.ts`, which both features use, since a client module may not import a sibling feature's `index.ts` ([`structure.md`](../structure.md)) and `decks` and `assistant` share no feature.
  - **Polling the job through a Server Action.** A poll is a read the browser repeats every few seconds, which stack-nextjs §3 gives a Route Handler; the cancel is a mutation from the page's own UI, a Server Action. Both call the function as the verified user, as `/api/assistant` does.

## Decision

- **The edge character** is `EdgeAssistant`, a client component of the `assistant` feature that the 노트 page, a note and 기록 render in their own pages, and no other: not 홈, whose mascot is the entry, nor study, its completion, the editor, photo import or 설정. It is a button "말랑이와 대화하기", 72 px, `fixed` at the foot of the window above the tab bar and 12 px in from the edge, from 1024 px beside the side menu when it is at the left; at the right until it is dragged. It breathes and blinks: `Mascot` takes `breathes`, which only this character sets, as the phone's does ([ADR 0204](0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md)); under `prefers-reduced-motion` it is the still image and its slide has no transition.
- **It tucks** 36 px into its edge while the window scrolls and returns 400 ms after the last scroll; a pointer drag past 8 px moves it, and where it is let go decides the edge, the left or the right of the window's middle; an arrow key moves it to that edge for one who cannot drag. The edge is kept in `localStorage` under `knowno.assistant.edge`, and where storage refuses, for the page.
- **It leaves the page while a modal dialog is open**, so the card editor, photo import and every sheet show none, and returns when it closes.
- **The room under the last row** is a spacer after the page's content as high as the group the character draws, hint or ready bubble included, and 24 px, measured by a `ResizeObserver`.
- **Bubbles:** "n장 만들어 뒀어요" inside the button, read after its name, while a proposal not yet added is ready, as 홈's bubble is, tapping it opens the chat; and, where a first note exists and not while cards are ready, the hint "말랑이를 누르면 언제든 대화할 수 있어요" with "안내 닫기" 44 px, spent by tapping the character or the close button and kept under `knowno.assistant.hint`. The 노트 page and a note pass `hint`, the 노트 page only when it lists a note; 기록 never.
- **Opened from a note,** the character goes to `/assistant?note={id}`; the page reads the note, the user's live one, and the chat names it once, "{name} 노트에서", unless its last line already does, and sends `context: {deck_id}` with each message. The line is a turn of the stored conversation that is never sent.
- **Manual adding** is in ⋯ "직접 추가": a note's 노트 설정 holds it first, and opens the 카드 추가 sheet, as "카드 추가" did; the 노트 page's ⋯, "노트 메뉴", holds it alone and opens 새 노트, in place of "새 노트". Neither page has a button of its own. `AuthoringButton` becomes `AuthoringSheets`, the screens, which the two menus open; `?adding=1` still opens the sheet on arrival.
- **Photos:** the field's attach button, "사진 첨부", takes JPEG, PNG or WebP, prepares each as `downscalePhoto` does (upright, 2048 px, a JPEG of at most 3 MiB), stages up to 50 and uploads each to `assistant-photos` at `{user id}/{uuid}` with the Supabase browser client before the message that names them in `photos`. An upload that fails sends nothing and keeps the text and the photos.
- **The job:** the `job` event is kept on the reply; the chat asks `GET /api/assistant/jobs/{id}` every 3 s while it reads, drawing "n/m장 읽는 중", the photos not queued over those attached, over a bar with "읽기 취소", a Server Action that calls `POST /assistant/jobs/{id}/cancel`; a job the function no longer has is cancelled. Done while no message has followed the reply, the chat sends "사진 읽기가 끝났어요. 이어서 해 주세요." itself, with the job on the reply and the photos on the turn that attached them, and does not draw it; done while a message is under way, it waits for the next ask. The poll belongs to the open chat: with the page closed it stops, and a stored running job is asked after again when the chat opens.

## Consequences

- A character at rest can sit over a row in the middle of a page; what is guaranteed is the foot of each page and a short page, which `e2e/edge.spec.ts` checks at 390 px, 1280 px and 390 px at 200% on each of the three pages.
- `assistant` still depends on no feature: the note is read by its own `readNote`, and the JPEG by `design/`.
- `/api/assistant/jobs/[id]` is a second Route Handler a page's own UI calls, beside ADR 0200's; the proxy's matcher excludes `/api`, so the handler refuses a visitor not signed in itself.
- A job whose chat is closed before it is done is not told until the chat opens again, where the poll resumes and the turn goes then.
- The notes page and a note lose their visible "새 노트" and "카드 추가" buttons: a first-time visitor reaches manual adding through ⋯, as the owner decided.

## Signs the decision was wrong

- Users tap a row and reach the character, or ask for it at an edge the drag does not offer.
- A visitor of a short page at a large zoom still finds a control under the character.
- The poll's three-second request shows as load, or users wait for a job after closing the chat.
