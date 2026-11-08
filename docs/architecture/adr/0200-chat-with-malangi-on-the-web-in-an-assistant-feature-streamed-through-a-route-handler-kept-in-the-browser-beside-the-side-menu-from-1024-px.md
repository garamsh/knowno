# ADR 0200: Chat with 말랑이 on the web in an `assistant` feature, streamed through a Route Handler, kept in the browser, and beside the side menu from 1024 px

> Status: accepted
> Date: 2026-11-05

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

Epic #711 and issue #722 ask for 말랑이's chat on the web, built against the `assistant` Edge Function ([ADR 0190](0190-serve-the-assistant-from-an-edge-function-that-streams-a-tool-loop-proposes-cards-in-groups-and-commits-what-the-user-checks-under-a-per-plan-daily-limit.md), [ADR 0195](0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md), [ADR 0197](0197-make-the-card-forms-versioned-skills-an-index-the-assistant-always-sees-and-a-guide-per-form-it-loads-shared-with-mcp-and-hold-each-proposal-group-to-one-form.md)). The owner's decisions on #711 and the PM's on #722 bind it: one conversation kept on the device, streamed text, quick-reply choices, proposals in groups with a form chip, "다른 형식으로", per-card and per-group checks and "n장 추가", a shortcut to each note written, back from that note landing on the same chat, 홈's big mascot as the entry with a speech bubble when cards are ready (홈 E, #742), and the day's tokens left shown as a share. Below 1024 px the web is the phone (`design/principles.md` §One style on every client); from 1024 px the PM left the chat's place to this issue.

Forces:

- The function answers `POST` alone and sends no CORS headers (`supabase/functions/assistant/handler.ts` at 269e2fcc6ffd6f8bb1c3b04e2d4cd18d2c9b4e5a refuses another method `405`), so the browser cannot call it across origins; the web already reaches `extract-cards` from the server for the same reason (`web/src/features/decks/read-photo.ts`).
- stack-nextjs §3 gives a streamed response to a Route Handler and a mutation from the app's own UI to a Server Action.
- A message's answer is a stream the browser reads as it arrives, and the user may stop it.

Alternatives considered:

- **The browser calling the function directly.** Rejected: no CORS, and it would put the user's access token in client code where the session is otherwise the cookies' alone.
- **A Server Action returning a stream.** React's server functions can return a `ReadableStream`, but an abort from the browser does not reach the action's fetch, so a stopped reply would run on to its end; and stack-nextjs §3 names a Route Handler for streaming.
- **The conversation on the server.** Rejected by #711 decision 4: the server is stateless per request and keeps no text.
- **From 1024 px, the chat as a panel beside each page, or a dialog.** A panel beside 홈 or a note would halve the 1040 px column or overlap it, and a dialog would hide the side menu that is the way to the note a shortcut opens. The chat as its own page keeps the side menu and the column the other pages use.

## Decision

- A new web feature, `assistant`, holds the chat; it depends on no other feature. `/assistant`, in the `(shell)` group and titled "말랑이 · 알아몰라", reads only the day's tokens through `assistant_allowance()` and draws the chat.
- **Messages** go through `POST /api/assistant`, a Route Handler that verifies the session as a Server Action does and forwards the body to the function with the user's token, passing the function's status and stream back as they arrive; the browser going away aborts the call. **The commit** is a Server Action, `commitProposal`, which reads the proposal and the checks before sending them to `/assistant/commit`. Both sit behind `AssistantClient`, a seam the tests fill with a fake.
- **The conversation** is kept in this browser's `localStorage` under `knowno.assistant`, the draft with it, the list's scroll in `sessionStorage`; each message sends the last 40 turns, each reply with the proposals and question it showed. "대화 지우기" in ⋯ clears it behind a confirmation.
- **Layout.** Below 1024 px the chat covers the screen, the tab bar included, as the phone's pushed chat does; from 1024 px it fills the space beside the side menu, which stays, its turns and field in the 720 px study column. Its bar holds the way back, the mascot at 40 px in the face the chat is in (thinking, sleepy once the day's tokens are used, sad on a failure, happy once a proposal is added), "말랑이" with "오늘 n% 남았어요", and ⋯.
- **States.** A message refused `busy` is sent again after 3 s, up to three times; `rate_limited` says the day is used and removes the field; a failed or cut reply says so, a failed one with "다시 시도"; a reply can be stopped.
- **Entry on 홈.** 홈's mascot is a link to `/assistant` named "말랑이와 대화하기", with "카드 n장 만들어 뒀어요" over its head while the last proposal shown is not yet added; the first run's one action is "말랑이와 첫 노트 만들기". The edge character, the context marker from a note, photo attach and "직접 추가" come in #722's second pull request.
- `decks`' ⋯ menu, `RowMenu`, moves to `web/src/design/row-menu.tsx`, the chat being its second feature (`design/principles.md` §One component per UI job).

## Consequences

- A chat lives in one browser: the phone's and another browser's are apart, as #711 decision 4 accepts.
- A stopped reply, or one whose page was closed, is charged by the function as `cancelled`; the chat marks it "멈췄어요.".
- The first run on the web no longer opens 새 노트 from 홈; the 노트 page's "+ 새 노트" still does.
- The web has one Route Handler the app's own UI calls, `/api/assistant`, for the stream alone.

## Signs the decision was wrong

- Users lose chats they expected on another device, or across a cleared browser, often enough to ask for them.
- A proxy or host between the browser and the server buffers the Route Handler's stream, so replies arrive whole.
- From 1024 px users leave the chat to look at a note and back repeatedly, which a panel beside the note would have spared them.
