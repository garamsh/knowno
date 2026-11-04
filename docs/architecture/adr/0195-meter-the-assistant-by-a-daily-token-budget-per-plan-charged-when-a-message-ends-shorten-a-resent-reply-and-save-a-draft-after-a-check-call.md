# ADR 0195: Meter the assistant by a daily token budget per plan, charged when a message ends, shorten a resent reply, and save a draft after a check call

> Status: accepted
> Date: 2026-11-05

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #748**, the owner of 2026-11-04: the assistant's cost is metered by tokens, not by messages or photos, so that a short question and a long analysis each cost what they actually cost. ADR 0190's daily message limit, Free 10, Pro 100, Max 300, 스페셜 none, is to be replaced by a token budget per plan. The PM's brief adds: a message starts only if budget remains, and its actual usage is charged when it ends, a cancelled, cut or failed call included by the usage reported so far, under the per-user lock; the period and whether to weight tokens by price are to be decided and recorded; the default budgets go to the owner for approval.
- **What a message costs is known only when it ends.** A message is up to 8 model calls, each resending the conversation and the tool answers, so its input tokens are not known at its start, and its output is up to 8,192 tokens a call (ADR 0190).
- **What the providers report.** The output tokens include the reasoning tokens on each of the three providers ([`assistant.md`](../assistant.md) §Providers records each field; ADR 0190's context cites Anthropic's "Extended thinking" for `thinking_tokens` as a share of the output). A stream that breaks off has reported what it reported by then: Anthropic its input tokens at `message_start` and its output in each `message_delta`, OpenRouter's responses and OpenAI's chat completions only at their end.
- **Issue #746.** ADR 0190 caps a turn's text at 4,000 characters and refuses a request over it, yet a reply the server streamed can be far longer, so a client resending it as history would be refused on every later message; its body cap of 512 KiB, checked before anything is shortened, would refuse such a history too (the PM's review of #754).
- **A client that goes away** cancelled the call in flight under ADR 0190, so a call whose provider reports usage only at its end was charged nothing (the PM's review of #754).
- **The PM's addition of 2026-11-05:** the function's check call that saves an assistant draft, which ADR 0190 left to #713's next pull request, is built here, as extract-cards' `settings/configuration` saves a photo draft (ADR 0182), with the same request and answer shapes.
- **Alternatives considered:**
  - **Weighting tokens by the configuration's price.** Output costs several times input on every provider, and a model's prices differ between models. The configuration holds no price, so weighting needs a price per model that someone keeps current, and a budget in weighted units no longer reads as tokens. Rejected for now: a plan is served by one configuration at a time and its budget is set knowing that model, so plain tokens track its cost closely enough until a plan's spend shows otherwise.
  - **A monthly period**, as plans renew. A month's budget lets a user spend it in a day and wait weeks. Rejected: a day in Asia/Seoul, as the message limit and the photo limits count.
  - **Reserving tokens when a message starts.** The reservation would have to be the worst case, 8 calls of the whole context, far more than a message uses, and would refuse messages a budget could afford. Rejected: charge what was used, when it ends.
  - **Letting a user's messages run at once.** Each would see the budget unspent and start, so the budget could be overrun by as many messages as a client opens. Rejected: a message does not start while another of the user's is running; with the check and the charge under the same lock, the budget is overrun only by the last message, and by no more than one message uses.
  - **Bounding the reply so it always fits the cap** (#746's other option). A reply cut at 4,000 characters would cut long explanations the user asked for. Rejected: the server shortens a resent reply it made, head and tail around a marker, and keeps the user's cap.

## Decision

- **The budget.** Each plan has a daily token budget, a day in Asia/Seoul, null for none, in `private.assistant_token_budgets`, set by an admin and each change recorded. It replaces the daily message limit, whose table stays for the revert.
- **The charge.** A message is charged its input and output tokens, the output including reasoning, as the providers report them; tokens are not weighted by price. A call that was cut is charged what it reported.
- **A client that goes away does not end the charge.** The call in flight is read on to its end, nothing more sent, so that the usage OpenRouter and OpenAI report only there is charged; it is still bounded by the turn's 120 s. A call that broke off, failed or timed out before its provider reported its input is charged an estimate of that input, its request's UTF-8 bytes over 4 (`BYTES_PER_TOKEN`), beside any output it reported. A call the provider refused with an error status is charged nothing.
- **The check and the charge.** A message starts only when its provider has a key, the day's tokens charged are under the budget, and no other message of the user begun within 150 s is still unrecorded. It is charged when it ends, by its record, before the client is sent its last event. Both run under the user's assistant lock, so the budget is overrun only by the one message that crossed it. That message is at most 8 calls (`MAX_MODEL_CALLS`), each answering at most 8,192 output tokens (`MAX_OUTPUT_TOKENS`) over an input of the history and of what the earlier calls and their tools added, which the model's context window bounds: at most 8 × (the context window + 8,192) tokens.
- **What the client is told.** A refused message is `429` with `rate_limited` and the budget and tokens used, or `busy`; the last event of a message names the budget and the tokens used with it; `assistant_allowance()` answers the budget, the tokens used and those left.
- **`busy` is retried.** A client that is refused `busy` waits a few seconds and sends the message again; the clients, #721 and #722, will. A message cancelled by its client stays running until its call ends and is recorded, so the next message sent right after a cancel is refused `busy` for up to the rest of its 120 s.
- **The default budgets**, approved by the owner on 2026-11-05: Free 200,000 tokens a day, Pro 2,000,000, Max 6,000,000, 스페셜 none, about the message limits at 20,000 tokens a message.
- **A resent reply.** An assistant turn's text over 4,000 characters is shortened to its head and tail around a marker counting what was left out; a user turn over the cap is refused as before.
- **The body a message may send.** Its replies are shortened before what it holds is measured against 512 KiB (`MAX_BODY_BYTES`), so a resent history is never refused for its size. The body read may be up to `MAX_REQUEST_BYTES`: 512 KiB beside 40 turns (`MAX_TURNS`) each a longest reply, 8 × 8,192 tokens at 4 characters a token, of 3-byte characters, 31,981,568 bytes. A reply longer than 4 characters a token on average is beyond that bound.
- **The draft.** `POST /assistant/settings/configuration` takes a plan, provider, model, optional prompt version, web search, searches a turn and reasoning effort from an admin, makes one call with them through the provider's adapter, and saves them as the plan's draft only when that call answered, with extract-cards' codes. A model that cannot run at the effort is refused as `effort_unsupported` before the call, asked of the database's per-model check so the two cannot disagree.

## Consequences

- A message's cost is what it used, so a long one spends more of the day than a short one, and a user near the end of the budget gets one more message whatever its size.
- A user cannot run two messages at once. A message whose function stopped before its record holds the next one back for at most 150 s and is charged nothing.
- A record that fails leaves the message uncharged; the log says so.
- A cancelled message still costs its call to its end, and the estimate of an input nobody reported may differ from what the provider bills.
- The function reads a message body of up to about 32 MB before it measures what the body holds.
- Web searches are not in the budget: a turn's searches stay capped by its configuration (ADR 0190), and their results reach the model as input tokens, which are.
- The clients, not built yet (#711), read the budget and tokens in place of the day's messages. The admin 요금제 page that shows and sets the budgets is a later pull request; its functions are here.
- A client sees the head and tail of a long reply in the model's memory of it, not the middle.

## Signs the decision was wrong

- A plan's spend in money differs widely between users with the same tokens used, which weighting by price would have evened out.
- Users run out of the day's budget in a few messages, or never come near it, at the approved numbers.
- Users meet `busy` in ordinary use, such as a second device or a quick follow-up, beyond what a retry after a few seconds covers.
- Charged estimates of unreported input differ widely from the provider's bill for the same calls.
- The model answers about the middle of a long reply it can no longer see.
