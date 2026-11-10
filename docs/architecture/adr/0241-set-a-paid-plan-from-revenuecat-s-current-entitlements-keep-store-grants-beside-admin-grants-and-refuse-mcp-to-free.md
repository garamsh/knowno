# ADR 0241: Set a paid plan from RevenueCat's current entitlements, keep store grants beside admin grants, and refuse MCP to 무료

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #884**, the server half of #599's payments; the phone's half is #885. The owner approved the work on 2026-11-10, a cost-relevant change under [`server.md`](../server.md) §Edge Function deploys, "Gate". The plan versions and limits are [ADR 0097](0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md)'s and do not change; no user sees 스페셜 ([ADR 0177](0177-make-unlimited-use-the-plan-special-that-no-user-sees-put-every-admin-on-it-and-move-each-unlimited-grant-onto-it.md)), and #599 required that an ended 스페셜 or Max grant never drop a paying user to Free.
- **The decisions of #599** (the PM's comment of 2026-11-10): the entitlement `plus` is plan `pro`, shown 플러스; the RevenueCat app user id is the Supabase user id; the webhook is checked by an `Authorization` header kept in Vault; sandbox events grant; MCP is for paid plans.
- **Sources**, RevenueCat's own documentation, read 2026-11-10:
  - "Webhooks", `https://www.revenuecat.com/docs/integrations/webhooks`: an authorization header value may be set when the integration is created and "RevenueCat sends it with every POST request"; "Your server should return a 200 status code", any other is a failure, retried up to 5 times with exponential backoff, roughly 2.5, 5, 10, 20 and 40 minutes, about 80 minutes in all; a response not finished in 60 seconds is a failed attempt; sandbox purchases produce events with `environment` `SANDBOX`; and the page recommends treating a webhook as a trigger, then calling `GET /subscribers` for the customer's current state.
  - The same page: HMAC signing may be enabled, adding `X-RevenueCat-Webhook-Signature` (a timestamp and an HMAC-SHA256 over it and the raw body). The #599 comment says RevenueCat does not sign; it does, optionally. This ADR keeps the Authorization header, which the page also offers and which needs no second secret; signing is an addition for a later ADR if a header is judged too weak.
  - "Customers", REST API v1, `https://www.revenuecat.com/docs/api-v1/customers`: `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` returns the latest customer info, with Bearer authentication; 200 for a customer found and 201 for one created, since it "creates the customer if it doesn't exist"; `subscriber.entitlements` is a dictionary "including any expired entitlements", and the sample shows `expires_date` and `grace_period_expires_date` there and `unsubscribe_detected_at` in `subscriber.subscriptions`. The page does not define these fields; the function treats a missing or null date as no end and reads only these names.
  - "Restore behavior", `https://www.revenuecat.com/docs/projects/restore-behavior`, and "Event types and fields", `https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields`, read 2026-11-10: "Transfer to new App User ID" is the default, transferring purchases between identified app user ids, the subscription revoked from the first; a `TRANSFER` event lists `transferred_from` and `transferred_to` and no `app_user_id`.

## Decision

- **A store grant is a row of its own**, `private.store_grants`, one per user, beside `private.user_plans`, which stays the admins' alone. `private.live_grant` picks the better live grant (`special`, `max`, `pro`; the admin's on a tie) and `private.entitlement_of` uses it. No store event reads or writes an admin or 무제한 grant, and an admin's grant that ends leaves a paying user on the store's plan.
- **The webhook is a trigger, never the state.** The `store-webhook` Edge Function (`verify_jwt = false`) checks `Authorization` against the Vault value in constant time, then reads the user's current entitlements from the REST endpoint with a Vault secret API key and applies them through `public.apply_store_entitlement` (`service_role` only). Replays, duplicates and out-of-order events therefore all converge on the current state, and a replay records nothing. It answers 200 to an unknown user and an ignored event, 401 to a bad header, and 502 or 503 where a retry can help.
- **A `TRANSFER` names its ids in lists.** Its event carries `transferred_from` and `transferred_to`, not `app_user_id`; the function reads and applies the current entitlements of every id in either list that is a UUID, ignoring any other, all reads before any apply, and answers non-200 if any read fails so RevenueCat retries.
- **Secrets are write-only Vault entries**, set and cleared through admin-checked RPCs that need a sign-in within 10 minutes; the value is in no audit row and no function reads it back to a client.
- **Each store change is audited**, with no admin id and `admin_email` `revenuecat`.
- **`my_plan()`** is the single authenticated read for 내 플랜: plan (스페셜 shown as `max`), source (`store`, `admin`, `unlimited`, `none`), the store grant's end and whether it renews, and the period's photos used and limit.
- **MCP refuses 무료.** After its token check, `initialize` and `tools/call` read `my_plan()` with the user's token; `free` is refused with a Korean sentence naming 플러스, and a plan that cannot be read is refused too (fail closed).
- **Not decided here:** a deploy workflow for the function (declared in `config.toml`, so merging deploys it), and the admin form for the two secrets, #886; until it merges the owner calls the RPCs with an admin session ([`payments.md`](../payments.md)).

## Alternatives considered

- **A `source` column on `private.user_plans`.** One row per user means a store event would have to overwrite or skip an admin's row, and an admin grant that ended would leave nothing under it; a second table makes both protections structural rather than a branch to get right.
- **Acting on the event's own fields.** It would need a handler per event type and is wrong on an out-of-order delivery; RevenueCat itself recommends the trigger form.
- **HMAC signing instead of the header.** A second secret and raw-body handling for no gain against the threat the header already covers, given the function only reads state from RevenueCat and never trusts the body's contents.
- **Ignoring a `TRANSFER` event.** RevenueCat's default restore behavior, "Transfer to new App User ID", moves purchases between identified app user ids: a user who restores on a device whose store account another knowno account bought with moves the entitlement, and the first account loses it. An ignored `TRANSFER` would leave the second account on 무료 and the first on 플러스, so it is followed (Decision).
- **Letting MCP fail open on an unreadable plan.** A database fault would give every free user the paid feature.

## Consequences

- A valid UUID that no Supabase user holds makes the REST call create an empty RevenueCat customer, answered 200 `no_user`; only an attacker holding the header can cause it.
- `_shared/same.ts` now serves two functions, so a change there redeploys `review-sign-in` and `store-webhook`.
- The owner must complete [`payments.md`](../payments.md)'s steps before a purchase grants anything: until the API key is set the function answers 503 and RevenueCat retries.
- A purchase during an outage longer than RevenueCat's retries (about 80 minutes) is not applied until the next event or a manual resend from RevenueCat's integration page.
