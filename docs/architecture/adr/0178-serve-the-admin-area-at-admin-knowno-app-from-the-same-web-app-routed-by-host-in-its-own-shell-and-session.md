# ADR 0178: Serve the admin area at admin.knowno.app from the same web app, routed by host in the proxy, in a shell and a session of its own

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #648**, the owner's direction of 2026-11-03 with the approved mockup: the admin area is its own app at `admin.knowno.app`, an admin-only shell with none of the user app's menus, and its own sign-in. The PM's decisions on the issue: one Next.js app routed by host, `proxy.ts` serving the admin route group there and no user route; `knowno.app/admin/*` moving permanently to the same path on the admin host; the mockup's six sections, 처리할 일, 사용자, 노트, AI, 요금제 and 관리자, with the account, "서비스 열기" and 로그아웃 at the menu's foot and a full-screen menu below 1024 px; session cookies left host-only, so the admin host signs in on its own.
- **Before this change** ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md), [ADR 0155](0155-organise-the-admin-area-in-five-sections-by-the-job-to-do-and-show-only-what-an-operator-acts-on.md)): the area was `/admin` inside the `(shell)` route group, under the user app's side menu and tab bar, its five sections a row of links above each page, and a user who was not an admin got the not-found page.
- **What Next.js documents for one app on two hosts.** Next.js 16.4.1's guide "How to build multi-tenant apps in Next.js" (`docs/01-app/02-guides/multi-tenant.md`, shipped in the `next` package) gives the Platforms Starter Kit as its recommended architecture: one application that reads the request's host in its proxy (`middleware.ts` before 16) and rewrites the request into the routes that host serves, with `*.localhost` standing in for the subdomains on a machine. The proxy's reference (`docs/01-app/03-api-reference/03-file-conventions/proxy.md`) names `NextResponse.rewrite()` for serving one route at another URL, and `revalidatePath` (`docs/01-app/03-api-reference/04-functions/revalidatePath.md` §Using `revalidatePath` with rewrites) takes the route's own path behind a rewrite. Multi-Zones (`multi-zones.md`) is the documented shape for separate applications under one domain by path, which is not this case.
- **Alternatives considered:**
  - **A second Next.js app or Vercel project for admin.** It would need its own copy of the design components, the Supabase adapter and the env loader, or a shared package, which the repository does not have, and a second build and image. Next.js documents one app for several hosts. Rejected.
  - **Keep the admin host's paths under `/admin` (`admin.knowno.app/admin/users`).** No rewrite and no change to the area's links, but every address repeats the host, and the mockup's addresses are `admin.knowno.app/users`. Rejected.
  - **A cookie shared across `knowno.app` and its subdomains.** One sign-in for both, but the issue asks for a sign-in of its own, and a session cookie scoped to the parent domain would reach every subdomain. Rejected.
  - **Configure the admin host's name by an environment variable.** One more value frozen into each build, and a container operator would have to set it. The name's first label, `admin.`, is enough on Vercel, in a container and on `*.localhost`. Rejected.

## Decision

- **One app, routed by host.** `web/src/proxy.ts` treats a host whose name starts with `admin.` as the admin host, reading the name from `X-Forwarded-Host`, or the Host header without one, as the Platforms Starter Kit reads the Host header: behind `next start` and the standalone server the request's URL names the server's own address (Next.js 16.4.1, `server/lib/router-utils/resolve-routes.js`), so only the headers tell the hosts apart, and a Server Action's redirect is rendered by a fetch to that address which carries the action's `X-Forwarded-Host` and not its Host (`server/app-render/action-handler.js`, `server/base-server.js`). There it rewrites every path into the admin area's routes, `web/src/app/admin/`: `/` serves `/admin`, `/users` serves `/admin/users`. The one path it leaves alone is the code exchange, `/auth/callback`, a Route Handler both hosts share. A page of the service is looked for in the admin area there and is not found. `/api`, the static files and the public icons stay outside the proxy, as before.
- **The old addresses move.** On any other host, `/admin` and every path below it are answered with a permanent redirect (308) to the same path on the admin host, `knowno.app/admin/users?q=kim` to `admin.knowno.app/users?q=kim`, before the session is read.
- **The area's links are the admin host's paths.** Every link, redirect and history entry of the area names its path on the admin host (`/users/…`, `/decks?view=hidden`); `revalidatePath` keeps the route's own `/admin`, as the documentation asks behind a rewrite.
- **Its own session.** `@supabase/ssr` writes host-only cookies, and nothing changes that, so a sign-in on one host is not a sign-in on the other, and a sign-out on one leaves the other signed in. A signed-out visitor on the admin host goes to its `/login`, the admin sign-in: the brand over "관리", "관리자 로그인" and Google's button, with no link into the service. Its callback is `https://admin.knowno.app/auth/callback`, which must be in Supabase Auth's allowed redirect URLs.
- **Its own shell.** The area's layout draws the admin shell in place of the service's: from 1024 px a side menu, "관리 메뉴", with the brand over "관리", the six sections and, at its foot, the account's email, "서비스 열기", which opens the service in a new tab, and 로그아웃; below 1024 px a bar with the brand and "메뉴", which opens the same menu as a full screen through `useModalDialog`. Until #650 and #651 redraw the sections, the existing pages move into it unchanged, 설정's under the section holding their job: 요금제 is `/settings`, AI 제공자 is AI's, 관리자 and 작업 기록 are 관리자's.
- **A refusal, not a missing page.** A signed-in account that is not an admin gets one line, "관리자만 들어올 수 있어요.", and "다른 계정으로 로그인"; every read stays an admin function the server refuses it.
- **The service's origin** reaches the admin pages from the proxy, as the request header `x-knowno-service-origin`, the admin host's name without `admin.`.
- **On a machine and in the e2e specs** the admin host is `admin.localhost:<port>`, which the browser sends to the loopback with no DNS; `next dev` already admits `localhost`'s subdomains.

This changes ADR 0070's placement of the area inside the shell and its not-found page for a non-admin, and ADR 0155's five-section menu; the rest of both stands.

## Consequences

- The owner adds `admin.knowno.app` to the Vercel project, its DNS record, and its callback to Supabase Auth's redirect URLs before the old addresses lead anywhere.
- A host that is an IP address, or a Vercel preview's `*.vercel.app`, has no admin host: its `/admin` moves to a name that does not resolve.
- A server started on 127.0.0.1 cannot serve the admin host: Next.js 16.4.1 names each request by the server's own address and compares the proxy's rewrite with it after turning 127.0.0.1 into `localhost`, so it takes the rewrite for another origin's and fetches it again, which loops (`server/lib/router-utils/resolve-routes.js`, `server/web/adapter.js`). The image listens on 0.0.0.0, Vercel names the real host, and `scripts/test-web.ts` now listens on 0.0.0.0 too, the specs reaching it at `localhost`.
- Each admin page's request runs the proxy's rewrite, so a link in the area that still names `/admin/…` is not found.
- An admin signs in twice, once on each host.

## Signs the decision was wrong

- The admin area needs a dependency, a runtime or a deploy schedule the service does not, which a separate app would give it.
- A preview of the admin area on each pull request is needed, which a host routed by its first label does not give on `*.vercel.app`.
- An admin page's address has to be shared with the service, so the two paths of one page cause confusion.
