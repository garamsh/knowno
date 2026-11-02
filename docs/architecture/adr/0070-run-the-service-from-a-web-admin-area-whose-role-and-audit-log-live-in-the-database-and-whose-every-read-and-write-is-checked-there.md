# ADR 0070: Run the service from a web admin area whose role and audit log live in the database, and whose every read and write is checked there

> Status: accepted; its per-photo cost and daily limit as web constants superseded by ADR-0071; its private decks kept out of the area superseded by ADR-0072; its section menu superseded by ADR-0155
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #223**, the owner's request of 2026-10-19, with the scope the PM decided: operators run the service from a web admin area instead of the Supabase dashboard. The area has six parts:
  - an overview of users, study and photo extractions with their estimated cost;
  - the reported decks, with hide, unhide, unpublish and dismiss;
  - users, read-only;
  - the public decks;
  - the admins;
  - an audit log of every admin write.
- **#223's constraints:**
  - The role lives in the database, with no email, user id or allow-list in code, config or env.
  - The first grant, for the owner's account, is a data row the PM inserts after deploy, not a seed.
  - Every admin read and write is authorised in Postgres.
  - The web holds no service-role key unless no other way exists.
  - A non-admin gets the not-found page.
  - The UI is Korean, on the web only.
  - The migration is additive.
- **Issue #224**, plans with a model and a daily limit each, builds on this area: a Plans page, and plan grants on a user's page, each recorded in the audit log. The PM asked for the role and the log to take those without rework.
- **The web today** reads and writes with the publishable key and the user's session alone ([`web.md`](../web.md)). Moderation was the dashboard's: "the project's owner unhides it in the dashboard" ([`server.md`](../server.md)).
- **Alternatives considered:**
  - **A role claim in the JWT** (`app_metadata`), set through Auth's admin API. Granting would need the service-role key in the web, or a hook, and a revoked admin would keep the role until its token expired. A table is checked on every call.
  - **Row-level security policies on the existing tables for admins**, with direct reads. Users' emails live in `auth.users`, which PostgREST does not expose, so a function would still be needed. Admin policies on `decks`, `cards` and `deck_reports` would also widen every user's read path and join every query. The functions keep the existing policies as they are.
  - **The service-role key in the web runtime.** It would put a secret in the image ([`web.md`](../web.md): "nothing in it may reach a Supabase secret"), and authorise in the web rather than in Postgres. Security-definer functions that check the role need neither.
  - **An enum of audit actions.** #224's plan actions would need a schema change to the enum. A checked text name, written only by the functions, takes a new action with the function that writes it.
  - **An admin area outside the shell**, with a layout of its own. It would duplicate the shell's menus and skip link. Inside the shell, the area adds only its own section menu.

## Decision

- **The role** is the table `private.admins`: one row per admin, `user_id` referencing `auth.users` with `on delete cascade`, and `granted_by` and `granted_at`. A user without a row is not an admin.
  - It lives in the schema `private`, which the API does not expose. No client role holds a privilege on it.
  - No email, id or list names an admin anywhere in code, config or env.
  - **The first admin** is a row the PM inserts on the production project after the migration deploys:
    `insert into private.admins (user_id) select id from auth.users where email = 'sauce@garam.sh';`
    The pull request's owner actions name this step. Every later grant goes through the admin area.
- **The audit log** is the table `private.admin_audit`. Each row holds:
  - who acted, as `admin_id` and a snapshot of `admin_email`;
  - the action and the target, as `action`, `target_kind` and `target_id`;
  - a JSON `detail` object;
  - when, as `created_at`.
  - `action` and `target_kind` are snake-case names that the writing function chooses. This area writes `hide_deck`, `unhide_deck`, `unpublish_deck` and `dismiss_reports` on a `deck`, and `grant_admin` and `revoke_admin` on a `user`. #224 adds its own names, such as a plan grant on a `user` or a setting on a `plan`, with no schema change.
  - `admin_id` references `auth.users` with `on delete set null`, so deleting an admin's account keeps every row it wrote, with `admin_email` saying who acted. This is an exception to [`server.md`](../server.md)'s rule that a table holding a user id cascades: an audit log that its subjects' deletion erases records nothing (the PM's review of #227).
- **Authorisation is in Postgres.**
  - Every admin read and write is a `security definer` function in `public`, with an empty `search_path`, granted to `authenticated` only.
  - Each function first calls `private.require_admin()`, which raises `insufficient_privilege` (`42501`) unless the caller has a row in `private.admins`.
  - Each write records itself through `private.audit()`, in the same transaction.
  - `public.is_admin()` answers the caller's role. It is the web's only check before it shows the area.
- **The functions:**
  - `admin_overview(today_start, week_start)`: users in total and new in the last 7 and 30 days; users with a live answer since each start; extractions since the start of the UTC day.
  - `admin_extractions_by_day()`: extractions per UTC day over 30 days.
  - `admin_reported_decks()`: each reported deck with its owner, state, report count, reasons and latest report.
  - `admin_public_decks(search, owner)`: every public deck with its owner, live cards, copies, reports and hidden state.
  - `admin_deck(deck_id)` and `admin_deck_cards(deck_id)`: one deck and its live cards, but only a deck that is public or reported, so a user's private decks stay out of the area.
  - `admin_find_users(query)`: at most 50 users whose email holds the query.
  - `admin_user(user_id)`: one user's sign-up, latest answer, live decks and cards, today's extractions and role.
  - `admin_admins()` and `admin_audit_log(before, page_size)`.
  - The writes:
    - `admin_set_deck_hidden(deck_id, hidden)`;
    - `admin_unpublish_deck(deck_id)`, which makes the deck private with an edit time of now, so it wins over an older edit on a device and the owner's devices pull it;
    - `admin_dismiss_reports(deck_id)`, which deletes the deck's reports and leaves a hidden deck hidden;
    - `admin_grant_admin(email)`, for an existing user;
    - `admin_revoke_admin(user_id)`, which refuses the caller's own role. Revokes run one at a time under an advisory lock seeded with 3, and the caller's role is checked again once the lock is held, so two admins revoking each other at once cannot leave none: the second finds itself revoked. The last admin therefore always remains.
    - A write that changes nothing records nothing.
- **The web area** is `/admin`, in the `(shell)` route group, with the section menu "관리 메뉴": 개요, 신고, 공개 덱, 사용자, 관리자 and 작업 기록.
  - Its layout renders nothing until `is_admin` answers. An admin then sees the menu and the page; anyone else gets the not-found page, and a server that cannot answer gets the error page.
  - With `cacheComponents`, the check runs inside a Suspense boundary whose fallback is empty, so the not-found page streams, as a deck that does not exist does.
  - The area's pages set no metadata of their own, so no title names the area before the check.
  - Every action asks for confirmation on the page, and its sentence shows after. The server's check, not the confirmation, is what authorises it.
  - The web uses the publishable key and the user's session alone. No service-role key enters it.
  - The feature `admin` in `web/src/features/admin/` holds the reads, the Server Actions and the components. It depends on `decks` for card content and on `study` for the study day.
- **The figures:**
  - "Today" and "the last 7 days" of study are study days from 04:00 in the zone the browser names, which the web computes with `studyDayStart`. Extractions count by UTC day, the daily limit's day.
  - The estimated cost is the count times one per-photo cost in `web/src/features/admin/extraction.ts`: $0.0018, Claude Haiku 5.5 on prompt v6 in the PM's run of 2026-10-19 (#217). #224 replaces it with each plan's model.
  - The daily limit shown beside a user's extractions is the same file's `dailyExtractionLimit`, which a test compares with `extract-cards`' `DAILY_EXTRACTION_LIMIT`. #224 moves the limit into the database.
- **Indexes.**
  - The overview counts users with an answer since a time across every user. Today's index leads with `user_id`, so that count scans the live reviews in range, and the 30 days of extractions scan `extraction_usage`.
  - Both are operator reads, rare against the writes on those tables, so they get no new index, as [ADR 0034](0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §6 decides for the public search.
  - The PM adds an index when `supabase inspect db outliers` lists either function among the ten statements of highest total time.
- **The migration** `20261019120000_admin.sql` is additive: two tables, their indexes and the functions. It changes no existing row and no existing object.

## Consequences

- Moderation, lookups and the admin role move from the dashboard to the web, and every operator write is on record.
- Granting or revoking admin takes effect on the next request; nothing waits for a token to expire.
- #224's Plans page and plan grants add functions that call `private.require_admin()` and `private.audit()`, and pages under `/admin`. No change to the role or the log is needed.
- The area lists every public deck and every reported deck in one page each, with no paging. A later change pages them when the lists grow.
- Deleting an admin's account keeps the audit rows it wrote, which then name the admin by email alone.
- The first admin exists only after the PM's insert. Until then, the area is not found for everyone.

## Signs the decision was wrong

- An admin needs a read the functions do not offer, and the functions multiply into one per screen instead of a few that serve several.
- The audit log's free-form names drift: two names for one action, or a target kind no reader can open.
- `supabase inspect db outliers` lists an admin function, so the scans need indexes sooner than expected.
- A non-admin learns the area exists, from a status code, a title or a timing, so the not-found page does not hide it.
