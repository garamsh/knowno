# ADR 0212: Edit the card-form skills in admin as a part of 말랑이, each form a draft tried by admins and applied on its own

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- #751 asks that the owner edit each card form's skill, a one-line summary and a guide, as a versioned draft, try it and apply it without a deploy, as the prompts are. The server side is ADR 0197's: `admin_card_form_skills` lists every version with its labels, `admin_save_card_form_skill` saves one and makes it the form's `test` label, `admin_activate_card_form_skill` makes the test version `active` and clears the test, and `admin_clear_card_form_skill_test` ends it. `card_form_skills()` serves an admin a form's test version while one is set, and everyone else the active one, to the assistant and to MCP alike.
- "Try it" for a prompt is its draft: admins are served it. AI's section adds a trial that runs the photo function on a photo; 말랑이 has none, since the assistant has no route that answers one message with a configuration named (ADR 0196). A skill has the draft and no route to try it by: the admin tries it in 말랑이's chat, or through MCP, which both serve him the test version.
- `web-admin.md`'s sections are one per job (ADR 0155, ADR 0178, ADR 0196). A skill is not a plan's configuration: it is applied per form, not per plan, with its own labels, and MCP reads it too.
- **Alternatives considered:**
  - **An eighth section for the skills.** The job is the assistant's behaviour, which 말랑이 holds: its configuration, its prompt versions and its budget. A section would put a form's guide away from the prompt that tells the assistant to read it (prompt v2's working order), and cost a menu link, at 390 px in the full-screen menu too. Rejected; the skills are read by MCP as well, which has no admin page of its own, so 말랑이 is the nearest.
  - **A skill as a prompt-like version nobody serves until a configuration names it.** The server applies a skill by form, with no plan, so there is nothing for a plan's draft to name. Rejected.

## Decision

- **A part of 말랑이**, laid out as its prompt versions are, not a section. 말랑이's address takes `skill=<form>` and `from=<version>`; the menu, `aria-current` and the redirects are as before.
- **"카드 형식 스킬"**, beside "프롬프트 버전": each form, in the chat's order and words (글, 단어, 빈칸 문장, 표, 사진, 섞어서), with the version in use and its summary, and a chip while a draft is set. Each opens that form's panel above the plan's.
- **The form's panel**, as a plan's: its draft against the version in use, the summary and the lines of the guide it changes, collapsed; 테스트 끝내기 and 모두에게 적용, each asked first, the panel's one primary; the form "새 버전", a summary of one line of at most 300 characters, a guide of at most 20,000 and a note of at most 200, starting from the version `from` names, else the draft, else the one in use; and the form's versions, newest first, each opening the form from it.
- **Saving makes the draft.** 초안으로 저장 saves the version and sets it as the form's test version, as the server does, replacing a draft already there, and returns to the form's panel. Nothing is served to a user who is not an admin until 모두에게 적용. A browser submits a textarea's line breaks as CRLF, which would make every line of the diff a change, so the action stores them as LF.
- **The limits are checked before the call**, as the prompts' are, and the server's again: a form is one of the six, read at the boundary, so an address or a request naming another reaches no function.
- **The audit log** names the three actions and links a form's entry to its panel.
- **No migration and no new server function**: the pages use the four ADR 0197 added.

## Consequences

- The page holds a third list beside the prompts' and the plans'; 말랑이 is longer. The form's panel opens only on request.
- An admin tries a draft in his own chat or in MCP: there is no one-message trial, and the draft is served to every admin until it is applied or ended, as a plan's draft is.
- A prompt version saved from the form has CRLF in the same way the prompts' do; that is the prompts' own and unchanged here.

## Signs the decision was wrong

- 말랑이's page is hard to use for its length: skills need an address of their own, as a section or a page under 말랑이.
- Operators want a skill tried on one message with no chat: the assistant needs a route that answers a message with a draft named, as the photo function has.
- MCP's operators tune a skill without the assistant in mind often: a section named for the card forms, not 말랑이.
