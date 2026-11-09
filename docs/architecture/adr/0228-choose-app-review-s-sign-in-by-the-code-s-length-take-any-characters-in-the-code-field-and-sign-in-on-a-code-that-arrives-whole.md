# ADR 0228: Choose App Review's sign-in by the code's length, take any characters in the code field, and sign in on a code that arrives whole

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #836**, the phone's half of [ADR 0226](0226-sign-one-app-review-address-in-through-the-review-sign-in-function-with-a-fixed-code-kept-in-vault-and-hand-the-app-the-token-hash-of-an-email-sign-in.md), which leaves "the phone's rule for when to call it" to the phone: a real code is six digits, the review code at least 12 characters.
- **The field.** The code field of `EmailSignInScreen` ([ADR 0214](0214-sign-in-with-an-email-code-on-the-phone-in-a-screen-opened-over-the-sign-in-screen-with-three-failures-added-to-the-account-failures.md)) keeps only digits, up to six, and signs in at the sixth. A review code of 12 or more random characters cannot be typed into it, and one that starts with six digits would be sent to Auth at its sixth.
- **The function's contract** (ADR 0226): `{email, code}` with a code of 1 to 128 characters, trimmed by the function; `401` `refused`, `429` `rate_limited` with `Retry-After: 600`.
- **The client.** `functions_client` 2.7.1 throws `FunctionException` with `status` and `details` and no headers (`lib/src/types.dart`, read from the pub cache), so the phone cannot read `Retry-After`.

## Decision

- **The rule is the trimmed code's length.** `AccountService.verifyEmailCode` trims the code. Under 12 characters, the digits in it go to `verifyOTP` as before. At 12 or more, the code goes whole to `review-sign-in`. The screen does not know the rule, and the phone holds no address and no code.
- **The field takes any characters up to 128**, the function's limit, on `TextInputType.visiblePassword`, the text keyboard that does not correct, suggest or capitalise. Its label, "6자리 코드", is unchanged, since a real code is still six digits and the reviewer's steps are in the App Store Connect notes ([ADR 0226](0226-sign-one-app-review-address-in-through-the-review-sign-in-function-with-a-fixed-code-kept-in-vault-and-hand-the-app-the-token-hash-of-an-email-sign-in.md), the owner's steps).
- **A code that arrives whole signs in; one typed key by key waits for the button.** A change that takes the field from empty to six characters or more (a paste, or the platform's one-time-code fill) calls `verifyEmailCode` at once. Typing the sixth key no longer does, because the first six characters of a review code can be digits. The button is enabled from six characters.
- **Failures are the existing ones.** `401` is `AccountCodeRefused`, `429` is `AccountRateLimited` with a wait of 10 minutes, the figure of ADR 0226's `Retry-After`, held by the phone because the exception carries no header. A request that never arrived or a `5xx` is `AccountOffline`; an answer without a token hash, and any other status, `AccountRejected`; a refusal of the hash by `verifyOTP` is mapped as an email code's is. No string is added.

## Alternatives considered

- **A rule by shape: anything that is not six digits goes to the function.** A paste of "코드 123456", which the digit filter made the code, would go to the function and be refused, and spend the address's five attempts in the function's window. A length of 12 is the line the owner's steps already draw.
- **A second field, button or gesture for the review code.** Rejected by #836: the reviewer uses the existing screen.
- **A review code of digits only, the field keeping its number keyboard and filter.** Binds the owner to digits, where ADR 0226's example, `openssl rand -hex 12`, gives hexadecimal; and still needs the sixth-key sign-in removed.
- **Keeping the sign-in at the sixth typed key.** A review code that begins with six digits would be sent to Auth as a wrong code, and a hexadecimal one does about 6% of the time (`(10/16)^6`).
- **Reading `Retry-After`.** Needs the raw response; the Edge Functions client does not expose it, and the HTTP client under it is not the account domain's to replace for one header.

## Consequences

- A user typing a real code taps "로그인" after the sixth digit; a code filled from the mail notification or pasted still signs in at once.
- The code field keeps what is typed, so a real code with words around it of 12 or more characters ("인증 코드는 123456 입니다") goes to the function and is refused as a wrong code.
- The 10 minutes are the phone's copy of the function's `Retry-After`; a change to one needs the other.
- The code field no longer shows a number keyboard; a real code is typed on the text keyboard's number row.
- Not verified here: the reviewer's flow against the real function and project, and the keyboard on a device.

## Signs the decision was wrong

- Users report signing in with a real code takes a tap more than before, or stop reaching the button: the sixth-key sign-in was worth its cost to the review code.
- Auth's wrong-code counts rise from codes sent to the function: the 12-character line is wrong for what users paste.
- The owner's review code is shorter than 12 characters, or the function's minimum changes: the line moves with it.
