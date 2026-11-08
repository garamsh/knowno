# Assistant app

The app's `assistant` domain: the chat with 말랑이 on the phone, its client of the `assistant` function, the conversation kept on the device, the proposals the user adds, and how 홈 opens it. The function's contract is [`assistant.md`](assistant.md)'s; the web's chat is issue #722's.

## Current decisions

### Surface and location

- The domain lives in `app/lib/assistant/`; its surface is `app/lib/assistant/assistant.dart`, which exports `AssistantChatScreen` and `OpenNote`, `AssistantClient`, `HttpAssistantClient` and `assistantUrl`, and the providers `assistantClientProvider`, `assistantStorageProvider` and `assistantReadyCardsProvider`, with `assistantStorageKeys` for the composition site ([ADR 0201](adr/0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md), [`structure.md`](structure.md)). Its internals are under `app/lib/assistant/src/`:
  - `protocol.dart` — the stream's events, proposals, choices and refusals as sealed types, parsed at the boundary, and the share of the day's tokens left;
  - `event_stream.dart` — the `text/event-stream` reader;
  - `assistant_client.dart` — `AssistantClient`, the seam, and `HttpAssistantClient`, which streams the message, commits a proposal and reads `assistant_allowance()`;
  - `conversation.dart` — the turns, a reply's events applied, the last 40 turns a message sends, the ready proposal, and the stored form;
  - `assistant_controller.dart` — `AssistantController`, the one notifier that sends, retries, stops, commits and clears, and keeps the conversation in the app's preferences;
  - `providers.dart` — the providers above;
  - `chat_screen.dart` — the chat; `proposal_view.dart` — a proposal's groups and cards; `card_preview.dart` — a proposed card in two lines.
- The domain imports no other domain. `home/` opens it ([`home.md`](home.md)); the composition site builds `HttpAssistantClient` from the Supabase project and passes it to `composeApp` as `assistant`, which hides every way into the chat when it is null.

### The conversation

- One session, never a list: a user's message and 말랑이's reply are turns, and a reply holds its text, its sources, its proposals, its question and how it ended (whole, failed at the model, cut at the output limit, or stopped by the user).
- It is kept in the app's preferences, `assistant.conversation` for the turns and `assistant.draft` for the message being written, so typing rewrites no turn. A reply cut off by the app's closing is read back as stopped. A text that is no conversation reads as the empty one.
- A message sends the last 40 turns, each reply with the proposals it showed and the question it asked ([`assistant.md`](assistant.md) §Requests). A user's message is at most 4,000 characters, as the function's.
- "대화 지우기", in the chat's ⋯, asks "대화를 지울까요?" and clears the turns and the draft; it is not offered while a reply streams.
- The notifier outlives the screen, so 홈's bubble reads what the chat draws. Leaving the chat stops a reply still streaming, and opening a note over it does not.

### The stream and its refusals

- A message is `POST /functions/v1/assistant` with the session's token, answered as `text/event-stream`; `text`, `choice`, `proposal`, `citation`, `job`, `error` and `usage` are read, and an event of another name is dropped. A known event whose data is not its form ends the reply as failed. The `job` event is parsed and nothing is drawn for it until photos are attached.
- `usage` brings the day's tokens, and the share left, "오늘 n% 남았어요", sits under the chat's title; it is read through `assistant_allowance()` when the chat opens, and not shown while it cannot be read.
- A refusal is told by its status and body: `429` `rate_limited` (the budget is used: the mascot sleeps and the field goes), `429` `busy` (another message still runs: the message is sent again after 3 s, up to three times, and then asks "다시 시도"), `401`, `403`, `413`, and any other status or a connection that fails.
- A reply that failed offers "다시 시도", which replaces it; one cut at the output limit says so; "멈추기" stops one, keeping what arrived.

### Proposals

- A proposal arrives whole, and again whole under its id when a group is remade; each group that kept its cards keeps its checks, and a remade one is checked whole.
- It is drawn as one group on the surface: the note ("새 노트 · name" for a new one), then each group with its check, its title and its form chip, "다른 형식으로", which offers the other forms but a photo's and the group's own and sends "title 부분은 form 형식으로 다시 만들어 줘", and its cards, each with its check and two lines. A group of six cards or more starts collapsed to "카드 n장 · form".
- The action at the foot is the open proposal's, the last one shown whose reply has ended and which is not added: "n장 추가", or "n장 바꾸기" for changes, over the cards checked, disabled at none. A refused or failed commit says why above it.
- Once added, a proposal loses its checks, and a shortcut under it names the note and its cards, "카드 n장". It opens the note through `OpenNote`, which `home/` gives: it runs a sync, waits for it where the note is not on the device, and opens `DeckScreen` over the chat, so back returns to the same turns, scroll and draft.

### 홈

- Where the app has an assistant, 홈's hero mascot is a button named "말랑이와 대화하기" and the first run's primary is "말랑이와 첫 노트 만들기" ([`home.md`](home.md)).
- While a proposal of new cards is ready and not added, a speech bubble over the mascot reads "카드 n장 만들어 뒀어요", n the cards checked; the mascot's name carries it, "말랑이와 대화하기, 카드 n장 만들어 뒀어요". Nothing is shown by default.

### Strings

- Every string is in the ARB set under `assistant…` keys, the same Korean as the web's chat (issue #722), in 해요체 and with a deck a 노트 ([`design/copy.md`](design/copy.md)).

### Tests

- `app/test/assistant/fakes.dart` holds `FakeAssistantClient`, which answers each message with a scripted reply, refusal or stream the test feeds, and records what it is sent and committed.
- `app/test/assistant/protocol_test.dart`, `event_stream_test.dart`, `conversation_test.dart`, `card_preview_test.dart` and `assistant_client_test.dart` test the boundary: each event and refusal, a stream split at any byte, the stored form, the 40-turn cap, the checks a remade proposal keeps, and the client against a mock HTTP client.
- `app/test/assistant/chat_screen_test.dart` drives the chat over the fake: the empty chat and the share left, a reply streaming in and kept with the draft, a question's options, a proposal's checks and its commit, changes, a collapsed group, a remade group, `busy`, `rate_limited`, a refusal that can pass, a failed reply, a cut reply, stop, leaving, a failed commit, clearing, and a note opened with back to the same scroll and draft; and the chat in both themes at text scale 1.0 and 3.12 against the tap target guideline.
- `app/test/home/assistant_entry_test.dart` drives 홈: the first run's primary with and without an assistant, the mascot's button, the bubble and when it is not shown, a note opened over the chat, and the bubble inside the screen in both themes at text scale 1.0 and 3.12.

## Rationale

- [ADR 0201](adr/0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md) records why the chat is a domain of its own, why the conversation is kept in the preferences and the draft apart, why one notifier outlives the screen, and how 홈 opens it.
- Issues #711 and #721 record the owner's and the PM's decisions the screens carry.

## Open questions

- The edge character, the one-time hint, the context marker, photo attach with its job, and "직접 추가" in a note's ⋯ are the next pull request's (#721, PR 2).
