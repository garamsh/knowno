# ADR 0034: Key synced rows by client-made uuids, keep time in `timestamptz` and UTC text, purge tombstones past a revision horizon, and index each query

> Status: accepted; the cursor its horizon rebuild reads, and its local purge's deletion of unreferenced card and deck tombstones, superseded by ADR-0041; its order placing step 6 after step 4's store release superseded by ADR-0053; its card state tombstones, their purge index and the partial index on live reviews superseded by ADR-0077; its owner approval before an owner-marked step superseded by ADR-0246
> Date: 2026-10-16

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #93 asks for a production-grade data model, decided with evidence, before more features build on it. The owner decided on 2026-10-16 that ids are uuids. This ADR is the design; the PM opens the implementation issues from it.
- The schema was read on `main` at `b4958d25d79c43fd935ec764c34e1816846804b8`. The queries #95 added were read at `cf494ca6fcc4fbd2e934f3ad5acdcfd191d141f4`, where it merged with [ADR 0033](0033-count-cards-left-per-study-day-from-04-00-and-continue-as-unrecorded-practice.md), and are measured on the same seed:
  - `supabase/migrations/` creates nine tables in `public`. `decks`, `cards` and `reviews` have `text` primary keys; `card_states` is keyed `(user_id, card_id)`; `profiles`, `deck_reports`, `user_blocks` and `deck_imports` have composite or uuid keys; `extraction_usage` has an identity.
  - Both clients already create v4 uuid strings: the app through `uuid`'s `v4` (`app/lib/main.dart:79-85`), and the web through `crypto.randomUUID()` (`web/src/features/study/components/study-screen.tsx:64`).
  - Every time column on the server is already `timestamptz`.
  - Tombstones are never purged.
  - The phone's drift schema v5 (`app/lib/shared/database.dart`) has one index, `cards (deck_id, card_key)`, and stores every `DateTime` as Unix seconds.
- The production database holds the owner's real data: at least one deck of 60 cards with its reviews. Every step below keeps that data.
- Measurements were taken on a local stack seeded to scale and on a matching SQLite file. The scripts, the seed and every plan, before and after, are in [`0034-appendix-explain-plans.md`](0034-appendix-explain-plans.md). The seed:
  - one heavy user with 20 decks, 10,000 cards and 100,000 reviews;
  - 1,999 ordinary users with 3 decks and 300 cards each, three reviews per card;
  - 609,700 cards in all, about 1.9 million reviews, and 2,001 public decks, 1,893 of them visible;
  - 10% of cards and 5% of decks are tombstones.
  - The server is Supabase CLI 2.120.0's Postgres 17 image (`supabase/config.toml`, `major_version = 17`). The phone is SQLite 3.51.0, the macOS `sqlite3`.
- Alternatives passed over, by item:
  1. Keys:
     - keeping `text` keys, against the owner's decision and at 36 characters compared by collation;
     - v4 for new rows, which forgoes the measured locality;
     - ids defaulted on the server, which a device offline cannot wait for;
     - `bigint` identities, which a device cannot make offline and which can be enumerated;
     - an expand-and-contract conversion through shadow `uuid` columns written alongside the text ones, which would add four steps and dual writes when the wire format does not change.
  2. Time:
     - a server-set `updated_at`, which would order offline edits by upload;
     - keeping Unix seconds on the phone, which ties edits within a second and drops the web's milliseconds;
     - integer milliseconds through a type converter on every `DateTime` column, where drift documents and recommends its text mode.
  3. Deletion:
     - keeping tombstones forever, today's state, where tables grow with every delete;
     - a fixed time-to-live with no horizon, where a device unsynced past it keeps deleted rows, the failure Couchbase documents;
     - purging by `deleted_at`, a device's clock;
     - a shorter retention such as Couchbase's 3 days, which would make full rebuilds routine;
     - for the owner's rule that study history survives deletion:
       - keeping reviews past their card's purge by `on delete set null (card_id)`, which Postgres 15 and later allow for `on delete` only (sql-createtable: "A subset of columns can only be specified for ON DELETE actions"). It loses which card each review was of, which #90's retention and mastered count need;
       - a per-day roll-up of reviews before the purge, which keeps the streak and day counts but not the per-card history, and is a second table to sync and keep equal to the reviews;
       - never purging card tombstones, which keeps the content the user deleted.
  4. Indexes:
     - adding a `deck_id` index beside `cards_user_id_deck_id`, two indexes on every card write;
     - adding the owner to the preview query instead, which leaves released apps scanning;
     - a partial index on cards, which the cascade cannot use for tombstones.
  5. Constraints: validating each check in the statement that adds it, which holds the write lock through the scan.
  6. Public decks:
     - a trigram index now, whose upkeep buys nothing at today's size and nothing for two-syllable words;
     - full-text search, which has no Korean configuration;
     - a stored card count.
  7. Access:
     - keeping two select policies, which the advisor flags and which build the public hash on every own-row read;
     - making `list_public_decks` `security definer`, which would bypass the policies it relies on.
  8. Phone:
     - 16-byte `BLOB` ids;
     - the server's checks on the device.
  9. Migration: a maintenance window, which nothing here needs at production's size.
  10. Observability: an external monitoring service, where the platform's advisors and `pg_stat_statements` cover these queries.
- Sources, each read 2026-10-16:
  - PostgreSQL 17 manual:
    - uuid type: <https://www.postgresql.org/docs/17/datatype-uuid.html>
    - UUID functions: <https://www.postgresql.org/docs/17/functions-uuid.html>
    - `ALTER TABLE`: <https://www.postgresql.org/docs/17/sql-altertable.html>
    - constraints and foreign keys: <https://www.postgresql.org/docs/17/ddl-constraints.html>
    - partial indexes: <https://www.postgresql.org/docs/17/indexes-partial.html>
    - multicolumn indexes: <https://www.postgresql.org/docs/17/indexes-multicolumn.html>
    - `CREATE INDEX`: <https://www.postgresql.org/docs/17/sql-createindex.html>
    - `pg_input_is_valid`: <https://www.postgresql.org/docs/17/functions-info.html>
    - date and time types: <https://www.postgresql.org/docs/17/datatype-datetime.html>
    - pg_trgm: <https://www.postgresql.org/docs/17/pgtrgm.html>
    - text search: <https://www.postgresql.org/docs/17/textsearch-intro.html>
  - PostgreSQL 18 release notes, for `uuidv7()`: <https://www.postgresql.org/docs/release/18.0/>
  - RFC 9562, UUIDs: <https://www.rfc-editor.org/rfc/rfc9562.html>
  - Tomas Vondra, "Sequential UUID generators", EDB, 2018-11-27: <https://www.enterprisedb.com/blog/sequential-uuid-generators>
  - Supabase:
    - choosing a primary key, 2022-09-08: <https://supabase.com/blog/choosing-a-postgres-primary-key>
    - row-level security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
    - row-level security performance: <https://supabase.com/docs/guides/database/postgres/row-level-security-performance>
    - database functions: <https://supabase.com/docs/guides/database/functions>
    - advisors: <https://supabase.com/docs/guides/database/database-advisors>
    - the linter, with the lints `0001_unindexed_foreign_keys`, `0003_auth_rls_initplan`, `0006_multiple_permissive_policies` and `0011_function_search_path_mutable`: <https://supabase.com/docs/guides/database/database-linter>
    - `supabase inspect db outliers`: <https://supabase.com/docs/reference/cli/supabase-inspect-db-outliers>
    - Cron: <https://supabase.com/docs/guides/cron> and <https://supabase.com/docs/guides/cron/quickstart>
    - the changelog entry on Postgres 17 as the platform default, 2026-05-18: <https://supabase.com/changelog/46080-self-hosted-supabase-upgrading-from-pg-15-to-17-breaking-change>
    - Supabase CLI v2.109.0 release notes, on `CREATE INDEX CONCURRENTLY` in migrations: <https://github.com/supabase/cli/releases/tag/v2.109.0>
  - drift, documenting 2.35.2:
    - tables, for datetime options and `TableIndex.sql`: <https://drift.simonbinder.eu/dart_api/tables/>
    - datetime migrations: <https://drift.simonbinder.eu/guides/datetime-migrations/>
    - migrations API: <https://drift.simonbinder.eu/migrations/api/>
    - migration tests: <https://drift.simonbinder.eu/migrations/tests/>
  - SQLite:
    - partial indexes: <https://www.sqlite.org/partialindex.html>
    - foreign keys: <https://www.sqlite.org/foreignkeys.html>
    - the query planner: <https://www.sqlite.org/queryplanner.html>
    - `ALTER TABLE`: <https://www.sqlite.org/lang_altertable.html>
  - Dart `uuid` 4.6.0 and its changelog: <https://pub.dev/packages/uuid> and <https://pub.dev/packages/uuid/changelog>
  - npm `uuid` 14.0.3 changelog: <https://github.com/uuidjs/uuid/blob/main/CHANGELOG.md>
  - MDN, `Crypto.randomUUID()`: <https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID>
  - Couchbase Sync Gateway 3.2, managing tombstones: <https://docs.couchbase.com/sync-gateway/3.2/managing-tombstones.html>

## Decision

### 1. Keys

- **Type.** Every synced id, and every column that references one, becomes `uuid`:
  - `decks.id`, `cards.id`, `cards.deck_id` and `cards.origin_deck_id`;
  - `reviews.id`, `reviews.card_id` and `card_states.card_id`;
  - `deck_reports.deck_id` and `deck_imports.deck_id`.
  - A `uuid` is a 128-bit value, 16 bytes against the text form's 36 characters, compared as bytes rather than by collation (datatype-uuid).
  - Clients keep creating ids, since a device creates rows offline. No id column takes a default, so a client that forgets an id is refused rather than given one.
- **Version 7 for new rows.**
  - RFC 9562 §2.1: "UUID versions that are not time ordered, such as UUIDv4 … have poor database-index locality". §5.7 puts a 48-bit Unix millisecond timestamp first.
  - Vondra measured random keys spreading inserts across every index page, which "inflates the amount of generated WAL" through full-page images after each checkpoint.
  - Measured here: 2,000,000 inserts in four transactions with a checkpoint between them took 55.5 s and wrote 438 MB of WAL under v4 keys. Under v7 keys, made by a SQL function that also had to be called, they took 30.8 s and wrote 329 MB. The primary-key index ended at 77 MB against 60 MB.
  - `reviews` is the table that grows with every answer, so the locality pays where the rows are.
- **What v7 leaks, and why that is acceptable.** RFC 9562 §8: "Timestamps embedded in the UUID do pose a very small attack surface". A v7 id tells whoever can read it when the row was made. Every row that carries an id already carries `created_at`, `reviewed_at` or `published_at` beside it, under the same row-level security, so the id discloses no time the row does not. No id serves as a secret or a capability anywhere (§8: they "MUST NOT be used as security capabilities").
- **Generators.**
  - The app has v7 in the `uuid` package it already pins: `Uuid().v7()`, since 4.0.0, and 4.6.0 is locked.
  - The browser's `crypto.randomUUID()` makes v4 only (MDN). The web takes the npm `uuid` package, whose `v7()` exists since 10.0.0. It is pinned exactly, as `web/package.json` pins every package, and Dependabot's `npm` entry for `/web` moves it. Its advisory check is part of the issue that adds it.
  - The server does not generate ids: Postgres 17 has only `gen_random_uuid()`, a v4 (functions-uuid). `uuidv7()` arrives in Postgres 18, and Supabase's platform default is still 17.
- **Mixed versions.** Rows made before the change keep their v4 ids, and nothing reads the version.
- **Conversion.**
  - A check runs first. Every value of every column above must match `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`.
    - Postgres also accepts upper case, braces and missing hyphens (datatype-uuid), and its output "is always in the standard form".
    - A value in any other form would come back changed, and the phone, which keeps ids as text, would then hold two ids for one row. So the check is stricter than `pg_input_is_valid`: only values that round-trip unchanged pass.
    - Measured on the seed, the check found no bad value among 2.5 million rows in 28 s. Production holds hundreds.
  - The cast is `ALTER COLUMN … TYPE uuid USING col::uuid`, which rewrites each table and its indexes under an `ACCESS EXCLUSIVE` lock (sql-altertable).
  - It cannot run with the policies in place. Measured: Postgres refuses with `cannot alter type of a column used in a policy definition` for `cards_select_public` and `deck_reports_insert`. A composite foreign key cannot span a text and a uuid column. So one transaction:
    - drops the five foreign keys on converted columns and those two policies;
    - casts every column;
    - recreates the keys and the policies.
    - Measured on the seed, the transaction took 53.7 s, and the per-table count and `md5` of the ids were equal before and after. At production's few hundred rows, the locks last milliseconds.
  - `list_public_decks` must be recreated to return `uuid`, and `record_deck_import` to take one. Their bodies are not checked when the column type changes, and comparing `uuid` with `text` has no operator.
  - `hide_reported_deck` hashes `new.deck_id::text`. The text is the same, so the advisory lock key is unchanged.

### 2. Time

- **Server.** Every time column stays `timestamptz`: stored as UTC with microsecond resolution (datatype-datetime). That is already true of every column, and a new one follows it.
- **Phone.**
  - Schema v6 stores `DateTime` as ISO-8601 text in UTC, through drift's `store_date_time_values_as_text`. drift calls it "recommended for most applications due to its higher precision and timezone awareness"; its default is "unix timestamps in seconds … No timezone information or sub-second accuracy".
  - drift compares textual values "lexicographically", and so would `ORDER BY`. Every write is therefore made in UTC and truncated to the millisecond, so every value has one length and one zone, and text order is time order.
  - The web's `Date` already carries milliseconds, so both clients then send the server the same precision. ADR 0015's same-second ties become same-millisecond ties.
- **Ownership.**
  - `updated_at` stays the client's: the edit's time on the device that made it, which ADR 0015's last-writer-wins compares. A server-set `updated_at` would date an offline edit by its upload: an edit made earlier but pushed later would win.
  - `created_at`, `reviewed_at` and `deleted_at` stay the client's for the same reason.
  - `revision` stays the server's trigger's ([ADR 0010](0010-server-schema-and-row-level-security.md)), so the pull order never depends on a device clock.

### 3. Deletion

- **Why tombstones cannot be dropped at once.** A device learns of a delete only by pulling the tombstone above its cursor. Drop the tombstone before the device pulls it, and the device keeps the row forever. Couchbase's Sync Gateway names that failure for its 3-day default: "tombstones being purged before all clients have had a chance to be notified".
- **The horizon.** Retention is 90 days, made safe at any length by a horizon:
  - A `pg_cron` job (Supabase Cron is `pg_cron`) runs daily at 18:00 UTC, 03:00 in Korea. It records the sequence's last value in `private.revision_marks`.
  - It then purges the `decks`, `cards` and `card_states` tombstones whose `revision` is at or below the mark taken 90 days earlier, as the next bullet decides, and stores that mark in `private.sync_horizon`.
  - The marks are server time, so no device clock decides what is purged.
  - `public.sync_horizon()`, `security definer`, returns the horizon to `authenticated`.
  - A device whose cursor for a table is above zero but below the horizon may have missed a purged tombstone. It rebuilds that table: it pulls from revision 0, deletes each synced local row the pull did not return, and pushes ([`sync.md`](../sync.md)). Ninety days bounds how often that full pull happens, not whether deletes arrive.
  - Measured: deleting the seed's tombstones below a horizon took 68.7 ms without the partial index on `revision`, read through `cards_user_id_revision`, and 11.0 ms with it.
- **Study history survives deletion.** The owner decided on 2026-10-16 (issue #93) that deleting a card or a deck removes its content, not its reviews: the streak and #90's statistics keep counting them, on the server and on the phone. Clients cannot tombstone a review ([ADR 0010](0010-server-schema-and-row-level-security.md)), so only the purge and account deletion could remove one. The purge therefore treats a tombstone by whether reviews hang from it:
  - a card tombstone that no review references is deleted, with its card state;
  - a card tombstone that reviews reference keeps its row, stripped of its content: `front` and `back` become `[]` and `card_key` becomes `''`. Its id, deck, times and `deleted_at` stay, so each review keeps the card it was of. #90's retention leaves out "a card's first answer", and its mastered count is per card, so both need that link;
  - a card state tombstone is deleted; the reviews refold it on demand;
  - a deck tombstone that no card row references any longer is deleted; one that still holds stripped cards keeps its row with `name` `''`, `description` null, and `visibility` `private`.
  - The strip is an update, so the revision trigger gives it a new revision. Devices pull it like any edit and drop the content from their own copy of the tombstone. Only the rows that are deleted outright need the horizon.
  - Storage stays bounded. A kept card row holds ids, times and a revision, the same kind of row as a review. Each one is kept only while at least one review references it, so kept card rows never outnumber the reviews they keep. Reviews grow with study, not with deletes, and account deletion removes them all ([ADR 0026](0026-delete-the-account-through-an-edge-function.md)).
  - The device's local purge, after a run that leaves nothing unsynced, follows the same rule. It deletes a tombstoned card that no review references, with its state, and a tombstoned deck that no card references. It strips the others in place, so its foreign keys never cascade to a review. The streak and #90's statistics read reviews without filtering on whether their card is live.
  - The cron job also deletes `cron.job_run_details` rows older than 30 days, which Supabase says "grows with every Job run and is never cleaned up automatically".
- **Account deletion.** [ADR 0026](0026-delete-the-account-through-an-edge-function.md) is unchanged: every table still cascades from `auth.users`, and the purge's tables hold no user id. The new indexes make its cascade read by index where it now scans: measured, deleting an ordinary user took 34.9 ms before and 9.1 ms after. The three cascades that had no index took 8.6, 4.3 and 5.5 ms before, and under 0.2 ms each after.

### 4. Indexes

One index per real query, each named. Postgres does not index a referencing column itself: "the declaration of a foreign key constraint does not automatically create an index on the referencing columns" (ddl-constraints). Supabase's lint `0001_unindexed_foreign_keys` flags it.

Server, query → index. Times are warm `EXPLAIN (ANALYZE)` runs on the seed, the heavy user's for its own rows, before and after the whole target: uuid keys, these indexes and §7's policies.

| Query | Index | Measured before → after |
|---|---|---|
| Pull a page, `app/lib/sync/src/supabase_sync_server.dart:56-62` | `{table}_user_id_revision` (exists) | 4.73 → 0.24 ms |
| Pace, `web/src/features/study/read-pace.ts:28-34`; one study day's reviews for #87, #89, #90 on the web | `reviews_live_user_id_reviewed_at (user_id, reviewed_at) where deleted_at is null` (new) | 101.3 → 0.57 ms; 36.9 → 0.24 ms |
| Deck list decks, `web/src/features/decks/read-library.ts:48-56` | `decks_user_id_id_key` (exists) | 0.07 → 0.03 ms |
| Deck list cards, `read-library.ts:59-67` | `cards_user_id_id_key` (exists) | 8.5 → 1.0 ms |
| A study selection's cards, `read-library.ts:64` | `cards_deck_id_created_at_id` (new) | 5.0 → 1.1 ms |
| Card states, `web/src/features/study/read-states.ts:24-32` | `card_states_pkey` (exists) | 3.5 → 0.75 ms |
| Toggle a review, `supabase_sync_server.dart:152-156` and `web/src/features/study/record-answer.ts:53-57` | `reviews_pkey` (exists) | 8.8 → 0.44 ms |
| Today's reviews, first page and count, `web/src/features/study/read-today.ts:55-61` | `reviews_live_user_id_reviewed_at` (new) | 76.4 → 0.45 ms; count 89.9 → 0.22 ms, index only |
| Earlier reviews of up to 100 of today's cards, `read-today.ts:80-91` | `reviews_user_id_card_id` (exists), on `(user_id, card_id = any(…))` | 6.3 → 1.5 ms |
| The streak, 1,000 earlier answers a page newest first until a day gap, `read-today.ts:121-129` | replaced by `study_streak_before` (§9, step 7), one backward probe of `reviews_live_user_id_reviewed_at` per study day | first page 140.6 → 1.5 ms, page 50 118.1 → 92.5 ms; the function 40.6 ms for 365 days in one request |
| Preview a public deck, `app/lib/sharing/src/supabase_sharing_server.dart:62-69` | `cards_deck_id_created_at_id (deck_id, created_at, id)` (new) | 6.9 → 1.1 ms warm; 285 → 14 ms cold |
| `list_public_decks`, newest; its card count | `decks_public_published_at` (exists); `cards_deck_id_created_at_id` | 14.8 → 6.5 ms |
| `list_public_decks`, most copied with a search | none below the threshold in §6 | 31.5 → 12.9 ms |
| Delete an account: the cascade to `deck_reports`, `user_blocks` and `deck_imports` | `deck_reports_reporter_id`, `user_blocks_blocked_id`, `deck_imports_user_id` (new) | 34.9 → 9.1 ms |
| Purge | `{decks,cards,card_states}_tombstone_revision (revision) where deleted_at is not null` (new) | 68.7 → 11.0 ms |

- `cards_deck_id_created_at_id` replaces `cards_user_id_deck_id`. Deck ids are unique across users (`decks_pkey`), so an index led by `deck_id` serves:
  - the composite foreign key's cascade;
  - the web's `deck_id in (…)`;
  - the public preview, which filters on `deck_id` alone because the deck is another user's;
  - the listing's count.
  - The old index's leading `user_id` could serve the preview only by scanning all of a user's cards; the preview does not know the user, so its plan read the whole index and filtered on `deck_id`.
  - The new index is not partial, since the cascade must find tombstones too.
- `reviews_live_user_id_reviewed_at` is partial on `deleted_at is null`, as every query on it filters. A partial index "can be used in a query only if the system can recognize that the WHERE condition of the query mathematically implies the predicate" (indexes-partial).
- The tombstone indexes hold only tombstones, so they stay as small as the purge keeps them.
- Indexes are created with plain `CREATE INDEX` in a migration. At production's row counts the `SHARE` lock lasts milliseconds. `CREATE INDEX CONCURRENTLY` "cannot" run in a transaction block (sql-createindex). Supabase CLI v2.109.0's release notes say "`migration up`/`down` now handle `CREATE INDEX CONCURRENTLY`". They say nothing of `db push`, so a migration on a larger table uses `CONCURRENTLY` only once its issue has shown that `db push` runs it.

Phone, query → index (`app/lib/`), timed by the `sqlite3` shell's `.timer` (real time, whose resolution is 1 ms) on the heavy user's 10,000 cards and 100,000 reviews:

| Query | Index | Measured before → after |
|---|---|---|
| Deck list, `deck/src/deck_repository.dart:44-46` | none: one row per deck, sorted in a temporary B-tree | under 1 ms, unchanged |
| A deck's cards, oldest first, `deck_repository.dart:166-170`, `178-182` | `cards_deck_id_created_at (deck_id, created_at)` (new) | 1 ms both; the temporary B-tree for `ORDER BY` goes |
| A deck's card count, `deck_repository.dart:135-139`; counts per deck, `148-151`; duplicate check, `370-380` | `cards_deck_id_card_key (deck_id, card_key) WHERE deleted_at IS NULL` (rebuilt as partial) | index search before and after |
| Pace, `study/src/study_repository.dart:90-94`; one study day's reviews for #87, #89, #90 | `reviews_live_reviewed_at (reviewed_at) WHERE deleted_at IS NULL` (new) | 20 → 1 ms; 15 → 1 ms, from a full scan to an index search |
| One card's reviews for the fold, `sync/src/sync_store.dart:204-208`; the cascade from `cards` | `reviews_card_id_reviewed_at (card_id, reviewed_at)` (new) | 18 → under 1 ms; 1,907 → 26 ms |
| States of a selection, `study_repository.dart:25-30` | `card_states` primary key (exists) | index search, unchanged |
| Unsynced rows, `sync_store.dart:241-252`; any unsynced row, `sync_store.dart:83-86` | `{table}_unsynced (id) WHERE "dirty"` (new, one per synced table) | 8 → 1 ms; `dirty = 1` still scans |
| First answers since the day began, `study/src/study_repository.dart:88-101` (`min(reviewed_at)` per `card_id`, `having` ≥ the start) | `reviews_card_id_reviewed_at` and `reviews_live_reviewed_at`, after a rewrite that groups only the cards answered since the start | 64 ms; the indexes alone 92 ms; rewritten 4 ms |
| Answers since the day began, `study_repository.dart:104-125` | `reviews_live_reviewed_at` | 14 → 2 ms |
| Every answer's time for the streak, `study_repository.dart:128-140` | `reviews_live_reviewed_at`, read one probe per study day instead of every row | 126 ms; the index alone 50 ms; 7 ms by probes for 365 days |

- The #95 queries, by the same rule:
  - **Earlier reviews of today's cards** need no new index: `reviews_user_id_card_id`, which the composite foreign key's cascade already required, takes `card_id = any(…)` under `user_id`. Its plan shows both in the index condition.
  - **The streak** read on the web pages 1,000 answers at a time. A user with 100,000 answers and a year's streak sends 100 requests, each reading deeper by offset: page 50 still read every one of the user's rows in 92.5 ms after the indexes.
    - A function returning the streak in one request replaces the paging (§9, step 7). It walks back one study day at a time from the day before `before`, taking `max(reviewed_at)` before each day's end, which Postgres answers with one backward probe of `reviews_live_user_id_reviewed_at`. It stops at the first day with no answer. It counts the same days as `web/src/features/study/queue.ts`'s streak, with day boundaries at 04:00 in the zone the call names, so a day across an offset change starts and ends at 04:00 local time, as ADR 0033 reads them.
    - Measured: 366 probes, 40.6 ms in one statement.
    - A function returning every distinct study day was passed over: it would read every answer of the user to return days the streak stops reading at the first gap.
    - A first form, an `exists` per day, was planned as one read of all the user's rows and took 360 ms; the `max()` form is the one specified.
  - **On the phone**, `firstAnswersSince` groups every review by card to find the cards first answered since the day began. Indexes alone made it slower, from 64 to 92 ms, because the grouping still visits every row in card order. Step 4 rewrites it to group only the cards with an answer since the start, found through `reviews_live_reviewed_at`, then read through `reviews_card_id_reviewed_at`: 4 ms.
  - `answerTimes` reads every answer's time to count the streak. Step 4 replaces it with the same walk as the server's, one probe of `reviews_live_reviewed_at` per study day with the day boundaries computed in the app: 7 ms for 365 days, against 50 ms for reading every row through the index.
- SQLite says child key indexes "are not required … but they are almost always beneficial" (foreignkeys). Without `reviews (card_id)`, deleting 100 cards scanned `reviews` once per card: measured, 1.907 s against 0.026 s with the index.
- SQLite uses a partial index only when a term of the query matches the index's term (partialindex: "SQLite does not have a sophisticated theorem prover").
  - Measured: `WHERE "dirty"`, which drift writes for `row.dirty`, uses `reviews_unsynced`. `WHERE dirty = 1` in `hasUnsynced` still scans.
  - So the implementation writes that check as `WHERE "dirty"`.
- drift declares a partial index only through `TableIndex.sql` (tables page), which the four partial indexes use.

### 5. Constraints

- **NOT NULL.** Every column is `not null` except those whose null means something: `deleted_at`, `published_at`, `description`, `origin_deck_id` and `fuzz_factor`. That holds today and binds new columns.
- **Checks added.** Each is guarded by a count of the rows that would fail it, which must be zero on production before the check is added (§9, step 3):
  - `decks_name_check`: `deleted_at is not null or name <> ''`. The app refuses an empty name and trims it (`app/lib/deck/src/name_sheet.dart:51`); a purged deck's stripped row (§3) has none.
  - `cards_card_key_check`: `deleted_at is not null or card_key <> ''`. The app refuses an empty front; a purged card's stripped row has none.
  - `card_states_stability_check`: `stability >= 0.001`; `card_states_difficulty_check`: `difficulty between 1 and 10`. These are the engine's clamps (`engine/src/fsrs.rs:14-16`).
  - `cards_origin_deck_id_check`: `(source = 'shared') = (origin_deck_id is not null)`, which the import sets (`deck_repository.dart:304-311`).
- **How they are added.** Each check is added `not valid`, then validated in a second statement, so validation does not hold the write lock. On production's rows both take milliseconds.
- **Uniqueness and foreign keys** keep their shape: `(user_id, id)` unique on `decks` and `cards` as the target of the composite keys that keep references inside one user, `on delete cascade` from every user reference.
- **Names.** Constraints keep Postgres's defaults, and one added by name follows them: `{table}_pkey`, `{table}_{columns}_key`, `{table}_{columns}_fkey`, `{table}_{column}_check`. Indexes are `{table}_[{predicate}_]{columns}`, the form `decks_public_published_at` already has. The predicate words are `live`, `tombstone`, `public` and, on the phone, `unsynced`.
- **None of these checks is copied to the phone** (§8).

### 6. Public decks

- **Search stays `strpos` over `lower()`**, a scan of the visibly public decks.
  - Measured at 2,001 public decks, the most-copied listing with a search took 31.5 ms, and 12.9 ms after the other changes here.
- **pg_trgm** "support[s] trigram-based index searches for LIKE, ILIKE" (pgtrgm).
  - On Korean, measured: `show_trgm('영단어 단어장')` returns eight trigrams, stored as hashes because they are not ASCII. A GIN trigram index served a search for `단어장` from the index, in 3.7 ms.
  - A two-syllable search such as `단어`, the common length of a Korean word, extracts no full trigram. pgtrgm says such a pattern "will degenerate to a full-index scan". Measured: the planner left the trigram index unused for `%단어%` and read every visible public deck.
  - So the index helps only searches of three syllables or more.
- **Full-text search** has no Korean configuration in this Postgres. Measured: `pg_ts_config` lists 29 configurations, `arabic` to `yiddish` and `simple`, with no Korean among them. It would need an extension Supabase does not list.
- **Threshold.** The PM adds the trigram GIN index, partial on visibly public decks, when either holds:
  - `supabase inspect db outliers` lists `list_public_decks` among the ten statements of highest total time;
  - 20,000 public decks exist.
  - Until then the scan costs less than the index's upkeep on every deck write.
- **Sort.** Newest reads `decks_public_published_at`. Most copied sorts the visible public decks on each call, a top-50 heap sort measured within those 12.9 ms, and is covered by the same threshold.
- **Card count.** It stays a correlated count, now read through `cards_deck_id_created_at_id` for the 50 listed decks. A stored count kept by trigger was passed over: every card write of every user would pay for a number read only on the listing.

### 7. Access control

- **Policy shape.** One policy per command and table, each naming `to authenticated` and reading `(select auth.uid())`, the form Supabase's RLS guide recommends ("Wrapping the function causes an initPlan to be run"; "Always name the role a policy applies to"). Lint `0003_auth_rls_initplan` checks it.
- **One select policy.** `decks`, `cards` and `profiles` each have two permissive select policies, owner and public, which lint `0006_multiple_permissive_policies` flags. Each pair becomes one policy that ORs the two conditions. Policies of one command already combine with `or`, so no row changes visibility.
- **The owner's condition first.** Measured: with today's two policies, every query on the user's own `cards` first builds a hash of every visible public deck (1,893 rows on the seed) for the public policy, even though the owner policy already admits every row. With one policy whose owner condition comes first, the plan shows that hash "never executed", and the cards pull fell from 4.73 to 0.24 ms. The hash's cost grows with the number of public decks, so the order is part of the decision.
- **Keys compared as bytes.** `card_states`, which has no public policy, read its page 3.5 → 0.75 ms through the same primary key. The key's type is the only change: a `text` key compares by `en_US.UTF-8` collation, a `uuid` key by bytes.
- **Filters in queries.** Every query also filters on what its policy does: `user_id = $me` in pulls and web reads. Supabase's performance guide: "Postgres can use the filter to construct a better query plan". The plans above are taken under row-level security with those filters.
- **Functions.**
  - Functions run as `security invoker`, the default Supabase prefers, unless they must reach what the caller cannot. Those are the revision trigger, `consume_extraction`, `hide_reported_deck`, `record_deck_import`, `sync_horizon` and the purge.
  - Each `security definer` function sets `search_path = ''`, as Supabase's functions guide requires and lint `0011_function_search_path_mutable` checks.
  - Each revokes `execute` from `public` and grants it to the one role that calls it.
- **Grants.** Each migration revokes every privilege from `anon` and `authenticated` on a new table and grants back per command or column, as [ADR 0010](0010-server-schema-and-row-level-security.md) began. `private` stays outside the API's schemas.

### 8. Phone schema

- **What mirrors the server.** The phone keeps the server's ids as text and times at the precision it sends. SQLite has no uuid type, and a 16-byte `BLOB` key would rewrite every table and every id read for tables of thousands of rows. Production's ids pass the lowercase check of §1 before step 2 of §9 converts them, so a pulled id equals the stored one. The v7 generators of steps 4 and 5 are tested to emit that form.
- **Migration to v6.** One `stepByStep` step:
  - rebuilds `decks`, `cards`, `reviews` and `card_states` with `TableMigration`, converting each datetime from Unix seconds to UTC text as drift's datetime-migration guide does;
  - creates the indexes of §4.
  - `TableMigration` follows SQLite's 12-step procedure, which keeps every row. The `dirty` flags are copied with the rows, so a phone upgrading with unsynced rows still pushes them.
  - Foreign keys are off during the migration, so no cascade fires on the rebuild. drift's migration guidance checks `PRAGMA foreign_key_check` afterwards.
- **Test.** The `make-migrations` test for v5 → v6 starts from unsynced and tombstoned rows and reads them back equal, times included ("migrateAndValidate will extract all CREATE statement from the sqlite_schema table and semantically compare them").
- **No server checks on the device.** A check that one stored row fails aborts the rebuild, and the app no longer opens its database. The server refuses such a row on push instead, which the run reports as `SyncFailed`.

### 9. Migration plan for production

Each step is one pull request and, on the server, one migration that the PM pushes after merge. The steps are numbered by when they were decided, not by order; the order is the list after them. "Owner" marks a step that changes or deletes existing data; the PM pushes it only after the owner approves.

1. **Server indexes** (additive).
   - Creates the six new server indexes and drops `cards_user_id_deck_id` after its replacement exists.
   - No release order and no downtime.
   - Rollback: drop the new indexes and recreate the old one.
   - Verify: `pg_indexes` lists them, and `EXPLAIN` of the pace, the public preview and an account deletion shows them read.
2. **Keys to uuid** (owner: changes column types).
   - The check query from §1 runs in the migration and raises if it finds a value.
   - One transaction converts, recreates the keys and policies, and recreates `list_public_decks` and `record_deck_import`.
   - No release order: released clients send and read the same JSON strings.
   - Downtime: the `ACCESS EXCLUSIVE` locks for the transaction, milliseconds at production's size.
   - Rollback: a migration casting back with `USING col::text`, which returns the same strings because the check admitted only canonical ones.
   - Verify: before and after, per table, `count(*)` and `md5(string_agg(id::text, ',' order by id::text))` are equal; the pgTAP suite passes.
3. **Checks and policies** (owner: validates existing rows).
   - A query counts each check's violations first and raises unless all are zero. Adds the five checks `not valid`, then validates them. Replaces the two-policy pairs with one select policy each.
   - No release order.
   - Rollback: drop the checks; recreate the former policies.
   - Verify: `pg_constraint` shows the checks validated; the RLS tests pass; the Security Advisor shows no `0006` lint.
4. **App: schema v6, v7 ids, horizon-aware sync** (app release).
   - The local migration of §8; new ids from `v7()`; the run reads `sync_horizon()` and rebuilds below it; the local purge.
   - `firstAnswersSince` grouped only over the cards answered since the start, and the streak read by one probe per study day in place of `answerTimes` (§4).
   - `sync_horizon()` ships in this step's server migration, returning 0 until a purge has run. That migration is additive and goes before the release.
   - Rollback: an app release cannot be withdrawn from devices that took it; the release is tested with the migration test of §8 and the two-device test against a stack with steps 1 to 3 applied.
   - Verify: the v5 → v6 migration test; a device upgraded with unsynced rows pushes them.
5. **Web: v7 ids** (web deploy). The web's answers take `uuid`'s `v7()`. No order with the app. Rollback: redeploy the previous build.
6. **Purge job** (owner: deletes tombstones no review references, and strips the content of those that reviews do).
   - Creates `private.revision_marks`, the `pg_cron` job and the purge function, after step 4's release is in the stores.
   - The first purge comes 90 days after the first mark.
   - Rollback: `cron.unschedule` stops it. Purged tombstones do not return, which the horizon makes safe.
   - Verify: `cron.job_run_details` shows daily success; `sync_horizon()` rises after day 90; a device below it rebuilds in the two-device test; pgTAP shows a studied card's tombstone stripped with its reviews kept, and an unstudied one deleted.
7. **Server streak function and the web's streak read** (migration, additive; web).
   - `public.study_streak_before(time_zone text, before timestamptz) returns integer`: `security invoker`, so the policies decide what it reads; `stable`, `set search_path = ''`; `execute` revoked from `public` and `anon` and granted to `authenticated`. A zone Postgres does not know raises, and the web passes only the zone it already validated or Asia/Seoul.
   - `read-today.ts` calls it through `rpc` in place of `readStreakBefore`'s paging.
   - pgTAP tests the 04:00 boundary, an offset change and a gap against the same fixtures as `queue.ts`'s streak tests.
   - Needs step 1's index. No order with the app, which counts its own streak.
   - Rollback: the web returns to the paging; drop the function.
   - Verify: `EXPLAIN` shows one `Index Only Scan Backward` per day; the web's streak equals the paging's on the same rows.

- **Order against #87–#91.** #87 merged as #95 at `cf494ca6fcc4fbd2e934f3ad5acdcfd191d141f4` with ADR 0033, so its reads are on `main` now:
  - Step 1 comes next. `read-today.ts`'s reads of today's reviews and the streak, and the pace, then read `reviews_live_user_id_reviewed_at` instead of every row the user has. #89 and #90 add phone reads by study day, which the phone's `reviews_live_reviewed_at` (step 4) serves.
  - Step 7 follows step 1, before #91 builds more of the web on `readToday`.
  - Steps 2 and 3 are independent of #88–#91 and can land between them.
  - Step 4 touches the app's database, sync and the three `StudyRepository` reads #95 added. It lands before #89 and #90, which read the same reviews by day, and before #90's statistics, which depend on the local purge's rule for reviews.
  - Step 5 lands with or before #91, which restructures the web.
  - Step 6 comes last.

### 10. Observability

- **Advisors.** After each migration is pushed, the PM reads Supabase's Security and Performance Advisors ("deterministic checks that ship with the platform"). A lint in `0001`, `0003`, `0006` or `0011` is a defect against this ADR. Any other lint is fixed or recorded in an issue.
- **Slow queries.** Monthly, and after each migration, the PM runs `supabase inspect db outliers` ("statements, obtained from pg_stat_statements, ordered by the amount of time to execute in aggregate") and `supabase inspect db index-stats`. That run is the input to §6's threshold and to dropping an index that is never read.
- **The purge.** `cron.job_run_details` records each run. A failure or a missing day is seen there, and a horizon that stops rising is seen through `sync_horizon()`.

## Consequences

- Keys are 16 bytes on the server and compare without collation. Released clients keep working through the conversion, because the wire format does not change.
- New rows insert near the end of each primary key. Ids created after the change reveal their creation time to whoever can read the row, which already shows it.
- The phone keeps the server's millisecond precision, and its order of times is right as long as every write stays UTC and truncated. A write that skips the truncation sorts wrongly within one millisecond.
- The server's tables stop growing with deletes after 90 days. A device left unsynced for longer pays one full pull per table, and an unsynced edit to a row deleted and purged elsewhere is dropped.
- Study history survives deleting a card or a deck, on every device. A deleted card that was studied leaves a row without content for as long as its reviews exist. Only account deletion removes those rows.
- Each real query has an index or a stated reason for none. A new query names its index, or why it has none, in its pull request.
- Searching public decks by one or two Korean syllables stays a scan, even after the trigram index.

## Signs the decision was wrong

- `supabase inspect db outliers` shows an insert into `reviews` among its top statements while v7 ids are in use, which would mean locality was not the cost.
- Users report a deleted deck or card coming back, which would mean the horizon rebuild misses a case.
- Stripped card rows grow to rival live cards in number, which would mean users delete studied cards often enough that a roll-up would store less.
- A device that was unsynced for weeks, not months, rebuilds, which would mean the horizon rises faster than 90 days of marks.
- A phone fails to open its database after the v6 migration, which would mean a stored value the conversion did not expect.
- Users search public decks with one- or two-syllable words often enough that the scan shows in the outliers before 20,000 decks.
- A query reaches production without an index or a stated reason, and the Performance Advisor finds it before a reviewer does.
- Two devices' clocks disagree by enough that last-writer-wins keeps the older edit often enough for users to report it. That would argue for a server-set conflict time after all.

## Errata

- 2026-10-16: §1 "Conversion" says "`hide_reported_deck` hashes `new.deck_id::text`". It hashes `new.deck_id` with no cast (`supabase/migrations/20261015180000_public_decks.sql` line 119 at `b4958d25d79c43fd935ec764c34e1816846804b8`). `hashtextextended` takes only text, so once the column is `uuid` every report insert failed with `function hashtextextended(uuid, integer) does not exist`, measured on a local stack in issue #104's pull request. The decision stands: the conversion's migration recreates the function hashing `new.deck_id::text`, which is the same text, so the lock key is unchanged.
- 2026-10-16: §5 "How they are added" says each check is validated "in a second statement, so validation does not hold the write lock". That holds only when the two statements run in separate transactions. The Supabase CLI applies a migration file as one transaction, and within one transaction the `ACCESS EXCLUSIVE` lock the addition takes is held to commit. Measured on a local stack (Supabase CLI 2.120.0, PostgreSQL 17) in issue #105's pull request: after `add constraint decks_name_check … not valid`, `pg_locks` showed `AccessExclusiveLock` on `decks`, and after `validate constraint` both `AccessExclusiveLock` and `ShareUpdateExclusiveLock`. The decision stands: at production's size the lock lasts milliseconds. A table large enough for the lock to matter needs its validation in a later migration.
- 2026-10-17: §9 says each step's migration is one "that the PM pushes after merge", and that an owner-marked step is pushed "only after the owner approves". Supabase's GitHub integration applies a migration to production when its pull request merges into `main`, so no push follows the merge. #115 merged as `9b98292d2f642e794e5d32d969e3999629c5964b` at 13:55:55Z on 2026-10-16, and its `Supabase Preview` check on that commit ran 13:56:27–13:56:35Z; a `supabase db push` minutes later reported "Remote database is up to date" (issue #117). #118 merged as `a940deaef30ca376e34cd83631bd4112055cda6a` at 15:41:51Z, with the check at 15:42:24–15:42:33Z. The decision stands, that the owner approves before a step changes or deletes existing data. The approval now comes before the pull request merges, and `main` is the deployed state ([`server.md`](../server.md)).
- 2026-10-17: §2 "Phone" says drift compares textual values "lexicographically". drift 2.35.2's query API does not. A comparison of two `DateTime` expressions, and `isBetween`, is written through `julianday()` when times are stored as text: `lib/src/runtime/query_builder/expressions/expression.dart` and `comparable.dart` in drift 2.35.2. Measured with `EXPLAIN QUERY PLAN` on schema v6 in issue #106's pull request: drift's `reviewedAt.isBiggerOrEqualValue(…) & deletedAt.isNull()` plans as `SCAN reviews USING INDEX reviews_live_reviewed_at`, and the same filter written in SQL, comparing the text, as `SEARCH reviews USING INDEX reviews_live_reviewed_at (reviewed_at>?)`. The decision stands: text order is time order, which `ORDER BY` and a comparison in SQL read. The reads that §4 indexes by time are written in SQL.
