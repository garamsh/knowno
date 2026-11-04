# ADR 0196: Add a seventh admin section, 말랑이, for the assistant's configuration, prompts and token budget, beside AI

> Status: accepted
> Date: 2026-11-05

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #713**, the owner of 2026-11-04: he wants to try 말랑이's model and prompt from admin himself. ADR 0190 put the admin pages for the assistant's configuration in #713's next pull request; ADR 0195 replaced the daily message limit with a daily token budget per plan, set through `admin_set_assistant_token_budget`, and added the route that saves a draft after a check call.
- **ADR 0178** gave the admin host six sections, one per job: 처리할 일, 사용자, 노트, AI, 요금제 and 관리자. AI is the photo's configuration alone (ADR 0182).
- The assistant's configuration is its own tables, prompts and labels (ADR 0190): a plan's assistant draft and its photo draft are tried and applied apart, and an assistant prompt never serves a photo.
- **Alternatives considered:**
  - **The assistant inside AI**, as a second view under a switch. AI's page already holds the plans' table, the panel with its trial, the keys, the prompt versions and the results; a switch would double each part's address and leave the results, the trial and the cost with nothing to show for the assistant. Rejected: one section per job, as ADR 0155 and ADR 0178 hold.
  - **The token budget on 요금제**, beside each plan's photo terms. 요금제's terms are versions with a start and a favour rule (ADR 0097), and the budget is one number per plan applied from the next message. Rejected: it sits with the configuration it meters.

## Decision

- **A seventh section, 말랑이** (`/assistant`), after AI in "관리 메뉴", current on `/assistant` alone.
- It holds, laid out as AI:
  - each plan's active assistant configuration (provider, model, prompt version, web search with its searches a message, reasoning effort) and daily token budget, with its draft;
  - the chosen plan's panel: what the draft changes, the prompts' line diff, 테스트 끝내기 and 모두에게 적용, and the new draft's form, saved through the assistant's `settings/configuration` route after its check call;
  - the plan's daily token budget with its form, a number of tokens or 제한 없음, set through `admin_set_assistant_token_budget` and recorded;
  - the assistant's prompt versions and the new version's form.
- Provider keys stay on AI, which both configurations use.

This changes ADR 0178's six sections to seven; the rest of it stands.

## Consequences

- The menu holds seven links, at 390 px in the full-screen menu as well.
- An operator changes the photo's and the assistant's configurations in two places, each with its own draft.
- A key the assistant's draft needs is saved on AI.

## Signs the decision was wrong

- Operators keep changing the photo's and the assistant's configuration together, so one place for both would have served them.
- The menu grows past what fits beside the page from 1024 px, so sections need grouping.
