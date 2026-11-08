# ADR 0210: Revoke the Apple authorization when an account is deleted, by exchanging a fresh authorization code at deletion, and never let a failed revocation stop the deletion

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #731.** An account that signed in with Apple (ADR 0186) must have the app's Apple tokens revoked when it is deleted. The issue names App Review's guideline 5.1.1(v); that guideline was not read here.
- **Sources**, all read 2026-11-09. Apple's documentation pages render by script: fetching the HTML of "Revoke tokens" returned only its title, so what is cited below is read from the JSON Apple's documentation site serves for each page (`https://developer.apple.com/tutorials/data/documentation/<path>.json`), except the last Apple page, which was fetched as HTML.
  - **Revoke tokens** (`signinwithapplerestapi/revoke-tokens`): `POST https://appleid.apple.com/auth/revoke` takes `client_id` ("The identifier (App ID or Services ID) for your app. The identifier must match the value provided during the authorization request", and must not include the Team ID), `client_secret`, `token` ("The user refresh token or access token intended to be revoked") and an optional `token_type_hint`, `refresh_token` or `access_token`. It answers 200 "without a response body after the server invalidates the `token` value, or if the `token` value was previously invalidated", and "In order to revoke authorization for a user, you must obtain a valid refresh token or access token. If you don't have either token for the user, you can generate tokens when validating an authorization code."
  - **Generate and validate tokens** (`signinwithapplerestapi/generate-and-validate-tokens`): for an authorization code, `POST /auth/token` takes `client_id`, `client_secret`, `code` and `grant_type=authorization_code`; the code "is single-use only and valid for five minutes". A success returns "the identity token, an access token, and a refresh token". Its token response (`signinwithapplerestapi/tokenresponse`) says of the refresh token: "Store this token securely on your server."
  - **Error response** (`signinwithapplerestapi/errorresponse`): `invalid_grant` is "an invalid code (expired or previously used authorization code)"; `invalid_client` an invalid client identifier or secret.
  - **Creating a client secret** (`accountorganizationaldatasharing/creating-a-client-secret`, the page the token page links for it): an ES256 JWT, header `alg` and `kid` (the key's 10-character identifier), claims `iss` (the Team ID), `iat`, `exp` ("It's an error to request an expiration time more than `15777000` seconds (six months) in the future"), `aud` `https://appleid.apple.com` and `sub` (the same identifier as `client_id`), signed with ECDSA on P-256 and SHA-256.
  - **Offering account deletion in your app** (`https://developer.apple.com/support/offering-account-deletion-in-your-app/`): "Apps that support Sign in with Apple should use the Sign in with Apple REST API to revoke user tokens."
  - **Supabase** (`https://supabase.com/docs/guides/auth/social-login/auth-apple` and `.../social-login`): the Apple page has no section on revoking tokens or on account deletion, and says Supabase Auth "does not support Server-to-Server notification endpoints"; the social-login page says "Provider tokens are intentionally not stored in your project's database". So Supabase Auth holds no Apple token to revoke, and a project that wants one stores it itself.
- **What the repository holds.** The phone signs in through the system sheet and passes Apple's identity token to `signInWithIdToken` (ADR 0186): the authorization code the sheet returns with it is dropped, and Supabase keeps no Apple token. The account's Apple identity is in Supabase Auth's `identities`, with Apple's `sub`. The function `delete-account` takes no input but the bearer token (ADR 0026) and holds no secret beyond the platform's.
- **Alternatives considered:**
  - **Exchanging the code at sign-in and storing the refresh token.** The app sends the code to a function at each Apple sign-in; the server stores the refresh token encrypted and revokes it at deletion. Rejected: it needs a table of third-party secrets with an encryption key, a new function and a retention rule, the very store Supabase leaves out on purpose; and every account that signed in before it ships has no token, so a second path (a fresh code) is needed anyway.
  - **Revoking by the access token.** The token endpoint's access token expires; the refresh token is the one Apple says to store and to revoke. Rejected.
  - **Stopping the deletion when revocation fails.** The user keeps their data until Apple answers. Rejected: deletion must work whatever Apple's state or the project's secrets, and a failure Apple causes would hold a person's data; the authorization left behind is listed in the person's own Apple ID settings, where they can remove it.
  - **Telling the user when revocation failed.** It needs a changed answer (200 with a body) that builds already in use read as a rejection, since the app treats any success but 204 as `AccountRejected`. Not done: the outcome is logged for the operator.

## Decision

- **A fresh code at deletion.** For an account whose identity is Apple's, the app shows the Apple sheet once more after the user confirms the deletion and sends the code it returns in the request body, `{"apple_authorization_code": "<code>"}`; cancelling the sheet cancels the deletion. The body is optional: a request without a code, or one older builds send, is deleted as before.
- **The function.** After deleting the user's files and before deleting the user, `delete-account` reads the user's identities through the admin API. With an Apple identity, a code and the Apple secrets, it exchanges the code at `/auth/token`, takes the refresh token, and when the identity token's `sub` is the Apple identity's, revokes the refresh token at `/auth/revoke` with `token_type_hint=refresh_token`. A code of another Apple account is not revoked. The client secret is made for each request, valid 5 minutes. Each Apple call is cut off after 10 seconds.
- **The failure rule.** Revocation never stops a deletion. Apple refusing the code or the revocation, not answering, a code that is another account's, no code, a missing Apple secret or a key that does not parse each leave the account deleted, 204, and the outcome logged as `apple`: `revoked`, `none` (no Apple identity), `no_code`, `not_configured`, `mismatch`, `refused` or `unreachable`. The user sees nothing different. The log carries neither the code, the tokens nor a key. A failure to read the identities from Supabase Auth is the deletion's own failure, 502, as the user lookup's is.
- **The secrets.** Four function secrets, set by the owner, never in the repository: `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_CLIENT_ID` and `APPLE_PRIVATE_KEY`. `APPLE_CLIENT_ID` is the identifier the sheet's authorizations are made under, the app's App ID `app.knowno`; `APPLE_PRIVATE_KEY` is the text of the Sign in with Apple key's `.p8` file, its newlines as they are or written `\n`. With any of them missing no call is made to Apple.

## Consequences

- An Apple user's deletion asks for the Apple sheet once more; a user who cancels it keeps the account.
- Revocation reaches an account only when the app sends the code, so builds before the app half ships delete as before and leave the authorization.
- The deletion is not blocked by Apple, at the price that a revocation that failed is seen only in the log; the person can remove the app in their Apple ID settings.
- The key's secrets are read by one function and a revocation is the only place they are used; a rotated key is a new value of `APPLE_PRIVATE_KEY` and `APPLE_KEY_ID`.
- Not verified here: a real exchange of a code from the iOS sheet under `app.knowno`, which needs the owner's key and a device build.

## Signs the decision was wrong

- The log shows `refused` or `invalid_client` for Apple accounts after the secrets are set: the client identifier or the key is not the one the sheet's authorizations use.
- Users cancel the Apple sheet at deletion and leave, in numbers that make a deletion without it the better default.
- App Review asks for a visible confirmation that the Apple authorization was removed.
