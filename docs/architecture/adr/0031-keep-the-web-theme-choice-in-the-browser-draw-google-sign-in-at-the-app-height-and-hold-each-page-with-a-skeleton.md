# ADR 0031: Keep the web's theme choice in the browser and apply it before the first paint, draw the web's Google button at the app's height, and hold each waiting web page with a skeleton of its layout

> Status: accepted
> Date: 2026-10-16

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #80: the owner's feedback on production (`0540a8c8633ce7be6ada77ee408a99ae4f9026cd`, 2026-10-16) found the web's first screen plain, no theme setting, and a Google button that did not follow Google's guidelines. The owner later added that each page shows a sentence while it waits.
- **Theme.** The web followed `prefers-color-scheme` alone. The phone offers 시스템 / 라이트 / 다크 and stores the choice on the device ([`design/theme.md`](../design/theme.md)). On the web the choice has to reach the first paint of a server-rendered page, or the page flashes the other theme while it loads. Alternatives considered:
  - A cookie the root layout reads on the server. `next.config.ts` sets `cacheComponents`, under which a layout that reads `cookies()` must sit inside `<Suspense>` or `next build` fails (stack-nextjs.md §4), and the root layout renders `<html>` itself. Every page would also become dynamic, `/login` and the legal pages included, which now prerender.
  - `next-themes`, the package most Next.js apps use for this. It adds a dependency, with its own pin to move, for an inline script of one line and a store the app already has.
  - A script that resolves 시스템 to light or dark and always sets the attribute. It needs a listener to follow the system's changes, and without scripts it draws only the light theme.
- **Google's button.** [ADR 0024](0024-one-voice-and-a-sheet-action-rule.md) draws the button to Google's Sign in with Google branding guidelines on the phone alone. The guidelines page (developers.google.com/identity/branding-guidelines, last updated 2026-07-07, re-read 2026-10-16) gives the web button's fill, stroke and label colours, the 14/20 Google Sans Medium label, and 12 px before the mark, 10 px after it and 12 px after the label; it names no height or corner radius. Alternatives considered:
  - The asset bundle's Android and web sample, 40 px high with a 4 px (square) or 20 px (pill) radius (`signin-assets.zip`, SHA-256 `ba884069e12093b06bcfd776915081254a7c95094b80d50be2c5dc6bac1c1da1`, unchanged since ADR 0024). It is lower than the 44 px least target of [`design/principles.md`](../design/principles.md) §One visual language, and smaller than the phone's button and the SignIn artboard's, both 56.
  - The bundle's SVG mark. It draws the mark's colours with a conic gradient inside a `foreignObject`, which an `<img>` does not render the same way in every browser; the app's PNGs are the bundle's own pixels.
- **Loading.** Each page's `<Suspense>` showed "…불러오는 중이에요" while the server read, and the content then pushed everything below it down.

## Decision

- **Theme.** The choice is kept in the browser's `localStorage`, under `smartman.theme`, as `light` or `dark`; 시스템 removes it. The root layout's `<head>` runs one inline script first, before the body is parsed, which sets `data-theme` on `<html>` from the stored choice, so the first paint is drawn in it. `globals.css` draws the dark set under `prefers-color-scheme: dark` while `data-theme` is not `light`, and under `data-theme="dark"` whatever the system's mode; Tailwind's `dark:` variant follows the same two rules. A choice applies at once, then is stored; a browser that refuses to store it keeps the choice for the page and says it was not kept.
- **Google's button.** The web draws the button as the phone does: 56 high (`AppSize.cta`) with the 16 px button radius, since the guidelines name no height. Its colours, 1 px stroke, label and spacing are the guidelines', taken from `GoogleButtonStyle` in `theme.dart` as `@theme` tokens that a test compares with it. Its "G" mark is the app's 4x PNG of the bundle's mark, copied byte for byte into `web/public/google/` and drawn at 20 px.
- **Loading.** Every web page that waits on the server holds its place with a skeleton of its own layout: placeholders of the same size as the content that replaces them, so nothing below moves. It pulses as the phone's skeleton rows fade, only while reduced motion is not asked for, hides its placeholders from screen readers, and carries `aria-busy` and a visually hidden status sentence. A button that waits shows progress inside itself and cannot be pressed again.

## Consequences

- A stored choice reaches every page's first paint without a server read, and every page that prerendered still does; an e2e test reads the body's colour as the parser inserts it.
- The choice belongs to one browser: another browser, or the phone, keeps its own, as the phone keeps its choice per device.
- The dark set is written twice in `globals.css`, once per rule, and the token test compares both with `theme.dart`.
- The page carries an inline script, so a Content Security Policy added later has to allow it, by a hash or a nonce.
- The web's Google button matches the phone's and the artboard's size rather than Google's 40 px sample; a reviewer comparing it with Google's samples sees the difference, as with the label's font under ADR 0024.
- A change to a page's layout changes its skeleton too, or the content moves when it arrives; the e2e spec compares where the first block of each page lands with where its placeholder was.

## Signs the decision was wrong

- Users see the other theme flash on load in a browser where the head script runs late, or a policy blocks inline scripts.
- Users expect the choice to follow their account across browsers and the phone.
- Google's app verification rejects the button's height or radius, or the guidelines come to name a height.
- Skeletons drift from their pages' layouts and content jumps on arrival in spite of the check.
