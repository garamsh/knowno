# ADR 0111: Preview each pull request's migrations on synthetic data in CI, and keep deploying them on merge

> Status: accepted; its owner approval before merge of a data-changing migration superseded by ADR-0246
> Date: 2026-10-27

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Merging a migration into `main` deploys it: Supabase's GitHub integration applies it to the production project (`server.md`, Deploy path). Until now nothing showed a reviewer what a migration does to a database that holds rows. The local stack and the database tests start empty.
- Issue #402 first asked for two things: a preview in CI, and a `deploy-db` job that would run `supabase db push` under a GitHub Environment `production` after the owner approved a dry run. The owner's decision of 2026-10-27 in the issue's comment drops the job. The web on Vercel and the Edge Functions also deploy on merge, so a database held for approval would leave new code running against the old schema. Only the preview stays in scope.
- In the same comment the owner rules out any paid option: no Supabase Branching and no point-in-time recovery. Pro's daily backups are what exists.
- `supabase/config.toml` sets `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, so every `supabase start` loads `seed.sql`, and `supabase/test-db.sh`, `test-sync.sh` and `test-web.sh` all start their stacks that way. One synthetic user with one public deck, loaded into a stack with every migration and run through `supabase test db --local` on 2026-10-27, failed 20 subtests in 9 files. Among them were `admin_test.sql`'s overview counts, seven of `public_decks_test.sql`'s listings, and the "fixture holds two rows in each of the four tables" checks. The tests' fixtures assume an empty seed.
- Alternatives considered and rejected:
  - **An approval gate before production**: a `deploy-db` job under the GitHub Environment `production`, which prints the dry run and runs `supabase db push` once the owner approves. Rejected because the web and the Edge Functions deploy on merge, so a held database would put code and schema out of step for as long as the approval waits.
  - **Supabase Branching.** Its preview branches hold no real data, so they add little over the local stack, and the owner's comment rules it out with the other paid options.
  - **Keeping auto-apply with no preview.** A reviewer would still see a migration only as SQL, never as the rows it changes.
  - **The synthetic data in `supabase/seed.sql`.** Every test stack would load it and the tests above would fail. Keeping it there would mean changing `config.toml` or every test script, and either change would reach every contributor's local stack.

## Decision

- **Deploy.** Migrations keep deploying on merge through Supabase's GitHub integration. The guard stays before merge: a migration that changes or deletes existing data merges only after the owner approves it.
- **Preview.** On every pull request that touches `supabase/migrations/`, the workflow `.github/workflows/migration-preview.yml` runs `make preview-migrations`. That target runs `supabase/migration-preview.sh`, which works on a throwaway local stack:
  - it applies `main`'s migrations, loads `main`'s `supabase/preview-seed.sql`, records every table's columns and rows, and then applies the migrations the pull request adds;
  - it writes which tables and columns were added, dropped or altered, and per table how many rows were added, removed and changed;
  - the job posts that report as its summary on the pull request.
  `main` is the merge commit's first parent, as `check-migration-order.sh` reads it.
- **Seed.** The synthetic data lives in `supabase/preview-seed.sql`, which only the preview loads. It puts rows in every table of `public` and `private`, and every user in it is fictional. `supabase/seed.sql` stays empty, because every `supabase start` loads it and the database tests' fixtures assume no rows.
- **Production data** never leaves production. Neither the preview nor any test loads it.
- **Test.** `supabase/migration-preview.test.sh`, run by `make test-db`, runs the preview on a repository it builds: `main` holds this repository's migrations and seed, and a merge adds a fixture migration. The test reads the report.

## Consequences

- A reviewer sees what a migration does to rows before merging, and a migration that fails on the seeded data fails its pull request's preview job.
- The preview shows only what the seed exercises. Data that production holds and the seed lacks is not previewed, so the guard before merge stays the owner's approval.
- The preview loads `main`'s seed, which fits `main`'s schema. A migration that makes the seed invalid updates `preview-seed.sql` in the same pull request; otherwise the next pull request's preview fails when it loads the seed.
- Rows are compared on the columns a table had before and still has, so a value written only into an added column is not counted as a change.

## Signs the decision was wrong

- A migration that passed its preview changes or deletes production rows in a way the report did not show, and the cause is data the seed could not hold.
- Contributors stop updating `preview-seed.sql`, and previews fail on the seed rather than on the migration.
- The owner turns down an additive migration for want of a production dry run that this decision does not provide.
