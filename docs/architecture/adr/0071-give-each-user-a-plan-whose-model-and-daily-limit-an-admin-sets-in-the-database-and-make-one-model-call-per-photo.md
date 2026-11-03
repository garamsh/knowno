# ADR 0071: Give each user a plan whose model and daily limit an admin sets in the database, and make one model call per photo

> Status: accepted; its overview's cost at the Free plan's model superseded by ADR-0074; its `start_extraction` and the `consume_extraction` it kept superseded by ADR-0078; its plans with a model and a daily limit set in place, its Special plan, its UTC day and its `429`'s `daily_limit` superseded by ADR-0097; its one model call per photo superseded in part by ADR-0130; its model check against OpenRouter's list on save superseded by ADR-0162
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #224**, the owner's request of 2026-10-19:
  - remove the Sonnet retry;
  - let an operator set the main model;
  - add a Special plan an operator grants, besides Pro;
  - set the model per plan.
- **Before this change:**
  - Every user had the same daily limit, `DAILY_EXTRACTION_LIMIT` (30) in `supabase/functions/extract-cards/supabase.ts`, and the same model.
  - The model came from the secrets `CARD_MODEL` and `CARD_RETRY_MODEL` ([ADR 0013](0013-extract-cards-function-and-eval.md)). Changing it took console access.
  - On 2026-10-19 the PM set both secrets to `anthropic/claude-haiku-5.5` (#224), so production already made no Sonnet retry. The retry call itself was still in the code.
- **The admin area** of [ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md) holds the admin role and the audit log. It was shaped for a Plans page and plan grants.
- **Merging** deploys the migration and the function together, in no stated order ([`server.md`](../server.md)).
- **Alternatives considered:**
  - **The plan as a column on a user table.** The project has no user table of its own. A table of grants, with no row meaning Free, needs nothing for the many Free users.
  - **The model and the limit as code constants per plan.** Changing either would take a deploy. #224 asks for an operator to set them.
  - **The model checked by the function against OpenRouter's list at each call.** It would add a request to every photo. The admin area checks once, on save; the database checks the id's form; and the function refuses a row it cannot call.
  - **Keeping the retry on the same model.** The owner removed it. The measured validity rate supports that: on the PM's eval run of #225's head `2b3f1a2ea573277b4fd8331e8a94058710d8749c`, prompt v7 on Claude Haiku 5.5 over the 55 samples, every first call returned output the parser accepted, 55 of 55, so no image needed a second call. The source is the run's kept replies, `tools/eval/replies/2026-10-18T21-40-03Z/claude-haiku-5-5/`, which git ignores; each holds one call. An invalid reply is rare enough to show as the failure the app already handles.

## Decision

- **Plans.**
  - `private.plans` holds `free`, `pro` and `special`. Each has a `model`, an OpenRouter id checked to the form `vendor/model`, and a `daily_limit` from 0 to 1000. Each row records who last changed it, and when.
  - The migration seeds all three on `anthropic/claude-haiku-5.5` and 30 a day, the model and the limit production runs now. The merge therefore changes no user's model, limit or cost.
  - The rows are data the admin area edits. No plan setting is a code constant or a secret.
- **A user's plan.**
  - `private.user_plans` holds a user's grant of `pro` or `special`, with an optional end, which only Special may have, and who granted it, when.
  - A user without a row is on Free. So is a user whose Special has ended.
  - Rows cascade with the user, and `granted_by` is set null, so a grant outlives the admin who made it.
- **The function.**
  - It calls `public.start_extraction(user_id)` through the service role it already has. The call resolves the plan, and under the same per-user lock as `consume_extraction` counts the day's photos against that plan's limit, recording the photo when it is under.
  - It returns the plan, its model, its limit and whether the photo is allowed. No row means the plan's settings are missing.
  - The function makes **one model call** per photo, with that plan's model. Output that is not the schema's is `502 model_error` at once.
  - A refusal at the limit is `429` with `{"error": "rate_limited", "daily_limit": n}`, the plan's limit.
  - Missing settings, or a model id the function would not call, is `503 not_configured`, and no model is called.
  - Its log line names the plan and the model, and never the image or the cards.
  - It reads `OPENROUTER_API_KEY` and the platform's variables only. `CARD_MODEL` and `CARD_RETRY_MODEL` are no longer read, so the PM removes both secrets after the deploy.
- **Deploying.**
  - `consume_extraction` stays, so a function deployed before this migration keeps working.
  - Both functions count the same rows under the same lock, so a photo counts once whichever version takes it.
  - A later change removes `consume_extraction` once nothing calls it.
- **The admin area** gains, each a function that calls `private.require_admin()` and records itself with `private.audit()`:
  - `admin_plans()` and `admin_set_plan(plan, model, daily_limit)`, recorded as `set_plan` on a `plan` with the settings before and after;
  - `admin_user_plan(user_id)`, `admin_grant_plan(user_id, plan, ends_at)` and `admin_revoke_plan(user_id)`, recorded as `grant_plan` and `revoke_plan` on a `user`.
  - A grant replaces any earlier one. It refuses an end on Pro and an end not in the future.
- **The web.**
  - **The Plans page** (`/admin/plans`, "요금제") holds a form per plan for its model and daily limit. Beside a measured model it shows the eval's measured cost per photo, and below it the list of measured models: `web/src/features/admin/model-costs.ts`, from the PM's runs of 2026-10-19 (#217).
  - **Saving a model** first checks OpenRouter's public model list. The model must take image input and support structured outputs, the eval's rule (`tools/eval/models.ts`). An unknown or unsuitable model is not saved, and neither is any model while the list cannot be read.
  - **A user's page** shows the plan with its model and limit, and photos today against that limit. Its form puts the user on Pro, or on Special until the end of a chosen day's study day in the admin's zone, or without an end, and "무료로 되돌리기" removes the grant.
  - **The overview** estimates the cost at the Free plan's model's measured cost, and shows none when that model has no measurement.
  - The web's constants for the per-photo cost and the daily limit go ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md)).
- **The app** reads a `429`'s `daily_limit` and says "오늘 사진으로 만들 수 있는 {limit}장을 다 썼어요. 내일 다시 시도해 주세요.". A `429` without it, from a function deployed before, keeps the sentence it showed. Nothing else changes for the user.
- **The eval** drops the retry:
  - a candidate names one model, and one naming a retry is refused;
  - the dry estimate and each image's worst case price one call;
  - the configuration "Claude Haiku 5.5, Sonnet 5.5 retry" leaves `candidates.json`.
- **The migration** `20261019180000_plans.sql` is additive: two tables with their three seed rows, their indexes, and functions. It changes no existing row and no existing object.
- **Supersessions:**
  - ADR 0013's retry, its `CARD_RETRY_MODEL`, and its model as a secret;
  - [ADR 0059](0059-keep-one-sonnet-call-per-photo-after-measuring-an-outline-then-fill-pipeline-and-the-newest-models.md)'s Haiku-with-a-Sonnet-retry candidate;
  - ADR 0070's per-photo cost and daily limit as web constants.

## Consequences

- An admin changes a plan's model or limit, or a user's plan, in the web, and the next photo uses it. No deploy or secret is involved.
- Every photo costs one call, so an invalid reply now fails it where a retry might have saved it.
- The Pro plan exists before any billing; until then it is granted by hand.
- `consume_extraction` remains until a later change removes it.
- A model saved while OpenRouter lists it may later leave the list. The function then fails at OpenRouter, as `502`, until an admin sets another.

## Signs the decision was wrong

- Invalid output becomes a visible share of failures on Haiku, so one call per photo costs users more failed photos than the retry did.
- Operators need per-user limits or models beyond three plans, and grants multiply into special cases.
- An admin saves a model that passes the list's check but cannot read photos well, which the eval would have caught, so a save needs the eval's measurement and not only the list.
- The two count functions disagree during a deploy, so a photo counts twice or not at all.
