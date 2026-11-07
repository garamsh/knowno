# Web assistant

The web's `assistant` feature: 말랑이's chat at `/assistant`, the conversation kept in the browser, the route and the action it reaches the `assistant` function through, its states, and its entry on 홈. The function itself is [`assistant.md`](assistant.md)'s; the shell and the server reads every feature makes are [`web.md`](web.md)'s.

## Current decisions

### Page and layout

- `/assistant`, in the `(shell)` route group and titled "말랑이 · 알아몰라", reads only `assistant_allowance()`, the day's tokens left, and draws `AssistantChat` ([ADR 0200](adr/0200-chat-with-malangi-on-the-web-in-an-assistant-feature-streamed-through-a-route-handler-kept-in-the-browser-beside-the-side-menu-from-1024-px.md)); while it reads, a skeleton of the chat's bar and field says "말랑이를 불러오는 중이에요.".
- Below 1024 px the chat covers the screen, the tab bar included, as the phone's pushed chat; from 1024 px it fills the space beside the side menu, which stays. Its turns and field sit in the 720 px `study` column, below a photo import's bar where one shows.
- Its bar: "뒤로", the browser's back or 홈 where there is no history; the mascot at 40 px, still, thinking, sleepy once the day's tokens are used, sad on a failure, happy once a proposal is added; "말랑이" over "오늘 n% 남았어요", the share of the plan's budget left, none without a budget; and ⋯ ("대화 메뉴", `design`'s `RowMenu`) with "대화 지우기", which asks "대화를 지울까요?" before clearing.
- The chat draws no other mascot: the empty chat says "무엇을 외워 볼까요?".

### Conversation

- One conversation, kept in this browser's `localStorage` under `knowno.assistant` with the draft (#711 decision 4); the message list's scroll is kept in `sessionStorage`, so back from a note lands on the same turns, place and draft. A reply stored while it streamed reads back as stopped. Storage that cannot be read starts an empty chat.
- A message sends the last 40 turns, each reply with the proposals it showed and the question it asked (`assistant.md` §Requests). Enter sends and Shift+Enter breaks the line, a syllable being composed keeping its Enter; a message is at most 4,000 characters.
- 말랑이's text streams in as it arrives, its sources listed under it once each. A `choice` draws its prompt and its options as buttons on the last reply; a pick is sent as the next message.
- A proposal draws its note ("새 노트 · name" for a new one) and its groups on one surface: each group its check over its cards, its title, its form's chip (글, 단어, 빈칸 문장, 표, 사진, 섞어서), "다른 형식으로", which offers the other forms and sends "title 부분은 form 형식으로 다시 만들어 줘", and its cards, each a check over its first-shown text and what it adds; a group of six or more starts collapsed to "카드 n장 · form". A proposal sent again under its id keeps the checks of the groups it kept.
- At the foot, the last proposal not yet added offers "n장 추가", or "n장 바꾸기" for changes, the cards checked. Once added, its checks go and a shortcut to the note, its name and "카드 n장", opens it.

### Requests

- A message is `POST /api/assistant`, a Route Handler, since its answer is a stream (stack-nextjs §3): it verifies the session, forwards the body with the user's token to the function and passes its status and stream back as they arrive; the browser going away aborts the call. A visitor not signed in is answered `401` without calling.
- The commit is the Server Action `commitProposal`, which reads the proposal and the checks, sends them to `/assistant/commit` as the user, answers the note and the cards written, and revalidates the pages; a refused commit says "카드를 추가하지 못했어요. 말랑이에게 다시 만들어 달라고 해 주세요.".
- Both sit behind `AssistantClient`, the seam the tests fill with a fake. The events are read at the boundary: an event of a name the chat does not draw is passed over, and a known one that is not its form ends the reply as failed.

### States

- `busy`: sent again after 3 s, up to three times, saying "앞의 메시지를 마무리하고 있어요. 잠시 후 다시 보낼게요.".
- `rate_limited`: "오늘 말랑이와 이야기할 수 있는 만큼 다 썼어요. 내일 다시 이야기해요.", the field removed and the share at its figure.
- A failed reply, `model_error`, says so with "다시 시도", which sends the message again in its place; a cut one says to ask for the rest; "멈추기" stops a streaming reply, marked "멈췄어요.".
- A refusal before the start says what happened in one sentence, with "다시 시도" where sending again can help and "로그인" when the session ended.

### Entry

- 홈's mascot is a link to `/assistant` named "말랑이와 대화하기"; while the last proposal shown is not added, `ReadyBubble` over its head says "카드 n장 만들어 뒀어요", read after the link's name (#742). The first run's one action is "말랑이와 첫 노트 만들기", a link to `/assistant` ([`web-study.md`](web-study.md)).

### Tests

Each line names a file and what it covers; the file holds the cases.

- `web/src/features/assistant/__tests__/event-stream.test.ts` — events yielded whatever chunks split them, a CRLF split across chunks, data lines joined, comments skipped, a cut-off event dropped.
- `protocol.test.ts` — each event read into its form, an unknown name passed over and a malformed one marked; each refusal, `busy` told from `rate_limited`; the share left.
- `conversation.test.ts` — a reply's events applied, a remade proposal keeping its kept groups' checks; the last 40 turns with their proposals and question; the stored conversation read back and garbage read as empty; a proposal ready until added.
- `assistant-chat.test.tsx` — with a fake client: streaming, the share, and the conversation and draft kept across a remount; a choice's pick sent after its question; the checks by card and group, "n장 추가", the commit and the shortcut; a failed commit; a group remade in a form; a large group collapsed; the day used; `busy` resent; "다시 시도"; "멈추기"; clearing behind its confirmation.
- `assistant-server.test.ts` — a message forwarded as the user with its stream and refusals passed on, a signed-out visitor refused uncalled against a signed-in one, Supabase unreachable; a commit's cards written, a changes commit counted, a refused one and input that is not a proposal.
- `web/src/app/(shell)/__tests__/today.test.tsx` — 홈's mascot and first-run action ([`web-study.md`](web-study.md)).
- `web/e2e/assistant.spec.ts` — against a local stack with `/api/assistant` stubbed in the browser: 홈's first run to the chat, a streamed reply, a choice, a grouped proposal with its checks and collapsed group, the share, the day used; a shortcut to a note and back to the same scroll and draft; 홈's bubble; each at 390 and 1280 px in both themes and at 200%, nothing reaching past the right edge.

## Rationale

- [ADR 0200](adr/0200-chat-with-malangi-on-the-web-in-an-assistant-feature-streamed-through-a-route-handler-kept-in-the-browser-beside-the-side-menu-from-1024-px.md) records the feature, why messages stream through a Route Handler and the commit is a Server Action, why the conversation is the browser's, and the place beside the side menu from 1024 px; epic #711 and issue #722 record the owner's and the PM's decisions.

## Open questions

- #722's second pull request: the edge character on the 노트 tab, inside a note and 기록, the context marker of the note the chat is opened from, photo attach against #750, and "직접 추가" in a note's ⋯.
- Whether a shortcut's "카드 n장" should count the cards written, as now, or the note's cards; the phone's chat (#721) and this one are to agree.
