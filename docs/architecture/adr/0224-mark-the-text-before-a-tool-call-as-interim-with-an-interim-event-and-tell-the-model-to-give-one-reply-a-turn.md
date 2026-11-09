# ADR 0224: Mark the text before a tool call as interim with an `interim` event, and tell the model to give one reply a turn

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #824**, from the owner's iPhone on TestFlight v1.0.3, 2026-11-09. One turn showed one block of text made of every step's narration joined with nothing between them, and the reply named a tool's fields to the user. The owner asked that 말랑이 not send so many messages, for instance through a tool that sends the user a message.
- Both clients append every `text` event (`app/lib/assistant/src/conversation.dart`, `web/src/features/assistant/conversation.ts`). Only the function knows where one model call ends and the next begins ([`assistant.md`](../assistant.md) §Tool loop).

## Decision

- **Interim and reply.** The text of a model call that ends in tool calls the function runs is **interim**: a passing status line. The text of the call that ends the turn is the **reply**. A call that asks a choice ends the turn, so its text, and the text before a proposal in that call, is the reply.
- **The event.** The function sends `event: interim` with `data: {}`, once per call that streamed text and ended in tool calls it runs, after that call's last `text` event. It means: every `text` event since the previous `interim` event, or since the turn began, is interim. A call that streamed no text sends none; a call that ends the turn sends none.
  - It is sent when the call ends, before its tools run, so a client shows the status line while the tools work. The one case that waits is a call that holds `ask_choice`: the mark is sent after its tools ran, and only if the question was refused and the turn goes on.
- **The separator.** Before the first non-empty `text` delta of a call that follows an interim one, the function sends a `text` event whose delta is `"\n\n"`, so a client that appends every `text` event shows each step's text as a paragraph. It belongs to the text that follows it: a client that reads `interim` drops it with the interim segment, and one that keeps a reply trims its leading whitespace.
- **Old clients.** v1.0.3 and earlier ignore an event they do not know and keep appending: they show every step's text, now in paragraphs. Nothing else of the stream changes, so no client version is refused.
- **The index.** The model is told, in code-owned text after the card forms index (`REPLY_RULES`, so no prompt version is needed): keep remarks before a tool call short, give one reply in the turn's last step in Markdown, never name a tool, a field or an error's text, and say a failure in the user's terms.
- **Clients** show interim text as one status line, each replacing the last, gone when the reply starts, and keep only the reply (#829 app, #830 web).

## Consequences

- A message's text is no longer all of one kind: a client that records a turn's text must keep the reply alone, as #829 and #830 do.
- The rules are a request to the model, which may not keep them; a model that narrates in its last step shows it as the reply. The marking is the function's and does not depend on the model.
- A provider that sends text in a call beside tool calls is marked the same, so the rule holds on OpenRouter, OpenAI and Anthropic alike.
- The index grows by about 400 characters in every call.

## Alternatives considered

- **The owner's tool: `reply` or `send_message`, the only way to speak, free text discarded.** It gives one reply by construction. Rejected for now: the reply would stream as a tool argument, which is partial JSON the function must unescape as it arrives; it works against what every model does by default; and text a model writes outside the tool is lost. Marking gives the same result in plain text on every provider.
- **Dropping the text before a tool call on the server.** The user would see nothing while a long tool runs, and a model's useful remark before a question would be lost.
- **A `final` event on the reply instead of `interim` on the rest.** The function does not know a call is the last until it ends, so the reply's text would be marked after it was shown; marking the interim text at the end of its call is the earlier signal.

## Signs the decision was wrong

- Models write the reply before a tool call and a remark after it, so the reply is marked interim and lost: the tool becomes the better shape.
- Replies that name tools or fields continue after the index's rules, in more than one conversation.
- Clients show the status line flicker with remarks too fast to read.
