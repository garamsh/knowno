# ADR 0097: Give each plan versions of its terms with a start, Free 10 a month, Pro 100 a day and Max unlimited to 1,000 a day, each grant taking the latest at its monthly renewal

> Status: accepted; its model on each version and the same-model condition of its favour rule superseded by ADR-0162
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Before this change** ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md), [ADR 0089](0089-import-up-to-ten-photos-into-one-list-read-two-at-a-time-and-state-today-s-limit-before-reading.md)):
  - `private.plans` held `free`, `pro` and `special`, each with a model and a `daily_limit`, which `admin_set_plan` changed in place for every user at once;
  - `begin_extraction` and `extraction_allowance` counted a user's photos from 00:00 UTC;
  - the owner had set the limits to Free 30, Pro 100 and Special 200 a day on 2026-10-20 (issue #331, recorded in [ADR 0094](0094-read-a-photo-import-of-up-to-fifty-photos-three-at-a-time-as-an-app-level-job-kept-on-the-device-and-offered-again-after-a-restart.md)).
- **The owner's decisions of 2026-10-20** (issue #341):
  - Free: 10 photos a month, reset on the 1st at 00:00 Asia/Seoul;
  - Pro: 100 photos a day;
  - Max: unlimited, with a fair-use cap of 1,000 a day; Max replaces Special, so a Special grant becomes Max;
  - an admin's edit creates a new version with a start date: new subscribers take it at once, existing ones at their next renewal, and an edit in the user's favour may apply to everyone at once; each edit is in the audit log;
  - a photo counts when its AI call starts, and a cancel stops the work.
- **Each plan keeps its model**, and Max takes Special's: a change of model changes cost, which is the owner's ([`server.md`](../server.md) §Edge Function deploys, "Gate").
- **No billing exists.** Pro and Max are granted by an admin by hand, so no grant has a paid period whose end could be its renewal.
- **The migration changes existing data.** The owner delegated its sign-off to the PM on 2026-10-26 (issue #341). Merging deploys it and the function, in no stated order ([`server.md`](../server.md) §Location and migrations, "Deploy path").
- **Alternatives considered:**
  - **Keeping `daily_limit` and adding a period beside it.** A monthly plan would hold its month's photos in a column named for a day. The table has no other reader than the functions this change replaces.
  - **Renewal on each grant's own monthly anniversary.** Every grant would renew on a different day, which nothing bills by yet, and Free has no grant to count from. One date for everyone matches the only reset the owner named, Free's.
  - **Moving every user to the owner's terms at the migration.** Free users would go from 30 a day to 10 a month in the middle of a month they had begun on the old terms, which the versioning decision exists to prevent.
  - **Counting a monthly period only from the migration.** Each new version would need its own start for counting, so a version created mid-month would reset everyone's count. Putting existing users on the old terms until the 1st needs no such rule.
  - **Storing no version on a grant, and reading it from the grant's time.** The issue asks for a grant that points at its version, and a stored reference makes a version a grant holds impossible to remove by accident.

## Decision

- **Versions.** `private.plan_versions` holds each version of a plan's terms: the plan (`free`, `pro` or `max`), the quota, an amount from 0 to 100,000, the model, its start, whether it applies to all, and who created it when.
  - The quota is `monthly`, the amount a calendar month in Asia/Seoul; `daily`, the amount a day there; or `unlimited`, the amount the fair-use cap a day there.
  - A version is never changed. An edit is a new version.
- **Renewal.** Until billing exists, every grant renews on the 1st of each month at 00:00 Asia/Seoul, Free included, the boundary of Free's month. A user's version is:
  - for a grant begun since the last renewal, the version it began on, which the grant references;
  - for a grant begun before it, the version in effect at that renewal;
  - for a Free user, who has no grant, Free's version in effect at the later of its sign-up and the last renewal;
  - and, over any of these, the latest version of its plan that applies to all and has started since.
  A Max past its end is Free, as Special was.
- **A version in the users' favour** may apply to all from its start. It is in their favour when every version of the plan started by then has the same model, counts no more generously, in the order monthly, daily, unlimited, and allows no more photos in its period. The server refuses applying to all otherwise.
- **The count.** `begin_extraction` and `extraction_allowance` resolve the version through one function, `private.entitlement_of`, and count the photos since the start of its period. The function's `429` states `photo_limit` and `period` (`month` or `day`), and `extraction_allowance` returns the same with `used`.
- **Carrying usage into the first period** (decided here):
  - No count is reset or moved. A period counts every photo recorded since its start, those before the migration included.
  - Existing Free users stay on the terms they had, 30 a day, until the 1st of next month, when 10 a month begins with November's count at 0; a photo from October never counts against a monthly quota of theirs.
  - Today's photos count against Pro's 100 and Max's 1,000 from 00:00 in Seoul, the day's start moving from 09:00 to 00:00 Korean time.
  - A user who signs up after the migration takes 10 a month at once, its month holding only its own photos.
- **The migration** `20261026005136_plan_versions.sql`:
  - makes each plan's settings its first version, from when they were last set: Free daily 30, Pro daily 100 and Max daily 200 on production's values;
  - adds the owner's terms as a second version from the migration, on the first version's model: Free monthly 10 at each user's renewal; Max unlimited to 1,000 for all at once, being in the users' favour; and none for Pro, whose terms are already 100 a day;
  - turns each Special grant into a Max grant on Max's first version, keeping its end, granter and time, and each recorded call served by Special into one served by Max;
  - backs up what it changes: `private.plans` kept verbatim as `private.plans_before_versions`, the grants as `private.user_plans_before_versions`, and the converted calls' ids in `private.extraction_calls_before_versions`;
  - records each version of the owner's terms in the audit log as the migration, by the owner's delegation to the PM.
- **Revert.** `select private.revert_plan_versions();`, run by the PM, adds for each plan a version of its settings before, from then, applying to all, Special's as Max's, each recorded. Max keeps its name; a return to the tables before is a later migration from the backups.
- **The admin area.**
  - `admin_plan_versions()` lists every version with the one a user subscribing now takes; `admin_create_plan_version(plan, quota, amount, model, starts_at, applies_to_all)` creates one from now or a later start, recorded as `create_plan_version` on the `plan` with the terms before, and refuses a start already past, the current terms again, and applying to all terms not in the users' favour.
  - `admin_plans` and `admin_set_plan` are dropped. `admin_user_plan` returns the user's version, its terms and the photos counted in its period, and `admin_grant_plan` grants Pro or Max on the version a user subscribing now takes.
  - The Plans page shows each plan's current terms, a form for a new version with its start (00:00 Asia/Seoul on the day chosen, or now) and whether it applies to all, and every version. The plans are named 무료, 프로 and 맥스.
- **The app** names the period in the allowance's note and the limit's failure: "이번 달 n장 더 만들 수 있어요." and "이번 달 사진으로 만들 수 있는 n장을 다 썼어요. 다음 달 1일에 다시 시도해 주세요." for a monthly plan, the daily sentences otherwise.
- **Supersessions:**
  - ADR 0071's plans with a model and a daily limit set in place by `admin_set_plan`, its Special plan, and its UTC day;
  - ADR 0089's "today's limit" read from the UTC day, which is now the version's period;
  - the `429` body's `daily_limit`, which ADR 0071 added.

## Consequences

- Changing a plan's terms never changes a paying user's terms mid-month unless the change is in their favour, and every change is a version with its start in the log.
- The function's contract changes: an app built before it reads a `429` without `daily_limit` as a service failure until it is rebuilt from the same `main`, as ADR 0078 allows before the first store release.
- During the deploy, between the migration and the function, the old function reads `begin_extraction`'s new row as one it should not and answers `500`, and the new function the old row likewise.
- A user moved from Pro to Free mid-month by a revoke counts the month's photos made on Pro against Free's 10.
- Max at its cap reads as a daily limit of 1,000; the app does not name fair use.
- Renewal on the 1st is a rule for grants without billing. Billing will give each paid grant its own renewal, which `private.entitlement_of` then reads instead.

## Signs the decision was wrong

- Free users run out of 10 a month early and leave, or Free costs more than the owner meant, so the quota or its period is wrong.
- An admin needs to apply a change against the users' favour at once, as a correction, and the favour rule blocks it.
- Billing arrives with renewals that differ per grant and the stored version on each grant is not enough to say which terms it bought.
- The two count functions disagree for a user, so the app states a limit the function does not apply.
