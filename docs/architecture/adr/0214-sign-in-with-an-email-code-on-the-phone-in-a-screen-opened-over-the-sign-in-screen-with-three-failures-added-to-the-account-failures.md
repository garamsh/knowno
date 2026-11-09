# ADR 0214: Sign in with an email code on the phone in a screen opened over the sign-in screen, with three failures added to the account failures

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- The owner asked for email sign-in beside Google and Apple (#792). Its decisions bind the clients: a 6-digit code, no password, no magic link, an account created on first use, the resend interval and the wrong-code limit left to Supabase. The server's half (#793, ADR 0213) sets the template and the Auth configuration; this is the phone's half (#794).
- `SignInScreen` holds two sign-in buttons 48 tall, drawn to each provider's rules ([ADR 0194](0194-draw-google-s-and-apple-s-sign-in-buttons-48-tall-with-their-content-centred-and-keep-one-apple-nonce-until-a-sign-in-spends-it.md)), and shows a failure in a snack bar. An email sign-in has two steps and a field in each, and needs a keyboard, so it cannot take the buttons' place.
- `AccountFailure` is sealed with `AccountOffline`, `AccountMisconfigured`, `AccountRejected` and `AccountSuspended`. Supabase Auth answers an email sign-in with refusals none of them carries: a request that came too often, with the wait it names; a code refused; an address refused.
- `gotrue` 2.27.3 (`supabase_flutter` 2.18.3) sends `signInWithOtp` with a PKCE code challenge when it has an async storage, and answers `verifyOTP` with a session. Its error codes include `over_email_send_rate_limit`, `over_request_rate_limit`, `otp_expired`, `validation_failed` and `signup_disabled` (`gotrue/lib/src/types/error_code.dart`, read 2026-11-09). Supabase Auth's verify endpoint answers a wrong code and an expired one with the same `otp_expired` and the message "Token has expired or is invalid"; this is its documented behaviour, and was not exercised against the local stack in this change.

## Decision

- **A third way.** Below Google's and, on iOS, Apple's button, "이메일로 계속하기" (`EmailSignInButton`) opens `EmailSignInScreen` over the sign-in screen. The button is drawn as Google's is, 48 tall at the least, a capsule on the surface with a muted one-pixel outline and its label centred in ink, wrapping and growing at a large text size; it is not given Apple's or Google's branding because it has none.
- **Two steps on one screen.** The address step takes the address, checks its shape (something, an at sign, something, a dot, something, no space; Auth decides the rest) and calls `AccountService.sendEmailCode`, which calls `signInWithOtp(email:, shouldCreateUser: true)`. The code step, naming the address, takes the code and calls `verifyEmailCode`, which calls `verifyOTP(email:, token:, type: OtpType.email)`; the session that answers is the state `SignedIn`, and the screen closes, the gate showing the app under it.
- **The code field.** It asks for a number keyboard, carries `AutofillHints.oneTimeCode`, and keeps only digits up to six, so a pasted "123 456" or "코드 123456" is the code. It signs in at the sixth digit, and the "로그인" button does the same where a tap is wanted.
- **Resend and the way back.** After a code is sent, "N초 뒤에 코드를 다시 받을 수 있어요" counts down from 60 seconds, the interval the project sets between codes; then "코드 다시 받기" sends again to the same address. A rate-limit refusal that names its wait restarts the count from that wait. "이메일 주소 바꾸기", the screen's back arrow and the system's back all return to the address step, which keeps the address typed; back from the address step leaves the screen.
- **Three failures added.** `AccountRateLimited` (`over_email_send_rate_limit`, `over_request_rate_limit` or a 429, with `retryAfter` from "N seconds" in the message where it names one), `AccountCodeRefused` (`otp_expired`: a wrong and an expired code are one failure, as Auth gives them) and `AccountAddressRefused` (`validation_failed`, `email_address_invalid`, `email_address_not_authorized`). Offline stays `AccountOffline`; `signup_disabled` and `email_provider_disabled` are `AccountMisconfigured` beside `provider_disabled`; `user_banned` stays `AccountSuspended`; anything else is `AccountRejected`. A refusal appears under the field it concerns, not in a snack bar.
- **The rest of the account is unchanged.** An email account's session syncs, signs out and is deleted as any other; deletion makes no call to Apple for an account with no Apple identity ([`account.md`](../account.md) §Deletion).

## Alternatives considered

- **The two steps inline on `SignInScreen`.** The panel and the buttons are laid out to the screen's height with a scroll for large text; a field and a keyboard there would squeeze the panel and need the buttons hidden, where a screen of its own is as every other form here is.
- **One failure for each of wrong and expired.** The server answers both alike, so the app cannot tell them apart; two failures would be one of them never raised.
- **A fixed message for a rate limit.** The refusal names the wait, and a user told "try again later" waits blind, so the wait it names is read and shown, with "later" only where it names none.
- **A password or a magic link.** Rejected by #792.

## Consequences

- The sign-in screen has a third button and the app one more screen; the sealed `AccountFailure` gains three cases, so every `switch` over it names them (`describeAccountFailure`, `describeDeletionFailure`).
- The resend interval of 60 seconds is the app's copy of the Auth setting `max_frequency`; if the project sets another, a refusal names the wait and the count follows it, but the first count is still 60.
- The seconds in a rate-limit message are read by pattern, "N seconds"; Auth's wording changing leaves `retryAfter` null and the message "잠시 뒤에".
- `AppTextField` takes a keyboard type and autofill hints, and shows an error message on up to five lines rather than one.

## Signs the decision was wrong

- Users with a mail app that fills a code from its notification meet a code the field does not take: the autofill hint or the digit filter is the wrong shape.
- The wrong-code and expired-code cases are found to differ in Auth's answer (`otp_expired` for one and another code for the other): the single failure hides a message that could help.
- Users ask for the code step on the sign-in screen itself, or sign in again before the code arrives: the screen over the sign-in screen is the wrong place or the countdown the wrong length.
