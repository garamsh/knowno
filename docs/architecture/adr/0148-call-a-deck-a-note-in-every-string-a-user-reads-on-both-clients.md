# ADR 0148: Call a deck a note in every string a user reads, on both clients

> Status: accepted
> Date: 2026-11-02

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #577**, under #570. The owner decided on 2026-11-02 that what the app calls a 덱 reads as 노트, and that 카드 stays. [ADR 0118](0118-name-each-concept-once-write-each-role-in-one-form-hold-every-screen-to-one-set-of-visual-details-and-redraw-settings-and-the-deck-screen-by-them.md) had fixed 덱 as the term in `design.md` §Copy.
- **The word is in three kinds of place.** Strings a user reads, in `app/lib/l10n/app_ko.arb` and in the web's pages, titles, metadata, legal documents and admin area; names the code, the database and the protocols use, which no user reads: `decks`, `/decks`, `deck_id`, the MCP tools, the ARB keys; and the docs.
- **The particles differ.** 덱 ends in a consonant and 노트 in a vowel, so 덱이 is 노트가, 덱을 is 노트를, 덱은 is 노트는, 덱과 is 노트와, 덱으로 is 노트로 and 덱이에요 is 노트예요.
- **Alternatives considered:**
  - **Rename the code and the routes too.** `/decks` is in users' bookmarks, the tables and the MCP tool names are an interface other programs call, and stored keys are in every device's database. None of it is read by a user, and renaming it breaks what is stored.
  - **Change the Korean alone and leave the English ARB.** The English file would call the same thing a deck, so one concept would have two names across the two locales.
  - **Rely on review to keep 덱 out.** The word returns in the next string anyone writes from memory; a test that names where it may stay is what makes the decision hold.

## Decision

- **Every string a user reads calls a deck 노트, in Korean, and a note, in English,** on the phone and the web: labels, titles, errors, empty states, screen-reader names, page titles and metadata, and the terms of service and privacy policy. 카드 stays.
- **Code, tables, columns, routes (`/decks`), API and MCP tool names, ARB keys and stored keys keep `deck`.** Only an ARB value changes.
- **`design.md` §Copy names the term** in its table, and the docs' quoted strings follow.
- **Two scans hold it.** The phone's test reads every value of `app_ko.arb` and `app_en.arb`, and the web's reads the source of every module under `web/src` but tests, and each fails on a 덱, or on a deck in an English value, outside a named allow-list.

## Consequences

- A reader of the docs meets `deck` for the thing in code and 노트 for the same thing on a screen; `design.md` §Copy says so once.
- A new string that says 덱 fails a test in the first run.
- The ADRs before this one keep 덱 in their bodies, as they were decided.

## Signs the decision was wrong

- Users or the owner call the thing something else again, or read 노트 as something other than a deck, such as a free note without cards.
- The allow-list grows past a few files, which would show strings the scan cannot reach.
