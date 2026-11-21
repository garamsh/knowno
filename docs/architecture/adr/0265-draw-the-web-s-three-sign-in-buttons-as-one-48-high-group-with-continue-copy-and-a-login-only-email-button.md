# ADR 0265: Draw the web's three sign-in buttons as one 48 high group with "continue" copy and a login-only email button

> Status: accepted
> Date: 2026-11-21

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

Supersedes the Google label and Apple's `data-type` in [ADR 0191](0191-sign-in-with-apple-on-the-web-through-apple-s-js-button-in-a-popup-and-supabase-on-both-hosts-login.md) and [ADR 0194](0194-draw-google-s-and-apple-s-sign-in-buttons-48-tall-with-their-content-centred-and-keep-one-apple-nonce-until-a-sign-in-spends-it.md), and the email button's secondary style in [ADR 0215](0215-sign-in-on-the-web-with-an-email-code-through-two-server-actions-as-a-third-way-beside-google-and-apple.md).

## Context

- Goal #1000's direction (Designer, 2026-11-21, on [#1000](https://github.com/garamsh/knowno/issues/1000#issuecomment-7061688993)): Google, Apple and email are one 48 high group on both clients, each provider's inside following its own specification, the app's 64 Jua button style not applying to them.
- The phone's side is [ADR 0264](0264-show-apple-s-ios-system-sign-in-button-in-the-app-and-space-the-three-sign-in-buttons-12-apart.md): the same order, the same 12 gap, the same email label.
- The web's email button was the app's secondary button: 64 high, Jua 23/28, a bottom edge that `globals.css` draws for every `.rounded-button.bg-surface`, under two 48 high buttons. Apple's guidelines ask a button to be no smaller than the other sign-in buttons.
- Google's button said "Google로 로그인" and Apple's `data-type` was `sign-in`, beside "이메일로 계속하기" and the phone's "계속하기" on all three.

## Decision

- **The email button is 48 high** through `--spacing-google-height`, the group's one height, in the body type, Pretendard 16/24 medium, in ink, with a one-pixel outline in the outline token on the page's ground and the app's 24 px radius, a capsule at that height.
- **It has no fill of its own.** A `bg-transparent` button matches none of the selectors that draw the press edge, so the edge is gone without a change to `web/src/design/` or to `globals.css`; the button keeps `.pressable`'s state layer.
- **The variant is the login's alone**: a class string in `email-sign-in.tsx`, not a new `ButtonVariant`. The global button styles do not change, and "코드 받기" and the completion "로그인" keep `buttonClass("primary")`.
- **The copy is "Google로 계속하기" and "이메일로 계속하기", and Apple's `data-type` is `continue`**, so Apple's script draws "Apple로 계속하기" in Korean. The page sets no text in Apple's wrapper.
- **Order, width and gap are kept**: Google, Apple, email, each as wide as the column up to 375 px and centred, 12 apart, with 16 between the group and the legal links.

## Consequences

- A change to `.rounded-button.bg-surface` in `globals.css` that gave transparent buttons an edge would bring it back here; the email button's test names the fill.
- The name of the Google button, which e2e and unit tests read, changed.
- Apple's title is whatever its script draws for `continue` in `ko_KR`; the e2e's substitute script carries the same title.

## Signs the decision was wrong

- Apple's script draws no Korean title for `continue`, or draws one other than "Apple로 계속하기".
- A third sign-in method is added and the group no longer reads as three buttons of one height.
