# ADR 0207: Render and edit card text markup and cloze in the app through the engine, behind a deck-owned seam, and write text version 3

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0202](0202-parse-card-text-markup-and-anki-cloze-in-one-rust-parser-with-json-conformance-fixtures.md) and [ADR 0208](0208-escape-card-text-with-a-backslash-keep-its-lines-and-store-the-markup-as-text-version-3.md) put the markup, the Anki cloze, the escape and the line model in one Rust parser and decided the stored shapes: a markup 글 is `text` version 3 `{front, back}`, a cloze is version 2 `{text}`, and versions 1 and 2 of a 글 and version 1 of a cloze are literal.
- The app has to draw them on the card list, the whole card, study and the chat's card preview, and let the user write them, with Markdown shortcuts, a way to hide a selection, and a paste of Markdown.
- The bindings to the engine live in `study` (`study.md` §The bridge to the engine, only that domain imports them), and `study` depends on `deck`, so `deck`, which holds the content model, the editor and the renderers, cannot import them.
- The parser gives a document, not source offsets, so text cannot be styled in place inside a field from it.

## Decision

- **The bridge.** `app/rust/src/api/markup.rs` declares `parse_markup`, `hide_cloze`, `fill_cloze`, `cloze_numbers`, `plain_text`, `cloze_from_v1` and `escape_literal`, all synchronous, with mirror types for the document. The bindings are generated into `app/lib/study/src/rust`, as the scheduler's are.
- **The seam.** `deck` owns `MarkupEngine`, an interface of what it needs (`parse`, `clozeNumbers`, `plainText`, `escapeLiteral`, `clozeFromV1`) over deck-owned document types (`MarkupBlock`, `MarkupInline`). `study` implements it as `BridgeMarkupEngine`, and the composition site installs it with `installMarkupEngine` after `Scheduler.load()`; reading it before that is a `StateError`. Tests install it in `flutter_test_config.dart`.
- **Drawing.** One function, `markupSpan`, draws a document: blocks one newline apart, bullets and numbers as markers, a bold, italic or code run with its style, a cloze as a blank. Every screen draws through it, so a text of version 3 reads the same in the content view, the card list, the whole card, study and the preview. A text of version 1 or 2 and a cloze of version 1 are drawn as before. A screen reader is given the plain text, with a blank spoken as blank until the reveal. The renderers are tested against the engine's fixtures, read from the repository.
- **Study.** Every span of a cloze number is a blank and a hint is shown in the box. A card is one card whatever its numbers, graded and scheduled as today; the card key is the text filled in.
- **Reading and writing.** A cloze of version 2 with no cloze in it is kept as `UnsupportedContent`, written back as read. A 글 or cloze written as markup is a `TextCell(markup: true)` or `ClozeContent.markup`; the editor writes version 3 and 2 for what it adds. An old 글 or cloze opens as written and is stored as it was while unchanged; once edited it is written as version 3 or 2 with each part through `escape_literal` (a v1 cloze through `cloze_from_v1` where it is well formed and as v1 otherwise), so no text changes its meaning on save.
- **The editor.** A 글's fields take a Markdown shortcut as typed: a line break in a list item starts the next item and one in an empty item ends the list; the formatting is shown as it is typed by a rendered preview under the field, drawn only where the text holds a mark. A 빈칸 문장 is one field in Anki syntax with an action "가리기" that wraps the selection in the smallest free cloze number, and "가리기 풀기" on a cloze the cursor is in, which gives its answer back; saving needs one cloze. A paste into a 글 goes through an input formatter, so the menu and the keyboard both work: a table becomes a 표, an image on a line of its own with an https address a 사진, fetched, prepared and stored as a picked one is, and the rest stays a 글, which replaces an empty 글.

## Alternatives considered

- **Move the bindings out of `study` into `deck` or a new domain.** It would change what `structure.md` lets each domain import for one feature. The seam is a few lines and keeps the rule.
- **Style the text in the field itself.** The parser reports no offsets, so a second parser in Dart or a source map would have to follow the engine's rules; a preview from the engine's own document cannot differ from what is drawn.
- **A Dart parser for the editor's shortcuts.** Two readings of one text is what ADR 0202 set out to remove.
- **Convert old 글 and cloze on first read.** Reading would then change a stored card without an edit.

## Consequences

- `deck` runs nowhere the engine is not installed; every test that draws a markup text relies on the test config's install.
- The server still writes version 1 until #763, and the editor opens those as literal text; both readings are kept.
- The fixture `supabase/fixtures/card-frame/conversion.json` holds a cloze of version 2 with a version 1 payload as a later version; the app now keeps a v2 with no cloze as unsupported, so that fixture should be a cloze of version 3.
- The preview is a second drawing of the field, and the field itself shows the marks as characters.

## Signs the decision was wrong

- Users ask for the bold, italic and blanks to be shown in the field: the engine needs to report offsets.
- A second place in `deck` needs the engine beyond the five calls: the seam is the wrong width, and the bindings belong in a domain below `deck`.
