# Assistant

The `assistant` Edge Function, 말랑이 as an assistant that builds notes and cards with the user in conversation: its requests, the stream, the tool loop and its limits, the tools, proposals and their commit, how each provider is called with its web search and reasoning, the per-plan configuration and daily token budget it reads, an admin's draft saved after a check call, its log and its tests. The schema behind the configuration and the budget is [`server.md`](server.md)'s; the card tools it shares are [`mcp.md`](mcp.md)'s; the clients' chat screens are not built yet (#711).

## Current decisions

### Location

- `supabase/functions/assistant/` is a Deno module with no third-party dependency: it calls Supabase Auth, PostgREST and the provider of the caller's plan with `fetch` ([ADR 0190](adr/0190-serve-the-assistant-from-an-edge-function-that-streams-a-tool-loop-proposes-cards-in-groups-and-commits-what-the-user-checks-under-a-per-plan-daily-limit.md)).
- It imports the card tools from `supabase/functions/_shared/` (`tools.ts`, `store.ts`, `input.ts`, `cards.ts`), as `mcp` does, and Vault's key read, `_shared/keys.ts`, as `extract-cards` does.
- `index.ts` is its composition site: it reads the configuration once and passes `fetch`, the keys, the logger, the clock, the random source, the address lookup and the timeout to the handler.
- `config.toml` sets `verify_jwt = true`; the function then asks Supabase Auth for the token's user with the service-role key, refusing the anon key and an anonymous sign-in, as `extract-cards` does. It reads `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`, which the platform sets, and no other secret.
- Merging a change to it deploys it ([`server.md`](server.md) §Edge Function deploys).

### Requests

- `POST /functions/v1/assistant`, a message, with the user's token and a JSON body that holds at most 512 KiB (`MAX_BODY_BYTES`) once its assistant turns are shortened, read up to `MAX_REQUEST_BYTES`, 512 KiB beside 40 turns each a longest reply of three-byte characters, so the server's own history is never refused for its size ([ADR 0195](adr/0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md)):
  - `messages` — 1 to 40 turns, oldest first, the last the user's: `{role: "user", text}` or `{role: "assistant", text, proposals?, choice?}`. A user turn's text is at most 4,000 characters (`MAX_TURN_TEXT`); an assistant turn's longer text, such as a long reply the server streamed, is shortened to that length, its head and tail around a marker counting the characters left out, and never refused ([ADR 0195](adr/0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md), #746). An assistant turn's `proposals` are the proposals it showed, as the stream sent them, and its `choice` the question it asked; the model reads them after the turn's text, each proposal with its ids and each group's first five fronts, each cut to 80 characters. A turn so described is at most 16,000 characters (`MAX_DESCRIBED_TURN`): past it, its proposals show one front a group, then none, then only their sizes, and then those that still do not fit are counted, so a turn the server sent always fits; a turn whose text and question alone are over it is refused.
  - `context` — optional `{deck_id}`, the note the chat was opened in; the model is told its name and id when it is the user's live note.
- `POST /functions/v1/assistant/commit` — `{proposal, checked}`, where `checked` maps each group's id to the ids of its cards to write (§Commit).
- `POST /functions/v1/assistant/settings/configuration` — an admin's draft (§Draft).
- A message or commit is checked in this order: route, method, configuration, token, user, body size, JSON, for a message what the body holds once its replies are shortened, suspension, then for a message its turns and the start. A refused message never reaches the model, and one refused before the start is not recorded.
- Every refusal of a message or commit is `{error}`, and the commit's `400` and `422` add `message`:

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | the body is not JSON, or not a message or commit of the forms above |
| 401 | `unauthenticated` | no bearer token, an invalid one, the anon key, or an anonymous sign-in |
| 403 | `suspended` | an admin suspended the user |
| 404 | `not_found` | a path other than the two |
| 405 | `method_not_allowed` | a method other than `POST` |
| 413 | `too_large` | a commit body over 512 KiB; a message body over `MAX_REQUEST_BYTES`, or holding over 512 KiB once its assistant turns are shortened |
| 422 | `refused` | the commit's write tool refused it whole, such as a note that is not the user's |
| 429 | `rate_limited` | the day's tokens charged have reached the plan's budget; the body adds `token_budget` and `tokens_used` |
| 429 | `busy` | another message of the user is still running, as one is until its call ends after its client cancelled it; the client retries after a few seconds |
| 503 | `not_configured` | a platform variable is missing, or the plan has no configuration or budget |
| 503 | `unavailable` | the configuration's provider has no key in Vault, the message not recorded; or Supabase did not answer |

### Stream

- A started message is answered `200` with `text/event-stream`, each event `event: <name>` and one line of JSON `data`:
  - `text` — `{delta}`, 말랑이's text as it arrives;
  - `citation` — `{url, title}`, a web source the reply cites, once per URL a message;
  - `proposal` — a proposal (§Proposals), whole, sent again whole under the same id when one of its groups is remade;
  - `choice` — `{prompt, options}`, a question with 2 to 6 options; the client sends the pick, or a typed answer, as the next user turn;
  - `error` — `{error: "model_error"}` when a model call failed, or `{error: "cut"}` when a reply stopped at the output limit;
  - `usage` — always last, sent once the message is charged: `{outcome, model_calls, input_tokens, output_tokens, reasoning_tokens, web_search_requests, token_budget, tokens_used}`, `tokens_used` the day's tokens with this message's charge and `token_budget` null for no budget.
- `outcome` is `ok`, `choice`, `depth_limit`, `time_limit`, `model_error`, `cut` or `cancelled`. A `cancelled` turn's client has gone, so it is recorded and logged but sent nothing.

### Tool loop

- Each model call streams; the tools it calls run in order and their answers go back in the next call. The turn ends when the model ends it, when it asks a choice, or at a limit:
  - at most 8 model calls a message (`MAX_MODEL_CALLS`), a call the provider paused and a failed call included;
  - 120 s a message (`TURN_LIMIT_MS`), under the 150 s wall clock of the Free plan and the 400 s of paid ones; each call is aborted when the message's time runs out;
  - at most 8,192 output tokens a call (`MAX_OUTPUT_TOKENS`).
- A call the provider paused, Anthropic's `pause_turn`, is sent again with its message last, which resumes it.
- A reply that stopped at the output limit ends the turn as `cut`, its tool calls not run.
- A client that goes away cancels the stream: nothing more is sent, the call in flight is read on to its end within the message's time, so that the usage its provider reports there is counted, no further call is made, and the turn is recorded as `cancelled` with what it used.
- A call that breaks off, fails or is cut is counted with the usage its provider had reported by then: Anthropic reports its input tokens when the message starts and its output as it goes, OpenRouter's responses and OpenAI's chat completions only at their end. A call that broke off or failed before any input was reported is counted an estimate of its input, the request's UTF-8 bytes over 4 (`BYTES_PER_TOKEN`); one the provider refused with an error status, none.
- A call that fails ends the turn. A network error, an abort, or a stream that breaks off or reports an error is `cancelled` when the client went away, `time_limit` when the message's time ran out, and otherwise `model_error`. Any other error is a defect: it is logged as `internal` and not recorded.
- A tool whose arguments are not JSON, or that refuses, answers the model with a sentence it can act on, marked as an error; a read PostgREST does not answer says to try again.

### Tools

- `list_decks`, `list_cards` and `search_cards` — `mcp`'s own, with its definitions, through the caller's token ([`mcp.md`](mcp.md) §Tools).
- `propose_deck` (`name`, `groups`) and `propose_cards` (`deck_id`, `groups`) — new cards, for a new note or one of the user's live notes: 1 to 20 groups, each `{title, format, cards}`, 100 cards at most over them, each card in `add_cards`' form. Each card is read as `add_cards` reads it; one whose card key matches a card of the note or an earlier card of the proposal is left out as a duplicate; one without a block of its group's format is refused; a group with no card left is dropped. Over 100 cards is refused whole.
- `propose_changes` (`deck_id`, `title`, `cards`) — changes to up to 100 live cards of one note, each in `update_cards`' form and read as it reads them, as one `mixed` group.
- `regenerate_group` (`proposal_id`, `group_id`, `format`, `cards`) — remakes one group of a proposal of new cards that the conversation holds, or that this message showed, in the format, under the group's id and title; the proposal's other groups are kept as they were, and a card repeating one of theirs or the note's is left out.
- `ask_choice` (`prompt`, `options`) — sends a `choice` and ends the turn.
- The proposal tools write nothing. Each answers the model the proposal's and groups' ids and sizes, the cards left out and refused with their group and index, and that nothing is saved until the user adds it; a proposal of no card is refused with the reasons and sends nothing.

### Proposals

- A proposal is `{id, kind, deck: {id, name}, groups: [{id, title, format, cards: [{id, card}]}]}`, each id a version 7 uuid the function made:
  - `kind` `cards`, new cards, for a new note when `deck.id` is null; or `changes`, whose card ids are the cards' own;
  - `format` a 칸 type every card of the group holds, `text`, `senses`, `cloze`, `table` or `image`, or `mixed`;
  - `card` exactly what `add_cards` or `update_cards` takes, so a client draws it as `add_cards`' union.
- The server keeps no proposal: the client sends it back in the next turns and in the commit.

### Commit

- The commit reads the proposal, and the cards whose ids `checked` names under their group, each group's at most once; a group or card the proposal lacks, or no card checked, is `400`.
- It writes them as the caller, through the shared write path and its refusals: a new note through `create_deck` and then `add_cards`; cards for a note through `add_cards`; changes through `update_cards`. A whole refusal is `422`; otherwise `200` with `deck` and the write tool's answer, its cards added, skipped and refused.
- A commit sent twice adds no duplicate to a note, by `add_cards`' duplicate rule, but makes a second new note.

### Providers

- One adapter per provider in `providers.ts`, each streamed and read event by event; a read that stops before the body ends, at `[DONE]`, an error or a break, cancels the body, closing the connection:
  - **OpenRouter** — its Responses API (`/api/v1/responses`), stateless, with the prompt as `instructions`, the tools as functions, `reasoning.effort` the configuration's, `none` included, and with web search on, the `openrouter:web_search` server tool on the Exa engine with `max_uses` ([ADR 0190](adr/0190-serve-the-assistant-from-an-edge-function-that-streams-a-tool-loop-proposes-cards-in-groups-and-commits-what-the-user-checks-under-a-per-plan-daily-limit.md) records why not chat completions). Citations come from `url_citation` annotations. Only a `function_call` item is a call the function runs; a server tool's item, such as `openrouter:web_search`, is not. Every output item, those included, is sent back in the next call.
  - **OpenAI** — chat completions with the tools as functions and `reasoning_effort` unless it is `none`; it has no native search, so a configuration on it searches nothing.
  - **Anthropic** — messages with the tools, version `2026-10-21`, thinking adaptive with `output_config.effort`, or off at `none` as Anthropic's per-model table turns it off: `between_tools` on Claude Sonnet 5.5, `disabled` on the others. With web search on, it sends `web_search_20250305` and `web_fetch_20250910`, the basic variants every current model takes, each with `max_uses`. Web fetch also takes `max_content_tokens` 20,000 (`MAX_FETCH_TOKENS`) and fetches no URL found only in a function tool's answer (`url_sources`). Citations come from `citations_delta`; every block of a call, thinking with its signature, is sent back as it came.
- **Searches a turn.** The configuration's searches are a message's, shared by its calls and by Anthropic's web fetches: each call is offered those the earlier calls left, as each search tool's `max_uses`, and none once they are spent. One call may use what is left on each of Anthropic's two tools.
- Usage per call: input and output tokens; reasoning tokens, which the output tokens include, from OpenRouter's `output_tokens_details.reasoning_tokens`, OpenAI's `completion_tokens_details.reasoning_tokens` or Anthropic's `output_tokens_details.thinking_tokens`; searches from OpenRouter's `server_tool_use_details.web_search_requests` or Anthropic's `server_tool_use.web_search_requests`. Anthropic's web fetches, which cost only tokens, count against the searches a turn but are not recorded. A message's usage is the sum.

### Configuration and budget

- A configuration of an Anthropic model that cannot run at its effort by the per-model table is refused when saved: `none` on a model whose thinking is always on, or another effort on one with extended thinking alone ([`server.md`](server.md) §Assistant).
- The provider, model, prompt, web search, searches a turn and reasoning effort are the caller's plan's assistant configuration's, read at each message through `begin_assistant_message`: an admin, on 스페셜, is served 스페셜's draft while one is set ([`server.md`](server.md) §Assistant). Keys are Vault's, read through `_shared/keys.ts` and kept 60 s.
- The seed serves each plan on its photo configuration's provider and model, OpenRouter's `anthropic/claude-haiku-5.5` in production by ADR 0182's context, with no reasoning, or effort `low` on a model whose thinking is always on, 3 searches a turn, and web search off for Free and on for Pro, Max and 스페셜, the PM's default the owner may change.
- **The budget** ([ADR 0195](adr/0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md), superseding ADR 0190's daily message limit). Each plan has a daily token budget in Asia/Seoul, approved by the owner on 2026-11-05 as Free 200,000, Pro 2,000,000, Max 6,000,000 and 스페셜 none.
  - A message starts, before any model call, only when its provider has a key, the day's tokens charged are under the budget, and no other message of the user is running; it is refused `rate_limited` or `busy` otherwise.
  - It is charged when it ends, through `finish_assistant_message`, before its `usage` event: its input and output tokens summed over its calls, the output including the reasoning tokens, not weighted by price. The message that crosses the budget is charged whole: at most 8 calls, each at most 8,192 output tokens over an input the model's context window bounds.
  - A client refused `busy` sends the message again after a few seconds; a message its client cancelled stays running until its call ends and is recorded.
  - The check and the charge run under the user's lock ([`server.md`](server.md) §Assistant). A failed record leaves the answer standing, the message uncharged, and the log says so.
  - Web searches are not charged against the budget; a turn's searches stay capped by its configuration.

### Draft

- `POST /functions/v1/assistant/settings/configuration` with `{plan, provider, model, prompt_version_id?, web_search, max_searches, reasoning_effort}` saves an admin's draft of a plan's assistant configuration, as extract-cards' `settings/configuration` saves a photo draft ([`ai-extraction.md`](ai-extraction.md), [ADR 0195](adr/0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md)):
  - the caller is authenticated and must be an admin, as `admin_ai_session` answers it; no recent sign-in is asked;
  - the body names a plan, a provider, a model in its provider's form, web search, 1 to 10 searches a turn and an effort; a prompt version is optional, the draft keeping the one it had, or else the active one's;
  - a model that cannot run at the effort by Anthropic's per-model table is refused before any call, as the database asks it through `assistant_effort_fits` ([`server.md`](server.md) §Assistant);
  - one call with the provider's key in Vault, the model, the effort, the tools and web search as the draft has them, through the provider's adapter, read to its end, at most 30 s (`CHECK_TIMEOUT_MS`); only when it answered is the draft saved, through `save_assistant_configuration`.
- It answers `200` `{saved: true, configuration_id}`, or `{error}`: `400` `bad_request`, also when the database refuses the draft; `400` `effort_unsupported`; `401` `unauthenticated`; `403` `forbidden`; `409` `no_key`; `422` `key_refused`, `model_not_found` or `call_failed` when the check call failed; `503` `unavailable` when Supabase did not answer.

### Log and privacy

- The conversation is not stored: the server keeps a message's record and usage, never its text, a card or a reply.
- Each request logs one JSON line: `route` (`message`, `commit` or `settings`), `user_id`, `plan`, `provider`, `model`, `model_calls`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `web_search_requests`, `latency_ms`, `outcome_recorded` and `outcome`, each null where it does not apply; never the token, a key, a message or a card. A stream logs its line when it ends.

### Tests

- `supabase/functions/assistant/handler_test.ts` — the function end to end with Auth, PostgREST, the RPCs, Vault and the providers replaced by a fake applying row-level security's owner rule: the stream's events with `usage` last and the record; the call limit against a loop the model ends; a proposal of refused cards sending nothing and telling the model why, against one shown with a duplicate of the note left out and nothing written; 100 cards against 101 refused whole; a group's format refusing a card against `mixed`; a choice ending the turn; a group remade with the other kept as it was; a commit of the checked cards alone, of a new note, and of a card its group lacks and another user's note refused against the user's own; the day's budget spent refused before any model call against one token left, the message that crosses it charged whole; a message while another runs refused as `busy` against one after it; the record made before the `usage` event, so the next message starts at once; a provider without a key unrecorded; citations once each; a turn's searches shared by its calls and the search tool dropped once spent, and Anthropic's fetches sharing them; a failed call's `error` and record; a paused call sent again; the open note named; the refusals before the count; a client that goes away recorded as `cancelled` and charged the usage its OpenRouter stream reports after it went, against one that stays; the time limit before a call and during one, against a call just inside it and one that fails in time; a cut reply against a whole one; a programming error, and an adapter failing to build its request, surfacing unrecorded against a network error; the body, turn and text caps against their limits; a turn of one largest proposal described with its fronts, of two with one front a group and every id, of thirty with the rest counted, against a question no tool sends refused; the longest reply resent shortened to its head and tail, against a user turn over the cap refused; a failed call charged the tokens reported before it failed, and one that broke off before any its request's input as an estimate, against one the provider refused charged nothing; a history of the longest replies at every turn never refused for its size, against a body over `MAX_REQUEST_BYTES`; and the draft route: a draft saved after its check call with every setting, one from a user who is not an admin or no one refused before any call, invalid bodies refused, a model that cannot run at its effort refused as `effort_unsupported` before any call, and a check call refused, failed or unreachable, or no key, saving nothing, each against one saved.
- `supabase/functions/assistant/providers_test.ts` — each adapter's request: web search sent only when on, with the cap, OpenAI with none, web fetch's content cap and URL sources, and each reasoning setting, Claude Sonnet 5.5's `between_tools` among them; and each stream read: text, tool call pieces, reasoning and thinking tokens, searches and fetches, citations, a responses stream's function call apart from a server tool's item, a cut, failed or unfinished response, a thinking block's signature, a pause, an error event, a chat stream cut before it finished, a body that breaks off, events split across chunks, a failed stream carrying the usage reported by then, and the body cancelled when a read stops at `[DONE]`, an error or a break, against one read to its end.
- `supabase/tests/assistant_test.sql` — the schema's side ([`server.md`](server.md) §Tests).

## Rationale

- [ADR 0190](adr/0190-serve-the-assistant-from-an-edge-function-that-streams-a-tool-loop-proposes-cards-in-groups-and-commits-what-the-user-checks-under-a-per-plan-daily-limit.md) records the function, the stream, the loop's limits, the tools and proposals, the commit through the shared write path, the provider mapping, and why the configuration, prompts and limit are tables of their own; epic #711 and issue #713 record the owner's and the PM's decisions.
- [ADR 0195](adr/0195-meter-the-assistant-by-a-daily-token-budget-per-plan-charged-when-a-message-ends-shorten-a-resent-reply-and-save-a-draft-after-a-check-call.md) records the daily token budget that superseded the message limit, why tokens are not weighted by price, why a user's messages do not run at once, why a resent reply is shortened rather than bounded, and the draft's check call; issues #748 and #746 record the owner's and the PM's decisions.

## Open questions

- Whether the PM's defaults hold once the owner prices them: web search on for paid plans, no reasoning, Haiku 5.5 for every plan (#713's PR).
- Whether tokens should be weighted by price once a plan's spend shows plain tokens do not track it.
- The admin pages for the budgets and the configuration are #713's next pull request.
- The tools the PM's comment on #713 lists that are not built: reading the study record and labels, and a photo attached in the chat read through `extract-cards`.
