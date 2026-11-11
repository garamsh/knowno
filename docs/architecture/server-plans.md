# Server plans

The plans and their versioned terms with 스페셜, how every grant renews, and how a store purchase sets a plan: the store grants, the `store-webhook` function and `my_plan()`.

## Current decisions

### Plans

- The plans are Free, the default, Pro, Max and 스페셜 ([ADR 0097](adr/0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md), superseding [ADR 0071](adr/0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)'s plans set in place; [ADR 0177](adr/0177-make-unlimited-use-the-plan-special-that-no-user-sees-put-every-admin-on-it-and-move-each-unlimited-grant-onto-it.md)). Max replaced ADR 0071's Special, whose recorded calls became Max's ([`server-migrations.md`](server-migrations.md) §Plan versions migration); the name `special` now names 스페셜, which no user sees.
- `private.plan_versions` holds each version of a plan's terms: the plan, `free`, `pro`, `max` or `special`; the `quota`, `monthly`, `daily`, `unlimited` or `none`; an `amount` from 0 to 100,000, a month's or a day's photos, or for `unlimited` the fair-use cap a day, and none for `none`; `starts_at`; `applies_to_all`; and who created it when. Only `special` takes `none`, and it takes no other quota. A month and a day are Asia/Seoul's. No function changes a version: an edit is a new one.
- `private.user_plans` holds a user's grant of `pro`, `max` or `special`, with an optional end that only Max and 스페셜 may have, who granted it and when, and `version_id`, the version of its own plan in effect when it began, through a composite reference to `(id, plan)`. A user without a row is on Free, and so is one whose Max or 스페셜 has ended.
- **Renewal.** Every grant renews on the 1st of each month at 00:00 Asia/Seoul, Free included, until billing exists. `private.entitlement_of(user_id)` answers a user's version and the start of the period it counts:
  - a grant begun since the last renewal is on the version it references;
  - one begun before it is on the version in effect at that renewal, `private.plan_version_at(plan, renewal)`, the latest started by then;
  - a Free user is on Free's version in effect at the later of its sign-up and the last renewal;
  - an admin is on 스페셜's version, whatever it was granted;
  - over each, the latest version of the plan that applies to all and has started since wins.
- **In the users' favour.** `private.in_favour` holds a version's terms against every version of its plan started by its start: a quota no more generous in the order monthly, daily, unlimited, and an amount no larger. Only such a version may apply to all. A version holds no model: the plan's model is its AI configuration's ([`server-ai.md`](server-ai.md) §AI providers).
- The three tables and the functions sit in `private`, and no client role holds a privilege on them.
- `public.begin_extraction(user_id, configuration_id)` ([`server-ai.md`](server-ai.md) §Prompt store, [`server-ai.md`](server-ai.md) §AI providers) resolves the user's version, its `photo_limit` and `period`, and whether the photo is allowed, recording it when it is, under the extraction lock ([`server-ai.md`](server-ai.md) §Extraction usage). With no version for the plan it returns no row, which the function answers as not configured.
- The admin functions, each checking the role and recording itself as [`server-admin.md`](server-admin.md) §Admin area states:
  - `admin_plan_versions`, every version with whether a user subscribing now takes it;
  - `admin_create_plan_version(plan, quota, amount, starts_at, applies_to_all)`, from now when the start is null, under an advisory lock seeded with 5, recorded as `create_plan_version` on a `plan` with the terms and the terms before; it refuses a start already past, the terms a user subscribing then would already get, and applying to all terms not in the users' favour, recording nothing;
  - `admin_user_plan`, the user's plan, version, terms, its active configuration's provider and model, and the photos counted in its period, with the grant behind it;
  - `admin_grant_plan`, which grants Pro, Max or 스페셜 on the version a user subscribing now takes, replaces any earlier grant and refuses an end on Pro or one not in the future, and `admin_revoke_plan` (recorded as `grant_plan` and `revoke_plan` on a `user`, with the user's email).
- **스페셜** ([ADR 0177](adr/0177-make-unlimited-use-the-plan-special-that-no-user-sees-put-every-admin-on-it-and-move-each-unlimited-grant-onto-it.md)). No photo limit applies to a user on 스페셜, an admin or a user an admin gave it to; `private.unlimited(user_id)` answers whether the user's entitlement has the quota `none`.
  - `begin_extraction` allows and records every photo of such a user, with its call record, so spend stays counted, and returns its `photo_limit` null. `extraction_allowance()` answers `photo_limit` null for such a caller, with the day's photos, and names no plan.
  - No function `authenticated` may run but the admin functions, `extraction_allowance()`, `assistant_allowance()` and `my_plan()` reads a plan, so no user-facing read names 스페셜.
  - 스페셜 is served by its own AI configuration ([`server-ai.md`](server-ai.md) §AI providers), seeded as a copy of Max's active one.
  - Migration `20261102170843_unlimited.sql` had made unlimited use a 무제한 grant beside the plan, in `private.unlimited_grants` with three admin functions; `20261103143442_special_plan.sql` moved those grants onto 스페셜 and dropped them ([`server-migrations.md`](server-migrations.md) §Special plan migration).
- Migration `20261019180000_plans.sql` created `private.plans`, with a model and a `daily_limit` per plan set in place by `admin_set_plan`, and the grants; `20261026005136_plan_versions.sql` replaced them ([`server-migrations.md`](server-migrations.md) §Plan versions migration).

### Store plans

- **What** ([ADR 0241](adr/0241-set-a-paid-plan-from-revenuecat-s-current-entitlements-keep-store-grants-beside-admin-grants-and-refuse-mcp-to-free.md), [`payments.md`](payments.md)). A purchase through RevenueCat gives the user a store grant on plan `pro`, shown as 플러스; the plan versions and limits are ADR 0097's, unchanged. The RevenueCat app user id is the Supabase user id; the client never decides a plan.
- **Store grants** are `private.store_grants`, one row per user: the plan, `pro` or `max` (only `pro` is written, for the entitlement `plus`; `max` is reserved for the entitlement `pro`), an end that is null for an entitlement with none, whether it `renews`, when it began, and its plan version as `private.user_plans` holds it. No client role holds a privilege on it.
  - A store grant sits beside `private.user_plans`, which holds admin grants alone, so no store event reads or writes an admin's grant or a 무제한 (스페셜) one, and an admin's write never reaches a store grant.
  - `private.live_grant(user_id)` picks the better and `private.entitlement_of` uses it: it takes the better of the user's live admin grant and live store grant (`special`, `max`, `pro`; the admin's on a tie), then resolves versions and renewal as before (§Plans); an admin is on 스페셜 whatever either holds. So a 스페셜 or Max grant that ends leaves a paying user on Pro, not Free (the constraint ADR 0177 set for #599).
- **Applying an entitlement.** `public.apply_store_entitlement(user_id, plan, ends_at, renews)`, executable only by `service_role`, sets the user's store grant from what the function read, a null `plan` meaning no active entitlement, and answers one of:
  - `granted`, a new grant on the plan's version in effect now;
  - `changed`, an existing grant with another plan, end or `renews`; its start and version are kept unless the plan changed, which resets both;
  - `ended`, the grant deleted, also for an end not in the future;
  - `bad_plan`, a plan that is not `pro` or `max`, or one with no version in effect, recording nothing;
  - `unchanged`, a replay, or no entitlement and no grant, recording nothing;
  - `no_user`, an id that is no user, recording nothing.
  A change records `store_grant_plan`, `store_change_plan` or `store_end_plan` on a `user` with the email, plan, end and `renews`, as an audit row with no admin id and `admin_email` `revenuecat`.
- **The admin's reads** (#899). `private.grant_source(user_id)` answers one row, the source of the grant `private.live_grant` picks, as `my_plan()`'s `source` names it: `admin` for an admin account or an admin's grant of Pro or Max, `store`, `unlimited` for a 스페셜 grant, `none` on Free with no live grant; and for a store grant its `ends_at` and `renews`, null for any other source and for an admin account. No client role may run it. `admin_user_plan(user_id)` and `admin_users(...)` add three columns after their last, each keeping every column it had, so the current web build reads them unchanged:

  | Column | Value |
  |---|---|
  | `source` | `admin`, `store`, `unlimited` or `none`, as above |
  | `store_ends_at` | a store grant's end, the next renewal while it renews; null for any other source |
  | `store_renews` | whether the store grant renews at `store_ends_at`; null for any other source |

  `admin_user_plan`'s `plan` and `admin_users`' `user_plan` and plan filter already read `private.entitlement_of`, so a store grant is counted in them; `admin_user_plan`'s `ends_at`, `granted_plan`, `granted_at` and `granted_by_email` still describe the admin's grant alone. Migration `20261111120000_admin_plan_source.sql` drops and recreates the two functions with the added columns and changes no row; its header holds the revert.
- **Secrets.** `private.store_secrets` names two Vault secrets, `knowno_store_webhook_authorization`, the value RevenueCat sends in its `Authorization` header, and `knowno_store_api_key`, a RevenueCat secret API key, with who set each and when. `public.store_secrets()`, `service_role` only, returns both decrypted, null while unset.
  - `admin_set_store_secret(name, value)` creates or replaces one and `admin_clear_store_secret(name)` removes one, `admin_store_secrets()` lists `name`, `is_set`, `set_at` and `set_by_email` and never a value, each checking the role and a sign-in within 10 minutes (`reauth` otherwise), recorded as `set_store_secret` and `clear_store_secret` on a `store_secret` named by `name`, with no value; a webhook value is 16 to 1,000 printable ASCII characters and an API key 8 to 1,000 without whitespace, else `bad_secret`. `admin_store_secrets()` lists each name with whether it is set, when and by whom, never a value or any part of one.
- **`public.my_plan()`**, executable by `authenticated` (`renews` is true when the subscription has an end and RevenueCat has detected no unsubscribe), is the one read behind 내 플랜. It reads `source`, `ends_at` and `renews` from `private.grant_source`, so the admin's reads and 내 플랜 share one mapping from a grant to a source (#902, migration `20261111140000_my_plan_source.sql`, whose header holds the revert). It answers one row for the caller:

  | Column | Value |
  |---|---|
  | `plan` | `free`, `pro` or `max`: the plan the caller is on, 스페셜 as `max`, so no read names 스페셜 (ADR 0177). `pro` is shown 플러스 and `max` 프로 |
  | `source` | `none` on Free with no grant, `store` for a store grant, `admin` for an admin account or an admin's grant of Pro or Max, `unlimited` for a 스페셜 grant |
  | `ends_at` | a store grant's end, the next renewal while `renews`; null for any other source |
  | `renews` | whether a store grant renews at `ends_at`; null for any other source |
  | `photo_limit` | the period's photos, null where none applies, as `extraction_allowance()` answers it |
  | `period` | `day` or `month` |
  | `used` | the photos counted in the period |

  A caller on `admin` or `unlimited` is never locked or offered a purchase; a caller on `free` is locked from MCP and offered 플러스.
- **The function.** `store-webhook`, `verify_jwt = false` since RevenueCat sends no Supabase JWT, takes RevenueCat's `POST` and answers:
  - `401` `unauthorized` when `Authorization` differs from the Vault value, compared as SHA-256 digests byte by byte, and when the value is unset;
  - `200` `ignored` for a body that is not an event, an event with no UUID app user id (for a `TRANSFER`, none in `transferred_from` or `transferred_to`), and `TEST`; `200` `no_user` for an id that is no user;
  - otherwise the event is only a trigger: the function reads `GET /v1/subscribers/{app_user_id}` with the API key from Vault, takes the entitlement `plus` as active when it exists and its end, the later of `expires_date` and `grace_period_expires_date`, is null or in the future, and calls `apply_store_entitlement`; a `TRANSFER` does this for every UUID in `transferred_from` and `transferred_to`, reading all before applying any, so the account that lost the entitlement ends and the one that gained it is granted; `200` `applied` with the outcome. Sandbox events are read like any other (#599);
  - The sync route, `POST /functions/v1/store-webhook/sync`, is what the app calls right after a purchase or restore so the plan does not wait on webhook delivery. `verify_jwt` is off, so the function verifies the session itself, as `extract-cards` does (`authenticate`): `Authorization: Bearer <the user's access token>`, and the request body is never read. It acts on the caller alone, never on an id from the request, reads that user's entitlements and applies them exactly as a webhook for that user would, with the API key from Vault, and answers:
    - `200` `{"outcome": "applied", "result": "granted" | "changed" | "ended" | "unchanged"}`, after which the app reads `my_plan()`;
    - `401` `unauthorized` for a missing, invalid, anon or anonymous token, and also for the webhook's Vault value, which is no session;
    - `429` `rate_limited` with `Retry-After: 600` beyond 10 calls in 10 minutes by one user (`public.store_sync_begin`, counted in `private.store_sync_attempts`, a row deleted a day after it);
    - `502` `unavailable` and `503` `not_configured` as below, `405` for any method but `POST`.
    The webhook route, every path but `/sync`, is unchanged.
  - `502` `unavailable` when RevenueCat or the database cannot be reached or answers another shape, and `503` `not_configured` while the API key is unset, so RevenueCat retries (five times over about 80 minutes).
  - A replayed, duplicated or out-of-order event cannot leave a wrong plan: each reads the current state.
- Migration `20261110190000_store_plans.sql` creates the tables and functions and replaces `private.entitlement_of` (§Store grants); it changes no row, so it is additive ([`server.md`](server.md) §Location and migrations, "Gate"). **Revert:** `select private.revert_store_plans();` and then `drop function private.revert_store_plans();`, run once by the PM against production, restore `private.entitlement_of`, drop the functions and tables and delete nothing in Vault.
- **Gate.** The function is a cost-relevant change under [`server.md`](server.md) §Edge Function deploys: the owner approved it on 2026-11-10 (#599). It reads no function secret; the owner enters the two secrets in Vault through admin ([`payments.md`](payments.md)).

## Rationale

- [ADR 0241](adr/0241-set-a-paid-plan-from-revenuecat-s-current-entitlements-keep-store-grants-beside-admin-grants-and-refuse-mcp-to-free.md) records why a purchase is read from RevenueCat's current entitlements rather than the event, why store grants have their own table, and why MCP refuses 무료.
- [ADR 0097](adr/0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md) records why a plan's terms are versions with a start, why every grant renews on the 1st in Seoul until billing exists, how usage carries into the first period, and the migration's backups and revert; issue #341 records the owner's decisions and delegation.
- [ADR 0177](adr/0177-make-unlimited-use-the-plan-special-that-no-user-sees-put-every-admin-on-it-and-move-each-unlimited-grant-onto-it.md) records why unlimited use is the plan 스페셜, hidden from users by what they can read rather than by a label, why every admin is on it, the migration of the 무제한 grants with its backups and revert, and the constraint an ended grant puts on #599's purchases; it supersedes [ADR 0157](adr/0157-let-admins-and-users-granted-unlimited-use-past-every-photo-limit-decided-in-the-server-s-metering-with-the-grant-beside-the-plan.md), which still records why the allowance answers a null limit. Issues #597 and #649 record the owner's requests.

## Open questions

- None.
