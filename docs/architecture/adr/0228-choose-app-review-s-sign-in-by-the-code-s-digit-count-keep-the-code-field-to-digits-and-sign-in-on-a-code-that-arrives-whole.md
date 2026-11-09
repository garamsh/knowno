# ADR 0228: Choose App Review's sign-in by the code's digit count, keep the code field to digits, and sign in on a code that arrives whole

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #836**, the phone's half of [ADR 0226](0226-sign-one-app-review-address-in-through-the-review-sign-in-function-with-a-fixed-code-kept-in-vault-and-hand-the-app-the-token-hash-of-an-email-sign-in.md), which leaves "the phone's rule for when to call it" to the phone: a real code is six digits, the review code at least 12 characters.
- **The field.** The code field of `EmailSignInScreen` ([ADR 0214](0214-sign-in-with-an-email-code-on-the-phone-in-a-screen-opened-over-the-sign-in-screen-with-three-failures-added-to-the-account-failures.md)) keeps only digits, up to six, and signs in at the sixth. A review code of 12 or more digits cannot be typed into it, and one would be sent to Auth at its sixth digit.
- **The function's contract** (ADR 0226): `{email, code}` with a code of 1 to 128 characters, trimmed by the function; `401` `refused`, `429` `rate_limited` with `Retry-After: 600`. The function does not require letters or digits. ADR 0226's `openssl rand -hex 12` is an example in the owner's steps, not part of that contract.
- **The client.** `functions_client` 2.7.1 throws `FunctionException` with `status` and `details` and no headers (`lib/src/types.dart`, read from the pub cache), so the phone cannot read `Retry-After`.

## Decision

- **The review code is digits only, at least 12, and 16 is recommended.** This narrows the owner's step in ADR 0226, whose hex example this ADR supersedes: a code of 16 random digits has about 53 bits, which the function's 5 attempts an address in 10 minutes make far out of reach. [`server.md`](../server.md) §Review sign-in and [`account.md`](../account.md) carry the step as `LC_ALL=C tr -dc 0-9 </dev/urandom | head -c 16`.
- **The rule is the digit count.** `AccountService.verifyEmailCode` keeps the digits of the code. Under 12 digits, they go to `verifyOTP` as before. At 12 or more, they go to `review-sign-in`. The screen does not know the rule, and the phone holds no address and no code.
- **The field keeps its number keyboard and digit filter** and takes up to 128 digits, the function's limit. Its label, "6자리 코드", is unchanged, since a real code is still six digits and the reviewer's steps are in the App Store Connect notes (ADR 0226, the owner's steps).
- **A code that arrives whole signs in; one typed key by key waits for the button.** A change that takes the field from empty to six digits or more (a paste, or the platform's one-time-code fill) calls `verifyEmailCode` at once. Typing the sixth key no longer does, because the first six digits of a review code are digits too. The button is enabled from six digits.
- **Failures are the existing ones.** `401` is `AccountCodeRefused`, `429` is `AccountRateLimited` with a wait of 10 minutes, the figure of ADR 0226's `Retry-After`, held by the phone because the exception carries no header. A request that never arrived or a `5xx` is `AccountOffline`; an answer without a token hash, and any other status, `AccountRejected`; a refusal of the hash by `verifyOTP` is mapped as an email code's is. No string is added.

## Alternatives considered

- **A review code that may hold letters (ADR 0226's hex example), the field taking any characters on a text keyboard.** Rejected. Every user who types a code would pay for one reviewer's: on iOS the text keyboard that does not correct (`visiblePassword`) is the ASCII keyboard, with the digits behind its "123" key; and a pasted "인증 코드는 123456 입니다" would reach the function as a 15-character code and be shown as a wrong code, spending the address's five attempts. The only thing it saved the owner is a choice of alphabet that the function does not need.
- **A rule by shape: anything that is not six digits goes to the function.** Rejected for the same pasted sentence, which the digit filter makes the code today.
- **A second field, button or gesture for the review code.** Rejected by #836: the reviewer uses the existing screen.
- **Keeping the sign-in at the sixth typed key.** Rejected. A review code of digits begins with six digits, which would be sent to Auth as a wrong code at the sixth key, and does so every time.
- **Reading `Retry-After`.** Needs the raw response; the Edge Functions client does not expose it, and the HTTP client under it is not the account domain's to replace for one header.

## Consequences

- A user typing a real code taps "로그인" after the sixth digit and keeps the number keyboard; a code filled from the mail notification or pasted still signs in at once, and a pasted sentence holding the code is its six digits.
- The owner's review code must be at least 12 digits. A code with a letter in it cannot be typed on this field, and its digits alone would be sent: the owner's step in `server.md` says digits only.
- The 10 minutes are the phone's copy of the function's `Retry-After`; a change to one needs the other.
- Not verified here: the reviewer's flow against the real function and project, and the keyboard on a device.

## Signs the decision was wrong

- Users report signing in with a real code takes a tap more than before, or stop reaching the button: the sixth-key sign-in was worth its cost to the review code.
- Auth's wrong-code counts rise from codes sent to the function: a real code reaches it with 12 digits or more, so the line is wrong for what users paste.
- The owner's review code is under 12 digits or holds a letter, or the function's minimum changes: the line moves with it.
- Reviewers fail to enter the code on the number keyboard: App Store Connect's notes need to say that it is digits.
