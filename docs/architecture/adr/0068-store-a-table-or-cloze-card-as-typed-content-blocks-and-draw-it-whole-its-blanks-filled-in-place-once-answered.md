# ADR 0068: Store a table or cloze card as typed content blocks, and draw it whole, its blanks filled in place once answered

> Status: accepted; its read-only card editor and "a card the user types is a text card" superseded by ADR-0083; its filled-text back superseded by ADR 0137; its filled blank on the brand tint, on study's cards, superseded by ADR 0176
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **The owner's request** (issue #212, 2026-10-19):
  - a page's table, and a list or sentence learned in context, become cards that use the whole card face, not the split front and back;
  - a table card shows the whole table with its row and column headers, the cells to memorise as blanks; a cloze card shows its line with its blanks;
  - answering 안다 or 모른다 fills every blank in place;
  - one table, or one cloze line, is one card for scheduling, with two answers and FSRS unchanged.
- **The owner's direction on the data model**, recorded by the PM on #212 the same day: choose the data model that is right long-term, a migration included if that is the choice, not the one that avoids a schema change. The ADR compares at least (a) typed content, (b) markup in the `front` and `back` text and (c) a new column or table, on queries and sync, editing, old app versions, the web, and the next card kind.
- **The function's contract.** #217 (PR #225) has the function return a table card as `type: "table"` with `table: {columns, rows, blanks}`, its `front` the table's name, and a cloze card as `type: "cloze"` with its `front` writing each blank as `___` and `cloze: {answers}`. The PM asked this PR to read both, and to read a card type this version does not know as a plain card rather than fail the extraction, so #217 can merge after it.
- **What the stored shape already is**, read on `main` at `e0539232951fd7b1066b395c47ba188ae569d542`, and in QA's evidence on #212:
  - a card side is a JSON array of `{type, payload}` blocks (`app/lib/deck/src/content.dart`, `deck.md`), whose comment says a new kind adds a subclass and a discriminator value;
  - the server's `cards.front` and `cards.back` are `jsonb` arrays, checked only to be arrays (`supabase/migrations/20261014155006_sync_schema.sql`), and nothing on the server reads a block's payload;
  - `card_key` is made on the device from the front's text (`deck.md`), and the server stores it;
  - the phone keeps a block of a type it does not know and writes it back unchanged, and the web shows it as a placeholder;
  - sync resolves a card per row, by `updated_at` (`sync.md`), and the tombstone purge strips `front`, `back` and `card_key` (`supabase/migrations/20261018090002_tombstone_purge.sql`).
- **The options:**
  - **(a) Typed content: a `cloze` block and a `table` block** in the existing content model.
    - Queries and sync: no change. A row is a row whatever its blocks, and the key stays a column.
    - Editing: a typed editor per block later; read-only until then.
    - Old app versions: an app before this shows each new block as a labelled placeholder, keeps it, and shows the back's text.
    - The web: reads the same blocks.
    - The next card kind: another block type, the same way.
  - **(b) Markup in the text**, `{{c::answer}}` and `|` lines, as this PR first did.
    - Queries and sync: no change.
    - Costs: it puts structure where the model says a type belongs. A cell or an answer cannot hold `|`, a brace or a line break. The app would turn #217's structured fields into markup and parse it back.
    - Old app versions: they show the markup as typed.
  - **(c) A new column or table** for a card's kind and structure.
    - Queries and sync: a migration of the server and the device. A new table would need its own sync cursor, conflict rule and purge, and a new column the purge's strip.
    - What it adds over (a): nothing the blocks cannot hold.
  - Old versions weigh little: the app is in no store, and the one build in use, the owner's development install, updates with each merge (the PM's review of this PR).

## Decision

- **(a) Typed content blocks.** A later reader designing from scratch keeps a card's content in the content model it already has, and gives each kind of content a block type.
  - A **cloze** block (`ClozeContent`, block type `cloze`) holds its `text`, which writes each blank as `___`, and its `answers`, which fill the blanks in order, one non-empty answer each, as #217's cloze card sends them.
  - A **table** block (`TableContent`, block type `table`) holds its `columns`, its `rows`, each as many cells as there are columns and starting with the row's header, and its `blanks`, each a `{row, column}` of a cell with text, distinct, as #217's `table` sends them.
  - A block that breaks its shape fails decoding, as a text block without text does, on the phone and on the web.
- **Names.** The ADR keeps three concepts apart: a **block type** (`text`, `cloze`, `table`), the discriminator of a content block; a **card type** (`concept`, `cloze`, `identify`, `table`), what a function's card asks; and a **card kind** (`vocabulary`, `note`).
- **A whole card** is a card whose front holds a cloze or a table block. A table card's front is a text block with the table's name, then the table block; a cloze card's front is its cloze block.
- **Its back** is one text block, the front's text with every blank filled: a cloze's text with its answers, and a table as its header line and then a line per row, cells joined by " | ", as the function composes a table card's answer. Search, a merged back, a screen reader's answer and anything that reads text read it.
- **Its key.** `card_key` is taken from the front's text with every blank filled, so the duplicate rule keeps working: a cloze that fills to a stored front collides with it.
- **No migration.** The server's columns already hold any array of blocks, and nothing on the server reads a payload. No stored row changes.
- **Scheduling.** A whole card is one card, with one key, one state and one review per answer, however many blanks it holds.
- **Drawing.** `deck`'s `WholeCardView`, and the web's `WholeCard` in spans a button can hold, draw a whole card's front from its blocks:
  - a text block as its title, a cloze as its sentence in the style of the place it is drawn, and a table in the body size, its header row and each row's first cell bold, its header row on `ground`, inside `outline` lines;
  - an empty blank is its answer drawn so it does not show, on `hairline`, keeping its width so filling it moves nothing; a filled one is the answer on `brandTint`;
  - it reads with each empty blank as "빈칸", a table row by row, its cells joined by commas.
- **Where.** Wherever a card is drawn split, a whole card is drawn whole:
  - study, app and web: the current card with its blanks empty; the previous card, the day's last card and the whole-card sheet or dialog filled, without a back;
  - the deck list, app and web: the row with its blanks empty, filled where its answer is shown, in place of the answer bar; a public deck's row filled;
  - the card editor: read-only for now, its preview filled, with "표 카드와 빈칸 카드는 아직 고칠 수 없어요. 지울 수는 있어요." and delete; a card the user types is a text card. A table editor is out of scope;
  - photo import's list: a table or cloze row whole and filled, opening no edit sheet, not swapped by "앞뒤 바꾸기", which is not offered where every row of a section is one.
- **Import.**
  - `extraction_client.dart` reads the card type `table`, a table card's `table` and a cloze card's `cloze` into the card's front blocks.
  - A card type this version does not know is read as a `concept` card from its `front` and `answer`, so the next new type does not fail an extraction.
  - A copy of a public deck keeps each card's blocks, rather than flattening them to text.
- **v6's cloze cards.** Prompt v6 writes a cloze card as a text front with `___` and its answer on the back, and the cards already saved that way stay as they are: split text cards, not migrated. A text front cannot be told apart from one that holds `___` for another reason. A cloze card from a function that sends no `cloze` field is read the same way.
- This PR changes no function and no prompt. The prompt that makes such cards is #217.

## Consequences

- The content model holds structure as types, and the next kind of card adds a block type, with no migration and no parser.
- A cell or an answer holds any text.
- A whole card's back is written with its front: by photo import, by a copy, and by whatever writes such a card later. A back merged into it by "뒷면 합치기" is stored and searched but not drawn, since a whole card is drawn from its front.
- Until a table editor exists, a whole card is changed only by deleting and importing it again.
- v6's cloze cards stay split beside v7's whole ones.

## Signs the decision was wrong

- A later card kind does not fit a side's ordered blocks, and needs card-level fields the blocks cannot carry.
- Users need to edit tables often enough that the read-only editor is a common complaint before a table editor exists.
- The duplicate rule, keyed by filled text, merges a whole card with a text card the user meant to keep apart.
