# ADR 0191: Sign in with Apple on the web through Apple's JS button in a popup and Supabase, on both hosts' /login

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #727.** Apple sign-in landed on iOS ([ADR 0186](0186-sign-in-with-apple-on-ios-through-the-system-sheet-and-supabase-with-apple-s-button-under-google-s.md)); the web half stayed open. A custom web button needed Apple's logo artwork under the Apple Design Resources licence. The owner's rule: each company's button follows that company's guidelines and is not drawn by us.
- **The PM's decision on #727 (2026-11-04):** Sign in with Apple JS and Supabase's `signInWithIdToken`: Apple's own JS-rendered button, `AppleID.auth.init` with the Services ID `app.knowno.web` in popup mode, the SHA-256 of a raw nonce to Apple and the raw nonce to Supabase, the name stored with `updateUser` when Apple sends it, on knowno.app's and admin.knowno.app's `/login`.
- **Sources read on 2026-11-04:**
  - Supabase, "Login with Apple", §Using sign in with Apple JS (`https://supabase.com/docs/guides/auth/social-login/auth-apple`): `signInWithIdToken` with `provider: 'apple'`, Apple's `id_token` and the nonce; `updateUser` with `full_name`, `given_name` and `family_name` on the first sign-in, the one Apple sends the name on; the scope `name email`; the Services ID among the Client IDs and the website's domains and return URLs on it; the OAuth settings, and with them the secret rotated every six months, not needed. Its popup example gives Apple no nonce.
  - Apple, "Configuring your webpage for Sign in with Apple" (`https://developer.apple.com/documentation/signinwithapple/configuring-your-webpage-for-sign-in-with-apple`): the script at `https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js`; `AppleID.auth.init` with `clientId`, `scope`, `redirectURI`, `state`, `nonce` and `usePopup`; in popup mode the result is the document event `AppleIDSignInOnSuccess` or `AppleIDSignInOnFailure`; the redirect URI's host must be a domain name, not an IP address or `localhost`; the user object comes on the first authorization alone.
  - Apple, "Displaying Sign in with Apple buttons on the web" (`https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web`): the wrapper `<div id="appleid-signin">`; the locale in the script's path; `data-mode`, `data-type` `sign-in`, `continue` or `sign-up`, `data-color` `black` or `white`, `data-border`, `data-border-radius` 0 to 50 (default 15), `data-width` 130 to 375 and `data-height` 30 to 64, each defaulting to the container's size.
  - Apple, "Sign in with Apple JS" reference (`https://developer.apple.com/documentation/signinwithapplejs`): `AuthI.renderButton`, "Use this function when the framework you're using requires rerender support"; `ClientConfigI.redirectURI`, "The URI provided must redirect to a website under your control. Supply this URI to WWDR to enable this feature."
  - Apple's script itself, `appleid.auth.js` at `.../appleid/1/ko_KR/` (`Last-Modified: Thu, 29 Oct 2026 19:21:36 GMT`, its requests sent as `v=1.5.7`): popup mode asks Apple for `response_mode=web_message`, so the answer comes back by message to the page and nothing loads at the return URL; the border radius is drawn as that percentage of the button's height; the button caps itself at 375 px wide and 64 px high; the Korean `sign-in` title is "Apple로 로그인"; the failures are `popup_closed_by_user`, `popup_blocked_by_browser` and `user_trigger_new_signin_flow`.
- **Alternatives considered:**
  - **Supabase's OAuth redirect flow, as Google's.** It needs the Services ID's secret, a JWT signed with a `.p8` key that Apple lets live six months, and a button of our own with Apple's logo, the licence #727 stopped on.
  - **Apple's script in redirect mode.** Apple then posts the result to the return URL, which would need a Route Handler taking a form post across sites; the popup keeps the page and needs none.

## Decision

- **Both hosts' `/login` offer Apple under Google.** knowno.app's and admin.knowno.app's sign-in draw Apple's button under Google's, in the same column.
- **Apple's script draws the button.** The account feature loads Sign in with Apple JS from Apple's CDN through `next/script` on the two sign-in pages alone, in `ko_KR`, so the button reads "Apple로 로그인" as Google's reads "Google로 로그인". The button is `data-type="sign-in"` in `center-align`, black in the light theme and white in the dark with no border, drawn again when the theme changes; as tall as Google's 64 px, with Apple's percentage radius set to 24 px of it, the app's button radius; and both buttons one width: the column's, up to the 375 px Apple's script draws its widest at (`--container-sign-in`), centred. Apple's Human Interface Guidelines, "Sign in with Apple", §Displaying buttons, make Apple's button "no smaller than other sign-in buttons", the rule ADR 0187 applied to height on the phone, so Google's button, which its branding guidelines let scale, stops at Apple's widest; the PM's review of PR #740 on 2026-11-04 decided it. Nothing of Apple's artwork is in the repository.
- **A popup, a nonce per sign-in.** `AppleID.auth.init` gets the Services ID `app.knowno.web`, the scope `name email`, the return URL `<host>/login`, `usePopup: true`, and the SHA-256 as hex of a new raw nonce of 32 random bytes; a closed or cancelled popup draws a new one. On `AppleIDSignInOnSuccess` the identity token and the raw nonce go to `signInWithIdToken` with the Apple provider.
- **The name Apple shares is stored once,** as the phone does: `full_name`, the given and family names joined by a space, with `given_name` and `family_name` through `updateUser`. A failure there is logged to the console and the user stays signed in.
- **Outcomes reuse Google's.** A signed-in user opens `/` of the host signed in on. A popup closed, cancelled or replaced by another is quiet. Any other failure of Apple's, an answer without a token, or Supabase's refusal opens `/login?error=failed`, and `user_banned` `/login?error=suspended`, which `CallbackError` names as for Google. While Supabase signs in, the button cannot be pressed again. A script that cannot load hides the button.
- **The return URLs on the Services ID** are `https://knowno.app/login` and `https://admin.knowno.app/login`, on the domains `knowno.app` and `admin.knowno.app`. Only the owner changes them.
- **Supersedes** ADR 0186's "iOS alone offers Apple sign-in" for the web: the web offers it on both hosts; Android still does not.

## Consequences

- Web sign-in with Apple works only once the owner has added the domains and return URLs to the Services ID `app.knowno.web` (#727's PR lists the steps). Until then Apple's popup refuses with its own page, and Google sign-in is unchanged.
- A preview deployment's origin, and `localhost`, are not registered, so Apple's popup refuses there; Apple's docs refuse `localhost` as a return URL's host.
- The sign-in pages load a script from `appleid.cdn-apple.com`; a Content-Security-Policy added later must allow it and `appleid.apple.com`.
- No Apple secret is configured for the web, so nothing expires every six months.
- Apple's button keeps Apple's own label metrics and font, so its title is not Google Sans; Google's button stops at 375 px with it, narrower than the 560 px column it stood in alone.

## Signs the decision was wrong

- Apple's popup is blocked by browsers often enough that users report the button doing nothing.
- Apple changes the script's rendering so the button no longer matches Google's height or radius.
- Apple raises its script's 375 px cap, and the two buttons part again or Google's stays narrower than it needs to.
