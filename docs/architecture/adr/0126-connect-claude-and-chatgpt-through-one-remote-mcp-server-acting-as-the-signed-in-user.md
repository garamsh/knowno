# ADR 0126: Connect Claude and ChatGPT through one remote MCP server acting as the signed-in user

> Status: accepted; its resource and authorization server read from the gateway's forwarded origin and its settings entry's address superseded by ADR-0133; its card shape and its read tools' text superseded by ADR-0144; its "Nothing edits or deletes" superseded by ADR-0149
> Date: 2026-10-29

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

Issue #496: the owner asked for Claude and ChatGPT to work with a user's Smartman decks, and chose that cards made in the AI save straight into a deck, the AI client's confirmation of the tool call being the review. The PM fixed the stack (a Supabase Edge Function over Streamable HTTP, identity by Supabase Auth through OAuth 2.1, reads and writes through row-level security) and the five tools, and asked that the OAuth server be verified on the free plan before building.

The verification, posted on #496 on 2026-10-29 (issuecomment-6473796822), found Supabase's OAuth 2.1 server in beta on every plan at no charge, with dynamic client registration, S256 PKCE and public clients, which is what Claude's custom connectors and ChatGPT's connectors need. It also found every Supabase access token carrying `aud: authenticated`, the `resource` parameter accepted and not reflected, so the audience binding the MCP authorization spec (revision 2026-07-28) requires cannot be read from `aud`.

## Decision

- **One function, `mcp`, with no dependency.** It answers JSON-RPC over Streamable HTTP with one JSON object per POST, mints no session, answers GET with 405, and serves protocol versions 2025-11-25, 2025-06-18 and 2025-03-26, which open with `initialize`; a request naming another version in `MCP-Protocol-Version` is refused with 400, which a client speaking both eras reads as a server of the older one. It refuses any request carrying an `Origin`. It is written without the MCP SDK, as the other functions are written without dependencies.
- **Discovery from the function.** An unauthenticated or refused request is answered 401 with `WWW-Authenticate` pointing at the function's own protected resource metadata, `/functions/v1/mcp/oauth-protected-resource`, which names the function's URL as the resource and the project's Auth as the authorization server, both read from the gateway's forwarded origin. `config.toml` runs it with `verify_jwt = false` so that answer can be given.
- **A connector's token alone.** The function accepts a bearer token only when it carries a `client_id` claim, which only the OAuth server issues, and Supabase Auth accepts it; the phone's and the web's own sessions are refused. Every client registered on the project's OAuth server is an AI connector, so that claim stands for the audience until a Custom Access Token Hook can set `aud`, which needs a migration and is not built.
- **As the user.** Every read and write goes to PostgREST with the user's token and the anon key, never the service-role key, and filters on the caller's `user_id` besides, since a public deck of another user is readable through row-level security.
- **The tools.** `list_decks`, `list_cards` (one deck, by offset, up to 100 a page), `search_cards` (either side of every live card of the user's, a cloze or table card on its front alone), `create_deck` and `add_cards`. Nothing edits or deletes. A refusal is a tool result with `isError` and a sentence saying what to do.
- **Cards as direct entry writes them.** `add_cards` takes up to 100 cards per call and refuses a larger call whole. A card's front is a text block and its back a text block, or a senses block of one sense when it has labels or examples, labels read as direct entry reads them; `free` version 1, the phone's card key, version 7 ids, and `source` `import`, as photo import's cards, since a model wrote them. A front matching a live card in the deck, or one earlier in the call, is skipped unless the call allows duplicates, which mirrors direct entry's "그래도 추가"; no card is overwritten. The cards of one call are inserted in one statement, each a millisecond after the one before, so the deck lists them in the call's order. The server sets each revision, so the phone pulls them.
- **Consent on the web.** The OAuth server's authorization path is `/oauth/consent`. The page reads the request, which binds it to the signed-in user, and names the app, the host it returns to, the account and what the app may do, with a warning for a loopback host; "연결" and "취소" answer from the browser, as sign-in starts there. A request the user allowed before returns at once. A signed-out visitor is sent to `/login` with the request's id in a ten-minute cookie, and the proxy opens the consent again when sign-in lands on `/`.
- **The settings entry.** 설정 gains "AI 연결": the server's address and how to add it in Claude and in ChatGPT.

## Consequences

- No migration and no new web dependency. The owner applies the OAuth server's dashboard settings; the merge deploys the function, which has no secret of its own.
- Claude (claude.ai, Desktop, mobile) and ChatGPT register by DCR, since the server advertises no Client ID Metadata Document support; DCR registers a client per connection. Claude Code's loopback redirect on a random port is not matched by the authorization server, so Claude Code does not connect.
- A token any other OAuth client of the project held would be accepted. That stays true only while every client registered there is an AI connector.
- `search_cards` reads every live card of the user's per call, so its cost grows with the user's cards.
- A client that speaks only revision 2026-07-28 or later cannot connect until the function serves that revision.

## Signs the decision was wrong

- Claude or ChatGPT stops falling back to `initialize`, or needs the session or GET stream this server does not keep.
- The project registers an OAuth client that is not an AI connector, which makes the `client_id` check too wide.
- Users with many cards find `search_cards` slow.
- Duplicate cards accumulate because models set `allow_duplicates` unasked.
