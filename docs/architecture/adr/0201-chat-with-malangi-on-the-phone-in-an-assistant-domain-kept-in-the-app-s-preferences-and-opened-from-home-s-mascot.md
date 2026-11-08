# ADR 0201: Chat with 말랑이 on the phone in an assistant domain, kept in the app's preferences and opened from 홈's mascot

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #721**, part of epic #711: 말랑이 as an assistant on the phone, against the `assistant` Edge Function ([`assistant.md`](../assistant.md)). The PM split it on 2026-11-08 into two pull requests: the chat and 홈's entry (this record), then the edge character, photo attach, the context marker and "직접 추가" in the note's ⋯. The web's chat (#722, PR #758) is the first pull request's twin, so the two clients say the same thing.
- **Owner decisions that bind the screens** (#711 and #721's comments, 2026-11-04): 말랑이 is the default way to make notes and cards; on 홈 the big mascot is the entry and nothing else is drawn there; there is no dot, and a short speech bubble appears beside the mascot when something is ready; one session, no chat list; proposals come in groups with a format chip, a check per card and per group, and a sticky "n장 추가"; added notes appear as shortcut cards, and back from a note returns to the same chat; the quota is tokens, shown as a share.
- **Where the phone differs from the web.** The web keeps the chat in `localStorage` and streams through a Route Handler. The phone calls the function directly with the session's token, as `photo_import` calls `extract-cards`, and holds the conversation on the device.
- **Structural questions** ([`structure.md`](../structure.md)): the chat is a subject with its own lifecycle and vocabulary that 홈 depends on, so it is a domain; a note it added is `home/`'s screen, which a domain may not open.
- **Alternatives considered:**
  - **Put the chat in `home/`.** `home/` holds no reads and no rules of its own, and the chat holds a conversation, a stream and a commit.
  - **A file for the conversation**, as a photo import's job is. A conversation is text and cards, a few hundred kilobytes at most, and the app's preferences are already open at the composition site with a synchronous read, so the chat can draw its stored turns on its first frame. A file would need a directory passed through the composition site and an asynchronous first read.
  - **Store the draft in the same entry as the turns.** Each keystroke would rewrite every turn, so the draft has an entry of its own.
  - **Abort a reply on a sheet or screen change** other than leaving the chat. A note opened over the chat leaves the chat mounted, so its reply streams on, as the web's does.

## Decision

- **A domain, `assistant`**, `app/lib/assistant/`, whose surface exports the chat screen `AssistantChatScreen`, the client and its HTTP implementation, and the providers `home/` and the composition site use. It imports no other domain: the note a shortcut opens is handed in as a callback `home/` supplies, `OpenNote`, which syncs and then opens `DeckScreen` over the chat.
- **A client seam**, `AssistantClient`, with `HttpAssistantClient` for the function and a fake for the tests. A stream's events and a refusal's body are parsed at that boundary into sealed types, including the `job` event, which the chat reads and draws nowhere until photos are attached.
- **The conversation lives in the app's preferences** under two entries, the turns and the draft, one session, the last 40 turns sent with each message; a reply cut off by the app's closing is stored as stopped. "대화 지우기" asks to confirm before it clears both.
- **One controller outlives the screen**: a Riverpod notifier holds the conversation, so 홈's bubble reads the same state the chat draws. Leaving the chat stops a reply still streaming, as the web does; opening a note over it does not.
- **홈's mascot is the entry**: a button named "말랑이와 대화하기" where the app has an assistant, and on the first run the primary action is "말랑이와 첫 노트 만들기". While a proposal of new cards is ready and not added, a speech bubble over the mascot says "카드 n장 만들어 뒀어요", where n is the cards checked in it, and its words are read after the button's name.
- **The composition site** builds the HTTP client from the Supabase project and passes it to `composeApp` as an optional argument; with none, the app offers no way in and 홈's first run keeps "새 노트 만들기".

## Consequences

- `app/lib/` gains a domain, so `structure.md`'s closed list, `app/test/architecture_test.dart`'s list and the documents' index change with it.
- 홈's first run no longer offers "새 노트 만들기" where the app has an assistant; the 노트 tab's "새 노트" is the way to write one by hand until "직접 추가" moves into a note's ⋯ with the next pull request.
- A note the chat added opens only after a sync brings it, which `home/` waits for where the note is not on the device.
- The stored conversation is read once at start and written as it changes, but for the text of a reply streaming in, which is written when it ends; a kill mid-reply loses the reply's text, not the message.

## Signs the decision was wrong

- Conversations grow past what the preferences store handles well on a device, so that starting the app slows.
- Users ask for a reply to continue while they leave the chat.
- A second client of the conversation, such as the edge character's hint, needs state the controller does not hold.
