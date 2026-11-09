# ADR 0215: Sign in on the web with an email code through two Server Actions, as a third way beside Google and Apple

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- #792, the owner's request of 2026-11-09, adds sign-in by an email address alone, beside Google and Apple: a 6-digit code, no password, no magic link, `signInWithOtp` then `verifyOtp`, Supabase creating the account on first use and linking by a verified address. The phone's half is #794 (ADR 0214), the server's #793 (ADR 0213).
- The web's other two ways start in the browser (ADR 0019, ADR 0191): the browser client leaves for Google, or Apple's popup returns a token, and the session is set on the way back. An email code never leaves the page, and the session must be cookies on the host that asked: the service host and the admin host each keep their own (`web.md` §Session).
- Supabase answers a wrong code and an expired one with the same error, `otp_expired`, so the page cannot tell them apart.

## Decision

- **Two Server Actions through `@supabase/ssr`**, in `features/account/actions.ts`: `sendEmailCode` calls `signInWithOtp({email, options: {shouldCreateUser: true}})`, and `verifyEmailCode` calls `verifyOtp({email, token, type: "email"})` and opens `/`. The server client sets the session as cookies in the action's response, on the host that asked.
- **Parsed at the boundary** (`email-sign-in.ts`): the address trimmed and lower-cased where it has the shape something, `@`, a dotted name, at most 254 characters; the code as 6 digits once the spaces and hyphens of a paste are removed. An input that is neither reaches no Auth call; the action returns its sentence.
- **A third way, "이메일로 계속하기"**, on `/login` after Google's and Apple's buttons, a secondary button of the page's width. It opens the email step in its place, "이메일" and "코드 받기"; a send opens the code step, "6자리 코드" taking `autocomplete="one-time-code"` and `inputmode="numeric"`, "로그인", the line "{seconds}초 뒤에 코드를 다시 받을 수 있어요" counting down 60 s from each send and then "코드 다시 받기", and "이메일 주소 바꾸기", which returns to the email step with the address kept. The strings are the phone's, from ADR 0214's table, word for word. The steps are one client component; the actions hold no state, so the page keeps the address and the countdown.
- **The failures are returned as sentences**, never thrown: rate limited with the seconds Auth names, which the page counts down, a refused address, and a wrong or expired code in one sentence, each the phone's; and the web's own for what the phone's table lacks: offline (a request that never reached Auth), unavailable (a server error), a code of the wrong shape ("6자리 숫자를 입력해 주세요."; the phone's button is off below six digits) and a suspended account, in the sentence `/login` already shows for one.
- **The admin host is unchanged.** Its own sign-in keeps Google's and Apple's buttons. An email account is an ordinary account: the admin gate asks the server whether the signed-in user is an admin, as for any way of signing in, so an email account is admitted only as an admin is, and a test signs in by code as an admin and as another user.

## Consequences

- No new way into the admin area; the gate is the one it was.
- The web and the phone say one sentence where Auth cannot tell two cases apart; if the phone separates them by its own clock, the sentences will differ until reconciled.
- The countdown is the 60 s of `auth.email.max_frequency` in production as a constant of the page; where the project's setting is another interval, a refused resend names the wait and the page counts that down instead.
- The web's e2e stack starts Mailpit on a port of its own, and the e2e reads the code from its API; that needs the local template to show `{{ .Token }}` (#796). The spec reads no table of Auth's: how Auth hashes a code is not published.

## Signs the decision was wrong

- Users meet the one sentence for a wrong and an expired code and cannot tell what to do: the page needs the code's age, kept in the browser, to tell them apart.
- Users on a phone's browser lose the code step by switching to the mail app: the step must survive a reload, kept in the address or the session.
- Codes are guessed: Supabase's per-address attempts limit proves too loose, and the page needs a limit of its own.
