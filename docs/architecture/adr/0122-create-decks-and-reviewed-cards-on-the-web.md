# ADR 0122: Create decks and reviewed cards on the web

> Status: accepted; restriction to new cards superseded by ADR 0143; sheets for direct entry and photo review below 1024 px superseded by ADR 0158
> Date: 2026-10-28

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

Issue #490 asks for web deck creation, direct card entry and reviewed photo import with the phone's visual language and mobile usability. ADR 0038 kept creation off the web; directing web users to the phone now prevents the requested workflow. The existing schema and signed-in extraction function already support these rows and the user's plan allowance.

## Decision

Replace ADR 0038's web creation restriction: keep authoring within the existing `decks` feature, creating owner-scoped decks and new cards through authenticated Server Actions using the current synced schema. Use the existing extraction function and allowance, holding candidates in the browser until explicit review and addition, with grouped app-aligned sheets for direct entry and photo review.

## Consequences

- The first-run home, deck list and deck pages can lead directly into creation without another feature or a schema migration.
- Stable ids make write retries safe without overwriting existing cards; duplicate fronts warn before an explicit additional card.
- The browser's camera hint may open a file picker. Browser imports accept JPEG, PNG and WebP within the existing size limit; they do not persist after the window closes.
- The function has no browser CORS contract. Photo uploads go through a verified Server Action, bounded to 3 MiB inside a 4 MiB request limit; browser preparation shrinks larger accepted files. Stopping prevents later photos and cannot cancel a model request already started.
- Model selection, plans and quota enforcement stay with the existing function. Tests substitute extraction and make no paid call.
- Existing-card editing, public-deck browsing and full media/audio authoring remain separate work.

## Signs the decision was wrong

- Creation develops a lifecycle or dependencies that cannot stay within `decks` without a feature cycle.
- Users repeatedly lose unsaved photo jobs by closing the browser, making browser persistence necessary.
- The online-only flow cannot meet the retry and duplicate behavior without changing the server contract.
