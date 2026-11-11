# Server schema

The synced tables of the Supabase schema: their columns, row-level security, server-set revisions, tombstones, checks, indexes, the horizon and watermark, the tombstone purge, and the media bucket's table and policies.

## Current decisions

### Tables

- `public` holds `decks`, `cards`, `reviews` and `card_states`, mirroring the app's local tables (`app/lib/database/database.dart`). Their ids are created on the device.
- `decks`, `cards` and `reviews` have `id` as primary key; `card_states` has `(user_id, card_id)`.
- Every synced id, and every column that references one, is `uuid`: `decks.id`, `cards.id`, `cards.deck_id`, `cards.origin_deck_id`, `reviews.id`, `reviews.card_id`, `card_states.card_id`, `deck_reports.deck_id` and `deck_copies.deck_id`. No id column has a default, so a row sent without an id is refused. `extraction_usage.id` is an identity ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md)).
- Migration `20261016180000_uuid_keys.sql` cast those columns from `text` in place, so every row kept its id. It first raises, changing nothing, unless every value is in canonical lowercase form, the only form Postgres returns unchanged, so the phone, which keeps ids as text, holds the same id the server returns ([`sync.md`](sync.md)). In one transaction it dropped the five foreign keys and the two policies that name those columns, cast them, and recreated the keys, the policies, `list_public_decks` and `record_deck_copy`.
- PostgREST sends a uuid as the same JSON string a text id was, so app and web versions released before the conversion keep working.
- The app and the web create new ids as version 7; rows created before keep their version 4 ids, and nothing reads the version ([`sync.md`](sync.md)).
- Every row carries `user_id`, referencing `auth.users` with `on delete cascade`, so deleting an account deletes its rows. It defaults to the caller's `auth.uid()`.
- A card's `front` and `back` are `jsonb` arrays of blocks, in the encoding the app stores ([`deck.md`](deck.md)); a value that is not an array is refused.
- `cards.source` and `reviews.rating` take the local tables' values: `manual`, `import` or `copy`, and `again` or `good`. Migration `20261015180000_public_decks.sql` widened the source check to a copied card's value in one statement, changing no row ([ADR 0020](adr/0020-public-decks-in-a-sharing-domain.md)).
- `decks.icon` and `decks.color` are a deck's appearance keys, nullable, each bounded to 40 characters and checked against no list, so a newer app's keys sync; a client draws the default for a key it does not know. `authenticated` inserts and updates them as the deck's other columns. Migration `20261026120000_deck_appearance.sql` added them and their grants, changing no row ([ADR 0103](adr/0103-give-each-deck-an-icon-and-a-colour-stored-as-two-unchecked-keys-and-drawn-on-its-tile-in-place-of-the-initial.md)).
- `decks.image_media_id` is the media id of a deck's image, nullable, with no foreign key, since a device pushes the deck before its file's row lands (§Media storage). `authenticated` inserts and updates it as the deck's other columns.
- `cards.origin_deck_id` is a copied card's source deck, with no foreign key, since that deck is another user's.
- `cards.template` and `cards.template_version` are the template a card was made from and its version, nullable, so a card from before holds neither until an app's next write fills them in. The template is checked against no list, so a newer app's template syncs; the version is at least 1. `authenticated` writes both through the table's grants. Migration `20261026130000_card_template.sql` added them and rewrote no row ([ADR 0106](adr/0106-store-each-card-s-template-and-each-block-s-version-and-id-derive-one-face-or-front-back-from-blanks-and-keep-unknown-shapes-unchanged.md)); migration `20261027140000_card_template_free.sql` made every live card's template `free` ([`server-migrations.md`](server-migrations.md) §Card template migration).
- `reviews.fuzz_factor` is the review's fuzz factor ([ADR 0012](adr/0012-fuzz-review-intervals.md)), null for a review scheduled without fuzz, and checked to `[0, 1)`. Migration `20261015120000_review_fuzz_factor.sql` added it.

### Sync columns

- `updated_at` — the device's edit time, set by the client; #24 orders concurrent edits by it. `updated_at`, `created_at`, `reviewed_at` and `deleted_at` are the client's. The app's sync sends them at millisecond precision, as stored in schema v6, and so does the web.
- `deleted_at` — a tombstone on `decks` and `cards`, null while the row is live. Sync never deletes a row.
- `reviews` and `card_states` have no tombstone, since nothing writes one ([ADR 0077](adr/0077-drop-the-review-and-card-state-tombstones-that-nothing-writes.md)). Migration `20261019230000_drop_review_state_tombstones.sql` dropped their `deleted_at`, the `reviews_delete` policy, `card_states_tombstone_revision` and `reviews_live_user_id_reviewed_at`, created `reviews_user_id_reviewed_at` in its place, and rewrote every function that filtered on the column without that filter.
  - It drops each column only after `private.require_no_tombstone(table)` finds no row with it set, raising and changing nothing otherwise, so no row changes. The function stays, so its refusal is tested.
- `revision` — set on every insert and update by a trigger, from the one sequence `private.revision` shared by all four tables. Whatever the client sends is overwritten. Each table is indexed on `(user_id, revision)`, the pull cursor.
- Before drawing, the trigger takes a transaction-level advisory lock keyed by a 64-bit hash of the row's `user_id`, held until commit. One user's writing transactions therefore run one after another, so for each user a later commit holds the higher revision, and a pull by revision cannot pass a row that commits later. Different users never wait on each other, except on a hash collision ([ADR 0010](adr/0010-server-schema-and-row-level-security.md)).
- The cost: one user's concurrent writes, from two devices or two requests, serialize.
- The sequence and the trigger function live in the schema `private`, which the API does not expose. The function runs as its owner, so clients need no privilege on the sequence and have none.

### Access

- `anon` holds no privilege on the four tables; every statement it sends is refused.
- `authenticated` may select, insert, update and delete in `cards` and `card_states`, and select and delete in `decks`. On `decks` it may insert and update every column but `hidden` and `copy_count`.
- `reviews` is insert-only for `authenticated`, except `rating` and `updated_at`, which a toggle changes ([ADR 0007](adr/0007-study-swipe-screen-and-session-toggle.md)). A client inserts `fuzz_factor` with its review and never changes it. A client cannot delete a review; a review goes only with its account, through the `auth.users` cascade.
- Row-level security is on for all four tables, with one policy per command a client may run, allowing only rows where `user_id = auth.uid()`; `reviews` has none for delete.
- The one select policy of `decks` and of `cards` also lets any signed-in user read a visibly public deck and its live cards, and that of `profiles` the name of a user with one. Each tests the owner's condition first and ORs in the public one, so a read of one's own rows never runs the public condition's subquery ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §7). Migration `20261016200000_checks_and_policies.sql` merged each table's former owner and public pair into it, changing no row's visibility. Writes stay the owner's, since no write policy names another user's rows.
- Every policy names `to authenticated` and reads `(select auth.uid())`. A pull therefore filters on its account's `user_id` ([`sync.md`](sync.md)).
- The privileges are granted in the migration, not left to the project's default privileges.
- `record_deck_copy` runs as `security definer` and `authenticated` may execute it, which the Security Advisor reports as lint `0029_authenticated_security_definer_function_executable`. That is intended: it writes `deck_copies` and `copy_count`, which no client may write, and [ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §7 lists it among the `security definer` functions, granted to the one role that calls it (issue #113).
- The app does not use the service role, and neither does the web or the `mcp` function, which reads and writes with the caller's token ([`mcp.md`](mcp.md)): the admin area reads and writes through the functions of [`server-admin.md`](server-admin.md) §Admin area with the user's session.

### Integrity

- A card's deck, and a review's or card state's card, belong to the row's own user. Composite foreign keys enforce it: `cards (user_id, deck_id)` references `decks (user_id, id)`, and `reviews` and `card_states` reference `cards (user_id, id)`, each with `on delete cascade`.

### Checks

- Besides the column checks above, five checks hold on every row ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §5):
  - `decks_name_check`: `deleted_at is not null or name <> ''`;
  - `cards_card_key_check`: `deleted_at is not null or card_key <> ''`;
  - `card_states_stability_check`: `stability >= 0.001`;
  - `card_states_difficulty_check`: `difficulty between 1 and 10`, the engine's clamps with the one above;
  - `cards_origin_deck_id_check`: `(source = 'copy') = (origin_deck_id is not null)`.
- A tombstone may have an empty name or card key, since the purge strips them.
- Migration `20261016200000_checks_and_policies.sql` added them. It first counts each check's failing rows and raises, changing nothing, unless every count is zero. It then adds each `not valid` and validates it, in the same transaction, so the lock the addition takes lasts to commit. A table large enough for that lock to matter is validated in a later migration.
- **Constraint names.** Constraints keep Postgres's default names (`_pkey`, `_key`, `_fkey`, `_check`), and a constraint added later is given its name explicitly in that form.
- A row a check refuses fails a sync run as `SyncFailed` ([`sync.md`](sync.md)).

### Indexes

- Each index serves a named query, and a new query names its index or why it has none ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) lists them). Migration `20261016150000_server_indexes.sql` added these, changing no row:
  - `reviews_user_id_reviewed_at` on `(user_id, reviewed_at)`, for the pace and a study day's reviews. It was partial on `deleted_at is null` as `reviews_live_user_id_reviewed_at` until ADR 0077 dropped the column, which every review held null;
  - `cards_deck_id_created_at_id` on `(deck_id, created_at, id)`, for the composite foreign key's cascade, a study selection's cards, the public preview and the public listing's card count. It is not partial, so the cascade finds tombstones. It replaced `cards_user_id_deck_id`, which the migration dropped;
  - `deck_reports_reporter_id`, `user_blocks_blocked_id` and `deck_copies_user_id`, for the account-deletion cascade;
  - `decks_tombstone_revision` and `cards_tombstone_revision` on `revision` where `deleted_at is not null`, for the purge.
- **Index names** are `{table}_[{predicate}_]{columns}`. The predicate is `live` (`deleted_at is null`), `tombstone` (`deleted_at is not null`) or `public` (visibly public).
- Indexes are created with plain `create index` in a migration.

### Horizon and watermark

- `private.sync_horizon` holds one row: the revision the last tombstone purge purged below, 0 until a purge runs ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §3).
- `public.sync_horizon()` returns one row to the caller: `horizon`, that revision, and `watermark`, the last value of `private.revision` read after taking the caller's revision lock, the advisory lock the revision trigger takes ([ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md)).
  - Each of the caller's writes draws its revision under that lock and holds it to commit, so every revision of the caller's rows at or below the watermark is committed when it is read, and every later one is above it. A sync run reads it before pulling and raises each completed table's cursor to it ([`sync.md`](sync.md)).
  - It is `security definer`, `volatile`, since it takes a lock, and sets `search_path = ''`. `execute` is revoked from `public` and `anon` and granted to `authenticated`.
- Migration `20261017120000_sync_horizon.sql` added the table, holding 0, and the function, changing no row.

### Tombstone purge

- A `pg_cron` job, `purge-tombstones`, runs `private.purge_tombstones()` daily at 18:00 GMT, 03:00 in Korea ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §3). Each run:
  - records the revision sequence's last value in `private.revision_marks`, with the server's time;
  - deletes `cron.job_run_details` rows that ended more than 30 days earlier;
  - purges the `decks` and `cards` tombstones whose `revision` is at or below the latest mark taken 90 days or more earlier, and stores that mark as the horizon in `private.sync_horizon`, which `sync_horizon()` returns ([`sync.md`](sync.md));
  - deletes the marks older than that one.
  - With no mark 90 days old, a run purges nothing and the horizon stays where it is. The first purge therefore comes 90 days after the first mark.
- Study history survives deletion (the owner's decision, issue #93):
  - a card tombstone that no review references is deleted, with its card state;
  - one that reviews reference keeps its row, stripped: `front` and `back` become `[]` and `card_key` `''`, so its reviews stay in the streak and the statistics;
  - a card state stays with its card's row, stripped or live, and goes with the row;
  - a deck tombstone is deleted once no card row references it, with its reports and its users' copy records, which cascade from it. Until then it keeps its row, stripped of its name and description and made private.
  - A strip is an update, so the row takes a new revision and devices pull it. A row already stripped is not updated again.
  - Only account deletion removes reviews and the kept rows.
- A run that purges first locks `cards` and `reviews` in `share row exclusive` mode until it commits. A write to either waits, so no review or card written during the run comes to reference a tombstone the run deletes ([ADR 0053](adr/0053-purge-tombstones-before-any-store-release-enable-pg-cron-in-the-purge-s-migration-and-lock-cards-and-reviews-while-it-purges.md)). A run with no mark 90 days old takes no lock.
- `private.purge_tombstones()` runs as its owner and sets `search_path = ''`; `execute` is revoked from `public`, `anon` and `authenticated`.
- Migration `20261018090002_tombstone_purge.sql` added the marks table, the function and the job. It deletes no row itself.
  - It first calls `private.check_purge_start()`, which raises, changing nothing, unless `pg_cron` is in `pg_available_extensions` and `shared_preload_libraries`, `private.sync_horizon` holds its one row at 0, and no job named `purge-tombstones` exists. The function stays, so its refusals are tested.
  - It then runs `create extension if not exists pg_cron with schema pg_catalog`. **Merging it enables `pg_cron` in production if it is not on yet**; where the owner enabled Cron first, the statement does nothing.
- **Order.** The purge was built before any store release, by the owner's decision of 2026-10-18 in issue #108, which supersedes ADR 0034 §9's order of building it after the app's store release ([ADR 0053](adr/0053-purge-tombstones-before-any-store-release-enable-pg-cron-in-the-purge-s-migration-and-lock-cards-and-reviews-while-it-purges.md)). The only client devices then were the owner's, running `main`'s build, which reads the watermark.
- **Runs.** `cron.job_run_details` records each run, so a failure or a missing day shows there; a horizon that stops rising shows through `sync_horizon()`.

### Media storage

- `public.media` holds one row per stored file: `id`, a uuid the device makes, `user_id`, `kind` (`image` or `audio`), `mime_type`, `byte_size` (1 byte to 10 MiB), `sha256` (64 lowercase hex digits) and `created_at` ([ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md)).
- Row-level security lets its owner select, insert and delete its rows; no client role updates one, and no one else reads one.
- The private bucket `media` holds each file at `{owner}/{media id}`, of `image/jpeg`, `image/png`, `image/webp`, `audio/mp4` or `audio/mpeg`, at most 10 MiB, a ceiling well above the app's prepared images and its 5 MiB sounds ([ADR 0112](adr/0112-store-an-audio-block-by-media-id-and-length-up-to-60-seconds-and-play-the-front-s-sound-once-as-a-study-card-appears.md)); the app prepares JPEG alone, and PNG and WebP are an MCP card's photos, stored as they came ([ADR 0144](adr/0144-take-and-return-an-mcp-card-as-blocks-fetch-its-photo-from-a-public-https-url-and-store-png-and-webp-as-they-came.md)). The migration creates it in every project, and `supabase/config.toml` declares the same for the local stack. Policies on `storage.objects`:
  - its owner uploads a file only at the path of a `media` row it owns, and reads and deletes its own files; no policy allows an update, so no file is overwritten;
  - any signed-in user reads the file a deck the decks policy shows as public names in `image_media_id`, when that deck is the file's owner's own;
  - any signed-in user reads a file of an owner's that an `image` or an `audio` block names, on the front or back of a live card of that owner's in a deck of theirs that is public, not hidden and not deleted. The policy calls `public.media_in_public_card`, a `security definer` function with `search_path` pinned, which `authenticated` alone may execute ([ADR 0109](adr/0109-store-an-image-block-s-boxes-in-fractions-of-the-image-and-draw-them-with-the-image-s-one-transform.md)).
- Storage refuses a delete of `storage.objects` in SQL, so a file is deleted through the Storage API: by its owner's app, by the web acting as its owner ([`web-decks.md`](web-decks.md) §Media), and by `delete-account`.
- Migration `20261026140000_media.sql` creates the table, the bucket, `decks.image_media_id` and their policies and grants, and changes no row. Migration `20261027100000_media_card_read.sql` adds only the card-photo read policy and its function, and changes no row. Migration `20261027120000_media_audio.sql` adds the audio types to the bucket and replaces the function to match `audio` blocks too, its grants and the policy kept, and changes no row of `media`, `cards` or `storage.objects`. Migration `20261102090000_media_image_types.sql` adds PNG and WebP to the bucket and changes no row.

### Target data model (not built yet)

[ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) decides the schema below. None of it is built yet: each bullet holds once the migration that its implementation issue adds has been applied. Until then the decisions above describe the database.

- **Functions** run as `security invoker` unless they must reach what the caller cannot. Each `security definer` function sets `search_path = ''` and revokes `execute` from `public`. The definer functions are the revision trigger, `begin_extraction`, `extraction_allowance`, `hide_reported_deck`, `record_deck_copy`, `sync_horizon` and the purge.
- **Public listing.** Search stays a scan, matching `strpos` on `lower()`, until a threshold in ADR 0034 is crossed; then a `pg_trgm` GIN index on the visibly public decks serves it. The card count stays a correlated count.
- **Watching.** After each applied migration, the PM reads Supabase's Security and Performance Advisors, and monthly reads `supabase inspect db outliers` and `index-stats`. Each lint is fixed or recorded in an issue.

## Rationale

- [ADR 0010](adr/0010-server-schema-and-row-level-security.md) records the schema, the access rules and the revision mechanism.
- [ADR 0015](adr/0015-sync-protocol-and-conflict-policy.md) records how sync pushes reviews within the column grant, and the two-device test's stack.
- [ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) records the target data model, its measurements and the alternatives passed over, and the plan that builds it; issue #93 records the owner's direction.
- [ADR 0041](adr/0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md) records why `sync_horizon()` returns a watermark read under the caller's lock beside the horizon.
- [ADR 0053](adr/0053-purge-tombstones-before-any-store-release-enable-pg-cron-in-the-purge-s-migration-and-lock-cards-and-reviews-while-it-purges.md) records why the purge was built before any store release, why its migration enables `pg_cron`, and why a run locks `cards` and `reviews`; issue #108 records the owner's decision.
- [ADR 0107](adr/0107-store-media-in-a-private-supabase-storage-bucket-named-by-media-id-and-give-each-deck-an-image.md) records why media lives in a private Supabase Storage bucket named by media id rather than in S3 or by URL, the path scheme and size limits, who reads a public deck's image, and why `delete-account` deletes the files through the Storage API first.
- Issue #104 records the uuid conversion, issue #105 the checks and the merged select policies, issue #103 the streak function, issue #106 the horizon and the watermark, issue #107 the web's version 7 ids, and issue #113 the advisor lints read after #112.
- Issue #23 records the decisions made by the PM; issue #25 records those for the extraction count, issue #24 the fuzz factor column, issue #29 public decks, issue #67 counting each user's copy once, and issue #26 account deletion.

## Open questions

- None.
