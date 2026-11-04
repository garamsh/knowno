# ADR 0190: Serve the assistant from an Edge Function that streams a tool loop, proposes cards in groups and commits what the user checks, under a per-plan daily limit

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Epic #711**, the owner of 2026-11-04: 말랑이 becomes an assistant that talks with the user "like ChatGPT" and builds notes and cards, for every user with per-plan limits. The PM's decisions on the epic bind it: one Edge Function, `assistant`, in the same project, its card tools the `mcp` function's own code; writing tools that propose and do not write, saved only on the user's "추가"; replies streamed as server-sent events; the conversation kept on the device and sent with each message; the provider, model and prompt per plan in admin, as #702 made the photo configuration; a per-plan daily message quota, enforced on the server as photos are, defaults Free 10, Pro 100, Max 300, 스페셜 unlimited; a bounded tool loop and output.
- **Issue #713**, with the PM's additions of 2026-11-04: reasoning is a model setting, a reasoning effort per configuration; web search is the provider's own server tool, OpenRouter's `openrouter:web_search` or Anthropic's web search and web fetch tools, mapped by one adapter per provider, with no search API of the project's own; usage records reasoning tokens and search requests; citations stream as their own event; a `choice` event for a question with options; proposals in groups, each in one 칸 format, one group regenerated alone; a commit of the cards checked per group.
- **Limits** (the epic's comment of 2026-11-04 cites the Supabase docs): 2 s of CPU per request, async I/O excluded, and 150 s of wall clock on the Free plan, 400 s on paid ones.
- **#702 (ADR 0182)** made each plan's photo configuration a provider, model and prompt version, append-only, with an `active` label for users and one draft, `test`, for admins, applied as a unit.
- **OpenRouter's documentation, read 2026-11-04** (`https://openrouter.ai/docs/llms.txt` and the pages it indexes):
  - "Server Tools" (`/docs/guides/features/server-tools`) and "Web Search" (`/docs/guides/features/server-tools/web-search`) show every request carrying `openrouter:web_search` on `/api/v1/responses`.
  - The Responses API reference ("Create a response", `/docs/api/api-reference/responses/create-a-response`) documents the tool in the request (`WebSearchServerTool_OpenRouter`, with `max_uses`). It documents its activity as an output item of type `openrouter:web_search` (`OutputWebSearchServerToolItem`), apart from a `function_call`, and that item as an accepted input. It documents citations as `response.output_text.annotation.added` events and searches as `usage.server_tool_use_details.web_search_requests`.
  - The Chat Completions reference ("Create a chat completion") lists the tool among a request's `tools`. Its stream delta documents no annotations and no server-tool activity, and its tool call delta's type is `function` alone. The Responses API guide's "Web Search" page (`/docs/api_reference/responses/web-search`) says the tool "works with both the Chat Completions and Responses APIs".
  - The Anthropic Messages reference ("Create a message") documents the tool too, as Anthropic-format `server_tool_use` blocks.
- **Anthropic's documentation, read 2026-11-04:**
  - "Troubleshooting thinking" (`platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting`), §"Thinking support, defaults, and rejected configurations by model", is the per-model table. Claude Fable 5.1, Fable 5, Mythos 5.1, Mythos 5, Mythos Preview and Opus 5.5 reject `thinking: {type: "disabled"}`; their thinking is always on. Claude Sonnet 5.5 rejects it and takes `between_tools` in its place. Claude Haiku 5.5 and Opus 5 take it at effort `high` or below. Claude Opus 4.5, Haiku 4.5 and Sonnet 4.5 reject `adaptive`; the earlier Claude 4 models have extended thinking only.
  - "Extended thinking", §"Budget rules and tuning": `usage.output_tokens_details.thinking_tokens` counts the output tokens that were thinking, and a stream sends it on the final `message_delta`.
  - "Web fetch tool": `max_uses`, `max_content_tokens` (§"Content limits"), and `url_sources` (§"URL sources"), whose `client_tool_results: {type: "none"}` keeps a URL in a client tool's result from being fetched, as §"Web fetch tool" advises against exfiltration. Fetches have no charge beyond tokens (§"Usage and pricing") and are counted as `server_tool_use.web_fetch_requests`.
- **Alternatives considered:**
  - **The assistant's configuration as rows of `private.ai_configurations`** with a purpose column. Every function reading those rows and their labels, `begin_extraction` and the five admin functions among them, would need the purpose, the labels' key would change, and the migration would rewrite existing rows. Rejected: two tables of the same shape keep the photo path untouched and the migration additive.
  - **The daily limit as a column of `private.plan_versions`.** A version's terms renew monthly and change only in the users' favour (ADR 0097), and every function reading versions would change. A daily message count has no renewal to protect, and the epic asks for it to be edited on 요금제 as one number per plan. Rejected: one row per plan in `private.assistant_limits`, each change recorded.
  - **The assistant's prompts as rows of `private.prompt_versions`.** That store is the photo prompts': admin's 프롬프트 list shows each of its versions as one a photo draft may name, and its tests hold the photo prompts as the whole store (`prompts_test.sql` and `prompt_v9_activation_test.sql` failed with the assistant's prompt in it). Rejected: `private.assistant_prompts` has the same shape and append-only trigger.
  - **Keeping the proposal on the server** between the message and the commit. The epic keeps the server stateless per request. Rejected: the client sends a proposal back to regenerate a group or to commit, and the commit writes through `add_cards` or `update_cards` as the caller, so a proposal the client altered can do no more than the user could through MCP.
  - **Calling the provider without streaming** and sending each step whole. Rejected: the client renders 말랑이's text as it arrives.
  - **OpenRouter's Chat Completions with its web search server tool.** Its stream documents neither citations nor how server-tool activity arrives. Rejected: Responses documents both.
  - **OpenRouter's Anthropic Messages API**, which the Anthropic adapter's reader could read. Its reference is written for Anthropic's models, and a plan's configuration may name any model on OpenRouter. Rejected: Responses is OpenRouter's API for every model, and the one its server-tool guides show.

## Decision

- **The function.** `supabase/functions/assistant/` serves two requests with the user's token, `verify_jwt` on: a message, answered as server-sent events, and a commit, answered as JSON. It imports the card tools from `_shared/` and moves `keys.ts`, Vault's key read, there from `extract-cards`.
- **A message** carries the recent turns, at most 40, each at most 4,000 characters, an assistant turn with the proposals and the choice it showed, and the open note. A turn with its proposals and choice described is at most 16,000 characters, each card front shown cut to 80; past it the proposals are described shorter, down to their sizes, so a turn the server sent always fits. The server keeps nothing about the chat.
- **The loop.** Each model call streams; the function's tools run between calls; at most 8 calls and 120 s a message, each call's answer at most 8,192 tokens. A call the provider paused is sent again. The turn ends when the model ends it, asks a choice, reaches a limit, is cut at the output limit, or the client goes away, which aborts the call and records what the turn used.
- **The events:** `text`, `citation`, `proposal`, `choice`, `error` (`model_error`, or `cut`), and `usage` last, with the outcome, the tokens, reasoning tokens, searches, the day's limit and messages.
- **The tools:** `list_decks`, `list_cards` and `search_cards`, shared with `mcp`; `propose_deck`, `propose_cards` and `propose_changes`, which read their cards as `add_cards` and `update_cards` do, leave out duplicates, hold at most 100 cards and write nothing; `regenerate_group`, which remakes one group of an earlier proposal and keeps the others; and `ask_choice`.
- **A proposal** is `{id, kind, deck, groups: [{id, title, format, cards: [{id, card}]}]}`, each card exactly what `add_cards` or `update_cards` takes, each group's format a 칸 type every card holds, or `mixed`.
- **The commit** takes the proposal and the checked card ids per group, and writes them through `create_deck` and `add_cards`, or `update_cards`, as the caller, with their refusals.
- **Web search and reasoning** map to each provider's own:
  - OpenRouter through its Responses API: `openrouter:web_search` on the Exa engine with `max_uses`, and `reasoning.effort`. Only a `function_call` item is a call for the function to run; a server tool's item goes back as it came.
  - Anthropic: `web_search_20250305`, and `web_fetch_20250910` with `max_uses`, `max_content_tokens` 20,000 and URL sources without client tool results. Thinking is adaptive with `output_config.effort`, and turned off at `none` as the per-model table says: `between_tools` on Claude Sonnet 5.5, `disabled` otherwise. Reasoning tokens are `thinking_tokens`.
  - OpenAI's chat completions with `reasoning_effort` and no search.
- **Searches a turn.** A configuration's searches are a message's, shared by its calls and by Anthropic's web fetches: each call is offered those left, as each tool's `max_uses`, and none once they are spent.
- **The configuration** per plan is a row of `private.assistant_configurations`, append-only: provider, model, prompt version of `private.assistant_prompts`, web search, searches a turn (1 to 10) and reasoning effort (`none`, `low`, `medium`, `high`), labelled `active` and `test` as ADR 0182's are. A model of Anthropic's that cannot run at the effort, by the per-model table, is refused when saved and by the table. It is seeded on each plan's active photo provider and model, with search off for Free and on for Pro, Max and 스페셜, 3 searches and no reasoning, or effort `low` where the model's thinking is always on.
- **The limit.** `begin_assistant_message` counts a message under a per-user advisory lock seeded with 7, only when the provider has a key, against the plan's daily limit in Asia/Seoul; `finish_assistant_message` records what the turn used. The migration is additive and its revert drops what it made.
- **Admin.** The database functions for reading and setting the limits, saving and reading prompts, and saving, applying and ending a draft land here; the admin pages, and the function's check call that saves a draft, follow in the next pull request of #713.

## Consequences

- One message is one count, whatever its tool calls; a long request is proposed over several messages.
- A configuration with web search on costs each search beside the tokens, at the provider's price; the owner approves a plan's search.
- The photo path is untouched: `extract-cards` changes only in where it imports `keys.ts` from.
- A proposal's cards are the model's input form, so a client draws them as `add_cards`' union.
- A commit sent twice adds no duplicate to an existing note, by the duplicate rule, but makes a second new note.
- Jobs that run for minutes, such as reading many photos into a note, do not fit a message; they go to a queue with workers when they come (#711's comment of 2026-11-04).

## Signs the decision was wrong

- Turns end at 8 calls or 120 s often enough that users see `depth_limit` or `time_limit`.
- Operators keep the same text in both prompt stores and change it in one but not the other.
- Users commit proposals that the client altered in ways the server should have prevented, which a stored proposal would have.
- A plan's limit needs a monthly period or a favour rule, which versions would have given it.
