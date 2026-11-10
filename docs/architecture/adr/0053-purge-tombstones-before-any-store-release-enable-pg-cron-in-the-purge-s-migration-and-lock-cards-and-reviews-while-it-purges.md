# ADR 0053: Purge tombstones before any store release, enable pg_cron in the purge's migration, and lock cards and reviews while it purges

> Status: accepted; its owner approval before merge superseded by ADR-0246
> Date: 2026-10-18

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #108 builds step 6 of [ADR 0034](0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §9: the daily tombstone purge. Three points of it are decided here.
- **Order.** ADR 0034 §9 creates the job "after step 4's release is in the stores", and issue #106's note on #108 (2026-10-17) repeats it: a store-installed app without [ADR 0041](0041-raise-each-pull-cursor-to-a-watermark-read-under-the-user-s-lock-and-strip-local-tombstones-in-place.md)'s watermark would rebuild a table on every run once the horizon rises.
  - The owner decided on 2026-10-18, in #108, to build the purge now, before any store release. No store build exists. The only client devices are the owner's, and they run `main`'s build, which reads the watermark. The web reads the server directly and keeps no cursor.
- **pg_cron.** The owner enables `pg_cron` on the production project; merging a migration applies it there ([`server.md`](../server.md), Deploy path). A migration that schedules the job needs the `cron` schema.
  - Every local stack applies every migration when it starts: `make test`'s throwaway stacks, a contributor's `supabase start`, and CI's. Probed on 2026-10-18 in the image Supabase CLI 2.120.0 starts, `public.ecr.aws/supabase/postgres:17.11.0.004`: `pg_cron` 1.6.4 is in `shared_preload_libraries` and `pg_available_extensions`, and is not installed. The `postgres` role, which is not a superuser there, may create it.
  - So a migration that refuses unless `pg_cron` is already installed fails on every local stack.
  - Supabase's Cron install guide enables it in SQL with `create extension pg_cron with schema pg_catalog;` (`apps/docs/content/guides/cron/install.mdx` in `supabase/supabase` at `2d7e5f57ed7ad427a011a044df13d0a292c8b64a`, committed 2026-10-14, read 2026-10-18).
- **A purge racing a write.** The purge deletes a card tombstone that no review references. In Postgres's default isolation, a statement sees the rows committed when it started. A review of that card committed while the delete runs is not seen by its test, and the card's `on delete cascade` then deletes the review. ADR 0041 holds that no review can still reach such a tombstone, since a review pushed after the purge is refused with `23503`; that holds only for a review pushed after the purge commits. The same holds for a card inserted into a deck tombstone while the purge deletes the deck.
- Alternatives passed over:
  - keeping the order of ADR 0034 §9, which protects devices that do not exist;
  - a migration that refuses unless `pg_cron` is installed, with local stacks installing it first through `supabase/roles.sql`, which `supabase start` applies before the migrations. That file is for roles, and every stack would depend on a step outside the migrations;
  - a purge under `serializable` isolation, which would fail the day's run on a conflict instead of waiting;
  - leaving the race, as one review in a few milliseconds a day. It would delete a review the server accepted, against the owner's decision that study history survives deletion (issue #93).

## Decision

1. **Order.** The purge job is built now, before any store release. This supersedes ADR 0034 §9's order for step 6, "after step 4's release is in the stores". The rest of step 6 stands: the owner approves the pull request before it merges, and the first purge comes 90 days after the first mark.
2. **pg_cron.** The purge's migration first raises, changing nothing, unless all of these hold:
   - `pg_cron` is in `pg_available_extensions` and in `shared_preload_libraries`;
   - `private.sync_horizon` holds its one row at 0, so no purge has run;
   - no job named `purge-tombstones` exists.
   It then runs `create extension if not exists pg_cron with schema pg_catalog`. In production, that does nothing if the owner enabled Cron first; otherwise merging enables it. The check is a function, `private.check_purge_start()`, kept after the migration so pgTAP can test each refusal.
3. **Lock.** A run that purges first locks `cards` and `reviews` in `share row exclusive` mode, held to commit. A write to either waits for the purge, so what the purge reads stays true until it commits: a review written meanwhile cannot be cascaded away, and a card written meanwhile cannot be deleted with its deck. A run with no mark 90 days old takes no lock.

## Consequences

- The purge's first deletions come about 90 days after the migration merges. A store release made before then reads the horizon from its first run, so no device ever ran a build without the watermark against a rising horizon.
- Merging the migration may be what enables `pg_cron` in production, so the owner's approval of the pull request covers enabling it.
- Every local stack runs `pg_cron`, and the job, scheduled for 18:00 GMT daily, would run on a stack left up past that hour.
- Once a day, card and review writes from every user wait for the purge to commit. Measured in ADR 0034 §3 on its seed, the deletes took 11.0 ms.

## Signs the decision was wrong

- A store release reaches users before the first purge and a device on it rebuilds a table it synced within 90 days. That would mean a build without the watermark was released, which the order of ADR 0034 §9 guarded against.
- The migration refuses in production with `pg_cron` enabled in the dashboard. That would mean the dashboard installs it in a way the check does not read.
- `cron.job_run_details` shows the purge failing on a lock timeout or a deadlock, or sync requests time out at 18:00 UTC. That would mean the lock is held longer than writes can wait.
