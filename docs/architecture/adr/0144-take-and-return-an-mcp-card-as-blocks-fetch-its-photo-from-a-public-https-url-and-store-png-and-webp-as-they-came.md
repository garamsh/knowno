# ADR 0144: Take and return an MCP card as blocks, fetch its photo from a public https URL, and store PNG and WebP as they came

> Status: accepted; its files left by a card refused after a photo of it was stored and by a failed insert superseded by ADR-0170
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #531: the owner reported on 2026-11-01 that the AI makes only one card shape, since `add_cards` takes a text front and back (ADR 0126), and wants it to choose tables and photos where they fit. [ADR 0137](0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md) §One input format fixes the input: `{"blocks": [칸, …]}`, a 사진 by an https `url`. It leaves open how a URL is fetched, how a stored photo reads back and how a card of two sides reads in the union.
- The `media` bucket took `image/jpeg` alone among images (`20261027120000_media_audio.sql`), and the app's `mediaTypeOf` reads only JPEG among images when a public deck is copied ([ADR 0113](0113-copy-a-public-deck-s-photos-and-sounds-into-the-copier-s-own-media-under-new-ids-when-the-deck-is-copied.md)). The function imports nothing, so it holds no image codec ([ADR 0126](0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md)). The owner decided on 2026-11-02 to widen the bucket and that a copy keeps those photos.
- A URL a model passes is untrusted input to a server with outbound network access: a server-side request forgery surface.
- Until the migration of #549 runs, most live cards are `free` v1, so a read tool meets two side lists.
- Alternatives considered:
  - **Convert PNG and WebP to JPEG in the function.** It needs an image library, and a dependency-free encoder is not reasonable. The owner chose the bucket.
  - **Return a card's text alongside its blocks.** Two forms of one card for a model to read, and a text form a later block type would have to extend.
  - **Keep `search_cards` on a blank card's front alone.** ADR 0137 has it read every 칸, revealed.
  - **Connect to the checked address, pinning it.** It closes the gap between the lookup and the connection, below. It needs a client that takes an address beside a TLS name, which `fetch` does not.
  - **Accept a header of any image type, the bytes deciding.** A host that mislabels its files would be served, at the price of a looser rule for a case not met.

## Decision

### Blocks in and out

- `add_cards` takes each card as `{"blocks": [칸, …]}`, or the plain `front` and `back` with labels and examples, which becomes one 글, or a 단어 when it has either. A label is text in the union, read as direct entry reads typed labels. A box takes no id from a model; the function gives it one.
- Each 칸 is built as the web's `encodeCells` writes it and held to the frame's own reader, `supabase/functions/mcp/frame.ts`, a third implementation kept to the app's and the web's by `supabase/fixtures/card-frame/`. The union holds no sound, since no URL form of one was asked for.
- A refusal names the block by its index and says what the type must hold.
- `list_cards` and `search_cards` return each card's `blocks` in the same union, in place of `front` and `back` text. A card of two sides is converted on read, by the rule the clients read it by. A stored photo names its `media`, `width` and `height` where a written one names `url`, a sound reads as an `audio` block, and a block of a later version as `{"type": "unknown", "stored_type": …}`.
- A guide resource, `knowno://guide/card-forms`, and the tool descriptions say which form fits what.

### Fetching a photo

- `https` only, with no credential in the URL; the user's token is never sent.
- Before every hop, a host's every A and AAAA address, or the literal it names, must be public. IPv4 refuses private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges. IPv6 is held to global unicast, 2000::/3, without 6to4, Teredo and documentation, so IPv4-mapped and NAT64 forms are refused with no parsing of what they embed.
- At most 3 redirects, followed by hand so each hop is checked. 10 seconds for the whole fetch. At most 10 MiB, by the header and again by the bytes read.
- The `Content-Type` and the opening bytes must both name the same one of JPEG, PNG and WebP. The size comes from the file's own header, a JPEG's turned by its Exif orientation, since a client draws it so. Nothing decodes the image.
- A failure refuses that card alone, with a sentence naming what to do. A duplicate's photo on the back is not fetched.
- A call fetches at most 10 photos, a later card refused with what to do, so a call stays under the platform's wall clock.

### Storing it

- The file is stored as it came, as the phone's upload stores one: its `media` row, then the file at `{owner}/{media id}` through the Storage API, both with the user's token. A file Storage refuses takes its row back and refuses the card.
- The bucket accepts `image/png` and `image/webp`, by an additive migration. `mediaTypeOf` reads both, so a public-deck copy keeps those photos.
- A card records `free` v2, its 칸 in `front` and `[]` in `back`.

## Consequences

- A model can write every 칸 but 소리, and read what it wrote.
- ADR 0126's card shape and its read tools' text are superseded; the rest of it stands.
- The read tools' output changes shape: a client that read `front` and `back` reads `blocks`.
- The check and the connection each look a host up, so a host answering a public address and then a private one is not caught. The checks still refuse every address a host states at the first lookup.
- A photo's key holds its new media id, so the same photo sent twice is two cards.
- A card refused after an earlier photo of it was stored, and a call whose insert fails, leave files no card names, until the account is deleted.
- Three validators of one frame stand; a new 칸 type changes all three and the fixtures.
- A device's image cache and pickers are unchanged: only a server-side photo is PNG or WebP.

## Signs the decision was wrong

- The function's logs or a report show a request reaching a private address by rebinding, which asks for a pinned connection.
- Models hit the ten-photo limit often.
- Hosts that mislabel their files refuse many cards.
- Orphaned files grow to matter in storage cost.
