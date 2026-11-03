# ADR 0157: Let admins, and users granted 무제한, past every photo limit, decided in the server's metering, with the grant beside the plan

> Status: superseded by ADR-0177
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #597**, the owner's request of 2026-11-03: "나와 같은 어드민이나 아니면 내가 특별히 지정하는 사용자는 무제한으로 사용 가능해야돼".
- **Before this change:**
  - every user, admins included, was held to the photo limit of its plan's version ([ADR 0097](0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md)), Max to its fair-use cap of 1,000 a day;
  - `public.begin_extraction` and `public.extraction_allowance` resolved that limit through `private.entitlement_of`, and the admin area's trial of a prompt counted against the admin's own limit ([ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md));
  - a user held at most one grant, of Pro or Max, in `private.user_plans` ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)).
- **The issue's decisions:** being an admin is reason enough, with no grant; designated users hold 무제한, granted and revoked on the admin user page with an optional end and recorded in the audit log, never sold; the server decides it, and the clients only display it; spend is still recorded; an ended 무제한 falls back to the user's plan.
- **Neither client shows a standing allowance.** The phone and the web read `extraction_allowance` only when several photos are picked, and speak only when the batch is cut ("오늘 n장 더 만들 수 있어요. 처음 n장만 읽어요.") or nothing is left. The PM decided (#597) that no new "무제한" text is added to them; the admin user page shows it.
- **No spend cap exists** in the schema at this change, so there is none to exempt admins from.
- **Alternatives considered:**
  - **무제한 as a fourth plan in `private.user_plans` and `private.plan_versions`.** A user holds one grant, so granting 무제한 would replace a Pro or Max grant and its end would leave the user on Free, not on its plan. It would also need a model and versions of terms for a plan with no terms. Rejected.
  - **A very large amount on a version.** A number is a limit, not its absence, and it would still refuse an admin past it; it would also apply to every holder of that plan. Rejected.
  - **A separate `unlimited` column beside `photo_limit` in `extraction_allowance`.** It would let the answer hold a limit and no limit at once, and need a new signature. Rejected for a null limit.
  - **Deciding on the clients from the admin flag.** The issue puts the decision on the server, where the function enforces it. Rejected.

## Decision

- **The rule.** `private.unlimited(user_id)` answers whether no photo limit applies to a user: an admin (a row in `private.admins`), or a holder of a 무제한 grant that has not ended. Both count functions ask it, so they agree.
- **The grant.** `private.unlimited_grants` holds one grant per user: an optional end, who granted it and when. It sits beside the plan's grant, so a user keeps its plan, and its model, while it holds 무제한, and returns to that plan's limit when the grant ends. No client role holds a privilege on it.
- **The metering.**
  - `begin_extraction` allows and records every photo of such a user, under the same lock, with the same call record, so spend and cost reporting stay true. Its row is unchanged: `photo_limit` and `period` are still the plan version's, so `extract-cards` needs no change.
  - `extraction_allowance()` keeps its signature and answers `photo_limit` null for such a caller, with the period and the photos counted in it.
- **The admin area.** `admin_user_unlimited(user_id)` reads the decision and the grant, ended or not; `admin_grant_unlimited(user_id, ends_at)` grants or replaces it, refusing an unknown user and an end not in the future; `admin_revoke_unlimited(user_id)` removes it. Each checks the role, and the two writes record `grant_unlimited` and `revoke_unlimited` on the `user`. The user page has a 무제한 section, and the header a 무제한 chip.
- **The clients.** The phone and the web read a null `photo_limit` as an allowance with no limit, not as one that could not be read: a batch is never cut and no note shows.
- **Removed.** The admin trial's sentence for a `429`, which an admin no longer meets.

This supersedes ADR 0073's trial counted against the admin's daily limit.

## Consequences

- An admin, or a user the owner names, reads any number of photos on its plan's model, and each still costs what it costs; the owner's spend on them is bounded by nothing but the grant.
- An admin's own Max fair-use cap no longer applies to it.
- An app or a web build before this change reads a null limit as an allowance it cannot read, which also reads every photo, so nothing breaks while the clients update.
- A grant that ends stays on the page as ended until it is replaced or revoked.

## Signs the decision was wrong

- A 무제한 holder's spend surprises the owner, so 무제한 needs a cap or a review of its own.
- The owner asks for 무제한 to carry a model of its own, which would make it a plan.
- A later metered feature needs another decision than "no limit", so `private.unlimited` should answer per feature.
