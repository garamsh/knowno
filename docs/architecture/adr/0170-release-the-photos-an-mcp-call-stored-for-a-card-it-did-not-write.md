# ADR 0170: Release the photos an MCP call stored for a card it did not write

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #608. [ADR 0144](0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md) §Consequences: "A card refused after an earlier photo of it was stored, and a call whose insert fails, leave files no card names, until the account is deleted." `update_cards` ([ADR 0149](0149-edit-and-delete-cards-and-decks-through-mcp-as-the-clients-do-each-block-keeping-its-id.md)) stores photos the same way and adds a third such case: a card whose row was edited after the call began is refused after its new photos were stored.
- The web's editor releases the new files a refused write named ([ADR 0163](0163-store-a-web-card-s-new-photos-and-sounds-one-request-each-at-save-and-release-what-a-refused-or-edited-card-lets-go.md)), and left this case to the function, which #608 records.
- `delete_cards` and `delete_deck` already release what no live card or deck of the user's holds, and name what they could not in `files_not_released` (ADR 0149). The same path serves here with no migration: the owner policies let the user delete their own `media` rows and files.
- A photo is stored before its card is written: the bucket's policy requires the `media` row first, and whether an edit was made elsewhere is known only when the card's update runs.
- Alternatives considered:
  - **Release each photo the moment its card is refused**, outside the held check. A write that failed on the way back may have landed, and its card would then name a released file; the held check reads the cards first.
  - **Answer an insert that fails as refused cards** rather than as the error it is now. The write may have landed, which the error already says to check with `list_cards`.

## Decision

- `add_cards` and `update_cards` release, through `delete_cards`' path, the photos the call stored for a card it did not write: one refused after an earlier photo of it was stored, one `update_cards` refused because its row was edited after the call began, and every card of a write that fails, the cards refused before it included. A photo is released only where no live card or deck of the user's holds it.
- Both answers carry `files_not_released`, empty when nothing failed, naming the media ids of the photos whose release failed. A failed release never turns the answer into an error.
- A failed write releases before its error reaches the handler, and the call answers that error as before, with no `files_not_released`.

## Consequences

- ADR 0144's consequence that such a card or a failed insert leaves files is superseded; the rest of it stands.
- A call whose refused cards stored a photo reads every live card of the user's to decide what is held, as a deletion does.
- `add_cards`' and `update_cards`' answers gain a required field.
- A write that fails while the release also fails leaves its photos, and its answer does not name them.

## Signs the decision was wrong

- `files_not_released` appears often in `add_cards` or `update_cards` answers, which would point at storing a photo only after its card's write.
- Calls with refused photo cards grow slow for users with many cards.
