# ADR 0204: Draw 말랑이 at a screen's edge, name the note a chat opens from, attach photos to a message and follow their job from the phone

> Status: accepted; superseded in part by [ADR 0248](0248-meet-malangi-on-home-alone-offer-the-chat-once-a-day-in-a-bubble-over-the-mascot-and-open-it-naming-no-note.md) where it places the edge character and names the note a chat opens from
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #721, PR 2**, part of epic #711, after [ADR 0201](0201-chat-with-malangi-on-the-phone-in-an-assistant-domain-kept-in-the-app-s-preferences-and-opened-from-home-s-mascot.md): the chat and 홈's mascot are built. What the owner decided on 2026-11-04 and the PM's split of 2026-11-08 leave for this record:
  - 말랑이 is an always-present character, not a button, at the edge of 노트, a note and 기록, absent from 홈, study and its completion, the editor, photo import and 설정; it breathes and blinks, tucks into the edge while a list scrolls, can be dragged to the other edge and is remembered per device, and never covers content.
  - After the first note exists, a one-time hint, "말랑이를 누르면 언제든 대화할 수 있어요".
  - Opened from a note, the one thread carries a marker, "영단어 기본 노트에서", and the chat knows which note is meant.
  - Manual adding moves into ⋯ "직접 추가", on a note and, for a new note, on the 노트 tab.
  - The chat takes photos, which 말랑이 reads in a background job ([ADR 0198](0198-read-the-chat-s-photos-in-a-background-job-on-supabase-queues-each-photo-a-step-of-the-assistant-s-model-charged-against-the-day-s-tokens.md), [`assistant.md`](../assistant.md) §Photo jobs).
- **The mascot breathes from 128 px** ([ADR 0193](0193-make-home-one-screen-of-sky-over-ground-with-the-mascot-on-a-hill-the-streak-s-days-and-one-action.md)), and the edge character is 72.
- **A floating character over a scrolling list** covers a row wherever it rests. "Never covers content" can hold for what the list ends on and for what the character is told to keep clear of, and the owner's own words have it tuck while a list scrolls and return when it stops.
- **Alternatives considered:**
  - **One character in `HomeScreen`, over the whole tab area.** The notes navigator's other routes and the editor would show it, and it would need a rule for each; each screen that draws it wraps its own body instead, and what covers a screen covers its character.
  - **Lower the breathing threshold to 72.** Every 72 to 127 mascot would breathe, and nothing else is meant to; `Mascot` takes a `breathes` flag the edge character sets.
  - **A strip under every list for the character.** It would cost 96 px of every screen to keep a button clear that is tucked while the list moves.
  - **The upload as a closure written in `main.dart`.** The composition site would then decide a bucket and a path, which `structure.md` §Composition leaves to the units it builds.
  - **Photos through `media`'s upload queue.** That queue names a deck's own images by media id into the `media` bucket and survives restarts; a chat photo is uploaded once, just before its message, into `assistant-photos` and deleted by the server when its job ends.
  - **Poll the job from the chat screen.** A job outlives the screen, and the message after it should go whether or not the chat is open.

## Decision

- **The edge character** is `EdgeAssistant`, a widget of `assistant`'s surface that a screen wraps its body in: `home/`'s 노트 tab, a note's screen and 기록, and nothing else. It is a button "말랑이와 대화하기" 72 square, at the foot of the body, 12 from the edge, at the right until it is dragged to the left past the middle; the edge it rests at is kept in the app's preferences. It tucks half into its edge while the body scrolls vertically and returns 400 ms after the scroll ends; under reduce motion it moves without animation and the mascot stands still. Lists under it keep `edgeReserve` at their foot, so the last row is never under it. A note opened from the chat draws none, and `assistant` draws nothing where the app has no assistant.
- **Bubbles beside it:** "n장 만들어 뒀어요" while cards are ready, tapping it opens the chat; and, while a first note exists and the hint has not been tapped or dismissed, the hint with a close button, not while cards are ready. The hint is spent by tapping the character or its close button, and stored per device.
- **Manual adding** is in ⋯ "직접 추가" where the app has an assistant: on a note, the add sheet, and on the 노트 tab, 새 노트; neither screen has a header action of its own then, and without an assistant both keep theirs.
- **The context:** a chat opened from a note adds the line "name 노트에서" to the thread unless its last line already names that note, and sends `context: {deck_id}` with each message while it is open there. The marker is not a turn and is never sent.
- **Photos:** the chat offers 사진 찍기 and 앨범에서 고르기, stages up to 50 photos as JPEGs `photo_import` prepares, and uploads each to `assistant-photos` at `{user id}/{uuid}` before the message that names them in `photos`; an upload that fails sends nothing and keeps the text and the photos.
- **The job:** the `job` event is kept on the reply, and the chat asks `GET /assistant/jobs/{id}` every 3 s while it reads, drawing "n/m장 읽는 중" over a bar and "읽기 취소", which calls `POST …/cancel`. When it is done and no message has followed the reply, the chat sends one itself, the job on the reply that started it, and the cards made from it become ready like any others. The poll belongs to the app-level notifier, so it goes on with the chat closed and after a restart.
- **`assistant` depends on `photo_import`** through its surface for the camera, the library and the JPEG, and **imports `supabase_flutter`** for `SupabasePhotoStore`, the adapter it owns for the `assistant-photos` bucket, as `media`'s `SupabaseMediaServer` does for its own: the bucket, the `{user id}/{photo id}` path and the refusal where nobody is signed in are decided there, and the composition site only constructs it over the client and passes it. A fifth domain imports the package ([ADR 0020](0020-public-decks-in-a-sharing-domain.md) recorded the third).

## Consequences

- `Mascot` gains one flag, and `ListHeaderActions` and `StatsView` each one optional argument.
- A character at rest can sit over a row in the middle of a list; what is guaranteed is the foot of each list and a screen whose content is short, which `app/test/home/assistant_edge_test.dart` checks for each of the three screens.
- A message the chat sends in the user's place ends the thread's turns, so a user who writes while a job reads is answered once and the chat adds none.
- A reply that is stopped by the app's closing no longer holds a running job after the next poll answers.

## Signs the decision was wrong

- Users tap a row and reach the character, or ask for it elsewhere than the right or left edge.
- Reading goes on for minutes and the three-second poll shows as battery use.
- The user's message after a job reads as sent by them and surprises them.
