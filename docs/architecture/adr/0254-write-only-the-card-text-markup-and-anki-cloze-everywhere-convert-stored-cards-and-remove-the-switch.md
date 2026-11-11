# ADR 0254: Write only the card text markup and Anki cloze everywhere, convert stored cards and remove the switch

> Status: accepted
> Date: 2026-11-12

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

Supersedes [ADR 0216](0216-write-the-card-text-markup-behind-a-database-switch-off-until-a-release-that-reads-it-is-on-testflight-and-serve-its-skills-only-while-it-is-on.md).

## Context

- [ADR 0216](0216-write-the-card-text-markup-behind-a-database-switch-off-until-a-release-that-reads-it-is-on-testflight-and-serve-its-skills-only-while-it-is-on.md) kept the server writing `text` version 2 and `cloze` version 1 behind a database switch, `card_markup`, until a release of the app that reads `text` version 3 and `cloze` version 2 was on TestFlight. The switch is off and was never set (production, 2026-11-12).
- The owner's goal #953 makes the markup the one card format everywhere. A switch that keeps two forms alive costs every layer of the server a second path: the card tools read it on each call, the skills carry a third label for it, and the tests hold both.
- Production on 2026-11-12 held live cards `text` v2 417, `cloze` v1 12 and `cloze` with no version 3, and tombstones `text` with no version 280, v1 3 and v2 111, `cloze` v1 236 and with no version 1. A card of the older forms that stays is one a layer must still read.

## Decision

- **`text` version 3 and `cloze` version 2 are the only forms the server accepts, writes and teaches.** A `text` block's front and back are markup; a `cloze` block is `{text}` in Anki's syntax. A cloze in the older form, `text` with `___` and `answers`, is refused by the card tools, the assistant's and MCP's alike, with a sentence that gives the form to send. `list_cards`, `search_cards` and the study record show a stored block as stored, whatever its version.
- **A migration converts every stored `text` block below version 3 and `cloze` block below version 2**, in live cards and in tombstones: a `{front, back}` text goes through the escape of [ADR 0208](0208-escape-card-text-with-a-backslash-keep-its-lines-and-store-the-markup-as-text-version-3.md), so it reads the same, and a cloze goes through the rule of the engine's `cloze_from_v1`. Card ids, notes and study history do not change; each converted row takes a new revision and its `updated_at` moves, so every device pulls it. A row is backed up first. The conversion is held to the engine's fixtures, `engine/tests/fixtures/markup/`, by a pgTAP test.
- **A card the rules cannot reshape is left, and counted.** A live card's `text` block of version 1, `{text}`, is the side block of a template no build writes now, and the template that reads it reads that shape; a tombstone's is converted. A cloze whose blanks and answers differ in number is left, as the engine refuses it.
- **The switch is removed**: `private.server_switches`, `public.card_markup_enabled`, `admin_card_markup`, `admin_set_card_markup` and every read of it in the Edge Functions. The web's admin control was removed before ([#954](https://github.com/garamsh/knowno/pull/954)). The audit log keeps its `set_card_markup` entries.
- **The skills teach the markup alone.** The `text`, `cloze` and `mixed` guides get new versions, labelled `active`, that do not call the older cloze form accepted; the `markup` label is removed, with its mechanism, and no older version is served.
- **`extract-cards` asks for and returns the markup.** Its output contract, which comes after whichever prompt version is served and decides the form of the output, asks that a `concept`, `cloze` or `identify` card's front and a note's answer be card text in the markup and that a cloze card write each blank as `{{cN::answer}}`; the parser refuses a cloze front that does not hold a finished span for each answer. The candidates are still not stored cards: the app stores them, and its `photo_import` stores `text` version 3 and `cloze` version 2 once it changes.
- **The migration has a revert for the cards and none for the switch and the skills**, with the reason recorded in the migration.

## Consequences

- A phone build that predates the markup, `v1.0.1` and `v1.0.2`, shows a converted card as unsupported, as ADR 0216 foresaw for any card the server wrote as version 3. The app change that writes and reads the markup everywhere is a later round of #953; the switch was never set, so no card holds the new forms yet and the migration is what puts them in front of those phones.
- A public deck's `note_content_hash` changes with its converted cards, so its content hash is new.
- Merging deploys the migration and the bundles together; for the moments between, a bundle deployed before reads `card_markup_enabled`, which is gone, and its card tools refuse a write.
- Reverting restores the cards, not the switch or the skills' labels; an admin returns to an earlier skill version through the `test` label.

## Signs the decision was wrong

- Users on a phone build that cannot read the markup report cards they cannot study, and the app change is not out: the migration should have waited for it.
- A card of a form converted here is found that the rules left, and a layer still reads it: the left cases were more than the counted few.
