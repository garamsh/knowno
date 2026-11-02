# Sync

The `sync` domain: keeping the local database and the signed-in account's rows on the server in step, in the background, and the web app as a second writer of those rows.

## Current decisions

### Surface and location

- The domain lives in `app/lib/sync/`; its public surface is `app/lib/sync/sync.dart`, with internals under `app/lib/sync/src/` ([ADR 0002](adr/0002-domain-public-surface-and-shared-database.md)).
- The surface exports what the composition site constructs and overrides with:
  - `SyncServer`, the seam to the server, with `Pulled` and `Horizon`; `SupabaseSyncServer`, its PostgREST implementation; and `connectSyncServer`, which picks the server for the account's connection;
  - `SyncStore`, `Synchronizer` and `SyncController`, and `syncControllerProvider`;
  - the status: `SyncStatus`, `SyncIdle`, `Syncing`, `Synced`, `SyncInterrupted`;
  - the failures: `SyncFailure`, `SyncOffline`, `SyncRejected`, `SyncFailed`, and `MissingServerParent`, the cause of a `SyncFailed` refusing a row whose parent the server does not hold;
  - `SyncStatusView`.
- The domain reads and writes the shared database directly. It uses `account`'s surface for the session (`AccountService`, `SignedIn`'s `UserId`, and the `SupabaseClient` of `AccountConnection`), `study`'s for the fold (`Scheduler.fold`), and `media`'s for the media queues (`MediaStore.drain`, [`media.md`](media.md)).
- `deck`, `study` and `media` do not import `sync`. `account` reaches it through `accountDataProvider`, which the composition site overrides with the `SyncController` ([`account.md`](account.md)). `home/` passes `SyncStatusView` to the settings screen as the status it shows ([`home.md`](home.md)).
- With `account` and `sharing`, it is one of the domains that import `supabase_flutter`, for PostgREST only ([ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md), [ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md)).

### Local schema

- Schema v4 gives `decks`, `cards`, `reviews` and `card_states` the columns `updated_at`, `deleted_at` (a tombstone, which schema v7 drops from `reviews` and `card_states`) and `dirty` (not yet pushed). `dirty` defaults to set, so every local insert is unsynced; the v3 to v4 migration leaves every existing row unsynced, and dates a review's `updated_at` by its `reviewed_at` and a card state's by its `last_review`.
- `sync_state` holds at most one row: the owning account's id, and per table the pull cursor, the highest server `revision` applied. No row means no account owns the database.
- Schema v5 adds `visibility`, `published_at` and `description` to `decks` and `origin_deck_id` to `cards`, and lets `source` take a copied card's value, `shared` until schema v8. The v4 to v5 migration leaves every deck private and rebuilds `cards` for its check, keeping every row ([`sharing.md`](sharing.md)).
- Schema v6 stores every `DateTime` column as ISO-8601 text in UTC (drift's `store_date_time_values_as_text`, in `app/build.yaml`). Every column writes through `StoredTime` (`app/lib/database/database.dart`), which converts to UTC and truncates to the millisecond, so every value has one length and one zone, its text order is its time order, and its precision is the web's ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §2).
  - The v5 to v6 migration rebuilds `decks`, `cards`, `reviews` and `card_states` with `TableMigration`, converting each time column from Unix seconds. It keeps every row and its `dirty` flag, with foreign keys off, as the earlier rebuilds did.
  - Its migration test starts from v5 rows that are unsynced and tombstoned, and reads them back unchanged, times included.
- Schema v7 drops `deleted_at` from `reviews` and `card_states`, which nothing wrote, so only decks and cards have tombstones ([ADR 0077](adr/0077-drop-the-review-and-card-state-tombstones-that-nothing-writes.md)).
  - The v6 to v7 migration drops the partial index `reviews_live_reviewed_at`, whose term names the column, then rebuilds both tables with `TableMigration`, keeping every row and its `dirty` flag, and creates `reviews_reviewed_at`.
  - Its migration test starts from v6 reviews and a card state, unsynced and synced, reads them back unchanged, and finds the index on `reviewed_at` whole.
- Schema v8 renames a copied card's `source` from `shared` to `copy` ([ADR 0082](adr/0082-name-copying-a-public-deck-copy-and-keep-import-for-photo-import.md)). The v7 to v8 migration rebuilds `cards` for its check with each such row remapped, keeping every row, its origin and its `dirty` flag; the server remaps its own rows. Its migration test reads a copied, a photo and a typed card back, the copied one as `copy`.
- Schema v10 adds `icon` and `color` to `decks`, a deck's appearance keys, nullable, so every deck from before holds neither; the v9 to v10 migration adds the two columns and rewrites no row, and its migration test reads a v9 deck back unchanged with neither key ([ADR 0103](adr/0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md)).
- Schema v11 adds `template` and `template_version` to `cards`, the template a card was made from and its version, nullable, so every card from before holds neither until its next write; the v10 to v11 migration adds the two columns and rewrites no row, and its migration test reads a v10 card back unchanged with neither ([ADR 0106](adr/0106-store-each-card-s-template-and-each-block-s-version-and-id-derive-one-face-or-front-back-from-blanks-and-keep-unknown-shapes-unchanged.md)).
- Schema v12 adds `image_media_id` to `decks`, a deck's image, nullable, so every deck from before holds none, and the `media` domain's two queues, `media_uploads` and `media_deletions`; the v11 to v12 migration adds the column and the two tables and rewrites no row, and its migration test reads a v11 deck back unchanged with no image and both queues empty ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).
- Schema v13 makes every live card of the template `flip`, `cloze` or `table` at version 1, or of none, `free` at version 1, the one template the editor writes ([ADR 0114](adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md), [`deck.md`](deck.md)). The v12 to v13 migration rewrites only those two columns: each card's sides, card key, `updated_at` and `dirty` stay as they were, and a tombstone, or a template or version no build of this app wrote, is left alone. Its migration test starts from v12 cards of each template, synced and unsynced, live and deleted, and reads each back with its template and everything else as expected.
  - The server makes the same change in its own rows, drawing each a new revision and keeping its `updated_at` ([`server.md`](server.md)). So a device holding a card synced takes the server's copy on the tie, which its own step has already made equal; a device with an edit not yet pushed wins the tie as an unsynced row, or holds a later `updated_at`, and pushes its edit, already `free`, over the server's.
  - A device on an earlier build pulls `free` cards, which it opens as 자유. A card it writes in one of its forms is pushed with that form's template, which this build opens in its block editor and writes as `free` on its next edit.
- Schema v14 moves every live card of `free` at version 1, or of none or of `flip`, `cloze` or `table` at version 1, to the 칸 frame ([ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md), [`deck.md`](deck.md)). The v13 to v14 migration rewrites `front`, `back`, `template` and `template_version` alone: each card's key, `updated_at` and `dirty` stay. A tombstone, a card in the frame, a template or version no build wrote, and a card `frameSides` cannot convert are left alone, and the app converts such a card on read. `frameSides` sits in `app/lib/database/database.dart`, since a foundation imports no domain and a migration keeps what it did when it shipped.
  - Its test, `app/test/drift/app_database/card_frame_step_test.dart`, runs every case of `supabase/fixtures/card-frame/conversion.json` through the step against its expected list and against `cellsFromSides`, and compares the two on every front and back of up to two blocks of each kind, so a step that drifts from the frame fails.
  - The server makes the same change in its own rows, drawing each a new revision and keeping its `updated_at` ([`server.md`](server.md) §Card frame migration). So a device holding a card synced takes the server's copy on the tie; a device with an edit not yet pushed wins the tie as an unsynced row, or holds a later `updated_at`, and pushes its edit over the server's. The same test pulls 4,038 such rows onto a device holding an unpushed edit of each kind and finds the edits kept and pushed.
  - A build without the step keeps its edit at v1 and pushes it over the frame. It reads the pulled `free` v2 cards, and a frame build converts that v1 card on read.
- Schema v9 adds `study_settings`, at most one row: the user's daily study minutes, their edit time and `dirty`; no row reads as the default ([ADR 0085](adr/0085-fill-each-day-s-new-cards-from-the-daily-study-minutes-the-user-sets-stored-per-user-on-the-server-and-synced.md), [`study.md`](study.md)).
- Schema v7 indexes, which v8 keeps:
  - `cards_deck_id_created_at` on `(deck_id, created_at)`;
  - `cards_deck_id_card_key`, partial where `deleted_at IS NULL` since v6;
  - `reviews_card_id_reviewed_at` on `(card_id, reviewed_at)`, which also covers the cascade from `cards`;
  - `reviews_reviewed_at` on `reviewed_at`;
  - one `{table}_unsynced` index per synced table, partial on `dirty`.
  - Each partial index is declared with `TableIndex.sql`. A query reaches it only by repeating its term, so the check for unsynced rows reads `WHERE "dirty"`, not `dirty = 1`.
  - drift's own comparison of two times is written through `julianday()`, which no index serves, so the reads by time are written in SQL comparing the text ([`study.md`](study.md)).
- **No new local checks.** A check added on the device would have to hold for every stored row, or the table rebuild aborts and the database no longer opens. The server's checks are the authority, and a row they refuse fails the run as `SyncFailed`, as any constraint does.
- Screens never show a tombstoned deck or card ([`deck.md`](deck.md), [`study.md`](study.md)).
- Ids are `TEXT` on the device, in canonical lowercase uuid form. The server keeps them as `uuid` and returns them in that same form ([`server.md`](server.md)), so a pulled id equals the one the device stored. The app creates new ids with `uuid`'s `v7()`, which the composition site passes to `DeckRepository` and `StudyRepository`. The web creates its new ids, each answer's review, with the `uuid` npm package's `v7()`, pinned exactly in `web/package.json` ([`web-study.md`](web-study.md)).

### A run

- A run, for the signed-in account:
  1. claims the database: with no owner, its rows become the account's; with another owner, every synced row, the study settings, the owner and the cursors are deleted first, so another account's rows are never pushed;
  2. reads `sync_horizon()`: the horizon, below which tombstones may have been purged, and the watermark, a revision at or below which none of the account's rows is still uncommitted ([`server.md`](server.md), [ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md));
  3. pulls the account's own `decks`, `cards`, `reviews`, then `card_states`, each in pages of 500 rows above its cursor, lowest revision first, applying each page and moving the cursor in one drift transaction; a pull filters on `user_id`, since the session may also read other users' public decks and cards ([ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md));
  4. recomputes the state of every card a pulled review was added to or changed the rating of;
  5. pulls the account's `study_settings` row whole, one row a user with no revision, and merges it as §Conflicts says;
  6. pushes the unsynced rows of each table in the same order, 500 per request, then the study settings, through `save_study_settings`, and clears `dirty` on each row still as it was pushed; a row edited during the push stays unsynced;
  7. purges the local tombstones, when nothing is left unsynced.
- After a run that succeeds, `SyncController` drains the media queues: each queued file is uploaded, then each released one deleted, so a deck reaches the server before its image's file does. A transfer that fails stays queued and schedules a retry with the backoff below; the run itself still counts as synced ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).
- Pull comes before push, so a local row that loses its merge is never sent.
- A pulled row whose parent is not yet on the device ends its page there, below the cursor; the pull starts over, up to three passes, and a parent still missing then fails the run as `SyncFailed`.
- Each pushed row carries `user_id`, the run's account; a session belonging to another account is refused by row-level security.

### Horizon and watermark

- A table whose pull completes has its cursor raised to the watermark the run read, so a table no one writes keeps up with the horizon ([ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md)).
- A table whose cursor is above zero but below the horizon may have passed a purged tombstone, so the run rebuilds it ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §3):
  - it pulls that table from revision 0, merging as usual;
  - once that pull completes, it deletes each synced local row the pull did not return, with what cascades from it; an unsynced row stays and is pushed.
  - With the watermark stored, only a device that has not completed a pull since the horizon's mark was taken, about 90 days earlier, rebuilds.
- The server's purge job raises the horizon daily, 90 days behind its marks ([`server.md`](server.md)). It was built before any store release, by the owner's decision of 2026-10-18 in issue #108, which supersedes [ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §9's order of building it after the app's store release ([ADR 0053](adr/0053-purge-tombstones-before-any-store-release-enable-pg-cron-in-the-purge-s-migration-and-lock-cards-and-reviews-while-it-purges.md)). Every client device then ran `main`'s build, which reads the watermark, so no device syncs against a rising horizon without it.
- A push refused for a parent the server no longer holds (`23503`) is sent again one row at a time. Each row refused so is deleted locally, with what cascades from it, since a delete elsewhere wins, and the rest are pushed.

### Local purge

- After a run that leaves no row unsynced, the device purges its tombstones ([ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md)):
  - every card tombstone is stripped in place, its `front` and `back` made `[]` and its `card_key` `''`;
  - every deck tombstone is stripped in place, its `name` made `''` and its `description` null, and made private.
- A card or deck tombstone is never deleted on the device, so a review pulled later still finds its card, and no foreign key cascades to a review. The strip is not marked unsynced; the server strips its own copy ([`server.md`](server.md)).
- The streak and the statistics read reviews whether or not their card is live ([`study.md`](study.md)).

### Conflicts

- Decks and cards: a tombstone wins over a live row, whichever was written later; otherwise the later `updated_at` wins. A deck's visibility, publish time, description, icon, colour and image, and a card's template and its version, are columns of its row and follow the same rule, so a publish on one device reaches the others. A pulled deck is written whole, a column the server holds as null written as null, so a removed image reaches the other devices too. A card a newer build wrote, its template or blocks unknown here, is pulled, stored and pushed back unchanged, a merged back aside ([ADR 0106](adr/0106-store-each-card-s-template-and-each-block-s-version-and-id-derive-one-face-or-front-back-from-blanks-and-keep-unknown-shapes-unchanged.md)). On a tie an unsynced local edit wins, since the server has not seen it; otherwise the server's.
- Reviews: a union by id. A review on both sides keeps the rating of its later edit, with the same tie rule. On the server, a push inserts new reviews and changes an existing one's `rating` and `updated_at` only where the server's edit is older.
- Study settings: the later `updated_at` wins, with the same tie rule as decks; a local row kept stays unsynced, so the next push repairs the server's. The server's `save_study_settings` writes only over an older row ([`server.md`](server.md)).
- Card states are never merged. A pulled state replaces a synced local one and gives way to an unsynced one. After a pull brings a review for a card, the card's state is recomputed by folding all its reviews in `reviewed_at` order through the engine from a new card, each with its stored fuzz factor, and written unsynced where it differs.
- A row where the local copy is kept is marked unsynced, so the next push repairs the server's copy, which another device may have overwritten.
- Equal-key cards from two devices are distinct rows: both are kept, and the deck's duplicate rule shows them on the next edit.

### When it runs

- `SyncController` starts a run when an account signs in, at app start and on each resume while signed in, and three seconds after the last of a burst of local writes that left a row unsynced. A study session's answers are such writes, as is a change of the daily study minutes, so the run after a session is the one after its last answer.
- One run at a time: a trigger during a run starts one more after it.
- Nothing on the study screen's answer path awaits a run; only sign-out's push and clear do.
- A failed run is retried after 5 seconds, doubling up to 5 minutes; a successful run or the retry button restarts the backoff.

### Sign-out

- `SyncController` is `account`'s `AccountData`. Sign-out first runs sync and reports whether nothing is left unsynced, a file waiting in either media queue included; the settings screen then asks "동기화하지 않고 로그아웃할까요?" and lets the user cancel or sign out anyway.
- After signing out, the controller waits for the run under way, then deletes every synced row, the study settings, both media queues, the owner and the cursors, so the next account starts empty and pulls its own rows.

### Failures and status

- Every expected failure of a run is a `SyncFailure`:
  - `SyncOffline` — no connection, no answer within 20 seconds, or a server or gateway error;
  - `SyncRejected` — the session or a row-level security policy refused the request;
  - `SyncFailed` — the server answered with a row sync cannot read or a constraint it refused, or the local database failed.
- A failure is never shown as a blocking error. It becomes the status `SyncInterrupted`, which the settings screen shows while signed in, one line read out as it changes, its words alone after a spinner while syncing ([ADR 0116](adr/0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md)): "동기화 중", "동기화됨", "오프라인 · 연결되면 동기화해요", or "동기화하지 못했어요" with "다시 시도".
- `SupabaseSyncServer` maps PostgREST's error codes: `42501`, `PGRST301`, `PGRST302`, 401 and 403 to `SyncRejected`; `PGRST000` to `PGRST002` and 500, 502, 503 and 504 to `SyncOffline`; `23503` to `SyncFailed` with `MissingServerParent`; any other to `SyncFailed`.

### The web app as a writer

- The web app keeps no local database: it writes the server's `reviews` and `card_states` directly, with the user's session, the same rows a phone's push sends, so the phone merges them by the rules above ([`web-study.md`](web-study.md), [ADR 0022](adr/0022-study-on-the-web-with-the-engine-in-the-browser.md)).
- An answer inserts its review, ignoring one already stored under its id, with `good` for "안다" and `again` for "모른다", its time, its duration on screen, a fuzz factor drawn for it, and `user_id`. A toggle changes that review's `rating` and `updated_at` only where the server's edit is older, as a push does.
- Either then upserts the card's `card_states` row with the state the engine computes, replaying the card's answers of the web session, each with its factor, from the state the session opened with.
- Every row takes the time of the edit as `updated_at`; the server sets `revision`. Neither table has a tombstone, and the web app deletes nothing.
- A phone pulls these rows like any other: the review is added to or changes the rating of its card's history, so the card's state is recomputed by the fold, and a pulled state replaces a synced one.
- The `decks` feature's editor updates a stored `cards` row only where it is live and the server's `updated_at` is older than the save's, so the later edit wins as above and a tombstone stays; the row keeps its id and takes a new revision, and its reviews and state are not touched ([ADR 0143](adr/0143-edit-a-stored-card-on-the-web-from-its-row-the-later-updated-at-winning.md), [`web-decks.md`](web-decks.md)).
- The `mcp` Edge Function writes `decks` and `cards` the same way for an AI app acting as the user: new rows only, with the user's token, its own times as `updated_at`, and the revision the server sets, so a phone pulls them like a web-made deck or card ([`mcp.md`](mcp.md) §Rows written).

### Tests

- `app/test/sync/merge_test.dart` — each conflict rule, the study settings' included, with a control.
- `app/test/sync/synchronizer_test.dart` — push, pull, the conflict rules end to end, the state fold and ownership; a table no one writes kept at the watermark against one below the horizon rebuilt, a rebuild keeping unsynced rows, a push refused for a missing parent, and the local purge, with a review that reaches a device after it purged its card's tombstone. It runs over in-memory databases and a substituted server (`app/test/sync/fake_sync_server.dart`) with the server's revision, ownership, foreign key and review rules and a horizon a test sets.
- `app/test/sync/synchronizer_test.dart` also carries a deck's image to the other device, and its removal.
- `app/test/sync/synchronizer_test.dart` also covers the study settings: set on one device and read on the other against a fresh device's default, the later edit winning both ways, a setting changed during its push left unsynced, and the setting cleared by another account's claim and by sign-out.
- `app/test/sync/sync_controller_test.dart` — when runs start, retry, `push` and `clear`, and a deck's image uploaded after its deck, deleted with it, and retried while the media server does not take it.
- `app/test/sync/answer_path_test.dart` — the composed app answers and advances while a run never finishes, and pushes a change of the daily study minutes after the edit delay.
- `app/test/sync/sync_status_test.dart` — each status on the settings screen, the retry, and the tap target and contrast guidelines in both themes.
- `app/test/sharing/sharing_server_test.dart`, run by the same script, checks that a run never pulls another account's public deck, and that a publish reaches the owner's other device.
- `app/test/sync/two_devices_test.dart` — two in-memory databases syncing through `SupabaseSyncServer` as one new account against a local stack, and an answer and its toggle written as the web app writes them, which both devices merge with an offline answer into the fold of the union. A device left below the horizon by the server's purge, which the test runs in the stack's database container, rebuilds: a card deleted elsewhere and purged leaves it, and a studied one stays, stripped, with its review. `make test` runs it through `scripts/test-sync.sh`, which starts a throwaway stack with Postgres, Auth, PostgREST and the gateway, under its own project id and reserved database and API ports, as [ADR 0014](adr/0014-database-tests-on-a-stack-of-their-own.md) does for the database tests, and stops it on every exit. Without Docker the script prints the skip and why; the plain `flutter test` run skips the file with its reason. Each step the file takes on the stack is bounded by `SupabaseSyncServer`'s 20-second request timeout, the bound past which the app counts the server as offline: every sync request, and the sign-up and the sign-in, which retry within that bound while Auth answers that the request may be retried. The file sets no bound over a whole test, whose duration is the sum of its steps and grows with the host's load (issue #47). The same file sets the daily study minutes on both devices and finds the later edit on both, against an older one that changes neither. It also carries a deck's image id from one device to the other, and its removal.

## Rationale

- [ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md) records the protocol, the conflict policy, ownership, when sync runs, and why `sync` imports `supabase_flutter`.
- [ADR 0010](adr/0010-server-schema-and-row-level-security.md) records the server schema sync runs against.
- [ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md) records why pulls filter by owner and how deck visibility syncs.
- [ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) records schema v6, its indexes, the horizon and the local purge; issue #93 records the owner's direction.
- [ADR 0053](adr/0053-purge-tombstones-before-any-store-release-enable-pg-cron-in-the-purge-s-migration-and-lock-cards-and-reviews-while-it-purges.md) records why the server's purge was built before any store release; issue #108 records the owner's decision.
- [ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md) records why a completed pull raises the cursor to the watermark, and why the device strips its tombstones rather than delete them; issue #106 records their implementation.
- [ADR 0077](adr/0077-drop-the-review-and-card-state-tombstones-that-nothing-writes.md) records why reviews and card states have no tombstone, and schema v7.
- [ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md) records schema v14 and why the server's migration and each device's step meet through sync without losing an edit not yet pushed.
- [ADR 0114](adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md) records schema v13, why it rewrites only a card's template, and why the server's migration and each device's step meet through sync without losing an edit not yet pushed.
- [ADR 0039](adr/0039-name-every-top-level-folder-by-its-responsibility-compose-across-domains-in-a-home-shell-and-keep-seams-off-screens.md) records why `home/` hands the status view to the settings screen.
- Issue #24 records the decisions made by the PM, issue #29 the synced deck and card columns of schema v5, and issue #45 those for the web app as a writer.

## Open questions

- A study session writes a card's state from the state it opened with, on the phone and on the web. A review of that card pulled or written elsewhere during the session is left out of that write; the card's state is right again once another review of it, or another device's state recomputed with both, is pulled. Whether the session should reread the state before writing is open.
