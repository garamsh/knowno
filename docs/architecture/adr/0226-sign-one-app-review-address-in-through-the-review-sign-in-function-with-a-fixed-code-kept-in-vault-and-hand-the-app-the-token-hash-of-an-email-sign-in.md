# ADR 0226: Sign one App Review address in through the `review-sign-in` function with a fixed code kept in Vault, and hand the app the token hash of an email sign-in

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #835**, from the owner's question of 2026-11-09: how to give App Review an account when sign-in is not by password. The phone's half is #836.
- **The rule.** App Review Guideline 2.1(a), read 2026-11-09 at `https://developer.apple.com/app-store/review/guidelines/`: "include demo account info (and turn on your back-end service!) if your app includes a login. If you are unable to provide a demo account due to legal or security obligations, you may include a built-in demo mode in lieu of a demo account with prior approval by Apple."
- **The gap.** The phone signs in with Google, Apple or an email code ([ADR 0213](0213-sign-in-by-email-with-a-six-digit-code-sent-in-korean-and-set-the-production-project-s-auth-by-hand-since-its-config-toml-section-is-not-applied.md), [ADR 0214](0214-sign-in-with-an-email-code-on-the-phone-in-a-screen-opened-over-the-sign-in-screen-with-three-failures-added-to-the-account-failures.md)). A reviewer cannot read the mailbox a code goes to.
- **Sources**, read 2026-11-09 from `supabase/supabase` at `a1538e957b0b25c05e54f8779dc6847c9a3f06cb`, committed 2026-11-09T08:47:06Z, and from `supabase/auth` at `35307ce6c1ca59016fd820f1d77d9b6201dc2e15`, committed 2026-11-06T23:57:06Z:
  - `apps/docs/content/guides/auth/testing-auth-flows.mdx`: "use test phone numbers to sign in with a fixed code"; under "Test phone sign-in with test numbers", "Auth doesn't send an SMS to a test number". Email has no such setting there.
  - `apps/docs/spec/supabase_dart_v2.yml`, `generateLink()`: "Generates email links and OTPs. This will not send links or OTPs to the end user."; "`generateLink()` handles the creation of the user for `signup`, `invite` and `magiclink`."; the response holds `hashedToken`, `emailOtp`, `actionLink`. The same file, `verifyOTP`, takes an optional `tokenHash` ("Token used in an email link"). `apps/docs/spec/supabase_js_v2.yml` lists the same `verifyOtp` types, "`email`, `recovery`, `invite` or `email_change` (`signup` and `magiclink` types are deprecated)".
  - `apps/docs/content/guides/auth/auth-email-passwordless.mdx`, "With Magic Link", PKCE: the exchange of a hash for a session is `verifyOtp({ token_hash: 'hash', type: 'email' })`; the setting "Email OTP expiration" "also governs the validity of Magic Links and other email links".
  - `openapi.yaml` of `supabase/auth`, `/admin/generate_link`: the request takes `type` (`magiclink` among them) and `email`; the response holds `action_link`, `email_otp`, `hashed_token`, `verification_type`, `redirect_to`, with additional properties; `/verify` takes `type` and `token_hash` and answers "An access and refresh token."
  - `apps/docs/content/guides/database/vault.mdx`: secrets are stored encrypted and "available in decrypted form through a Postgres view", `vault.decrypted_secrets`; `vault.create_secret(secret, unique_name, description)`.
  - `apps/docs/content/guides/functions/function-configuration.mdx`: `verify_jwt = false` per function in `config.toml`.
- **Measured here**, on a local stack of this repository's migrations (Auth from the Supabase CLI 3.0.0-next.9's images), with the function's own code run against it: a `generate_link` for an address with no user created the user, provider `email`, confirmed; `POST /auth/v1/verify` with `{"type": "email", "token_hash": <hashed_token>}` and no other field answered 200 with an access token for that user; the same hash a second time answered 403 `otp_expired`; a second `generate_link` for the now-existing user and a verify signed it in again.

## Decision

- **One function, one address, one code.** A new Edge Function `review-sign-in`, `verify_jwt = false` because its caller has no session yet, takes the address and the code. Both are Vault secrets the owner creates, `review_sign_in_email` and `review_sign_in_code`, read through `public.review_sign_in_begin(address_key)`, which only `service_role` executes. A secret is never cached: deleting either from Vault ends review sign-in at the next request.
- **The contract the app calls.**
  - Request: `POST {SUPABASE_URL}/functions/v1/review-sign-in`, `Content-Type: application/json`, the project's publishable (anon) key as `apikey`, which `supabase_flutter`'s `functions.invoke('review-sign-in', body: {...})` sends; body `{"email": <string, 1 to 254 characters>, "code": <string, 1 to 128 characters>}`. The address is trimmed and compared in lower case, the code trimmed.
  - Answer `200` `{"token_hash": <string>, "type": "email"}`: the address and the code are the owner's.
  - Answer `401` `{"error": "refused"}`: anything else that is a well-formed attempt, whichever of the address and the code was wrong, whether the address is the review address, and whether the owner has set the secrets. One body, one status, one log line (`outcome: refused`), the same work done.
  - Answer `429` `{"error": "rate_limited"}` with `Retry-After: 600`: the attempts below.
  - Answer `400` `{"error": "bad_request"}`, a body that is not JSON of that shape; `405` `method_not_allowed`; `502` `unavailable`, the database or Auth failed or answered in another shape; `503` `not_configured`, the platform's `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing. None says anything about the address.
  - The session: on `200` the app calls `supabase.auth.verifyOTP(tokenHash: token_hash, type: OtpType.email)` and is signed in as `signInWithOtp`'s code would sign it in: the `AuthResponse` carries the ordinary session, which `supabase_flutter` stores. The function never holds an access or refresh token. The hash is single use and lives as long as an email code, 600 s (`otp_expiry`), so the app exchanges it at once. A `verifyOTP` failure is `AccountCodeRefused` or `AccountRateLimited` as [ADR 0214](0214-sign-in-with-an-email-code-on-the-phone-in-a-screen-opened-over-the-sign-in-screen-with-three-failures-added-to-the-account-failures.md) maps it.
  - The phone's rule for when to call it is #836's; a real code is six digits and the review code is at least 12 characters, so a code that cannot be a real one can go to this function instead of `verifyOTP`.
- **How the session is made.** After a match the function calls the admin API, `POST /auth/v1/admin/generate_link` with `{"type": "magiclink", "email": <address>}` and the service-role key, and answers its `hashed_token`. That sends no email, creates the user on first use as any email sign-in does (an ordinary 무료 account), and signs an address with an existing account into that account. The `email_otp` and the `action_link` it also returns are dropped.
- **Constant time.** Every attempt hashes the input and each secret with SHA-256 and compares the two 32-byte digests byte by byte without stopping at the first difference, the address and the code both, whether or not either is set; a missing secret compares against the empty text. Only a match goes on to `generate_link`.
- **A code too short is no code.** A secret under 12 characters is treated as unset, so a weak code the owner typed fails closed.
- **Attempt limits.** Every attempt, whatever its address, is recorded in `private.review_sign_in_attempts` under the hex SHA-256 of the normalized address (never the address) before anything is read. An address over 5 attempts in the last 10 minutes, or the function over 20, is refused 429 and no secret is read. Every address is counted alike, so the limit says nothing of which is the review address. A row is deleted a day after it. Success is counted too.
- **Migration** `20261110090000_review_sign_in.sql`: the table, `public.review_sign_in_begin`, and `private.revert_review_sign_in()`. It changes no row and no existing object, so it is additive; the Auth settings of every other user are untouched.
- **The owner's steps.**
  1. **The address.** Choose one that no real account uses, on Google, Apple or email: whoever holds the code signs in as that account's user. It must also receive mail, since the app's address step sends a real email code to it first (and a bounce is a mark against the SMTP sender).
  2. **The code.** At least 12 random characters, for example `openssl rand -hex 12`. With 20 attempts every 10 minutes, at most 2,880 guesses a day across all callers, a 24-character hex code is out of reach.
  3. **Vault**, in the production project's SQL editor or its Vault page (whose labels were not read): `select vault.create_secret('<address>', 'review_sign_in_email', 'App Review sign-in address (ADR 0226)');` and the same for `review_sign_in_code`. The SQL editor keeps its history, so the Vault page is the better place for the code. To change one later, `vault.update_secret` on its id; to end review access, delete both.
  4. **Merging** deploys the function and applies the migration; neither needs a function secret, and with no Vault secret every attempt is refused.
  5. **Check**, once the app of #836 or `curl` can reach it: `curl -s -X POST https://<project ref>.supabase.co/functions/v1/review-sign-in -H "apikey: <publishable key>" -H 'Content-Type: application/json' -d '{"email": "<address>", "code": "<code>"}'` answers 200 with a `token_hash`; a wrong code answers 401. Do not run it more than 5 times in 10 minutes.
  6. **App Store Connect**, App Review Information, Sign-in required: User name the address, Password the code, and in the notes the phone's steps as #836 builds them. Google Play's review takes the same credentials in its own form, not read here.

## Alternatives considered

- **Supabase phone test numbers.** A fixed code for a phone number (`testing-auth-flows.mdx`), but the app has no phone sign-in, and adding one means an SMS provider and a screen for the reviewer alone. Email has no such setting.
- **A built-in demo mode.** Guideline 2.1(a) allows one only with Apple's prior approval, and only where a demo account cannot be given; here one can. It would also ship a second app path to maintain and to keep from real data.
- **A password for one account.** The app would need a password field, which #792 decided against ([ADR 0213](0213-sign-in-by-email-with-a-six-digit-code-sent-in-korean-and-set-the-production-project-s-auth-by-hand-since-its-config-toml-section-is-not-applied.md)), and the account would hold a second long-lived credential, tried at Auth's own limits and outside this function's.
- **Sign in with Apple alone.** Needs the reviewer to hold an Apple ID, and the app offers Apple sign-in on iOS alone ([`account.md`](../account.md) §Sign-in and session), so Google Play's reviewers on Android cannot use it.
- **The function answers a session, not a token hash.** It would call `/auth/v1/verify` itself and return the access and refresh tokens, so the app would need `setSession` and the function would hold and send a long-lived credential. The hash is single use, expires in 10 minutes, and the app uses the same `verifyOTP` call it has.
- **An in-memory attempt limit.** An Edge Function's instances are not shared, so each would count alone and the limit would be a multiple of itself.
- **A Send Email hook** that makes the review address's code fixed: needs a hook function on Auth's own path for every user's email, against the constraint that Auth for other users is untouched.

## Consequences

- Anyone can spend the 20 attempts of a window and lock the reviewer out for up to 10 minutes, or 6 on the review address. The limit protects the code, not the reviewer's time; the 429 names the wait.
- A reviewer may delete the account in the app (deletion is required of an app with sign-in); the next review sign-in creates a fresh one.
- The app's address step sends the review address a real email code before the reviewer reaches the code field, which counts against the project's hourly email limit and, to an address that does not receive mail, bounces. #836 may find a way around that; this ADR's contract does not need it.
- The code is a Vault secret that `service_role` reads decrypted; it appears in no log, answer or error (`handler_test.ts` checks the log and the answers). An address under attack is in the table only as a SHA-256, which a guesser could still test.
- The function's bundle imports `_shared/auth.ts`, so a change there deploys it as it does the other four.
- Not verified here: a real Supabase project's behaviour (the check was against a local stack), a reviewer's use of the screen of #836, and Google Play's form.

## Signs the decision was wrong

- App Review rejects the build for the sign-in, or asks for a demo mode after all: the demo account was not enough for the reviewer's flow.
- The Edge Function logs show `rate_limited` at the times of real reviews: the limit is too tight for how reviewers retry.
- Logs show `refused` in numbers at a steady rate: the endpoint is being probed, and the code's strength or the limit needs to change.
- Auth stops accepting `type: email` with a `generate_link` token hash, or `generate_link` stops creating the user: the contract's session step is wrong, and a newer ADR supersedes this one.
