# ADR 0030: Read only what each web page shows, count a read's first page and request the rest together, run the web's functions in Supabase's region, and size the web from the app's tokens

> Status: accepted; `web/vercel.json` holding nothing but `regions` superseded by ADR 0180, for its `ignoreCommand` only
> Date: 2026-10-16

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- Issue #69: on production (`3d2724d6784b0c8ae59ce63df2bfa45057dcc890`, 2026-10-15) every web page showed its loading sentence for about 3–5 s. Each page read the whole library, every deck and every card with both sides, through `readLibrary`, and read its tables in pages of 1000 rows one after another, until a page came back short. The issue asks for a typical library of 10 decks × 200 cards to render within 1 s on a warm server, and leaves the approach to the worker within stack-nextjs.md §4: reading only what the page shows, caching per user with tag invalidation on write, or streaming with Suspense.
- Measured on a local stack seeded with 10 decks × 200 cards, half of them reviewed, served by `next build` and `next start`, the pages render in 20–45 ms with Supabase on the same host. Their cost is in requests made one after another: through a proxy holding each request for 150 ms, the home page took 0.50 s, three requests deep (the card pages 0–999, 1000–1999 and an empty third), and the deck page 0.34 s.
- The PM measured production (`76f408d459bd917d60601d7698ac068b2f6c4a44`) in Chrome, signed in, with one deck of 60 cards: warm full responses of 1015–1187 ms for the home page and 1000–1057 ms for the deck page. The Vercel project ran its functions in `iad1` (Washington, D.C.), its default, and the Supabase project is in `ap-northeast-1` (Tokyo), so every request a page made to Supabase crossed the Pacific.
- Alternatives considered:
  - Caching each user's library in the server with `use cache` and tag invalidation on write: the web writes only reviews and states, and the phone's sync writes decks, cards, reviews and states without passing through the web server, so a tag the web invalidates misses most writes and a page shows a library the phone has changed. The cache key would also have to carry the user, and a mistake in it shows one user's library to another.
  - Streaming more finely with Suspense: every page already streams its content behind one boundary over a prerendered shell, so splitting it shows the same requests' latency in pieces.
  - Embedding each deck's cards and their states in one PostgREST request: `max_rows` limits embedded rows too, to 1000 per deck on the local stack, so a deck over 1000 cards would need a second kind of paging.
  - A database function or view returning each deck's counts: a migration the owner pushes, for a page that already reads in one or two requests.
  - The region set by hand in the Vercel project's settings: it is neither reviewed nor versioned, and nothing in the repository says where the functions run.
  - Next.js's `preferredRegion` route segment option: a container ignores it as it ignores `vercel.json`, but it sits in the app's route files beside the code a container runs. `vercel.json`'s `regions` keeps the setting in the file only Vercel reads, and names it once for every function of the project.
- [ADR 0027](0027-draw-both-clients-in-the-smartman-brand-and-the-v2-screens.md) left the today card's minutes, the summary's next review and the "공개" chip to this issue's data loading.
- The web's `@theme` carried the colours, radii and type scale of `app/lib/shared/theme.dart`, and `theme-tokens.test.ts` compared the colours and radii only. The web's heights and spacing were Tailwind's numeric steps written in the markup (`min-h-13` for the 52 px button), which no test compared with `AppSize` or `AppSpace`.

## Decision

- **Reads.** Each page reads only what it shows, with no cache: the home page reads the decks and, of each card, its id, deck and creation time, without its sides; the deck and study pages read only the decks they name and those decks' cards with their sides. Every page reads the states of the user's cards beside them.
- **Paging.** A read asks for its first page with PostgREST's exact count and then requests every remaining page together, so it waits on two requests at most, and on one when the rows fit one page.
- **Region.** On Vercel the functions run in `hnd1`, Tokyo (AWS `ap-northeast-1`), the Supabase project's region, declared as `regions` in `web/vercel.json`, which holds nothing else. A container ignores the file and runs where its operator deploys it.
- **Data the phone shows.** The home page reads the duration of the user's latest 200 reviews beside the rest and shows the today card's "약 n분" as the phone computes it; each deck's `visibility` gives its "공개" chip on the home page and the deck page; the summary names the next review from the states the session's saved writes stored, once every write is saved.
- **Sizes and spacing.** `@theme` pins Tailwind's spacing unit at 4 px, gives `AppSpace`'s gutter, row gap and section gap tokens of their own, and gives every `AppSize` value the web draws a token under the same name; the markup uses those tokens, and `theme-tokens.test.ts` compares them, and the type scale's size, line height, weight and tracking, with `theme.dart`.

## Consequences

- Through the 150 ms proxy, the home page takes 0.35 s (two requests deep), the deck page 0.20 s and a one-deck study page 0.19 s; with Supabase on the same host nothing changes measurably.
- A page's server work is its request depth to Supabase, in order: the proxy verifies the session in the process (no request while the signing key is cached and the access token fresh), the page verifies it again the same way, and then its reads go out together. That is one request deep for `/decks/[id]` and `/study` while the named decks hold at most 1000 cards and the user at most 1000 states, two beyond that; two deep for `/` with the 10 × 200 library (one up to 1000 cards); and none for `/account`. In `hnd1` each of those requests stays within one region, so a page's time is that depth times a request within Tokyo, plus rendering, instead of times a request across the Pacific.
- A refreshed access token, or a signing key the process has not fetched yet, adds one request to Supabase Auth before the reads. The proxy may make it, and the region setting does not place the proxy if Vercel runs it as Routing Middleware, which Vercel's function-region documentation (updated 2026-08-11) deploys to every region.
- A page shows what the server holds when it is requested, the phone's latest sync included, and no response is kept for any user.
- A read sends its pages after the first at once: a library of 10 000 cards is one request and then nine together, where it was eleven in turn.
- A row written between a read's first page and the rest can shift a row across a page boundary, so it is read twice or missed until the next request, as it could between pages read in turn.
- The pace's query orders the user's reviews by `reviewed_at`, which no index covers, so its cost grows with the user's review count.
- A height or spacing the app changes, or one the web changes alone, fails the token test; a height no web screen draws has no token.

## Signs the decision was wrong

- A page takes more than 1 s on a warm server with a typical library, measured at the function region's distance from Supabase, or the pace query shows in the database's slow log for a user with many reviews.
- Users see a library older than the phone's last sync, or another user's rows, on any page.
- A screen needs a height between the tokens, or the markup goes back to raw steps for one the tokens name.
