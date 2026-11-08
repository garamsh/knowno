# Assistant app

The app's `assistant` domain: the chat with 말랑이 on the phone, its client of the `assistant` function, the conversation kept on the device, the proposals the user adds, the photos it reads, the character at a screen's edge, and how 홈 opens it. The function's contract is [`assistant.md`](assistant.md)'s; the web's chat is issue #722's.

## Current decisions

### Surface and location

- The domain lives in `app/lib/assistant/`; its surface is `app/lib/assistant/assistant.dart`, which exports `AssistantChatScreen` and `OpenNote`, `AssistantClient`, `HttpAssistantClient` and `assistantUrl`, and the providers `assistantClientProvider`, `assistantStorageProvider`, `assistantPhotoSourceProvider` and `assistantReadyCardsProvider`, `EdgeAssistant` with `edgeSize`, `edgeReserve` and `edgeReturnDelay`, and `ChatNote`, with `assistantStorageKeys` for the composition site ([ADR 0201](adr/0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md), [`structure.md`](structure.md)). Its internals are under `app/lib/assistant/src/`:
  - `protocol.dart` — the stream's events, proposals, choices and refusals as sealed types, parsed at the boundary, and the share of the day's tokens left;
  - `event_stream.dart` — the `text/event-stream` reader;
  - `assistant_client.dart` — `AssistantClient`, the seam, and `HttpAssistantClient`, which streams the message, commits a proposal and reads `assistant_allowance()`;
  - `conversation.dart` — the turns, a reply's events applied, the last 40 turns a message sends, the ready proposal, and the stored form;
  - `assistant_controller.dart` — `AssistantController`, the one notifier that sends, retries, stops, commits and clears, and keeps the conversation in the app's preferences;
  - `providers.dart` — the providers above;
  - `chat_screen.dart` — the chat; `proposal_view.dart` — a proposal's groups and cards; `card_preview.dart` — a proposed card in two lines, a text of version 3 as its plain text and a cloze of version 2 as `___` with its hint on the front and its answers on the back, read through `deck`'s `markupEngine` ([ADR 0207](adr/0207-render-and-edit-card-text-markup-and-cloze-in-the-app-through-the-engine-behind-a-deck-owned-seam-and-write-text-version-3.md));
  - `edge_assistant.dart` — `EdgeAssistant`, the character at a screen's edge;
  - `supabase_photo_store.dart` — `SupabasePhotoStore`, the private `assistant-photos` bucket through Supabase Storage.
- The domain imports `photo_import` through its surface, for the camera, the library and the JPEG a photo is prepared as, and `supabase_flutter` for the storage adapter, `flutter_timezone` for the zone name, `deck`'s surface for the markup engine its card preview reads a card's text through ([ADR 0207](adr/0207-render-and-edit-card-text-markup-and-cloze-in-the-app-through-the-engine-behind-a-deck-owned-seam-and-write-text-version-3.md)), and no other domain ([ADR 0204](adr/0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md)). `home/` opens it ([`home.md`](home.md)); the composition site builds `HttpAssistantClient` from the Supabase project and passes it to `composeApp` as `assistant`, which hides every way into the chat when it is null.

### The conversation

- One session, never a list: a user's message and 말랑이's reply are turns, and a reply holds its text, its sources, its proposals, its question and how it ended (whole, failed at the model, cut at the output limit, or stopped by the user).
- It is kept in the app's preferences, `assistant.conversation` for the turns and `assistant.draft` for the message being written, so typing rewrites no turn. A reply cut off by the app's closing is read back as stopped. A text that is no conversation reads as the empty one.
- A message sends the last 40 turns, each reply with the proposals it showed and the question it asked ([`assistant.md`](assistant.md) §Requests). A user's message is at most 4,000 characters, as the function's.
- "대화 지우기", in the chat's ⋯, asks "대화를 지울까요?" and clears the turns and the draft; it is not offered while a reply streams.
- The notifier outlives the screen, so 홈's bubble reads what the chat draws. Leaving the chat stops a reply still streaming, and opening a note over it does not.

### The stream and its refusals

- A message is `POST /functions/v1/assistant` with the session's token, answered as `text/event-stream`; `text`, `choice`, `proposal`, `citation`, `job`, `error` and `usage` are read, and an event of another name is dropped. A known event whose data is not its form ends the reply as failed. The `job` event starts a photo job's line under the reply (§Photos and their job).
- `usage` brings the day's tokens, and the share left, "오늘 n% 남았어요", sits under the chat's title; it is read through `assistant_allowance()` when the chat opens, and not shown while it cannot be read.
- A refusal is told by its status and body: `429` `rate_limited` (the budget is used: the mascot sleeps and the field goes), `429` `busy` (another message still runs: the message is sent again after 3 s, up to three times, and then asks "다시 시도"), `401`, `403`, `413`, and any other status or a connection that fails.
- A reply that failed offers "다시 시도", which replaces it; one cut at the output limit says so; "멈추기" stops one, keeping what arrived.

### Proposals

- A proposal arrives whole, and again whole under its id when a group is remade; each group that kept its cards keeps its checks, and a remade one is checked whole.
- It is drawn as one group on the surface: the note ("새 노트 · name" for a new one), then each group with its check, its title and its form chip, "다른 형식으로", which offers the other forms but a photo's and the group's own and sends "title 부분은 form 형식으로 다시 만들어 줘", and its cards, each with its check and two lines. A group of six cards or more starts collapsed to "카드 n장 · form".
- The action at the foot is the open proposal's, the last one shown whose reply has ended and which is not added: "n장 추가", or "n장 바꾸기" for changes, over the cards checked, disabled at none. A refused or failed commit says why above it.
- Once added, a proposal loses its checks, and a shortcut under it names the note and its cards, "카드 n장". It opens the note through `OpenNote`, which `home/` gives: it runs a sync, waits for it where the note is not on the device, and opens `DeckScreen` over the chat, so back returns to the same turns, scroll and draft.

### The context

- A chat opened from a note, `AssistantChatScreen`'s `note`, adds the line "name 노트에서" to the thread once it is built, unless its last line already names that note, and sends `context: {deck_id}` with each message while it is open there; opened from 홈 or the 노트 tab it sends no `deck_id`. Every message's `context` also carries `time_zone`, the device's IANA zone name, which `deviceTimeZone` reads through `flutter_timezone` and `HttpAssistantClient`'s `timeZone` supplies, so the server counts the study day in it ([`assistant.md`](assistant.md) §Requests); where the platform gives no name the `time_zone` is left out, and the server counts the day in `Asia/Seoul`, as for a message that names none. The line is a `ContextTurn`: stored with the thread, never sent as a turn, and not counted in the 40.

### Photos and their job

- The photo button beside the message field, present where `assistantPhotoSourceProvider` holds a source, offers "사진 찍기" and "앨범에서 고르기" and stages up to 50 photos, each a JPEG of at most 6 MiB that `photo_import` prepares; a staged photo is taken out by tapping it. A message may be photos alone.
- A message's photos are uploaded one by one, "사진을 올리는 중이에요", each at `assistant-photos/{user id}/{uuid}` through `HttpAssistantClient`'s `storePhoto`, which is `SupabasePhotoStore`'s `store`: the adapter the domain owns over the Supabase client, which decides the bucket, the path and the refusal where nobody is signed in, and which the composition site only constructs and passes; then the message names them in `photos`. A photo that does not upload sends nothing and leaves the text and the staged photos where they were.
- The `job` event is kept on the reply as a `JobProgress`, which is stored with it. While a job reads, `AssistantController` asks `GET /assistant/jobs/{id}` every 3 s (`jobPollEvery`), from the first event and again after a restart, and draws "n/m장 읽는 중" over a bar, n the photos no longer queued, with "읽기 취소", which calls the cancel route. A job the server does not know ends as cancelled; a poll that fails is asked again.
- When a poll says done and no message has followed the reply, the controller waits out a reply still streaming, then sends a message of its own, `jobDoneMessage`, with the job on the reply that started it (`assistant.md` §Photo jobs, "Composing"); the thread draws no line for it, the job's own line, "사진 n장을 다 읽었어요", says so. The cards made from it are ready like any others. A cancelled job sends nothing.

### The edge character

- `EdgeAssistant` wraps a screen's body: `home/`'s 노트 tab, a note's screen and 기록 do, and 홈, study and its completion, the card editor, photo import, 설정 and a note opened from the chat do not. It is a button "말랑이와 대화하기" 72 square, at the foot of the body 12 from its edge, the right edge until the user drags it past the middle to the left; `assistant.edge` keeps which, per device. It breathes and blinks (`Mascot`'s `breathes`), and under reduce motion stands still.
- While the body scrolls vertically it tucks half into its edge and its bubble fades; 400 ms after the scroll ends it comes back. A list under it keeps `edgeReserve` at its foot.
- Beside it, while cards are ready, "n장 만들어 뒀어요", read after its name and opening the chat when tapped. Otherwise, once a first note exists and until the character is tapped or the hint's close button, "말랑이를 누르면 언제든 대화할 수 있어요", kept per device in `assistant.hintShown`.
- Without an assistant `EdgeAssistant` draws its body alone.

### 홈

- Where the app has an assistant, 홈's hero mascot is a button named "말랑이와 대화하기" and the first run's primary is "말랑이와 첫 노트 만들기" ([`home.md`](home.md)).
- While a proposal of new cards is ready and not added, a speech bubble over the mascot reads "카드 n장 만들어 뒀어요", n the cards checked; the mascot's name carries it, "말랑이와 대화하기, 카드 n장 만들어 뒀어요". Nothing is shown by default.

### Strings

- Every string is in the ARB set under `assistant…` keys, the same Korean as the web's chat (issue #722), in 해요체 and with a deck a 노트 ([`design/copy.md`](design/copy.md)).

### Tests

- `app/test/assistant/fakes.dart` holds `FakeAssistantClient`, which answers each message with a scripted reply, refusal or stream the test feeds, and records what it is sent and committed.
- `app/test/assistant/protocol_test.dart`, `event_stream_test.dart`, `conversation_test.dart`, `card_preview_test.dart` and `assistant_client_test.dart` test the boundary: each event and refusal, a stream split at any byte, the stored form with its markers, photos and job, the 40-turn cap, the checks a remade proposal keeps, and the client against a mock HTTP client, its context, upload, job poll and cancel among them.
- `app/test/assistant/chat_screen_test.dart` drives the chat over the fake: the empty chat and the share left, a reply streaming in and kept with the draft, a question's options, a proposal's checks and its commit, changes, a collapsed group, a remade group, `busy`, `rate_limited`, a refusal that can pass, a failed reply, a cut reply, stop, leaving, a failed commit, clearing, and a note opened with back to the same scroll and draft; and the chat in both themes at text scale 1.0 and 3.12 against the tap target guideline.
- `app/test/assistant/supabase_photo_store_test.dart` drives the storage adapter over a Supabase client whose HTTP client is substituted: the bucket, the `{user id}/{photo id}` path and the JPEG type, nothing sent where nobody is signed in, and a failure where the bucket refuses.
- `app/test/assistant/chat_photos_test.dart` drives the photos, the job and the context: staging, removing and sending photos, a failed upload, a pick that fails, the camera, the job's progress and its poll, the message sent when it is done and not when the user wrote after it, cancelling, a job the server lost, a job a closed app left, a job done while a reply streams, and the note a chat names and sends.
- `app/test/assistant/edge_assistant_test.dart` drives the character: its button, its size and edge, the drag to the other edge and its keeping, the tuck and the return, reduce motion, a list that scrolls sideways, the ready bubble in both languages and on both edges, the hint, both themes at text scale 1.0 and 3.12, and the room at a list's foot against the one with none.
- `app/test/home/assistant_edge_test.dart` drives the screens that draw it: the three that do and the ones that do not, "직접 추가" on a note and on the 노트 tab with the header actions kept where there is no assistant, the hint across screens, the chat opened from the edge with and without a note, and, for each of the 노트 tab, a note and 기록, that the character sits over no control at the list's foot.
- `app/test/home/assistant_entry_test.dart` drives 홈: the first run's primary with and without an assistant, the mascot's button, the bubble and when it is not shown, a note opened over the chat, and the bubble inside the screen in both themes at text scale 1.0 and 3.12.

## Rationale

- [ADR 0201](adr/0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md) records why the chat is a domain of its own, why the conversation is kept in the preferences and the draft apart, why one notifier outlives the screen, and how 홈 opens it.
- [ADR 0204](adr/0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md) records why the character is a widget each screen wraps its body in, how it tucks and rests, how the job is polled and followed, and what `photo_import` gives the chat.
- Issues #711 and #721 record the owner's and the PM's decisions the screens carry.

## Open questions

- A character at rest can sit over a row in the middle of a list, which it leaves by tucking while the list moves; the guarantee is the list's foot ([ADR 0204](adr/0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md)).
