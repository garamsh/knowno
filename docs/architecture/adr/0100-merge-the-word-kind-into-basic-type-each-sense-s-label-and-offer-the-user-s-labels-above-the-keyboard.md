# ADR 0100: Merge the word kind into basic, type each sense's label, and offer the user's labels above the keyboard

> Status: accepted; its kind and its basic form superseded by ADR-0114; its sense buttons and the presets' delete button and handle menu refined by ADR-0117, which puts them in each row's ⋯ menu; its starting set of fourteen labels superseded by ADR-0184
> Date: 2026-10-26

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **[ADR 0083](0083-write-every-card-kind-by-hand-in-a-form-of-its-own-chosen-by-a-kind-switch-each-deck-remembers.md)** gives the card editor four kinds: basic, word, cloze and table.
  - A card whose back holds senses is a word.
  - A word's labels are chips. "표시 추가" opens a sheet of the fourteen parts of speech of [ADR 0075](0075-store-a-vocabulary-card-s-senses-as-a-typed-block-and-show-each-label-in-brackets-before-its-meaning.md), with a field for another label.
- **Issue #376** records the owner's decisions of 2026-10-26:
  - "기본" and "단어" become one kind, "기본". Its back is one meaning by default, and "뜻 추가" makes it a list of senses, today's word card.
  - Each sense's label is a small field the user types into, such as "명", with no dropdown and no fixed list.
  - A strip above the keyboard offers the user's labels, in the user's order, to tap into the focused label field.
  - A "품사 표시" screen in settings adds, renames, reorders and removes them, starting from the current short forms.
  - Storage stays a senses block whose labels are text, with no migration, and the presets stay on the device, not synced.
  - The kind switch reads "기본", "빈칸" and "표".
- **The owner's later decision on #376** (2026-10-26) shows the merged kind as "앞뒤", not "기본", so that each kind is named by its shape, as "빈칸" and "표" are. When a later issue stores a card's kind, its stored name is `flip`; storing it is out of scope here.
- Alternatives considered:
  - **Keep the word kind beside basic, with typed labels.** The owner asked for one kind; a card with one meaning and a card with several differ only by "뜻 추가".
  - **Always save a basic back as senses.** Every plain basic card would change its stored shape on its next save, and the web, photo import and a merged back would read a senses block where they read text today. A back of one meaning with no label stays text.
  - **Sync the presets.** Not asked; the owner left it as a later decision.
  - **Reorder the presets by drag alone.** WCAG 2.2's dragging movements criterion (2.5.7) asks for a single-pointer alternative, so the handle's menu also moves a preset up or down.

## Decision

- **Kinds.** `CardKind` is basic, cloze and table. A card is a cloze or a table when its front holds that block, and otherwise basic, its back of senses included. A device that stored the word kind for a deck opens that deck's next new card as basic. The switch reads "앞뒤", "빈칸" and "표", in place of "기본" and of the cloze kind's "문장" of issue #313. The kind keeps the name `basic` in the code and on the device under `deckCardKinds`; no kind is stored on a card.
- **The basic form's back:**
  - By default, one meaning: a label field beside the field "뒷면".
  - "뜻 추가" adds a sense under the last, which makes the back a list of senses, each a label field beside its meaning, moved and deleted by its buttons. Deleted down to one, it is the back's one meaning again.
  - A sense stored with examples keeps its "예문" field. Each text block beside a back's senses keeps its "덧붙인 내용" field (issue #312).
- **Labels are typed.** Each word in a label field is one label, without the brackets a card shows: a `PartOfSpeechLabel` where it is one of the fourteen short forms, an `OtherLabel` otherwise. A stored label keeps the text it was stored with while its field is left as it was.
- **Saving.** A back that held no senses and is still one meaning with no label and no example is saved as text, as a basic back was. Any other back is a senses block, then the back's other blocks, as ADR 0083 saves a word.
- **The presets.**
  - They are the user's own: a label and an optional name each, in the user's order.
  - They are kept on the device under `labelPresets`, beside `deckCardKinds`, and are not synced.
  - A device with none starts from the fourteen short forms, each named.
- **The strip.** While a label field has focus, a strip right above the keyboard offers the presets. A tap fills the focused field, which keeps the focus. "관리" opens the "품사 표시" screen.
- **The 품사 표시 screen.**
  - `deck`'s `PartOfSpeechPresetsRow` opens it. `home/` gives that row to the account screen under "공부", below the daily study minutes.
  - A tap on a preset edits its label and name in place. A delete button removes it, and "표시 추가" adds one.
  - A drag on a preset's handle moves it, and so do the handle menu's "위로" and "아래로".
  - Every change is stored at once.
- **Storage is unchanged:** ADR 0075's senses block, its labels as text, and ADR 0068's blocks.
- **Supersedes** ADR 0083's four kinds, its word kind and its word form's label chips and part-of-speech sheet. The rest of ADR 0083 stands.

## Consequences

- A vocabulary card and a plain card are written in one form. A label is a short typed word, so any label a book prints can be written, with or without a preset.
- A plain basic card keeps its stored shape until a label or a second meaning is added.
- The fixed list of fourteen parts of speech stays only as the presets' starting point and as what decides a part-of-speech label.
- The presets live on one device. A second device starts from the defaults.
- "빈칸" names the cloze kind again, beside the table form's blanks.

## Signs the decision was wrong

- Users type the same label in long form, such as "명사", where a short form was meant, so their cards show labels a book would not.
- Users miss the strip, because labels come out typed by hand while presets go unused.
- Users ask for their presets on another device.
- Cards that should be plain text are saved as senses because a label was typed by mistake. That would mean the label field should be offered only after "뜻 추가".
