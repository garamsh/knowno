# ADR 0225: Draw 말랑이's reply as Markdown with GFM in a bubble, through the Dart `markdown` package and our own widgets

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #825**, from the owner's phone on 2026-11-09: replies showed `**…**`, backticks and a pipe table literally, outside any bubble. The owner asked for a bubble and for Markdown. A reply is not card text, so the card markup subset ([ADR 0207](0207-render-and-edit-card-text-markup-and-cloze-in-the-app-through-the-engine-behind-a-deck-owned-seam-and-write-text-version-3.md)) does not serve it: it has no headings, tables or links.
- **The packages**, as of 2026-11-09:
  - `markdown` 7.3.1, the version `flutter pub add markdown` resolved: a Markdown parser to an AST, with extension sets for GFM tables, strikethrough, fenced code and bare links, read from its source in the pub cache. It has no Flutter dependency.
  - `flutter_markdown` was discontinued by its publisher (issue #825).
  - Renderers that wrap `markdown` decide how images load, how links open and how a table lays out, and each of those is a rule below.
- **Rules the owner fixed:** links open in the system browser, images are not fetched, raw HTML is shown as text, a wide table scrolls sideways.

## Decision

- **Parser: `markdown` ^7.3.1**, a direct dependency of the app. A reply is parsed with an extension set of fenced code, tables, strikethrough and bare links. No syntax for raw HTML is in the set, so `<b>x</b>` stays as text; footnotes and task boxes are not read.
- **Renderer: ours**, `app/lib/assistant/src/reply_markdown.dart`, which walks the AST into widgets from the theme's tokens: paragraphs, headings, nested lists, block quotes, code blocks and tables as blocks; bold, italic, strikethrough, inline code and links as spans. A table sits in a horizontal scroll view; a code block likewise.
- **Links** with the scheme `http`, `https` or `mailto` open through `launchUrl` in the external application, as a citation does, and say "linkNotOpened" where they did not; any other scheme is text. **An image** is drawn as its alt text and never loaded.
- **Words** keep `keepWords`'s joiners, as every Korean text does. The semantics label, "말랑이: …", reads the text without marks (`replyPlainText`), a table row on a line.
- **A text that cannot be read** is drawn as typed. Streaming re-parses the whole text on each change, so a mark not yet closed shows as typed until its closing arrives.
- **The bubble** is 말랑이's text alone, at the start of the line, as the user's is at its end; the proposal, question, job and sources stay below it.

## Alternatives considered

- **A renderer package (`flutter_markdown_plus` and the like).** Less code. Rejected: each hands the owner's rules (no image fetch, no HTML, sideways tables) to its own options and releases, and none was read for this decision.
- **`flutter_markdown` itself.** Discontinued: no fixes.
- **The card markup engine.** One parser for both, no new dependency. Rejected: it reads no headings, tables or links, and a reply the model writes in Markdown would show them raw.

## Consequences

- One new dependency, and about 300 lines of widgets that the app owns and tests.
- The web's chat (#826) reads the same Markdown with its own library; the two agree on CommonMark and GFM, not on pixels.
- A syntax the set leaves out shows as typed.

## Signs the decision was wrong

- The renderer grows to cover Markdown it does not draw (footnotes, task boxes, HTML) and the cost passes a maintained package's.
- `markdown` is discontinued or its AST changes under the walker.
