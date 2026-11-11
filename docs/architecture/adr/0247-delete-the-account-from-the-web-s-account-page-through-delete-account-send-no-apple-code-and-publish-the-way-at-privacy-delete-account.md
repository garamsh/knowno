# ADR 0247: Delete the account from the web's account page through delete-account, send no Apple code, and publish the way at /privacy#delete-account

> Status: accepted
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #921.** An account could be deleted only from the app's 설정 → "계정 삭제" ([`account.md`](../account.md) §Deletion). The web's `/account` had no deletion, and the privacy policy described the app's way alone. The issue records that Google Play requires a web resource where a user can ask for deletion without installing the app, and that its Data safety form asks for that URL; this was not checked against Google's pages here.
- **The server already deletes.** `delete-account` deletes the token's user and, by cascade, every row it owns, and takes no body but an optional Apple authorization code ([ADR 0026](0026-delete-the-account-through-an-edge-function.md), [ADR 0210](0210-revoke-the-apple-authorization-when-an-account-is-deleted-by-exchanging-a-fresh-authorization-code-at-deletion-and-never-let-a-failed-revocation-stop-the-deletion.md)); a request without a code deletes as before, so nothing in `supabase/` changes.
- **Apple.** The function signs its client secret for the app's App ID, `app.knowno` (`APPLE_CLIENT_ID`, ADR 0210), and an authorization code is valid for the client it was issued to. The web's Sign in with Apple uses the Services ID `app.knowno.web` ([`web-account.md`](../web-account.md) §Sign-in), so a code made there is not one the function can exchange.
- **Alternatives considered:**
  - **A request form or an email address.** Rejected: a person would have to act on each request, and the server already deletes the account itself.
  - **A new function or a changed one for the web.** Rejected: the deletion is the same, and the only difference, the Apple revocation, is the next item.
  - **Revoking Apple from the web.** It needs, at deletion, a code from Apple's popup for `app.knowno.web` and a client secret for that Services ID, which the function does not sign. Not done: it changes `supabase/` and four secrets' use for one more identifier, and the function's failure rule (ADR 0210) already lets a deletion proceed without a revocation.

## Decision

- **The web deletes from `/account`.** "계정 삭제" is the last row of 계정, under "로그아웃", in red as the app's. It asks through `Confirm`: the app's title, "계정을 삭제할까요?", and its sentence without "this device", then "취소" and, last, a red "삭제".
- **The store plan note.** While `my_plan()` answers `source: store`, the dialog adds the app's sentence that deleting does not cancel the store subscription. It offers no button for it, since the web cannot open the store's management. An unknown plan or any other source leaves the dialog unchanged, and a plan never blocks the deletion.
- **A Server Action calls the function.** `deleteAccount` re-verifies the session, posts to `<Supabase URL>/functions/v1/delete-account` with the session's access token and no body, and on a 204 ends this browser's session (`scope: "local"`) and opens `/login?deleted=1`, where `/login` says the account was deleted. Any other answer, or none, keeps the session and returns a sentence the dialog shows.
- **No Apple code.** The web sends none, so a web deletion does not revoke Sign in with Apple, and the authorization stays listed in the person's Apple ID settings, as ADR 0210 describes for a deletion without a code.
- **What would close the gap.** The web asks Apple's popup for a code at deletion under `app.knowno.web`, and the function accepts it with the Services ID as a second client identifier and a client secret signed for it. That is a change to `supabase/functions/delete-account/`, its secrets and the web's Apple script use, and it is not made here.
- **The public page.** The privacy policy's deletion passage carries the anchor `/privacy#delete-account` and names the web's way, sign in at knowno.app and use 설정 → "계정 삭제", beside the app's. `/privacy` is open to a signed-out visitor, so that URL is the one for Play's form. What the passage says is deleted is unchanged.

## Consequences

- A user can delete an account without the app. An account that signed in with Apple and deletes from the web keeps its Apple authorization until the person removes it in their Apple ID settings.
- The policy's deletion passage changes after the owner approved its text on 2026-11-10; the owner is told after the merge ([ADR 0246](0246-merge-without-the-owner-s-approval-wait-only-for-a-missing-secret-and-report-a-data-model-or-cost-change-after-it-lands.md)).
- The terms' "계정 삭제" section still names the app's way alone; it is outside this change.
- Not verified here: a deletion against the deployed function. The web's tests substitute the function.

## Signs the decision was wrong

- Apple accounts delete from the web in numbers that make the leftover authorization a complaint, or App Review or Google asks for the revocation from the web too.
- Play rejects `/privacy#delete-account` as the deletion URL because it is a passage on a policy page and not a page for deleting.
- The function answers a web caller with a status the web reads as a failure while the account was deleted.
