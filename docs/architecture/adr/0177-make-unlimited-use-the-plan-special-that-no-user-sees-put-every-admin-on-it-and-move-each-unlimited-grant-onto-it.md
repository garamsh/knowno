# ADR 0177: Make unlimited use the plan 스페셜, which no user sees, put every admin on it, and move each 무제한 grant onto it

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #649**, the owner's direction of 2026-11-03: "무제한 대신 special(스페셜)로 하자 … 요금제에 무제한이 존재하도록 … 일반 사용자는 볼 수 없는 요금제", and "저렇게 숨겨짐 같은걸 표시하라는게 아니었어".
- **Before this change** ([ADR 0157](0157-let-admins-and-users-granted-unlimited-use-past-every-photo-limit-decided-in-the-server-s-metering-with-the-grant-beside-the-plan.md)):
  - unlimited use was a grant beside the plan, in `private.unlimited_grants`, with its own three admin functions and its own 무제한 section and chip on the admin user page;
  - `private.unlimited` answered it for an admin or a holder whose grant had not ended, and `begin_extraction` and `extraction_allowance` asked it;
  - an ended grant left the user on its plan.
- **ADR 0157 rejected unlimited use as a plan.** A user holds one grant, so 스페셜 would replace a Pro or Max grant, and it would need a model and versions of terms. The owner now asks for it as a plan anyway, so these costs are taken on, not avoided. Its sign "the owner asks for 무제한 to carry a model of its own, which would make it a plan" is what happened.
- **What the users can read.** No client has a 내 플랜 screen. The one user-facing read of the plan is `extraction_allowance()`, which answers a limit, a period and a count and names no plan. `extract-cards` answers a photo's cards or an error, with the plan only in its log and, for a `429`, the limit and period, which 스페셜 never meets. The terms page names 맥스's cap and no other plan.
- **Alternatives considered:**
  - **스페셜 with a very large amount, or Max's `unlimited` quota.** A number is a limit, and Max's quota has a fair-use cap. Rejected for a quota of its own with no amount.
  - **스페셜 without versions, decided in code.** Every other plan resolves through `plan_versions`, and grants reference a version. A version of its own keeps one path. Rejected.
  - **Keeping the separate grant for non-admins.** The owner asks for one concept. Rejected.
  - **A "hidden" badge in admin.** The owner said this was not what he meant. Rejected: 스페셜 is hidden from users because nothing they read names it, not because of a label.

## Decision

- **The plan.** `special`, named 스페셜, joins Free, Pro and Max. Its versions take the quota `none`, which has no amount and no limit. A check holds that 스페셜 takes only `none` and that no other plan takes it, so 스페셜's terms can never become a limit. The migration gives it one version.
- **The metering.** `private.unlimited(user_id)` keeps its name and now answers whether the user's entitlement has the quota `none`. `begin_extraction` and `extraction_allowance` keep their bodies: 스페셜 allows and records every photo, and `photo_limit` is null for it in both. `extract-cards` reads a null `photo_limit` on an allowed row, and refuses a refused row without one as a row it should not get.
- **Admins.** `private.entitlement_of` puts every admin on 스페셜's version whatever it was granted, so admin trials and every admin photo go through 스페셜's configuration.
- **Giving it.** `admin_grant_plan` gives 스페셜 with an optional end, as Max, and `admin_revoke_plan` removes it, each recorded as for any plan. The admin user page offers it in 요금제 바꾸기, and the plans page and the AI settings page list it like any plan, with no hidden badge. The plans page shows its terms as 제한 없음 and draws no form for a new version.
- **Its model.** 스페셜 has an AI configuration of its own. The migration seeds it as a copy of Max's active one, and admins change it on the AI settings page as any plan's.
- **Never shown to users.** No user-facing read, string or API answer names it. A pgTAP test lists every function `authenticated` may run outside the admin functions that reads a plan, and finds only `extraction_allowance`.
- **The migration.** Each 무제한 grant that has not ended moves to `private.user_plans` as 스페셜, with its end, granter and time. The Pro or Max grant it replaces is kept in `private.user_plans_before_special`, and every 무제한 grant, ended or not, in `private.unlimited_grants_before_special`. A grant that had already ended is backed up but not moved. The revert is in the migration's header. `private.unlimited_grants` and its three admin functions are dropped, and so is the admin page's 무제한 section.
- **The falls-to-Free constraint for payments (#599).** A user holds one grant, so a 스페셜 grant that ends leaves its holder on Free, not on a Pro or Max it held before. Once store purchases exist, a user's entitlement must be the better of its purchase and any grant, so an ended 스페셜 grant cannot drop a paying user to Free.

This supersedes ADR 0157.

## Consequences

- 무제한 holders move from their plan's model to 스페셜's, a copy of Max's, so the cost per photo changes for those who were on Free or Pro.
- An admin's own Pro or Max grant no longer decides its plan; it shows beside 스페셜 on the user page.
- A user whose 스페셜 grant replaced a Pro or Max grant returns to Free when the grant ends. Only the backup table and the revert keep the earlier grant.
- An app or a web build from before this change reads the same null limit as before.
- The admin log keeps its past `grant_unlimited` and `revoke_unlimited` entries, still named.

## Signs the decision was wrong

- 스페셜's spend surprises the owner, so it needs a cap, which a version of terms could then carry.
- An admin needs to be held to a plan's limit, for instance to try one, so admins should not be on 스페셜 automatically.
- A user-facing read starts to name the plan, so the check that 스페셜 stays unseen needs to cover answers as well as functions.
