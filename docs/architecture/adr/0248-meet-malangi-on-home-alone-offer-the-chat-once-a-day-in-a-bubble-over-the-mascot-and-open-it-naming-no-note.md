# ADR 0248: Meet 말랑이 on 홈 alone, offer the chat once a day in a bubble over the mascot and open it naming no note

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issues #923 (the goal) and #924 (the app), then #925 (the web).** The owner approved the mockup "시안대로" on 2026-11-11. [ADR 0204](0204-draw-malangi-at-a-screen-s-edge-name-the-note-a-chat-opens-from-attach-photos-to-a-message-and-follow-their-job-from-the-phone.md) drew 말랑이 at the edge of the 노트 tab, a note and 기록 on the phone, with a one-time hint, named the note a chat opens from and moved manual adding into ⋯ "직접 추가"; [ADR 0205](0205-draw-malangi-at-the-edge-of-the-notes-a-note-and-the-record-on-the-web-name-the-note-a-chat-opens-from-add-by-hand-from-the-menu-and-attach-photos-to-a-message.md) did the same on the web. A character that stays on three screens is met where a person is working on something else, and the owner's direction is that it is met on 홈.
- **What the edge character reached.** Besides `EdgeAssistant`, the phone kept `assistant.edge` and `assistant.hintShown` in the preferences, a `bottomReserve` in `ScreenSkeleton` for the list's foot, `Mascot`'s `breathes` flag, `AssistantChatScreen.note` with the `ContextTurn` it adds and the `deck_id` it sends, and the "직접 추가" menu item. The server reads `context.deck_id` ([`assistant.md`](../assistant.md) §Requests) and ignores its absence.
- **홈 already has the parts.** The hero mascot is a button that opens the chat, and a bubble, `_ReadyBubble`, says "카드 n장 만들어 뒀어요" over it while cards are ready ([`assistant-app.md`](../assistant-app.md) §홈).
- **Alternatives considered:**
  - **Keep the edge character and add 홈's bubble.** Rejected: it is the owner's decision that the character leaves the three screens.
  - **Keep the chat's note and open it from a note's ⋯.** Rejected: the chat opens from 홈 alone, so nothing reaches the note it would name; ADR 0204 and 0205 asked for the code to go where nothing else reaches it.
  - **Show the bubble at every 홈 open.** Rejected: it would be a notice repeated each time; once per local day is what the owner chose.
  - **Keep the day shown in the synced database.** Rejected: it is a per-device nicety, kept in the app's preferences and, on the web, in browser storage, as the edge's side was.

## Decision

- **말랑이 is met on 홈 alone,** besides the chat itself and study's coach, which stay as they are. The 노트 tab, a note's screen and 기록 draw no character and no hint, on both clients.
- **Header actions are drawn as without an assistant:** "+ 새 노트" on the 노트 tab and "+ 카드 추가" on a note, each beside the ⋯ that holds the screen's other actions, and no "직접 추가".
- **The chat names no note.** It opens from 홈 only. The phone's `AssistantChatScreen` takes no note, the controller adds no `ContextTurn`, and the client sends no `deck_id`; the `context` carries `time_zone` alone. A `ContextTurn` already stored with a thread still loads and is drawn as its line, and is never sent as a turn.
- **홈's chat bubble** is the ready bubble's drawing, a surface pill with a tail in label type, centred over the hill's mascot:
  - **When.** At most once per local day, on the first 홈 open of that day: a moment after 홈 appears, about 1.5 s, it comes, and after about 6 s it fades. Where 홈 is not the visible screen, a tab other than 홈 selected or a screen open over it, it waits. Under reduce motion it appears and goes without motion.
  - **The line** follows 홈's state: while cards are left today or in the backlog, "오늘 배운 거, 같이 카드로 만들까요?"; once the day's cards are done, "수고했어요. 얘기 좀 할래요?"; otherwise "말랑이와 대화해요".
  - **A tap** opens the chat, as the mascot's does.
  - **Priority.** The ready bubble ("카드 n장 만들어 뒀어요") keeps it: while it shows, this bubble does not, and the day is not spent.
  - **The day shown** is kept per device, `assistant.inviteDay` on the phone as a local `yyyy-MM-dd` in the app's preferences, and is not synced. It is spent when the bubble is drawn.
  - **Semantics.** The bubble is left out of the semantics tree, as the ready bubble is; the mascot's name, "말랑이와 대화하기", is unchanged and is the way in for a screen reader.
- **Removed with the edge on the phone:** `EdgeAssistant`, `assistant.edge`, `assistant.hintShown`, `bottomReserve`, `Mascot.breathes` and the strings of the hint, the short ready line and "직접 추가".
- **Supersedes** ADR 0204 and ADR 0205 where they place the character at the edge of the 노트 tab, a note and 기록, and where they name the note a chat opens from and add by hand from ⋯. What else they decide, the photos in the chat and their job, the notes the proposals add and the character's 72-px drawing where study uses it, stands.
- **The web follows in #925,** with the same lines and rule, the day kept in browser storage, and this record cited. Until it lands, the web draws its edge character and sends `deck_id` as ADR 0205 describes; the function accepts both.

## Consequences

- A person meets 말랑이 on the phone on 홈, once a day by the bubble and always by the mascot's button; the 노트 tab and 기록 have no way into the chat.
- A device that stored `assistant.edge` or `assistant.hintShown` keeps two preferences nothing reads; they are not removed.
- A chat can no longer be told which note it is about from a note. A person names it in their message.
- `Mascot` breathes from 128 px alone on the phone; the web's edge character still sets its flag until #925.
- Not verified here: the bubble on a device; the widget tests drive it with a substituted clock and the screenshots are of the test's render.

## Signs the decision was wrong

- People say they cannot find the chat from a note or ask for the note it was about.
- The bubble is read as a notice that repeats, or is tapped away so seldom that the day it is spent on is wasted.
- Chats are opened less on days after the edge character went, enough to bring a place for it back.
