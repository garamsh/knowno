# ADR 0222: Parse an Anki package in the browser, import each deck as a note, and export a note as Anki's plain text

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #821**, the last criterion of #749, "Anki: import/export maps `{{cN::…}}` both ways", held until the markup parser ([ADR 0202](0202-parse-card-text-markup-and-anki-cloze-in-one-rust-parser-with-json-conformance-fixtures.md), [ADR 0208](0208-escape-card-text-with-a-backslash-keep-its-lines-and-store-the-markup-as-text-version-3.md)) and the web's reader ([ADR 0209](0209-draw-and-edit-card-text-markup-and-anki-cloze-on-the-web-through-the-engine-s-document-read-where-a-card-is-read.md)) landed. The PM's scope: import an `.apkg` as one note per Anki deck, export a note as the text Anki imports, on the web, with scheduling history and `.apkg` export out of scope.
- **The formats, read 2026-11-09:**
  - Anki's manual, Importing → Text files (`https://docs.ankiweb.net/importing/text-files.html`): UTF-8 text; a field holding the separator or a line break is quoted in `"`, a quote inside it doubled; `#key:value` header lines (Anki 2.1.54 or later) include `separator`, `html`, `notetype column`, `deck column`, `tags column` and `guid column`, the columns counted from 1; the field count is read from the first line that is not a comment; with `html` on, `&lt;`, `&gt;` and `&amp;` write the literal characters; "Escaped multi-lines will not work correctly if you are using cloze deletions that span multiple lines", so `<br>` is the line break.
  - Anki's manual, Exporting (`https://docs.ankiweb.net/exporting.html`): "Notes in Plain Text" writes each field separated by a tab with its HTML, and "Anki Deck Package (.apkg)" exports one deck and its children, with options for scheduling, presets, media and "Support older Anki versions", which "will not be readable by older Anki clients" when off.
  - Anki's source, `ankitects/anki` at `9d447f0f73defd05fc81e79092eabb28627c5964`: `rslib/src/import_export/text/csv/export.rs` writes `#separator:tab`, `#html:<bool>`, then `#guid column:`, `#notetype column:`, `#deck column:` and `#tags column:` for the columns present, the note type first after the guid and the deck after it. `rslib/src/import_export/package/meta.rs` and `proto/anki/import_export.proto` give a package three versions: `collection.anki2` (legacy 1) and `collection.anki21` (legacy 2), both plain SQLite, and `collection.anki21b` (latest), zstd-compressed, which also compresses the media files. A package with no `meta` entry is legacy 2 when `collection.anki21` exists and legacy 1 otherwise; `meta` is a protobuf `PackageMetadata` holding the version. A legacy `media` entry is a JSON object from a zip entry's number to the file's name; the latest one is a protobuf `MediaEntries` of name, size and SHA-1, the entry number being the position in the list (`rslib/src/import_export/package/media.rs`). `rslib/src/storage/schema11.sql` shows the `notes` table, whose `flds` joins a note's fields with the character U+001F, and a `col` row holding `models` and `decks` as JSON.
- **Not read:** the schema 18 tables of `collection.anki21b` (note types, fields and decks as tables, a note type's kind in a protobuf config), which the import's own change reads from `rslib/src/storage/` and `proto/anki/notetypes.proto` and tests against a package Anki wrote.
- **Existing paths.** Spreadsheet import reads a file in the browser with `fflate`, never uploads it, refuses by size before reading and saves reviewed cards in requests of at most 100 through `saveCards` ([ADR 0125](0125-add-cards-from-an-xlsx-or-csv-file-by-choosing-columns-and-reviewing-before-save.md), [`web-decks.md`](../web-decks.md)). Photo import stores a photo as a 사진 칸 through `store-card-media.ts` and `prepare-image.ts`. The web's markup seam is `design/markup-engine.ts` (`escapeLiteral`, `parse`, `clozeFromV1`).

## Decision

- **Where the parsing runs: in the browser.**
  - The user's package is never uploaded for reading, as no spreadsheet is, and the server holds only the cards the user reviewed, written by `saveCards` as manual adding writes them, so the write path's validation and limits are the same for an imported card as for a typed one.
  - Reading on a server would also read a SQLite file, decompress zstd and handle media, all in an Edge Function that holds a user's whole package in memory per request; the browser's own memory is the user's, and a refused package costs the service nothing.
  - The reading needs three things the web has no reader for: a SQLite reader, a zstd decoder and protobuf's two small messages. They are added by the import's own change, which names each dependency, its size and its version, and loads them only when a package is picked, as `spreadsheet.ts` is.
  - **Size limits** (the import's change sets each as a constant and tests it at the limit): a package over 100 MB is refused before it is read; its collection over 100 MB unpacked, or a part unpacking past its limit, is refused; more than 1,000 notes in one deck is refused, the spreadsheet's row limit, so a deck is a few `saveCards` batches. A refusal is one sentence saying which limit and what to do, never a crash.
- **Import.** An Anki package becomes one knowno note per Anki deck holding notes, named as Anki names it with `::` written as " / ". Nothing is written until the user has reviewed the notes and cards and chosen "추가", as spreadsheet import does.

  | Anki | knowno |
  |---|---|
  | Basic note type, two fields | a `text` version 3 card, front and back |
  | Cloze note type | a `cloze` version 2 card, its `{{cN::answer}}` and `{{cN::answer::hint}}` kept, the Extra field dropped |
  | any other note type | a `text` version 3 card of its first two fields, counted, and the import says how many cards were converted that way |
  | `<b>`, `<strong>`, `<i>`, `<em>`, `<ul>`, `<ol>`, `<li>`, `<br>`, `<div>` and `<p>` lines | the markup subset: bold, italic, lists and line breaks |
  | any other HTML | stripped to its text; entities decoded |
  | `<img src>` naming a file of the package's media map | a 사진 칸, stored as photo import stores it |
  | scheduling, tags, GUIDs, deck options | not imported |

  - The markup is assembled from the HTML's marks and every literal run passes through `escapeLiteral`; the result is checked by the engine's `parse` and `plainText` against the HTML's own text, and a field that does not read back as that text is written as one literal run. No second parser is written.
  - An Anki Cloze note with several numbers is one knowno card, as [ADR 0209](0209-draw-and-edit-card-text-markup-and-anki-cloze-on-the-web-through-the-engine-s-document-read-where-a-card-is-read.md) draws and schedules every cloze text; Anki shows one card per number, so card counts differ between the two apps for such a note.
  - A card whose key a card of the note already has is refused by the write path's duplicate rule and named, as in the spreadsheet's review.
- **Export.** A note exports as "Notes in Plain Text", a `.txt` named for the note, built in the browser from the cards the page already read.
  - The headers are `#separator:tab`, `#html:true`, `#notetype column:1` and `#deck column:2`; each row is the note type, the deck and two fields. A field holding a tab or a quote is quoted, its quotes doubled; no field holds a line break, since a line is `<br>`.
  - A `text` card is a Basic row, front and back; a `cloze` card is a Cloze row, its text in the first field and the second empty. The note type names are Anki's stock "Basic" and "Cloze", which Anki matches by name. The deck is the note's name, with `::` collapsed to `:` so Anki does not read a sub-deck.
  - A markup text becomes HTML from the engine's document: `<b>`, `<i>`, `<code>`, `<ul>`/`<ol>` with nested lists, `<br>`, and each cloze span as `{{cN::answer::hint}}`. A literal text, version 1 or 2, is written as typed with `&`, `<` and `>` escaped. A version 1 cloze is converted by `clozeFromV1`; one it cannot convert is written as a Basic row of its filled text.
  - Braces in literal text are written as `&#123;` and `&#125;`, and `:` inside a cloze as `&#58;`, so a literal `{{c1::` never becomes a cloze in Anki and a literal `::` never splits a hint.
  - A card that is neither a 글 nor a cloze (a 단어, a 표, a 사진 with boxes) is a Basic row of the text of its front and its back; a card with no front text, a 사진 alone, is left out. The export says how many cards were written, how many of them as text only, and how many were left out.
- **The pull requests.** The export, needing no package reading, is delivered first, with this ADR; the import is its own change, which carries the dependencies, the review screen, the conversion tests and an e2e test of a small package.

## Consequences

- No package leaves the browser, and no Edge Function or migration is added.
- The web's `decks` feature grows `anki-export.ts` now, and a package reader and the import screens with the import.
- The round trip is exact for a `text` or `cloze` card up to the markup subset: Anki's HTML outside the subset is stripped on the way in, so a note imported and exported again can lose formatting it had in Anki.
- Anki's own note type names can be translated on a localized install; the export names "Basic" and "Cloze", and a row whose type Anki does not find is Anki's to ask about at its import screen.
- A package Anki wrote in the latest version needs the zstd decoder and the schema 18 reading; a legacy package needs neither.

## Alternatives considered

- **An Edge Function reading the package.** Rejected: it uploads the user's whole package, reads SQLite and zstd on the server inside a function with a per-request memory bound, and still ends in the same `saveCards` write, so it buys no validation the browser path lacks.
- **Exporting an `.apkg`.** Out of scope by the issue; it needs the writing of a SQLite file and, for the latest version, protobuf and zstd.
- **One export row type for every card.** Rejected: a cloze exported as Basic is a front with braces, not a card Anki hides.

## Signs the decision was wrong

- Users' packages are refused for size more than rarely: the browser's limit is lower than their decks, and a server read with a streamed upload is the next decision.
- Anki refuses an exported file, or shows a row under another note type, on a current release: the header or the note type names are wrong, and the export's test fixture, read from Anki, is where it is corrected.
- Imported cards read differently from the Anki cards they came from in more than the subset's formatting: the HTML conversion needs a rule, and a fixture for it.
