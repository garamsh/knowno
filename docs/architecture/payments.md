# Payments

How a purchase becomes a plan: RevenueCat, the `store-webhook` Edge Function, store grants beside admin grants, the plan read for 내 플랜, and what the owner sets up outside the repository. The schema is [`server-plans.md`](server-plans.md)'s §Store plans; MCP's refusal of 무료 is [`mcp.md`](mcp.md)'s §Plan gate.

## Current decisions

- A store purchase is made in the app through RevenueCat, whose app user id is the Supabase user id (the app logs in to RevenueCat with it before any purchase). The entitlement `plus` is plan `pro`, shown 플러스; plan versions and limits are unchanged.
- RevenueCat posts every event to the `store-webhook` function with the `Authorization` value the owner set. The function treats the event as a trigger only (and the sync route, for the caller alone, does the same read): it reads the current entitlements of the user (of every user a `TRANSFER` names) with `GET /v1/subscribers/{app_user_id}` and sets or ends the user's store grant ([`server-plans.md`](server-plans.md) §Store plans).
- A store grant never replaces an admin grant or 무제한, and a store event never ends one; each store change is in the audit log.
- Sandbox events grant like production ones.
- An account deleted while a store subscription is active keeps being billed by the store until the user cancels there, so the app's deletion confirmation says so and offers 구독 관리, and deletion is never blocked (#914, carried out in #912).
- Right after a purchase or restore, the app calls the function's sync route so the plan does not wait on a webhook: `POST {SUPABASE_URL}/functions/v1/store-webhook/sync` with the user's session as `Authorization: Bearer <access token>` and the project's publishable key as `apikey` (`supabase_flutter`'s `functions.invoke('store-webhook/sync')` sends both). No body is read and the function acts on the caller alone. It answers `200` `{"outcome": "applied", "result": ...}`, then the app reads `my_plan()`; `401` for no valid session; `429` with `Retry-After: 600` past 10 calls in 10 minutes; `502` or `503` where a retry later may help. The app treats a failed call as non-fatal: RevenueCat's webhook still follows.
- The app reads `my_plan()` for 내 플랜: plan, source, the store grant's end or renewal, and the period's photos used and limit.
- The server's grant is the one source of who holds 플러스: the `private` store grant `store-webhook` sets from RevenueCat's current entitlements, beside admin grants, read through `my_plan()`. Every paid gate in the app follows `planProvider`, which reads `my_plan()`, and never RevenueCat's `CustomerInfo`; RevenueCat's SDK is used only to show the offering, buy, restore and name the store's management page. After a purchase or a restore the app refreshes the plan from the server. Web sales (#895, Toss Payments) and any later direct store integration are other writers of the same grant, and the app and `my_plan()` do not change for them.
- The app is one flow for every store: the build's store gives RevenueCat's public key and a fallback management page (data in `connectPurchases`), RevenueCat's current offering gives the package `$rc_monthly`, the package is bought, and the plan is read from the server. No widget names a store; the purchase sheet's copy says "the store" (스토어), and RevenueCat's management page opens for 구독 관리, with Google Play's own subscriptions page for `app.knowno` where RevenueCat gives none.
- The app holds only RevenueCat's public SDK keys, `REVENUECAT_APPLE_API_KEY` and `REVENUECAT_GOOGLE_API_KEY` in `app/config/dev.json` (added by #885), which are not secrets. The two secrets below are in Vault and never in the app, the web or a function secret.

## Store identifiers

Fixed once created: a store does not rename them, and no price goes into an ID.

| What | Identifier |
|---|---|
| RevenueCat entitlement | `plus` |
| RevenueCat offering | `default` (current) |
| RevenueCat package | `$rc_monthly` |
| App Store subscription group | `knowno Plus` |
| App Store product | `app.knowno.plus.monthly` |
| Google Play product | `plus`, base plan `monthly` |

The app reads the package `$rc_monthly` from the current offering (`default`) and hard-codes no store product ID.

Change rules:

- The app and the server check entitlements only, never a product ID. A grant comes from the entitlement (`plus` → plan `pro`), whichever product sold it.
- New terms of sale get a new ID: Apple `app.knowno.<tier>.<period>[.v<n>]`; Play product `<tier>` with base plan `<period>[-v<n>]`. The first product has no version (`app.knowno.plus.monthly`, Play `plus` / `monthly`).
- A price change stays on the same product.
- Discounts and trials are store offers, not new products.
- Replacing or testing the purchase screen uses RevenueCat offerings (`default`, then `default_<period>` such as `default_2027q1`), not new products.
- A higher tier gets a new entitlement (`pro`, which grants plan `max`, as #599 reserved). On Apple it goes in the same subscription group, `knowno Plus`, so upgrades and downgrades are the store's.

## Owner's steps

Done once, outside the repository. Labels are RevenueCat's and Apple's and may differ; the pages cited in [ADR 0241](adr/0241-set-a-paid-plan-from-revenuecat-s-current-entitlements-keep-store-grants-beside-admin-grants-and-refuse-mcp-to-free.md) were read 2026-11-10, the dashboard itself was not.

1. **RevenueCat project.** Create a project at `app.revenuecat.com`.
2. **Link the stores.** Add the iOS app (bundle id as in App Store Connect) and link App Store Connect through an App Store Connect API key or In-App Purchase key as the dashboard asks; add the Google Play app as step 11 says.
3. **Product.** Create the 플러스 subscription in App Store Connect (product `app.knowno.plus.monthly` in the group `knowno Plus`; Google Play's is step 11) and add it to RevenueCat's Products.
4. **Entitlement.** Create the entitlement with the identifier `plus` exactly and attach the product to it.
5. **Default offering.** Create the offering marked as current (`default`) and add each store's product as the package `$rc_monthly` (RevenueCat's Monthly package, so the one package holds the App Store and the Play product).
6. **Secret API key.** In the project's API keys, create a secret key (read access to customer information suffices). Keep it for step 8.
7. **Webhook.** In Integrations, add a Webhooks integration:
   - URL: `https://<project ref>.supabase.co/functions/v1/store-webhook`, or `https://api.knowno.app/functions/v1/store-webhook`;
   - Authorization header value: a random value of 16 or more printable characters, for example `openssl rand -hex 24`; keep it for step 8;
   - send both environments, since sandbox events grant.
8. **Vault, through admin.** Set each secret in admin's 스토어 비밀값 form, which checks the role and a sign-in within 10 minutes and never shows a value back. Only if the form is unavailable, call the RPC `admin_set_store_secret(name, value)` as an admin with a fresh session's access token: `curl -s -X POST https://<project ref>.supabase.co/rest/v1/rpc/admin_set_store_secret -H "apikey: <publishable key>" -H "Authorization: Bearer <admin access token>" -H 'Content-Type: application/json' -d '{"name": "knowno_store_webhook_authorization", "value": "<step 7 value>"}'` answers `"saved"`, then the same with `"name": "knowno_store_api_key"` and the step 6 key. `"reauth"` means sign in again. `admin_store_secrets()` lists which are set and when; `admin_clear_store_secret(name)` removes one.
9. **Where each key goes:**

   | Key | Goes to |
   |---|---|
   | Webhook Authorization value | RevenueCat's webhook integration, and Vault as `knowno_store_webhook_authorization` |
   | Secret API key | Vault as `knowno_store_api_key` only |
   | Apple and Google public SDK keys (the Google one is step 11.8) | `REVENUECAT_APPLE_API_KEY` and `REVENUECAT_GOOGLE_API_KEY` in `app/config/dev.json` |

10. **Check.** Use RevenueCat's "send test event"; the function answers 200 `ignored`. A sandbox purchase by a signed-in test user then shows the plan in `my_plan()`. An unset API key answers 503 and RevenueCat retries for about 80 minutes.

11. **Google Play.** Labels are Google Play Console's and RevenueCat's and may differ; the dashboards were not read.
    1. **App.** In Play Console, create the app with the package name `app.knowno` and upload a first build to a testing track (Play sells nothing until a build with the billing permission is uploaded).
    2. **Product.** Under Monetize with Play → Products → Subscriptions, create the subscription with the product ID `plus` and add the base plan `monthly` (auto-renewing, monthly, the price in KRW), then activate it.
    3. **RevenueCat Android app.** In the RevenueCat project add a Google Play app with the package name `app.knowno`.
    4. **Service account.** Following RevenueCat's Google Play setup, create a Google Cloud service account, enable the Google Play Android Developer API and the Cloud Pub/Sub API, invite the account in Play Console's Users and permissions with the permissions RevenueCat lists (view app information and financial data, manage orders and subscriptions), and upload its JSON key to the RevenueCat app. The key is a secret: it goes to RevenueCat only, never to the repository, the app or Vault. Credentials can take hours to be accepted.
    5. **Real-time developer notifications.** If RevenueCat asks for them, create the topic it names (or let it create the topic) and enter the topic in Play Console's Monetization setup; RevenueCat then learns of renewals and cancellations at once.
    6. **Products and entitlement.** Add the Play product `plus:monthly` to RevenueCat's Products, attach it to the entitlement `plus` (step 4) and to the package `$rc_monthly` of `default` (step 5).
    7. **License testers.** In Play Console's Settings → License testing add the Google accounts that test, and add them to the testing track; their purchases are free and renew on a short cycle.
    8. **Public key.** Copy the Google app's public SDK key (`goog_…`) into `REVENUECAT_GOOGLE_API_KEY` in `app/config/dev.json`; until then Android keeps the build that sells nothing.
    9. **Check.** A license tester signed in to the Android app buys, the plan shows in `my_plan()`, 구독 관리 opens Play's subscriptions, and 구매 복원 on a second device restores it.

Merging the function's pull request deploys it; it reads no function secret. To end store purchases, clear both secrets.

## Rationale

- [ADR 0241](adr/0241-set-a-paid-plan-from-revenuecat-s-current-entitlements-keep-store-grants-beside-admin-grants-and-refuse-mcp-to-free.md) records the trigger-only webhook, the store grants' own table, the secrets' form and MCP's refusal, with RevenueCat's pages cited.

## Open questions

- Whether to add RevenueCat's optional HMAC signature to the header check.
