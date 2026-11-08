# ADR 0202: Parse card text markup and Anki cloze in one Rust parser, with JSON conformance fixtures

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- The owner asked on #711, through #749, for Markdown-style formatting in text 칸 and for hiding by Anki's cloze syntax, `{{c1::answer}}` and `{{c1::answer::hint}}`, so that cards stay compatible with Anki. The text is drawn on the phone, on the web and in study, and written by the server's TypeScript validator (#749 B).
- Three readers of one syntax drift unless one of them defines it. The phone reaches the Rust engine through the bridge crate and the web through `engine-wasm/` ([ADR 0004](0004-flutter-rust-bridge.md), [ADR 0018](0018-engine-as-webassembly.md)); the server's validator is TypeScript and reads the same text.
- A cloze block v1 stores its text with `___` for each blank and one non-empty answer per blank, in order ([`deck.md`](../deck.md)); stored cards must not change meaning, so a literal `*` in an old card stays a `*`.
- The PM's split of #749 decided: storage keeps the 칸 structure; a text block's version 2 holds Markdown-subset source and a cloze block's version 2 holds one text with `{{cN::…}}`; version 1 blocks are read as before; no data migration; spans sharing a number are hidden together, each number gradable as one blank is today; the subset is bold, italic, inline code, bulleted and numbered lists one level deep, and line breaks.

## Decision

- One parser in `engine/`, `parse_markup`, total over every text: markup that is not closed, or is outside the subset (headings, links, images, HTML, tables, block quotes, escapes), is literal text. It returns a typed document of paragraphs and lists, their inline marks and cloze spans. Its rules are in [`engine.md`](../engine.md).
- The cloze API is on the document: the numbers it holds, the document with one number hidden (each span a blank carrying its hint, every other cloze shown as its answer), the document filled, and the plain text for the card key.
- `cloze_from_v1` gives blank k as `{{ck::answer_k}}`, and returns nothing when the result would not read back as the same filled text with numbers 1 to k, instead of escaping: the subset has no escape, so an answer holding `::` or `}}`, or a text holding a mark, stays a version 1 block.
- The conformance contract is JSON under `engine/tests/fixtures/markup/`: input and expected document, cloze numbers, hidden and filled documents, plain text, and v1 source. The Rust tests, the `engine-wasm` tests and the server's TypeScript tests run them.
- `engine-wasm` declares its own types for the document, with the shape of the fixtures, and exposes `parseMarkup`, `hideCloze`, `fillCloze`, `clozeNumbers`, `plainText` and `clozeFromV1`. The flutter_rust_bridge side is added by #764 in `app/rust/`.

## Consequences

- The three readers agree to the extent the fixtures cover; an edge case found in use is a new fixture and a new test, not a patch in one reader.
- A reader other than Rust implements the grammar from the fixtures and `engine.md`; the first valid closer, exact run lengths and skipping code and clozes are the rules it must match, and are why a text holds at most three nested marks.
- A v1 cloze that cannot convert stays v1 and reads as before; the editor opens it as it does today.
- A nested cloze, `{{c1::a {{c2::b}}}}`, is not supported: the first `}}` closes, and `{{c2` is read as an answer with a hint.
- The cost of a text with many unclosed marks is quadratic in its length, which card text, short, does not reach; no limit on its length is set here.
- Anki import and export, a separate issue, map the syntax directly; where this parser differs from Anki's own is a case for that issue.

## Signs the decision was wrong

- The server's validator and the clients disagree on a stored text, which the fixtures did not cover, more than once: the grammar is too loose to be held by fixtures, and a generated reader is the alternative.
- Users lose marks they wrote because an unclosed or edge-spaced mark reads as literal: the closing rules are too strict, and the first-closer rule is the one to revisit.
- Card text takes noticeable time to parse: the cost rule above is wrong, and the closer search needs a memo.
