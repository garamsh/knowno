# ADR 0169: Read the pages that show study state again in the browser once an answer saved after they were read lands

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The defect, issue #603.** An answer whose write was still in flight when the browser's back left the study page did not count on 홈. 홈 kept "오늘 2장" after the write landed.
- **Why 홈 was stale.** The web sets `cacheComponents` (`web/next.config.ts`). With it, Next.js 16.4.1 hides a route the browser leaves in React's `<Activity>` instead of unmounting it. It shows that route again on a back, with its state and its server-rendered content as they were. Its effects are cleaned up when it is hidden and run again when it shows (`next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md`, "Navigation with Activity"). Nothing told 홈 that an answer had landed since.
- **The write lands after the back.** The diagnosis on #603 showed that the write queue's save still resolves once the study screen is gone.
- **Alternatives considered:**
  - **A `popstate` listener on the study screen**, flushing the queue and then refreshing. It never ran in Chromium (#603). The likely reason, not confirmed, is that a hidden route's effects are cleaned up, which removes the listener. Rejected (#603).
  - **`revalidatePath("/", "layout")` in `recordAnswer`.** It fixes the defect: the client applies a discarded action's revalidation by refreshing the page it reached. But every Server Action that revalidates also re-renders the current route into its response (`next/dist/docs/01-app/02-guides/server-actions.md`). That is `/study`, which the client then discards. Measured on #620 over a 480-card deck, it adds about 166 KB per answer (165,745 bytes median, against 119 bytes without it) and about 17 ms median of server time. Rejected for the payload, which grows with the deck.
  - **`revalidateTag` with a stale-while-revalidate profile**, the one revalidation Next documents without that re-render. It sends no `x-action-revalidated`, so the client neither clears its cache nor refreshes (`next/dist/server/app-render/action-handler.js`, `addRevalidationHeader`). Rejected: it does not fix the defect.
  - **The study page reading less when re-rendered for an action.** It depends on Next's internal `next-action` request header. Rejected.
  - **Sending the session's cards outside the page's render.** That restructures how the study page reads, against `stack-nextjs.md` §3's reading of a page's data in a Server Component. Rejected.

## Decision

- **`study` records each saved answer in the browser.** Each answer or toggle that the server stores sets a module-level time, by the browser's clock. The store outlives the study screen.
- **The pages that show study state read themselves again.** `study` exports one client component, `StudyFreshness`, which draws nothing. 홈, the 노트 page and 기록 each mount it.
  - **On showing again:** if an answer was saved after the page was last read, it calls `router.refresh()` once. The page is read at its first show.
  - **While shown:** it calls `router.refresh()` once when an answer lands.
  - A page with no answer saved since it was read does nothing.
- **The server's write revalidates nothing.**

## Consequences

- An answer counts on 홈, 노트 and 기록 once its write lands, whether it landed before the back or after. Each such page refreshes once when shown, not once per answer saved while it was away.
- A study answer costs nothing beyond its write. The page that refreshes reads only itself.
- A page that newly shows study state must mount `StudyFreshness`, or it can show a count from before the session.
- The record lives in one tab. An answer saved in another tab, or on the phone, is not seen until the page is read again by other means.
- A page the router evicted from its hidden routes (Next keeps 3) mounts again with a new first show. If its content came from the router's cache, an answer saved before that show is not caught.

## Signs the decision was wrong

- 홈, 노트 or 기록 shows a count from before a session's last answer after a back. Or a new page that shows study state is found without the component.
- The refresh shows as a second load: the page flashes, or its scroll or open state resets, after a back.
- Next stops keeping left routes in `<Activity>`, or changes when hidden routes' effects run, and a page's first show no longer marks when it was read.
- Next documents a revalidation from a Server Action that does not re-render the current route but does clear the client's cache.
