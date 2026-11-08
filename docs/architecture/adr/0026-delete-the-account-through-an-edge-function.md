# ADR 0026: Delete an account through a `delete-account` Edge Function that deletes only the token's user, then sign out and clear the device as sign-out does

> Status: accepted; its function taking no input but the bearer token and never reading the body superseded by ADR-0210
> Date: 2026-10-15

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- The App Store requires an app that creates accounts to let a user delete theirs in the app. Issue #26 records the PM's decisions, amended 2026-10-15 by the owner so that deletion also clears the device:
  - an Edge Function `delete-account` verifies the caller's JWT and deletes that user with the admin API, using the service role only inside the function; it answers 204, 401 when unauthenticated, or 502 on failure, and never takes a user id from the body;
  - the account screen's "계정" section gets a red "계정 삭제" row with the note "계정을 삭제하면 서버와 이 기기에 있는 카드와 기록이 모두 지워져요. 되돌릴 수 없어요.";
  - a confirmation states what is removed and what stays, and needs a second tap on a destructive "삭제";
  - on success the app signs out of Supabase and Google and clears the device's data through `AccountData.clear()` ([ADR 0015](0015-sync-protocol-and-conflict-policy.md)) without pushing first; the gate ([ADR 0017](0017-require-sign-in-through-an-account-gate.md)) then shows the sign-in screen;
  - failures are typed `account` failures shown in snack bars.
- Every table in `public` references `auth.users` with `on delete cascade`, directly or through a user's deck or card: the four synced tables ([ADR 0010](0010-server-schema-and-row-level-security.md)), `extraction_usage` ([ADR 0013](0013-extract-cards-function-and-eval.md)), and `profiles`, `deck_reports` and `user_blocks` ([ADR 0020](0020-public-decks-in-a-sharing-domain.md)). Deleting the auth user is therefore the whole server-side deletion.
- `extract-cards` already reads the caller from Supabase Auth's `/auth/v1/user` with `fetch` and refuses the anon key and anonymous sign-ins. A second function needs the same check.
- The issue names three codes. `extract-cards` also answers 405 for a method other than `POST` and 503 when a platform variable is missing ([ADR 0013](0013-extract-cards-function-and-eval.md)).
- `supabase_flutter`'s client carries an Edge Functions client that sends the session's access token; it raises `FunctionsFetchException` for a request that never arrived and `FunctionsHttpException` with the status otherwise (`functions_client` 2.7.1).
- Alternatives considered:
  - A database function the client calls through PostgREST, `security definer`, deleting from `auth.users`. It puts a privileged delete of Auth's own table behind the client's role, where the admin API is the documented way and keeps the service role out of every role a client holds.
  - Soft deletion through the admin API's `should_soft_delete`. It keeps the user's row in `auth.users`, so the cascade never runs and the rows stay.
  - Copying the caller check into the new function. Two copies of the trust boundary drift apart.

## Decision

- **Function.** `supabase/functions/delete-account/` takes no input but the bearer token. It reads the user through Supabase Auth, then calls `DELETE /auth/v1/admin/users/<id>` with the service-role key, a hard delete that cascades to every row the user owns. It never reads the request body.
- **Codes.** 204 when deleted, 401 for no user, 502 when Supabase cannot be reached or does not delete; besides those, 405 for a method other than `POST` and 503 for a missing platform variable, as `extract-cards` answers. Each request logs one line of its user id and outcome.
- **Shared caller check.** The check moves to `supabase/functions/_shared/auth.ts`, which both functions import; it raises the same `SupabaseError` for an unreachable Auth as for an unexpected answer.
- **App.** `AccountService.deleteAccount()` invokes the function through the client's Edge Functions client and only deletes: a request that never arrived or a 5xx is `AccountOffline`, any other refusal or a success other than 204 is `AccountRejected`. The account screen confirms through `showAppConfirm`, then deletes, then runs the same sign-out and clear as sign-out without its push. A failure to delete leaves the account signed in with its data.
- **Row.** `AppListRow` gains a destructive variant that draws its title and leading icon in red.

## Consequences

- A deleted account leaves no row on the server holding its id, which `supabase/tests/account_deletion_test.sql` checks against every table in `public`; a new table must reference `auth.users` with `on delete cascade`, or that test fails.
- Copies other users made of a deleted user's public decks stay theirs: a copied card keeps its source deck's id in `origin_deck_id`, which holds no user id and no foreign key.
- Unsynced changes are lost with the account: deletion never pushes.
- `extract-cards` imports from outside its folder; a deploy of either function bundles `_shared/`.
- The function must be deployed before the row works; until then the app shows the rejection message, since the platform answers 404.

## Signs the decision was wrong

- A user reports data left on the server after deletion, or a table holding user ids without a cascade is added and the test is changed rather than the table.
- The admin API fails often enough that users see the 502 and retry by hand.
- A signed-in device of the same account, not the one that deleted it, keeps showing the account's data until its session expires, and that is found unacceptable.
- `_shared/auth.ts` grows branches for one function's needs.

## Errata

- 2026-10-18: §Consequences says "The function must be deployed before the row works; until then the app shows the rejection message". Supabase's GitHub integration deploys a changed function when its pull request merges into `main`, so no deploy follows the merge. #169 merged as `5ab5440e4475237dc21f25911a4d9f52ab89c3a1` at 19:20:11Z on 2026-10-17, and its `Supabase Preview` check on that commit ran 19:20:38–19:20:47Z. On 2026-10-18, `supabase functions list` showed `extract-cards` at version 9, updated 19:20:46 UTC, and no one had deployed it by hand (issue #177). Supabase's GitHub integration guide (`supabase/supabase` commit `626f0d412a5f88ef260289d4ed2b787f9705d6fc`, committed 2026-10-14, read 2026-10-18) lists "Edge Functions declared in `config.toml` are deployed" among the changes deployed to production. The decision stands: the row works once the merge that adds or changes the function has deployed it, and the rejection message covers a request made before that ([`server.md`](../server.md) §Edge Function deploys).
