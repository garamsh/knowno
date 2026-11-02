# MCP

The `mcp` Edge Function, knowno's remote MCP server for Claude and ChatGPT: its transport, its authorization through the project's OAuth server, its five tools, the rows it writes, and the web's consent page and settings entry it relies on. The schema and the deploy path are [`server.md`](server.md)'s; the web's account pages are [`web-account.md`](web-account.md)'s.

## Current decisions

### Transport

- `supabase/functions/mcp/` answers Streamable HTTP at `/functions/v1/mcp`: one JSON-RPC request per POST, answered with one JSON object; a notification or a response with 202 and no body; GET and DELETE with 405 ([ADR 0126](adr/0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md)). It mints no `Mcp-Session-Id` and keeps nothing between requests.
- It serves the protocol versions that open with `initialize`: 2025-11-25, 2025-06-18 and 2025-03-26. `initialize` answers the version offered when it is one of them and 2025-11-25 otherwise, with the `tools` capability, `serverInfo` naming it `knowno`, and a short instruction for the model. A request whose `MCP-Protocol-Version` names another version is refused with 400; one without the header is served.
- A request carrying an `Origin` header is refused with 403: Claude and ChatGPT call from their servers, and no browser is a client.
- It imports nothing but `supabase/functions/_shared/auth.ts`'s types; the MCP SDK is not used.
- `initialize` also names the `resources` capability: `resources/list` and `resources/read` serve one resource, `knowno://guide/card-forms`, which says which form fits what ([ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)).

### Authorization

- The project's Supabase Auth is the authorization server, through its OAuth 2.1 server (beta, on every plan), with dynamic client registration on. Claude and ChatGPT register themselves by DCR, since it advertises no Client ID Metadata Document support. The verification is #496's comment of 2026-10-29.
- The server's address is `https://api.knowno.app/functions/v1/mcp`, on the project's Supabase custom domain; the project's own `https://jaxltcczmioxrineznfu.supabase.co/functions/v1/mcp` serves it too ([ADR 0133](adr/0133-serve-the-mcp-server-at-api-knowno-app-name-a-listed-host-as-its-resource-and-auth-s-issuer-as-its-authorization-server.md)).
- `/functions/v1/mcp/oauth-protected-resource` is the protected resource metadata: the function's public URL as `resource`, Supabase Auth's issuer as its one authorization server, `header` as the bearer method, and `knowno` as `resource_name` ([ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md)).
  - The project's origin is `SUPABASE_URL`'s, which `config.ts` parses once as an http(s) URL; any other value leaves the function unconfigured, every request answered 503.
  - The public URL is the optional secret `MCP_PUBLIC_URL`, which `config.ts` reads once and requires to be an https URL ending in `/functions/v1/mcp`; production sets `https://api.knowno.app/functions/v1/mcp`. Without it, the URL is the project's origin plus that path. A value set but invalid leaves the function unconfigured, every request answered 503. No request header is read: the custom-domain gateway does not forward the client's host.
  - The issuer is `<project origin>/auth/v1`: Auth keeps it on the project's host under the custom domain, and RFC 8414 requires the advertised authorization server to equal it.
  - A local stack names its runtime's `SUPABASE_URL`.
- Any other request without a token the function accepts is answered 401 with `WWW-Authenticate: Bearer resource_metadata="…"`, and with `error="invalid_token"` and a description when a token was sent. `config.toml` sets `verify_jwt = false` for the function so these answers reach the client.
- A token is accepted when its payload carries a `client_id` claim, which only the OAuth server issues, and Supabase Auth's `/auth/v1/user`, asked with the anon key, accepts it for a non-anonymous user whose id is the token's `sub`. The phone's and the web's sessions carry no `client_id` and are refused before Auth is asked. Every Supabase token has `aud: authenticated` and the `resource` parameter is not reflected in it, so the claim stands for the audience the MCP specification asks for; it holds while every OAuth client of the project is an AI connector.
- The consent page is the web's `/oauth/consent` (§Consent page). Approving binds an authorization code to the user; the client exchanges it with its PKCE verifier for an access token and a refresh token.

### Tools

- Every read and write goes to PostgREST with the user's token and the anon key, never the service-role key, so row-level security decides each row. Each also filters on the caller's `user_id` and `deleted_at is null`, since the select policy lets a signed-in user read another's public deck.
- `list_decks`: the user's live decks, oldest first, with their live card counts.
- `list_cards`: one deck's live cards, oldest first, by `offset` and `limit` (1 to 100, 50 when absent), each as its `id` and `blocks`, with the deck's total and `next_offset`, null on the last page.
- `search_cards`: the user's live cards across their decks with a 칸 holding the query, revealed, an answer, an example and a box's answer included, ignoring case, width and spacing ([ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md)); at most `limit` (1 to 100, 20 when absent), each with its `blocks` and deck, with `truncated`. It reads every live card of the user's per call.
- A card is returned as `blocks` in `add_cards`' union, a card of two sides converted as the clients read it. A label is its short form. A stored photo names `media`, `width` and `height` in place of `url`, a sound is an `audio` block of `media`, `duration_ms` and `side`, a block of a later version is `{"type": "unknown", "stored_type": …}`, and a card that does not parse is one such block of `unreadable`.
- `create_deck`: a private deck of the given name, trimmed, 1 to 500 characters, under a version 7 id. Decks of the same name are not checked for.
- `add_cards`: up to 100 cards for one live deck of the user's; a call with more is refused whole and writes nothing. Each card is `{"blocks": [칸, …]}`, 1 to 100 of them, a union on `type` of `text` (`front`, `back`), `senses` (`term`, `senses`, `ask`), `cloze` (`text`, `answers`), `table` (`columns`, `rows`, `blanks`, `spans`) and `image` (`url`, `boxes`, `side`); or the plain `front` and `back`, with labels and examples, which becomes one 글, or a 단어 when it has either.
  - Each text is at most 2000 characters, a sense holds at most 10 labels and 10 examples, and a 단어 at most 20 senses.
  - A card is refused, by its index and why, when a block breaks `deck.md`'s rules or the card shows nothing before the reveal or adds nothing by it, which the function reads as the clients do (`frame.ts`). A reason names the block by its index and says what its type must hold.
  - A card whose card key matches a live card in the deck, or one earlier in the call, is skipped as a duplicate, with the matching card's id, unless `allow_duplicates` is true. The answer lists the cards added, with their ids, skipped and refused.
- A photo is fetched from its `url`, at most 10 a call, a later card refused with what to do ([ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)):
  - `https` only, no credential in the URL, and the user's token never sent;
  - before every hop, a host's every address, or the literal it names, is public: IPv6 is held to global unicast, so IPv4-mapped and NAT64 forms are refused;
  - at most 3 redirects, 10 seconds for the whole fetch and 10 MiB, by the header and by the bytes read;
  - the `Content-Type` and the opening bytes both name the same one of JPEG, PNG and WebP, and the file's own header gives its width and height, a JPEG's turned by its Exif orientation;
  - a failure refuses that card alone, with a sentence naming what to do, and a duplicate's photo on the back is not fetched.
- Nothing edits or deletes. A refusal is a tool result with `isError: true` and a sentence the model can act on, naming the tool to call or the limit to keep; an unknown tool's names the five. A request PostgREST does not answer is such a result too, saying to try again.
- Each request logs one line: the user's id, the JSON-RPC method, the tool, and the outcome; never the token or a card.

### Rows written

- A card is written as the web's `encodeCells` writes one ([`web-decks.md`](web-decks.md) §Authoring): `free` v2, its 칸 in `front`, `[]` in `back`, each block with a version 7 id, a box with one of its own. A label that is a part of speech's short form, such as 명 or 동, is stored as that part of speech and any other as an `other` label, as direct entry reads typed labels.
- A photo is stored as it came, as the phone's upload stores one: its `media` row, then its file at `{owner}/{media id}` through the Storage API, with the user's token ([`server.md`](server.md) §Media storage). A file Storage refuses takes its row back and refuses the card. A card refused after an earlier photo of it was stored, and a call whose insert fails, leave files no card names.
- Each card takes the card key `frameKey` gives on both clients, `source` `import`, as photo import's cards, and `created_at` and `updated_at` at the call's time, each card one millisecond after the one before, so a deck lists a call's cards in its order. The cards of a call are inserted in one statement.
- A deck is written `private`, with the user's id and the call's time as both times.
- The server sets every revision, so the phone pulls these rows as any other ([`sync.md`](sync.md)).

### Consent page

- `/oauth/consent?authorization_id=…` (`web/src/app/oauth/consent/`) reads the request from Supabase Auth on the server with the user's session, which binds it to the user, under `<Suspense>` with the page's skeleton, since it reads the request; an id that is not 1 to 128 letters, digits, `_` or `-` is refused before any request.
- It asks "{app}에 연결할까요?", the app's name as the client registered it, or "이 앱", over one group, "연결 내용": the account's email, the host the browser returns to and "덱과 카드를 읽고 새 덱과 카드를 추가해요. 지우거나 고치지는 않아요". For `localhost`, `127.0.0.1` or `[::1]` it adds that the address is a program on this computer, to connect only to one the user started.
- "취소", quiet, then "연결", the one primary fill, last. Each answers from the browser through `@supabase/ssr`'s browser client, as sign-in starts there, and sends the browser on to the address Supabase Auth returns; while an answer is on its way neither can be pressed again, and a refused answer says "연결하지 못했어요. AI 앱에서 다시 연결해 주세요." and keeps both.
- A request the user allowed before is answered by Supabase Auth with its address, and the page sends the browser there at once. An unknown or expired request says "연결 요청을 찾을 수 없어요. AI 앱에서 다시 연결해 주세요."; while Auth cannot be reached, the screen error of 설정 with "다시 시도".
- A signed-out visitor is sent to `/login` as from any page, and the proxy keeps the request's id in the cookie `smartman-oauth-consent`, HTTP-only, `SameSite=Lax`, for ten minutes, as long as Auth keeps an authorization open; when sign-in lands on `/`, the proxy opens the consent again and deletes the cookie ([`web.md`](web.md) §Session and proxy).

### Settings entry

- 설정 holds "AI 연결" between 학습 and 화면, drawn in the signed-in and the unreachable states, since it needs no server: one group with "서버 주소", `https://api.knowno.app/functions/v1/mcp` in every environment ([ADR 0133](adr/0133-serve-the-mcp-server-at-api-knowno-app-name-a-listed-host-as-its-resource-and-auth-s-issuer-as-its-authorization-server.md)), then "Claude" and "ChatGPT", each with how to add it, and under the group what a connection may do and that each service's plan limits it ([`web-account.md`](web-account.md)).

### Tests

- `supabase/functions/mcp/frame_test.ts` — every case of `supabase/fixtures/card-frame/` converted and held to validity as the app and the web read them, the card key of each 칸 type, a later block, and search reading every 칸 revealed.
- `supabase/functions/mcp/photo_test.ts` — the fetch with the network and the lookup replaced: public and refused addresses, each refused form before any request, a host with any private address, a redirect refused at its hop against one followed, the redirect limit, the size cap by header and by stream, the type by header and by bytes, the deadline, and each format's size.
- `supabase/functions/mcp/handler_test.ts` — the server end to end with Auth, PostgREST and Storage replaced by a fake applying row-level security's owner rule: the 401 challenges, a web session refused before Auth is asked, the metadata of a local-style `SUPABASE_URL`, the challenge and metadata with `MCP_PUBLIC_URL` set and Auth's issuer, the project's host named without it whatever the forwarded host, an `MCP_PUBLIC_URL` that is not an https URL ending in the function's path, a `SUPABASE_URL` that is not an http(s) URL, `initialize`, notifications, GET, `Origin`, the protocol version header, each tool, the guide resource, the 100-card cap, duplicates in the deck and in the call and `allow_duplicates`, refused cards with the fixtures' validity, the rows of every 칸 type, a stored photo's row, file and block, a refused fetch, a refused file taking its row back, the ten-photo limit, reading blocks back, another user's public deck refused for reading and writing, a call's order, and an unreachable database.

Each line names a file and what it covers; the file holds the cases. The consent page's, the settings entry's and the proxy's tests are listed in [`web-account.md`](web-account.md) and [`web.md`](web.md).

## Rationale

- [ADR 0126](adr/0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md) records the transport, the `client_id` check in place of an audience, the tools, the rows and the consent flow.
- [ADR 0133](adr/0133-serve-the-mcp-server-at-api-knowno-app-name-a-listed-host-as-its-resource-and-auth-s-issuer-as-its-authorization-server.md) records the custom domain, why the authorization server is a constant issuer, and the host named as the resource, which [its erratum of 2026-11-01](adr/0133-serve-the-mcp-server-at-api-knowno-app-name-a-listed-host-as-its-resource-and-auth-s-issuer-as-its-authorization-server.md#errata) moved from a forwarded-host list to `MCP_PUBLIC_URL`.
- [ADR 0134](adr/0134-name-the-app-knowno-serve-it-at-knowno-app-identify-it-as-app-knowno-and-reach-the-backend-at-api-knowno-app.md) records the server's name, `knowno`.
- [ADR 0122](adr/0122-create-decks-and-reviewed-cards-on-the-web.md) records direct entry, whose rows and duplicate rule the tools follow.
- [ADR 0114](adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md) records the free template every new card takes.
- [ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md) records the 칸 frame and its one input format.
- [ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md) records the union's read form, the photo fetch and its bounds, and why a PNG or WebP is stored as it came.

## Open questions

- Whether a Custom Access Token Hook should set `aud` to the function's URL for tokens carrying `client_id`, in place of the claim check; it needs a migration.
- Whether to serve protocol revision 2026-07-28 once Claude or ChatGPT speaks it.
- Whether to pin a fetch to the address it checked: the check and the connection each look a host up ([ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)).
