# ADR 0240: Keep note screening to rules and let reports catch the rest, and return each finding's field

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #875**, part of #590. [ADR 0238](0238-screen-a-note-by-rules-in-the-publish-note-function-keyed-by-a-hash-of-its-text-and-let-no-client-write-make-a-deck-public.md) planned an AI layer as #863 and wrote it into the decision. The owner dropped the AI layer on 2026-11-10 and closed #863 and #864.
- **What the web build found.** Matching an uncertain banned term as a substring refused ordinary Korean: "개 새끼" and "세 시 팔 분" each contain a term that no one means there.
- **A gap in the findings.** ADR 0238 lists `field` among a finding's keys, and the rules verdict stores it, but `private.screening_findings` dropped it, so a block holding several strings could not be located.

## Decision

- **No model judges a note before it is public.** Screening is the rules layer of ADR 0238 alone. Personal data, links, contact prompts and repeated promotions refuse at once.
- **A banned word is matched mechanically and refuses, and the list holds certain terms only:** terms no ordinary phrase contains. An uncertain term is not listed.
- **Reports are the backstop.** What the rules miss is left to the report system: three reports hide a note until an admin decides.
- **ADR 0238 is superseded in these parts:** "#863 adds `ai` there" (`private.required_screening_layers()` is `array['rules']` and stays so), the AI's severe verdict as a confirmed violation (only an admin's keep-hidden is one), and the `ai` hold (no note gets it).
- **The unused `ai` values stay,** the `ai` hold of `private.deck_screening` and the `ai` layer of `private.screening_verdicts` and of a refusal, with no migration removing them. Screening is layers keyed by content hash, and the owner wants a model layer to stay possible. Adding one is then a new ADR, the layer's code in `publish-note` and `ai` in `required_screening_layers()`, with no schema change for the hold or the verdict.
- **`private.screening_findings` returns `field`,** the path of the string a finding's offsets index, null for the name and the description, so `admin_screening_findings` and the owner's `my_deck_screening` carry it. The migration `20261110170000_screening_finding_field.sql` replaces the function and changes no row. Its revert is `private.revert_finding_field()`.

## Alternatives considered

- **Removing the `ai` values by a migration.** It rewrites two check constraints and the decision function for a layer the owner may want back; keeping them costs three unused words.
- **Substring matching of uncertain terms.** It refused ordinary Korean, as above.
- **A model layer.** Dropped by the owner.

## Consequences

- **Reports carry what the rules miss,** so a note that holds a word not on the list is public until reported.
- **The `ai` values are dead until a layer uses them:** nothing writes them.
- **The client reading `field`** is a later change; the key is present now, as null or a path.
