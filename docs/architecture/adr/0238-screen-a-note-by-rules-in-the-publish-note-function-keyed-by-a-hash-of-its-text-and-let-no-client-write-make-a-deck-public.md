# ADR 0238: Screen a note by rules in the `publish-note` function, keyed by a hash of its text, and let no client write make a deck public

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #862**, with the design approved in its comment 6743457997 and the PM's answers in comment 6743473555. The AI layer is #863, the app's publish sheet is another issue, and the admin screens for what this ADR adds are #866.
- **The gap.** A note became public the moment its owner's client wrote `visibility = public` ([ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md), [`sharing.md`](../sharing.md) §Publishing), and a public note could be edited without anyone looking at it again. Moderation began with three reports.
- **What a note holds that must not go public.** Resident registration numbers, phone numbers, account numbers, links and messenger IDs, promotions repeated across cards, and words the operators ban. The first two kinds are severe: a note that holds one is not only refused, it counts against its owner.
- **The writers.** `decks` is written by the app's sync, by the web, by the `mcp` function, by the admin functions, by triggers and by migrations. A rule that only the app follows is not a rule.

## Decision

- **A state, `decks.publication`:** `private`, `checking`, `held`, `refused` or `public`, tied to `visibility` and `hidden` by the check `decks_publication_state`: `public` is public and shown; `checking` and `held` are `visibility = 'public'` and hidden; `refused` and `private` are private. Clients read it (`grant select (publication)`) and write it never.
- **No client makes a deck public.** The trigger `decks_guard_publication`, before an insert or update on `decks`, treats `authenticated`, `service_role` and `anon` as clients: a client's write that sets `visibility = public` on a deck that is not already public and shown is refused, and a client's write to a public deck's `hidden`, `publication` or `published_at` is dropped to what the row held. Every other writer (a trigger, an admin function, a migration) has `publication` derived from the row.
- **The owner asks through `public.request_deck_publication(deck_id, description)`,** called as the owner. The deck becomes `checking`, or `held` while a hold stands (below). It is idempotent on a note that is checking, held or public; it refuses a suspended owner and a deck removed from sharing.
- **The function `publish-note`**, `verify_jwt = true`, has two routes:
  - `POST /` carries the owner's token: it authenticates it, asks for the publication as the owner, screens the note at once and answers `{state, refusal, findings}` from `public.my_deck_screening`.
  - `POST /work` carries the service-role key, compared in constant time: it screens every note `public.screening_due` names, 20 at most, and answers counts. A pg_cron job, `sweep-deck-screening`, posts to it each minute through pg_net with the function's URL (Vault `screening_function_url`) and the service-role key (Vault `assistant_service_role_key`, the secret [ADR 0203](0203-resume-a-stalled-photo-job-from-the-server-with-a-pg-cron-sweep-that-requests-the-worker-through-pg-net-its-url-and-key-in-vault.md) already holds); with either missing it does nothing. A note that is `checking` for 20 seconds, or public and never screened, is due.
- **Rules live in the function** (`_shared/screening/rules.ts`, `RULES_VERSION`), because a pattern list is code that changes with a deploy and is tested as code. It reads the note's name, description and each card's text, cloze, table, senses and image blocks' strings, never a media id or a structural string, folds them with NFKC, and finds: resident numbers by date and check digit; phone numbers with any separator; account numbers beside a bank name; links, messenger IDs and contact prompts; a text of 20 characters or more on five cards or more; and the banned terms, matched with no case, width or separator. Findings are `{card, where, block, field, category, start, end}`: the card by its hash and the offsets in the original text, never the text.
- **The verdict store.** `private.screening_verdicts` is keyed by `(content_hash, layer)`, the hash over the name, the description and the sorted hashes of the live cards, never card ids, so republishing the same text finds its verdicts again. A rules verdict's version is `RULES_VERSION` and the banned list's version; one of another version is made again. `public.screening_claim` reads the note, its cards with their hashes, the terms and the verdicts in one statement, `record_screening` stores a verdict only while the note still has the hash, and `apply_screening` decides from the verdicts on the hash it was given, answering `changed` when the note moved.
- **The decision.** `private.required_screening_layers()` is `array['rules']`; #863 adds `ai` there. All required layers clean makes the note `public`. A refusal makes it `refused`, with the layer in `deck_screening.refusal`; a severe verdict also records a `severe` row in `private.screening_violations`. An `unsure` verdict (the AI layer's) makes it `held` for an admin. A verdict of the layer `admin` outranks the others.
- **A public note's edit.** Statement triggers on `cards` (`cards_recheck_inserted`, `cards_recheck_updated`), acting only when the writer is a client role, hide a public deck whose card was inserted or whose text changed, set it `checking` and stamp the request; the sweeper or the next owner's call screens it. A client's edit of the deck's name or description does the same.
- **Holds.** `private.deck_screening.hold` is `reports` (the third report hid it), `admin` (an admin kept it hidden) or `ai`. A held note's owner sees `held`; an admin allows it (`admin_allow_deck`, an `admin` clean verdict) or keeps it hidden (`admin_keep_deck_hidden`, an `admin` refused verdict that blocks the unchanged text from being published again). Both are audited.
- **The banned-word list** is `private.screening_terms` with `admin_screening_terms`, `admin_add_screening_term` and `admin_remove_screening_term`, audited by the term's id, never the term. Its admin screen is #866.
- **Suspension candidates.** `admin_suspension_candidates` lists the users with severe violations or kept-hidden notes on 3 or more distinct decks. No one is suspended by it: an admin decides with the existing `admin_suspend_user`.
- **The migration** `20261110130000_publish_screening.sql` backfills `publication` on the existing `decks` rows: public and shown is `public`, public and hidden is `held` with a hold row (`reports` where the deck has reports, else `admin`). It changes existing rows, so it is not additive and needs the owner's Gate approval (`server.md` §Location and migrations). Its revert is `private.revert_publish_screening()`.
- **The owner creates** the Vault secret `screening_function_url` (the deployed function's URL, `https://<project ref>.supabase.co/functions/v1/publish-note`); `assistant_service_role_key` exists.
- **The MCP function** adds one sentence to the result of `add_cards`, `update_cards`, `delete_cards` and `update_deck` when the deck's `publication` reads `checking` after the write, so an assistant tells the user the note is being checked again.

## Alternatives considered

- **A trigger-only gate without a function.** Patterns in plpgsql are hard to test and to deploy; the AI layer needs a function anyway.
- **An enforce switch,** off until the app ships the sheet. The PM decided against one: the old client's publish is refused in the window, which is shorter than the window a switch would keep the gap open.
- **Screening in the client.** A client is not the only writer and its checks bind no one.
- **A verdict per deck,** not per hash. An edit and an undo would screen the same text twice, and an admin's decision would outlive the text it judged.
- **Suspending automatically** at the threshold. A false positive would lock an account; the list gives an admin the evidence.

## Consequences

- **The old client's window.** An app that still writes `visibility = public` is refused until it ships the publish through `publish-note`; sync then reports the failure like any check.
- **A narrow sync wedge.** A client holding a pending insert of a never-synced deck that is already public is refused on push and keeps retrying; the owner makes it private to clear it.
- **A dark period after an edit.** An edited public note is hidden for the time its check takes, the sweeper's minute plus the 20 seconds.
- **No enforce switch,** as above.
- **The card triggers act on client writes only.** A card written by a migration, a definer function or the dashboard does not recheck; a hard delete of a live card is not handled either.
- **An admin's keep-hidden blocks the unchanged text:** republishing it is refused until it changes.
- **The hand-off to #863** is `private.required_screening_layers()` and the `unsure` outcome; #866 must read the hash before loading cards when it shows a note's findings.
- **Suspension candidates use 3** as the threshold, a number the PM may change in a later migration.
- **Existing hidden decks** become `held`, so an admin sees them in the queue where before they were only hidden.
