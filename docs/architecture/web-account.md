# Web account

The web's `account` feature: the sign-in page with Google's button, the code exchange, the account page and sign-out, and the consent page an AI app opens beside them. The session and the proxy every route reads are [`web.md`](web.md)'s; the app's `account` domain is [`account.md`](account.md).

## Current decisions

### Sign-in

- `/login` follows the phone's sign-in screen and the SignIn artboard: the stacked lockup, 알아몰라 alone and 150 wide, as the heading and the phone's welcome sentence on the ground's panel, rounded at the foot, then on the surface Google's button, "Google로 로그인", and the consent line with the legal links. The button calls the browser client's `signInWithOAuth` for Google, with `redirectTo` the page's origin plus `/auth/callback`; while it starts, progress takes the mark's place and the button cannot be pressed again, and a failure to start is shown beneath it.
- The button is Google's, drawn to its branding guidelines (developers.google.com/identity/branding-guidelines, last updated 2026-07-07, re-read 2026-10-16) as the phone draws it ([ADR 0024](adr/0024-one-voice-and-a-sheet-action-rule.md), [ADR 0031](adr/0031-keep-the-web-theme-choice-in-the-browser-draw-google-sign-in-at-the-app-height-and-hold-each-page-with-a-skeleton.md)): the light button in the light theme and the dark one in the dark, with `GoogleButtonStyle`'s fill, 1 px stroke and label colours and its 14/20 medium label as `@theme` tokens (`google-*`), the guidelines' Android and web spacing, 12 px, 10 px and 12 px, and 56 high with the 16 px radius, the app's, since the guidelines name no height. Its "G" mark is `web/public/google/g-mark-light.png` and `g-mark-dark.png`, byte for byte the app's `app/assets/google/4.0x/` PNGs from Google's bundle ([`design/theme.md`](design/theme.md)), drawn at 20 px.
- `/auth/callback` is a Route Handler. It exchanges the code for the session cookie and opens `/`, or opens `/login?error=cancelled` when no code arrives, `/login?error=suspended` when Supabase Auth answers `user_banned` for a suspended account ([ADR 0072](adr/0072-suspend-a-user-through-supabase-auth-s-ban-and-restrictive-write-policies-remove-a-public-deck-from-sharing-for-good-and-read-any-deck-in-the-admin-area.md)), and `/login?error=failed` when the exchange fails otherwise; `/login` shows the matching sentence.
- Each origin the app is served from must be in Supabase Auth's allowed redirect URLs as `<origin>/auth/callback`. Only the owner changes that list.

### Account page and sign-out

- `/account` reads the session on the server and shows the account's email, the daily study minutes with what they mean for today's new cards, read over every deck as 홈 reads its day, or why they could not be read, and "로그아웃", or that the server cannot be reached with "다시 시도", which reads the page again, above "화면", which needs no server (#276); the menu's 설정 opens it.
- `/account` is drawn as the phone's settings screen, 설정 ([ADR 0118](adr/0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md), #446): "설정", then three muted section labels over one group each, its rows parted by hairlines and each its words alone ([ADR 0116](adr/0116-draw-an-icon-only-where-it-says-what-the-words-beside-it-do-not-or-follows-the-platform.md)): "계정", the email, then "로그아웃"; "학습", "하루 학습 시간" with the minutes and a chevron, read as "하루 학습 시간 n분", which opens `study`'s dialog that changes them, the one place they change on the web ([ADR 0091](adr/0091-draw-the-today-card-as-a-progress-bar-and-change-the-daily-study-minutes-only-in-settings.md), [`web-study.md`](web-study.md)); and "AI 연결", the MCP server's address and how to add it in Claude and in ChatGPT, which needs no server and is drawn while the server cannot be reached too ([`mcp.md`](mcp.md) §Settings entry); and "화면" with the theme choice, three rows, the chosen one ending in a check; then the legal links at its foot. No avatar and no mascot.
- `/oauth/consent` is the consent page Supabase Auth's OAuth server opens for an AI app connecting to the account, outside the shell as `/login` is; what it shows and how it answers are [`mcp.md`](mcp.md) §Consent page ([ADR 0126](adr/0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md)).
- Sign-out is the Server Action `signOut`, through the `account` feature's `actions.ts`; while it runs, the row shows progress at its end and cannot be pressed again. It revokes this browser's session alone (`scope: "local"`), so the phone stays signed in, and opens `/login`. When Supabase cannot be reached it returns the sentence the form shows.

### Tests

Each line names a file and what it covers; the file holds the cases.

- `web/src/app/login/__tests__/login.test.tsx` — the login page's logo, sentence, button and consent line with its legal links.
- `web/src/features/account/__tests__/sign-in-button.test.tsx` — the button's two marks, its pending state and its failures; `web/src/features/account/__tests__/google-mark.test.ts` — each web mark byte for byte the app's 4x PNG.
- `web/src/app/auth/callback/__tests__/route.test.ts` — the code exchange and each error it opens `/login` with; `web/src/app/login/__tests__/` — the sentence `/login` shows for each.
- `web/src/features/account/__tests__/` — sign-out.
- `web/src/app/(shell)/account/__tests__/daily-minutes.test.tsx` — the "학습" row and its dialog: the row read as the time with no icon but its chevron, the number, steps, typed number and tiles, the number committed on blur, a step disabled under the focus handing it to the other, saving with the row and 홈 read again, closing without saving, and `.pressable` on the row and every button of the dialog.
- `web/src/app/(shell)/account/__tests__/account.test.tsx` — the settings page's title, its 계정, 학습, AI 연결 and 화면 groups in order with rows of words alone and no mascot, AI 연결's server address and its Claude and ChatGPT rows, the shell's account link named "설정", the legal links, the unreachable state with its retry, AI 연결 and theme choice, and the redirect without a session.
- `web/src/app/oauth/consent/__tests__/consent.test.tsx` — the consent page: the app, account, host and what it may do in one group, 취소 outlined and 연결 the one fill last in three type sizes, the loopback warning against claude.ai's host, each answer sent through Supabase Auth and the browser sent on, a refused answer, a request allowed before, an unknown one, a malformed id refused before any request, and Auth unreachable.

## Rationale

- [ADR 0126](adr/0126-connect-claude-and-chatgpt-through-one-remote-mcp-server-acting-as-the-signed-in-user.md) records the consent page and the AI 연결 entry.
- [ADR 0019](adr/0019-web-app-stack-portability-and-sign-in.md) records why sign-in starts in the browser and why sign-out is local.
- [ADR 0031](adr/0031-keep-the-web-theme-choice-in-the-browser-draw-google-sign-in-at-the-app-height-and-hold-each-page-with-a-skeleton.md) records why the web's Google button takes the app's height.
- [ADR 0024](adr/0024-one-voice-and-a-sheet-action-rule.md) records why sign-in is drawn as Google's branded button.
- [ADR 0072](adr/0072-suspend-a-user-through-supabase-auth-s-ban-and-restrictive-write-policies-remove-a-public-deck-from-sharing-for-good-and-read-any-deck-in-the-admin-area.md) records the suspended account's sentence.
- Issue #80 records the first screens and Google's button.

## Open questions

- None.
