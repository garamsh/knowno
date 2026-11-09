# ADR 0223: Read an Anki package with sql.js, fzstd and fflate loaded on the import menu item, and build its fixtures with Anki's own library

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #821**, the import half. [ADR 0222](0222-parse-an-anki-package-in-the-browser-import-each-deck-as-a-note-and-export-a-note-as-anki-s-plain-text.md) decided that an `.apkg` is read in the browser and left the three readers it needs, a zip reader, a SQLite reader and a zstd decoder, to the change that adds the import, with the schema 18 tables ("Not read" there) read from Anki's source and tested against a package Anki wrote.
- **The schema, read 2026-11-09,** in `ankitects/anki` at `c06370ff4d87cb48d825f90cc83e02b9a4e84ecd` (tag `26.09.4`), and checked against packages that version wrote:
  - `rslib/src/storage/schema11.sql`: the legacy `col` row with `models` and `decks` as JSON, and `notes`, `cards`.
  - `rslib/src/storage/upgrades/schema17_upgrade.sql` and `schema18_upgrade.sql`: schema 18 moves note types, fields, templates and decks into tables `notetypes`, `fields`, `templates` and `decks`; `notes.flds` still joins a note's fields with U+001F, and a deck's name joins a parent and child with U+001F where the legacy JSON has `::`. `proto/anki/notetypes.proto` and `rslib/src/storage/notetype/mod.rs` show a note type's kind and a template's formats in a protobuf `config` column.
  - `rslib/src/import_export/package/meta.rs`, `media.rs` and `proto/anki/import_export.proto`: as ADR 0222 records, and a latest package's `media` entry is itself zstd-compressed, as each media file is; a latest package also holds a stub `collection.anki2` that asks to update Anki, which is not its collection.
- **Existing path.** `spreadsheet.ts` reads in the browser through `fflate`, refuses by size before reading, and caps what a part unpacks to; it is imported only when a file is picked (`components/spreadsheet-import.tsx`).

## Decision

- **Three readers, each loaded only when a package is picked** (`anki-import.tsx` imports `anki-package.ts` with `import()` inside the picker's handler, and `anki-package.ts` imports `anki-sqlite.ts`, which imports `sql.js` the same way):

  | Part | Choice | Version | Licence | Size | Why |
  |---|---|---|---|---|---|
  | zip | `fflate`, already a dependency | 0.8.3 | MIT | none added | `spreadsheet.ts` already reads zips with it, with the unpacked-size check per part |
  | SQLite | `sql.js` | 1.14.1 | MIT | 648 KB wasm and its loader, a separate static file | SQLite itself compiled to WebAssembly, so a collection is read with Anki's own tables and SQL, not a reimplementation; maintained, with releases in 2026 |
  | zstd | `fzstd` | 0.1.1 | MIT | about 12 KB | a pure JavaScript decoder with a streaming `Decompress`, which lets a read stop the moment its output passes a limit; no wasm |

  `@types/sql.js` 1.4.11 is a development dependency. All three are pinned exactly, as the project's other dependencies are. `sql.js` 1.15.2 was published 2026-10-26, under the two weeks a pin waits, so 1.14.1 is the version.
- **The wasm is a file the bundler emits.** `anki-sqlite.ts` fetches `sql-wasm-browser.wasm` by `new URL(…, import.meta.url)` and hands its bytes to `initSqlJs`; `next build` emits it under `.next/static/media/` and serves it only to a page that loads the import. It is the one seam the tests replace, with the same module read from `node_modules`, as jsdom fetches no file.
- **Limits** are constants in `anki-package.ts`, each tested at and past the limit: a package over 100 MB is refused by its size before a byte is read; a collection that unpacks past 100 MB is refused by the decoder as it grows, not after; a media list or file past 50 MB is refused, as a spreadsheet's part is; more than 1,000 notes in one deck is refused naming the deck. A refusal is one sentence that says which limit and what to do. Any other failure to read, a corrupt zip or collection, is one sentence too.
- **Which collection.** `collection.anki21b` where it exists, decompressed, read as schema 18; otherwise `collection.anki21` or `collection.anki2`, read as the legacy JSON. A note belongs to the deck of its first card; a note whose cards are missing or whose deck or note type the collection does not name is left out, and a deck with no note is not shown.
- **A note's kind** is read from what the collection holds: a note type whose template formats hold `{{cloze:` is a Cloze (in the legacy JSON also `type: 1`); two fields on one template is a Basic; anything else is "other" and read by its first two fields, as ADR 0222 has it.
- **The conversion of HTML** (`anki-html.ts`) walks the field's DOM as the browser parses it: text, `<b>`, `<strong>`, `<i>`, `<em>`, `<ul>`/`<ol>`/`<li>` with one level of nesting, `<br>`, and `<div>`/`<p>`/other block elements as lines. Each literal run passes through `escapeLiteral` and the engine's `plainText` must read the result back as the HTML's own text; where it does not, the field is the text alone. A Cloze field keeps `{{cN::…}}` as written, and the engine's `clozeNumbers` decides it holds a deletion. Marks across a line are closed and reopened per line.
- **Photos** are read from the package when the user chooses 추가, prepared by `prepareImage`, stored by `storeCardMedia` and written as `placed` 칸 on the side of the field they were in; the media id is a version 5 UUID of the file's SHA-256 under the import's job id, so a retry or a repeated image stores one file. A photo that cannot be read or prepared is left out; a card left with nothing on a side is not written.
- **Writes** go through `saveAnkiCards`, which is `writeCards` as manual adding calls it, with `source` `import` and media allowed: the same frame rule, key, duplicate rule and 100-card, 1,000,000-character bounds. The browser sends requests of at most 100 cards and 900,000 characters. Notes are made with `createDeck`, their ids and the cards' version 5 UUIDs of the deck's name and the Anki note id under the job id, so a retry writes nothing twice.
- **Fixtures** are packages Anki wrote, not hand-made: `web/e2e/fixtures/anki/generate.py` builds a collection with Anki's own Python library (`uv run --with anki==26.9.4 python -I generate.py`, run from that directory) and exports `spanish-latest.apkg` (the latest format) and `spanish-legacy.apkg` (`legacy=True`, `collection.anki21`) with scheduling off and media on. Each holds two decks, `Spanish` (a Basic note with bold and a Basic note with an image) and `Spanish::Verbs` (a Cloze note with a hint and an Extra field, and a "Basic (and reversed card)" note as the control for another note type). The tests read both files; the e2e test imports the latest one.

## Consequences

- The import's code and the three readers load only on the import menu item; no other route's bundle grows, and the 648 KB wasm is fetched once, then cached by the browser.
- `fzstd`'s last release is 2024; it is a decoder of a frozen format, and the size limit is enforced in this code, by the output it hands over, not by the library.
- Cards from other note types, a card's order of text and photos, and a Cloze note's Extra field are lost or reordered as ADR 0222 says: a photo sits before the text on the front and after it on the back.
- Regenerating the fixtures needs `uv` and network access once, and produces different bytes each time (Anki stamps ids and times); the tests read what is committed, not a regeneration, so the tests assert the notes' contents and not the files' bytes.

## Alternatives considered

- **A pure JavaScript SQLite reader.** Rejected: a reader of SQLite's file format written or vendored here is more code to trust than SQLite compiled to WebAssembly, which reads Anki's tables with SQL.
- **`wa-sqlite` and `@sqlite.org/sqlite-wasm`.** Not tried: `sql.js` already reads one collection from memory with a one-call loader and an exported wasm file, which is all the import does; the others add build or worker setup for features it does not use.
- **`zstddec` and wasm zstd decoders.** Not tried: `fzstd`'s streaming `Decompress` lets the code stop at the limit as output grows, and it needs no second wasm file.
- **Hand-written fixtures.** Rejected: a protobuf, a zstd frame and a schema written by the test and read by the reader agree with each other whatever Anki writes.

## Signs the decision was wrong

- A real package from a current Anki release is refused or misread and the fixture does not show it: the fixture's generator is run again at the release that wrote it, and the reader is corrected against that.
- The wasm file is not served, or is blocked, in a deployed build while it works in the e2e: the loader needs the deploy's asset path, and its test the same.
- A deck of Anki's own sample size is refused at 1,000 notes by more than a few users: the limit is the spreadsheet's, and the next decision is a deck split into several notes by 1,000.
