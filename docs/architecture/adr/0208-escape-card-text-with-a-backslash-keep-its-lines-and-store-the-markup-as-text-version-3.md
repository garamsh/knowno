# ADR 0208: Escape card text with a backslash, keep its lines, and store the markup as text version 3

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- [ADR 0202](0202-parse-card-text-markup-and-anki-cloze-in-one-rust-parser-with-json-conformance-fixtures.md) gave the markup no escape, folded a run of blank lines into one paragraph break, and left a v1 cloze block that holds a mark or `::` unconverted.
- `text` version 2 is already stored as the 칸 frame's 글 ([ADR 0137](0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md)), so the markup 글 cannot reuse that number. Versions 1 and 2 are literal text: saving one as markup with no escape would turn a literal `*` or `{{c1::` into markup and change what the card says. The owner's goal is that no stored card changes meaning (#749, #771).
- The editors save every literal run as markup, so for every text there must be markup that reads back as exactly that text. The parser did not allow it: it joined a run of blank lines into one break, dropped empty lines at both ends, and read `\r\n` as `\n` while leaving a lone `\r`.
- Card text is short and drawn as typed. Markdown's paragraph folding, which treats blank lines as spacing, is the wrong model for it. No client reads version 3 yet, so the fixtures change now at no cost to a stored card.

## Decision

- **Text version 3.** The markup 글 is `text` version 3, `{front, back}`, both read as markup. Text versions 1 and 2 stay literal; cloze version 2 (`{text}` in Anki syntax) stands.
- **The escape.** A backslash before `\`, `*`, `_`, `` ` ``, `{`, `}` or `:` makes it literal, wherever it stands, code spans and cloze answers and hints included. At a line's start, a backslash before `-`, or before a digit run and `.`, keeps the line from being a list item. A backslash before any other character is literal, a trailing backslash included. `escape_literal(text)` writes any text as markup that reads back as `text` with newlines normalised, holding no mark, list or cloze; `engine-wasm` exposes it as `escapeLiteral`.
- **The line model, superseding ADR 0202's paragraph folding.** Every `\n` ends a line and is kept. A blank line is a paragraph of its own, empty or holding its whitespace as text; a run of blank lines stays that many empty lines; a leading or trailing newline is an empty line; the other lines up to a blank line or a list are one paragraph, as before. Blocks are apart by exactly one newline, and `plain_text` joins them by one. Marks and clozes still cross a line break and still do not cross a blank line, as before; a mark cannot cross a line of whitespace either, since that line is a blank one.
- **The one normalisation.** `\r\n` and a lone `\r` read as `\n` before parsing. It changes nothing drawn, and it is what lets `plain_text(parse_markup(escape_literal(s)))` equal `s` with newlines normalised for every `s`.
- **Version 1 cloze.** `cloze_from_v1` writes the text and each answer through the escape, so every well-formed block converts and reads back as the same filled text with numbers 1 to k. It still returns nothing for a malformed block: blanks and answers differing in number, or an answer that is empty or has a line of only whitespace, which a cloze answer cannot hold (the span needs a character that is not a space, and a blank line ends the paragraph the span sits in).

## Consequences

- A literal text moves to version 3 with its meaning unchanged, and every v1 cloze with well-formed answers converts, so no block is left behind for what it holds.
- A renderer draws a document's blocks as consecutive lines with no space between blocks; an empty paragraph is an empty line. A reader that applied paragraph margins would draw `a`, a blank line and `b` with more space than the text has. The renderers (#764, #765) and the server's validator (#763) follow the fixtures.
- A text written as markup by hand and containing `\` before one of the escaped characters reads differently than under ADR 0202: `\*a\*` was a backslash and an italic and is now `*a*`.
- A reader other than Rust implements the escape and the line model from the fixtures and `engine.md`; the two rules that need care are that an escaped character is never part of a mark, closer, `::`, `}}` or opener, and that the escape at a line's start is read before the line is tested for a list marker.
- An empty or whitespace-only v1 answer stays a v1 block, as before.

## Signs the decision was wrong

- A client draws version 3 text with spacing between blocks the text does not have, or the editors cannot give the same line count back: the line model is not one the renderers can follow, and blocks need to carry their separation.
- Users meet backslashes in text they typed as markup that vanish, more than occasionally: the escape set is too wide for text typed by hand, and the editors, not the parser, should be the only writers of escapes.
- A v1 cloze with an empty answer is found in stored cards in number: the cloze span needs to allow an empty answer.
