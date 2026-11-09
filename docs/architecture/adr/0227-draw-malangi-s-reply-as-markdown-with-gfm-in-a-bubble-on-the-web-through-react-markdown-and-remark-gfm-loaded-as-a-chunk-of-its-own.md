# ADR 0227: Draw 말랑이's reply as Markdown with GFM in a bubble on the web, through `react-markdown` and `remark-gfm` loaded as a chunk of its own

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #826**, the web half of the owner's request of 2026-11-09 that #825 met on the phone ([ADR 0225](0225-draw-malangi-s-reply-as-markdown-with-gfm-in-a-bubble-through-the-dart-markdown-package-and-our-own-widgets.md)): the chat drew `turn.text` as a bare paragraph, so `**…**`, backticks and a pipe table showed as typed. The card markup ([ADR 0209](0209-draw-and-edit-card-text-markup-and-anki-cloze-on-the-web-through-the-engine-s-document-read-where-a-card-is-read.md)) has no headings, tables or links, so it does not serve a reply.
- **The packages**, read from the npm registry on 2026-11-09:
  - `react-markdown` 10.1.0, published 2025-03-07, MIT, peer `react >=18`: it parses with `remark`, builds React elements and no HTML string, and takes a `components` map, `urlTransform` and `remarkPlugins`. Raw HTML in the text is escaped as text unless a rehype plugin is added.
  - `remark-gfm` 4.0.1, published 2025-02-10, MIT: tables, strikethrough, autolink literals, footnotes and task lists.
  - Together they add 102 entries to the lockfile, counted from the diff of `web/package-lock.json`, read nowhere outside the chat.
- **Rules the owner fixed** (and the phone keeps): links open outside the page, images are not fetched, raw HTML is text, a wide table scrolls sideways.

## Decision

- **Parser and renderer: `react-markdown` 10.1.0 with `remark-gfm` 4.0.1**, direct dependencies of `web/`, each pinned exactly. No rehype plugin is added, so `<b>x</b>` and `<script>` stay text. `remark-gfm` also reads footnotes and task lists, which the phone's set leaves out; the web draws a task box as the library does, a disabled check, and a footnote's reference as text, since an in-page address is not one of the schemes below, rather than carry a plugin to remove them.
- **Our own elements.** `components` replaces each element with one drawn from the design tokens (`reply-markdown.tsx`): headings as `role="heading"` lines two levels below the page's, so the chat does not redraw the page's outline; nested lists, block quotes, inline code, code blocks and tables. A table sits in a horizontal scroll region named "표", and a code block scrolls likewise, both reachable from the keyboard. The table keeps `thead`, `th` and `td`.
- **Links** with the scheme `http`, `https` or `mailto` are `<a target="_blank" rel="noopener noreferrer">`; `urlTransform` drops any other address, a relative one included, and the text shows without a link. **An image** is its alt text in a `span`; no `img` is made, so nothing is fetched.
- **The bubble** is 말랑이's text alone, as the phone draws it: `surface` under a `hairline` border and `rounded-row`, at the start of the line up to 92% wide, as the user's is at its end. Proposals, the question, the job and the sources stay below it. A user's turn stays plain text in its own bubble.
- **A chunk of its own.** The chat imports the renderer through `React.lazy`, so the parser and the packages it brings are not in the chat route's first load; a reply is drawn as plain text, in the same bubble, until the chunk has arrived, then as Markdown.
- **The plugin list is exported** (`replyRemarkPlugins`), so #830's one-line status, which needs the reply's words without marks, reads the text through the same GFM set.
- **No fallback.** The parser reads every text, so none is refused. Streaming parses the whole text on each delta; a mark not yet closed shows as typed until its closing arrives, as on the phone.

## Alternatives considered

- **The card markup engine.** One parser, no dependency. Rejected for the reason above: no headings, tables or links.
- **`marked` or `markdown-it` with a sanitiser, drawn through `dangerouslySetInnerHTML`.** Smaller. Rejected: it puts HTML strings in the page, so raw HTML text and the link and image rules depend on a sanitiser's options and are checked by none of the types; `react-markdown` has no HTML path to close.
- **Our own renderer over `mdast-util-from-markdown`**, as the phone's over `markdown`. Rejected: the web would own table alignment, nesting and escaping that `react-markdown` already tests, for a client that has a maintained renderer.
- **Loading it with the page.** Rejected: every `/assistant` visit would carry the parser before a reply exists.

## Consequences

- Two new dependencies and 102 lockfile entries; about 120 lines of elements that the web owns and tests.
- The first reply of a visit shows as plain text for the time its chunk takes, then redraws as Markdown; a stored reply on a reload does the same.
- The phone and the web agree on CommonMark and GFM's tables, strikethrough and autolinks, not on pixels or on footnotes and task boxes.

## Signs the decision was wrong

- The elements grow to cover what the library does not draw, and their cost passes a renderer of our own.
- A release of `react-markdown` or `remark-gfm` makes raw HTML render, or fetches an image, in a way the tests do not see.
- The plain-text frame before the chunk loads is noticed as a flicker.
