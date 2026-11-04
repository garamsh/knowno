# ADR 0197: Make the card forms versioned skills, an index the assistant always sees and a guide per form it loads, shared with MCP, and hold each proposal group to one form

> Status: accepted
> Date: 2026-11-05

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #751**, the owner of 2026-11-04: 말랑이 must use consistent card forms, a word list as word (senses) cards, a table as table cards, a sentence to recall as cloze, while it builds from the user's requests rather than copying photos. The card-form guidance becomes a skill the assistant loads on demand, shared with MCP and editable in admin, with a draft and a test as prompts have (ADR 0182); each proposal group has one form; and the assistant's working order is recorded in its prompt and here: understand the material, restate the user's requirements and the plan, ask only what is unclear, build, then revise single groups on request. The PM's brief adds: the forms are exactly what the card validator accepts, and one added to it without a skill fails a test; MCP's `knowno://guide/card-forms` keeps working; the admin functions are built here and the admin pages later; the new prompt is a draft, not active.
- **What existed.** `_shared/guide.ts` held one text, MCP's only resource (ADR 0144), naming each block type with an example; the assistant never read it. ADR 0190 let a group's format be a 칸 type every card holds, other blocks beside it allowed, or `mixed`, which took any card; `propose_changes` made one `mixed` group.
- **A card's form.** The validator, `_shared/input.ts`, takes five block types, `text`, `senses`, `cloze`, `table` and `image`, in any combination. A text block accompanies the others as their name or their back: the guide's own examples are a text front naming a table and a photo with a text back.
- **Alternatives considered:**
  - **Every guide in the system prompt.** Six guides with examples are thousands of tokens on every call of every message, charged against the budget (ADR 0195), for forms most messages never use. Rejected: the index, a line a form, is always sent, and a guide is loaded with a tool when the material calls for it.
  - **The skills in code**, as `guide.ts` was. Tuning a guide would need a deploy. Rejected: versions in the database, as the prompts are.
  - **A form per block type, a text beside another type making the card mixed.** A picture with its text back, or a table with its name, the forms' plainest cards, would be mixed. Rejected: a text block takes the form of what it accompanies.
  - **Leaving the group's format a declaration.** The model could still put a word and a sentence in one `mixed` group. Rejected: a card's form is computed from its blocks and must equal its group's.
  - **The skills' labels on a configuration**, as the assistant's prompt rides on a plan's configuration. The skills serve MCP too, which has no configuration, and are one text a form for every plan. Rejected: each form has its own `active` and `test` labels, as ADR 0073's prompt labels were.

## Decision

- **The forms** are each block type the validator accepts and `mixed`. A card's form is the one type it holds besides text: `text` when it holds text alone, `mixed` when it holds two or more others; a type no form names, a kept sound, accompanies as text does. The validator's types are one exported list its reader matches exhaustively, so a type cannot be read without being in it, and each form's seed is a record over the forms, so a form cannot be added without one.
- **A skill** is a form's one-line summary of when it fits and its guide: rules, a good and a bad example, and edge cases.
- **Versions in the database.** Each save is an append-only version of a form's skill. Each form has an `active` version, served to everyone, and while one is set a `test` version, served to admins. An admin saves a version, which becomes the form's test, applies the test to everyone, or ends it; each is recorded. The first version of each is seeded active.
- **One reader.** `card_form_skills()`, called with the caller's token, answers each form's version served to that caller. The assistant and MCP read it through `_shared/card_forms.ts`, which keeps a caller's answer 60 s and fails, rather than serving a gap, when a form has no version.
- **The assistant** adds the index after its prompt, each form with its summary, and offers `read_card_form(form)`, which answers the guide. It reads the skills before a message starts, so a message whose skills cannot be read is refused `unavailable`, unrecorded.
- **MCP** serves the index at `knowno://guide/card-forms`, each form linked to its guide at `knowno://guide/card-forms/<form>`, and each guide there: the same rows as the assistant reads.
- **One form a group.** Every card of a proposal group takes the group's form; a call holding a card of another form is refused whole, showing nothing, with a sentence naming each such card, its group and both forms. `propose_changes` takes groups as the other proposal tools do.
- **The working order** is the assistant's prompt v2: understand the material and build what the user asks from it, not a copy of it; restate the requests and the plan; ask only what is unclear; build, reading each form's guide; revise one group on request. It is each plan's draft, beside its unchanged active configuration, until an admin applies it.

## Consequences

- The owner tunes a form's guide in the database, tried by admins before it serves everyone, with no deploy; the admin pages that do it are a later pull request, the functions being here.
- Every message pays for the index, a few hundred tokens, and a guide's tokens only when the model reads one.
- A message and an MCP resource read now depend on one more database read, kept 60 s a caller; a version saved reaches a caller within that minute.
- A proposal mixing forms costs the model a second call to fix it, which ADR 0190's per-card refusal did not.
- A `mixed` group no longer takes any card, and a card of one form with a text block beside it is that form; ADR 0190's group format is superseded.
- A form added to the validator needs its seed in code and a migration seeding its version; the type checker and the seed's test refuse it otherwise.
- The prompt's working order serves a plan only once an admin applies its draft; until then the assistant runs v1 with the index and the tool beside it.

## Signs the decision was wrong

- Proposals still mix forms in practice, a word list made cloze or a table made text cards, with the index and the guides served: the guidance needs to be in the prompt itself, or the form chosen by code from the material.
- The model rarely calls `read_card_form` and its cards break the guides' rules, while a guide's tokens in every call would have cost less than the retries: the guides belong in the system prompt.
- Owners want a guide per plan or per subject rather than one a form: the labels belong on a configuration.
- Real cards keep needing two forms on one card, the mixed group growing to a catch-all again: the forms are cut too fine.
