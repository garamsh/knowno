# ADR 0072: Suspend a user through Supabase Auth's ban and restrictive write policies, remove a public deck from sharing for good, and read any deck in the admin area

> Status: accepted; its user search as the admin types with 더 보기 superseded by ADR-0181
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #234**, the owner's request of 2026-10-19, with the scope the PM decided. This ADR covers three of its five areas:
  - **user search as you type**: debounced by about 250 ms, in place, paged, in the database through a role-checked function;
  - **suspend and unsuspend** with a reason: a suspended user cannot sign in or refresh a session, extract photos or sync writes; the data is kept; the app and web say so plainly;
  - **deck management**: browse any user's decks read-only, and remove a public deck from sharing permanently with a reason. Deleting a user's deck is out of scope.
- **#234's constraints:**
  - No admin function may write `auth.users.email`, a password or a profile field, shown by test.
  - The migration is additive, "except the suspension's use of the auth schema, which the ADR justifies". The owner approves before merge, and the PM confirms that no existing row changes.
- **Before this change** ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md)):
  - `admin_deck` and `admin_deck_cards` read only a public or reported deck, "so a user's private decks stay out of the area".
  - `admin_find_users` returned at most 50 matches for a submitted query, with no paging.
  - An admin could make a public deck private, and its owner could publish it again.
- **Supabase Auth** refuses a password sign-in and a token refresh for a user whose `auth.users.banned_until` is in the future, with the error code `user_banned`. The stack test `app/test/account/suspension_test.dart` shows both against the local stack's Auth.
- **An access token already issued** stays valid until it expires. Auth checks the ban when it issues a token, not when PostgREST or a function accepts one.
- **Alternatives considered:**
  - **Supabase Auth's admin API** (`PUT /admin/users/{id}` with `ban_duration`). It needs the service-role key, which the web must not hold ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md)), or an Edge Function holding it, which would move the role check out of Postgres. It writes the same column.
  - **A suspension table alone, with no ban.** The server could refuse writes and extractions, but the user would go on signing in and refreshing. #234 asks for both to be refused.
  - **A `custom_access_token` hook** that refuses a suspended user's token. It is a console setting, which the dispatch rules out, and every token issue would call it.
  - **Deleting the user's sessions and refresh tokens** at suspension. It writes two more auth tables, and refresh is already refused by the ban; an access token still in hand would stay valid either way.
  - **Changing the existing owner policies** to add the suspension check. It replaces existing objects. A restrictive policy is added beside them, and every write must pass both.
  - **Changing `admin_deck` and `admin_deck_cards`** to read any deck. `create or replace` changes an existing object, and the migration stays additive. New functions read any deck; the old ones stay, unused.
  - **Deleting a removed deck.** #234 rules it out, since it destroys user data.

## Decision

- **A suspension** is a row in `private.suspensions`: the user, the reason (1 to 500 characters), who suspended and when. A user without a row is active.
  - `suspended_by` references `auth.users` with `on delete set null`, as `private.admins.granted_by` does.
- **The one auth write.** `admin_suspend_user` sets the user's `auth.users.banned_until` to now plus 100 years, and `admin_unsuspend_user` sets it to null.
  - This is the only write to the `auth` schema in any admin function. It is what makes Supabase Auth refuse the user's sign-in and refresh.
  - It changes no other auth column, and no function writes an email, a password, a phone or a metadata column, or a `profiles` row.
  - `supabase/tests/admin_users_test.sql` shows this two ways: a digest of every user's email, password hash, phone, metadata and profile, unchanged after every admin write function; and a check that no function's body updates an `auth.users` column other than `banned_until`.
- **Sync writes** are refused by restrictive policies on `decks`, `cards`, `reviews` and `card_states`, one per command a user may run, each passing only when `public.is_suspended()` is false.
  - The existing owner policies are unchanged. A restrictive policy is ANDed with them.
  - A suspended user's reads still pass, so the app goes on showing the user's own data until its token expires.
- **Extraction** is refused by `extract-cards`: before it counts the photo, it asks `public.user_suspended(user_id)` with the service role, and answers a suspended user `403` with the error `suspended`. No photo is counted and no model is called.
- **What the user sees:**
  - The app's Google sign-in classifies `user_banned` as `AccountSuspended`, and extraction's `403 suspended` as `AccountSuspendedFailure`. Both show "이 계정은 이용이 정지됐어요. 문의는 sauce@garam.sh로 보내 주세요." in Korean, and its English equivalent.
  - The web's sign-in callback sends `user_banned` to `/login?error=suspended`, which shows the same sentence.
- **Each refusal is shown against an active user** as control: the writes and the ban in `admin_users_test.sql`; refresh, sign-in and a sync push against the real Auth and PostgREST in `suspension_test.dart`; extraction in `handler_test.ts`.
- **Suspending:**
  - refuses the caller's own account, an unknown user and a user already suspended, recording nothing;
  - records `suspend_user` on a `user`, with the email and the reason. `admin_unsuspend_user` records `unsuspend_user`.
- **Removing a deck from sharing** is `admin_remove_deck(deck_id, reason)`.
  - It writes a row in `private.deck_removals` (the deck, the reason, who and when) and makes the deck private with an edit time of now, as `admin_unpublish_deck` does, so the owner's devices pull it.
  - Restrictive policies on `decks` keep a removed deck from being made public again, by insert or update.
  - The deck stays its owner's, with its cards. Copies other users made are theirs and unchanged.
  - It records `remove_deck` on a `deck`, with the name and the reason. A deck already removed records nothing.
- **Any deck is readable** by an admin, read-only: `admin_user_decks(user_id)` lists a user's live decks, private ones too, and `admin_user_deck` and `admin_user_deck_cards` read any one deck, with its removal when there is one.
  - This supersedes ADR 0070's "a user's private decks stay out of the area", as #234 asks. Every read still checks the role.
- **The user search** is `admin_search_users(query, page_size, page_offset)`: emails holding the query, ignoring case, those starting with it first, then by email, 20 a page by default and at most 100, each with whether it is suspended and the total.
  - The web asks 250 ms after the last keystroke. It keeps the shown results until the next arrive, drops an answer to an older query, and adds the next page on "더 보기".
- **The old functions** `admin_deck`, `admin_deck_cards` and `admin_find_users` stay in the database, no longer called. Dropping them is a non-additive change, left to a later migration the PM approves.
- **The migration** `20261019200000_admin_users.sql` creates two tables, their indexes, the policies and the functions. It changes no existing row and replaces no existing object.

## Consequences

- A suspended user's refresh fails, so it reaches the server no longer than its access token lasts. Until then its reads work, and its writes and extractions are refused.
- The app classifies `user_banned` only where it signs in, so the sentence shows on a sign-in or an extraction, not on a background refresh.
- A deck removed from sharing can never be published again by its owner. Lifting a removal is not offered; a later change adds it if an operator needs it.
- The owner policies of four tables now pass through a second check on every write, one call to `is_suspended()` per statement.
- Three admin functions remain in the database with no caller until a later migration drops them.
- Merging deploys the migration and `extract-cards` together, in no stated order. Should the function arrive first, `user_suspended` is not yet there, and each extraction answers `500` until the migration applies.

## Signs the decision was wrong

- A Supabase Auth upgrade stops reading `banned_until`, or reports a banned user with another error code, and the stack test fails.
- A suspended user's writes reach the server through a table the policies do not cover.
- Operators need to suspend for a stated time, and the 100-year ban needs an end the function does not take.
- Removed decks need to come back, and owners ask for a way to publish one again.
