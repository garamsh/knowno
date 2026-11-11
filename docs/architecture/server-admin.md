# Server admin area

The admin area's role, audit log and read functions in the database, which every admin function of the other server documents checks and records itself through.

## Current decisions

### Admin area

- The admin role is the table `private.admins`, one row per admin with who granted it and when; a user without a row is not an admin ([ADR 0070](adr/0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md)). It sits in `private`, which the API does not expose, and no client role holds a privilege on it, so no email, id or list in code or configuration names an admin.
- The first admin is a row the PM inserts on the production project after the migration deploys: `insert into private.admins (user_id) select id from auth.users where email = 'sauce@garam.sh';`. Every later grant and revoke goes through the admin area.
- `private.admin_audit` records every admin write: the admin's id, set null when that account is deleted so the row stays, and a snapshot of the email, a snake-case `action` and `target_kind`, a `target_id`, a JSON `detail` object and the time. The writing function names the action; a later one adds its own names with no schema change.
- Every admin read and write is a `security definer` function in `public` with an empty `search_path`, executable by `authenticated` and not `anon`. Each first calls `private.require_admin()`, which raises `42501` unless the caller has a row in `private.admins`, and each write records itself through `private.audit()` in its transaction. A write that changes nothing records nothing. `public.is_admin()` answers the caller's role.
- The functions: `admin_overview` and `admin_extractions_by_day` (users, study and extractions per UTC day); `admin_reported_decks`, `admin_public_decks`, `admin_deck` and `admin_deck_cards` (a deck is readable only when public or reported); `admin_find_users` and `admin_user`; `admin_admins` and `admin_audit_log`; and the writes `admin_set_deck_hidden`, `admin_unpublish_deck`, which sets the deck private with an edit time of now so the owner's devices pull it, `admin_dismiss_reports`, which leaves a hidden deck hidden, `admin_grant_admin` by an existing user's email, and `admin_revoke_admin`, which refuses the caller's own role and runs one at a time under an advisory lock seeded with 3, checking the caller's role again once the lock is held, so two admins revoking each other at once cannot leave none.
- The overview's counts across users scan the reviews in range and `extraction_usage` without an index of their own; the PM adds one when `supabase inspect db outliers` lists either function among the ten statements of highest total time.
- Migration `20261019120000_admin.sql` is additive: it creates the two tables, their indexes and the functions, and changes no existing row or object.
- The reads the five sections need ([ADR 0155](adr/0155-organise-the-admin-area-in-five-sections-by-the-job-to-do-and-show-only-what-an-operator-acts-on.md)), each checking the role:
  - `admin_note_list(view, search)` — the public live decks of a view, each with its owner, live cards, copies, reports, reasons and first report: `reported`, those not hidden with a report, the oldest first report first; `public`, every one, newest published first; `hidden`, the hidden ones, the most reported first; the search holds in the name or the owner's email, ignoring case, and another view raises `22023`;
  - `admin_week_activity(time_zone)` — the users who signed up, and the users who answered a card counted once a study day, over the last 7 study days from `study_day_start_hour()` in the zone, today's included, and over the 7 before; an unknown zone raises;
  - `admin_prompt_labels()` — each label set, with its version and when it was set, until migration `20261104021846_configuration_prompts.sql` dropped it with the labels ([`server-migrations.md`](server-migrations.md) §Configuration prompts migration);
  - `admin_version_calls(version_id, before, page_size)` — one prompt version's recorded calls, newest first, as `admin_extraction_calls` pages them, without the user each served.
  - Migration `20261102160718_admin_jobs.sql` adds only these four.
- The users' list ([ADR 0181](adr/0181-list-every-user-in-admin-as-a-paged-table-filtered-by-plan-and-status-with-the-one-chosen-beside-it-and-give-plans-and-admins-a-page-each.md)): `admin_users(query, plan, status, page_size, page_offset)`, checking the role, reads a page of 1 to 100 of the users that are not anonymous whose email holds the query ignoring case, every one for a blank query, on a plan by `private.entitlement_of` (an admin on 스페셜) and `active` or `suspended`, any for null, newest sign-up first, each with its last answer, live notes and cards, plan (`user_plan`), whether it is an admin and whether it is suspended, and the matches in all. Migration `20261104012615_admin_user_list.sql` adds it and drops `admin_search_users`, which found no one for a blank query and which nothing called after it; it changes no row, and its header holds the revert.
  - It computes each matching user's entitlement before it pages, which is linear in the users; the PM adds a stored plan or an index when `supabase inspect db outliers` lists it among the ten statements of highest total time.
- `admin_overview`, `admin_reported_decks` and `admin_extraction_calls` stay in the database with no web caller since ADR 0155; dropping them is a non-additive change left to a migration the PM approves.

## Rationale

- [ADR 0070](adr/0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md) records why the admin role and the audit log are tables in `private`, why every admin read and write is a function that checks the role, and why the web needs no service-role key; issue #223 records the owner's request and the PM's scope, and #224 what builds on it.

## Open questions

- None.
