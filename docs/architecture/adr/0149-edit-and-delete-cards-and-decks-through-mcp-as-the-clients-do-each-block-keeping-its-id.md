# ADR 0149: Edit and delete cards and decks through MCP as the clients do, each block keeping its id

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #575: the owner asked on 2026-11-02 why MCP had no delete. [ADR 0126](0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md) §Decision, "The tools", scoped the `mcp` function to reading and adding: "Nothing edits or deletes".
- The clients delete a deck or a card as a tombstone: `deleted_at` and `updated_at` at the deletion's time, the server's trigger setting the revision, no row removed (`app/lib/deck/src/deck_repository.dart`, `_cardTombstone` and `_deckTombstone`; [`sync.md`](../sync.md)). A deck's deletion tombstones its live cards with it. Both then release the photos and sounds no other live card or deck holds: the file through the Storage API, then its `media` row.
- `authenticated` may update its own `decks` and `cards` rows, and delete its own `media` rows and files in its own folder of the `media` bucket, under the owner policies of `20261014155006_sync_schema.sql` and `20261026140000_media.sql`. So every write here goes through PostgREST and Storage with the user's token, and needs no migration.
- The web edits a stored card ([ADR 0143](0143-edit-a-stored-card-on-the-web-from-its-row-the-later-updated-at-winning.md)): its 칸 written in `free` v2, its id, `source`, reviews and card state kept, only over an older live row; a stored 사진 or 소리 kept by its media; a card holding a block of a later version left read-only.
- The read tools returned no block id ([ADR 0144](0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)), so a model could not say which block it changed.
- Alternatives considered:
  - **Keep a block's id by the app's `_withIds` rule**, the next unused stored block of its type. It serves an editor that holds no ids. A model edits what it read, so the ids can go there and back; the PM chose that on 2026-11-02.
  - **Leave a deleted card's files in the bucket.** Simpler, and ADR 0143 does so for a 칸 deleted on the web. A user who deletes a photo card through an AI expects the photo gone, as in the app; the PM chose the release on 2026-11-02.
  - **Delete a deck and its cards in one statement** through a database function. It needs a migration, which #575 rules out while the update policies allow the two statements.
  - **Promise in the settings and consent text that the AI asks before deleting.** `destructiveHint` is a hint, and no AI app is bound by it.

## Decision

### Tools

- **`update_cards`** takes up to 100 `{id, blocks}`, or an id with the plain form, and replaces each card's 칸 whole under `add_cards`' validation, refusals, storage, photo fetch and its limit of 10, and card key. A card is refused by its index when its id is not a live card of the user's, when it holds a block of a later version, when its new key matches another live card of its deck or one changed earlier in the call unless `allow_duplicates` is true, and when its row was edited after the call began, the later `updated_at` winning as on the web.
  - A block keeps the `id` it is given when that is an id of the same card's stored block of the same type; any other block takes a new one.
  - An image or audio block given by a `media` the card already holds is kept as stored: no fetch, not counted against the 10, its boxes as given, each box under a new id as `add_cards` gives one. A `media` the card does not hold is refused.
  - `updated_at` is the call's time; the id, deck, `source`, `created_at`, reviews and card state stay.
- **`delete_cards`** takes up to 100 ids and tombstones each live card of the user's as the clients do. The answer lists the ids deleted and those not found.
- **`update_deck`** renames a live deck of the user's, the name trimmed, 1 to 500 characters, `updated_at` the call's time.
- **`delete_deck`** tombstones a live deck of the user's and its live cards at one time, the cards first, and answers the count.
- **The release.** After a deletion is written, `delete_cards` and `delete_deck` release the photos and sounds of what they deleted, a deck's image included, that no live card or deck of the user's holds, as the app reads holding: a deck by its image, a card by any block naming the id. A release that fails leaves the deletion standing, and the answer names the media ids not released.
- **The read tools** return each 칸 of a `free` v2 card with its stored `id`.

### What a client is told

- Every tool carries MCP annotations: the read tools `readOnlyHint`; `create_deck`, `add_cards`, `update_cards` and `update_deck` not destructive; `delete_cards` and `delete_deck` `destructiveHint`.
- The `initialize` instruction tells the model to confirm a deletion with the user first and to change a card with `update_cards` rather than delete it and add another.
- The web's 설정 "AI 연결" and the consent page say "노트와 카드를 읽고, 추가하고, 고치고, 지울 수 있어요.", with no promise that the AI asks first; 노트 is #577's name for a deck.

## Consequences

- ADR 0126's "Nothing edits or deletes" is superseded; the rest of it stands as ADR 0133 and ADR 0144 left it.
- A model can fix a card it made, and its study history stays.
- The read tools' blocks gain an `id`; a card of two sides, whose 칸 are converted, shows none until it is written in `free` v2.
- `delete_deck` is two statements: a call failing between them leaves the deck live with its cards deleted, and calling again deletes it.
- Each deletion that names a photo or a sound reads every live card of the user's to decide what is held, as `search_cards` does.
- A failed release leaves files and `media` rows no live card names, until the account is deleted. A 칸 removed by `update_cards` keeps its file, as on the web.
- `update_cards` writes one card a statement, so a call's cards are written one by one, each refused alone.

## Signs the decision was wrong

- Users report cards or decks deleted by an AI that they did not ask for, which would ask for a confirmation the server holds rather than a hint.
- Models delete and re-add cards in place of `update_cards`, losing study history.
- `files_not_released` appears often enough that orphaned files matter in storage cost.
- Deletions with photos grow slow for users with many cards.
