# ADR 0080: Ask prompt v9 to name the rule on every card under it, and save it as a version an admin activates after the PM's two eval runs

> Status: accepted; its owner approval of a cost change or a migration superseded by ADR-0246
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #261:** on the dense grammar pages, samples 33 to 36, the mean coverage varies between eval runs of one prompt: v7 84.5 and 91.7, v8 75.0 and 79.8. The notes rules are identical across these versions (#260).
- **The misses**, traced on #260 from the PM's v8 run's replies:
  - On three of the four pages, the contraction lines missed because their cards did not name the rule, 축약. They came back as a cloze front "ㅗ+ㅏ -> ___" or a concept front "ㅗ+ㅏ -> ㅘ", or were dropped.
  - The rest were misreads of harsh or handwritten pages.
  - [ADR 0069](0069-ask-prompt-v7-for-whole-table-and-cloze-cards-as-structured-fields-exception-cards-that-state-what-they-do-and-examples-only-from-the-page.md) records the same weakness on v7's first run.
- **The sub-points rule**, which prompts v7 and v8 hold, asks that a card under a point name its rule, such as "비음화: ㄱ+ㄴ → ㅇ+ㄴ". Its one example is a concept card, and the misses were cloze cards as often as concept cards.
- **The prompt store.** Since [ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md), the function serves the version an admin activates in the admin area, and version 1 is seeded from `prompt_v8.ts`. `prompt_seed_test.ts` holds the seed to that file, and the user turn lives there.
- **The issue's acceptance:**
  - the PM runs the eval twice on the new prompt, and the dense mean is 85 or more in both runs;
  - the typical notes pages, the vocabulary scores, the labels and the unprinted labels (0) do not fall;
  - the cost per photo does not rise by more than 10%, or the owner approves.
- Alternatives considered:
  - **A metric that credits a card under a rule's heading by its topic.** It would raise the score without making a card readable alone, which is what the rule's name gives the learner.
  - **A seed migration that inserts v9 as version 2 and activates it.** Merging would then serve v9 to every user before the PM's runs. A migration that changes what users are served would also wait for the owner's approval, as changing data does.
  - **Replacing `prompt_v8.ts` with v9.** The seed test and the user turn need v8's file, and v8 is what users are served until an admin activates v9.

## Decision

- **Prompt v9** (`supabase/functions/extract-cards/prompt_v9.ts`) is prompt v8 with one notes rule added after the sub-points rule:
  - when the page lists cases, members, conditions or variants under a named rule or heading, every card made from them holds that name in its front or its answer;
  - this holds for a concept, cloze or identify card alike;
  - for example, the cloze front "축약: ㅗ+ㅏ -> ___" or the front "축약: ㅗ+ㅏ -> ㅘ", never "ㅗ+ㅏ -> ___" alone.
  - Every other line is v8's, unchanged. v9 is 11,838 characters against v8's 11,373, within the store's 20,000.
- **Files.** `prompt_v8.ts` stays as the seed's source and the home of the user turn. `prompt_v9.ts` holds only the version and the system prompt.
- **The eval** runs v9 by default, and the ledger and the report name it "prompt v9".
- **How v9 reaches users:**
  1. the PM runs the eval twice on v9 and checks the issue's acceptance;
  2. an admin saves `prompt_v9.ts`'s `SYSTEM_PROMPT` as a new version in the admin area's 프롬프트 page, with the note "prompt v9 (#261)";
  3. the admin marks it "관리자만 테스트" and tries it on a photo of a dense page;
  4. the admin activates it with "모든 사용자에게 적용".
  - Nothing is served differently on merge, and rolling back is activating version 1 again.

## Consequences

- A contraction or other sub-point card reads alone with its rule's name, and the coverage metric, which reads a card's front and answer, credits it.
- Fronts under a rule grow by the rule's name. The prompt grows by 465 characters, 503 bytes, so at most 503 input tokens. On Claude Haiku 5.5's $0.1000 per million prompt tokens, that is at most $0.00005 a photo, about 2% of v8's measured $0.0022. Longer fronts add output tokens too; the PM's runs measure the whole.
- A merged prompt file is no longer what users are served until an admin activates it. `ai-extraction.md` says which version is served and which file the eval measures.
- `prompt_v8.ts` and `prompt_v9.ts` hold two near-identical texts. `prompt_v9_test.ts` fails when v9 differs from v8 by anything but its new line.

## Signs the decision was wrong

- In either of the PM's runs, the dense mean stays below 85, or the contraction lines still miss for want of the rule's name.
- Fronts grow long enough that the study card shrinks them to their floor, or cards of other pages gain a heading's name they do not need.
- The typical notes pages, the vocabulary scores or the labels fall, or unprinted labels rise above 0.

## Note, 2026-10-19: how prompt v9 was activated

- The PM ran the eval twice on v9, and the dense grammar pages' mean was 89.3 and 90.5, over the issue's 85.
- The owner delegated the activation to the PM. The PM cannot sign in to the admin area, so steps 2 to 4 of the Decision did not run there, and the "관리자만 테스트" try was not made.
- In their place, migration `20261019230003_activate_prompt_v9.sql` does what the admin area's save and activation do:
  - it saves `prompt_v9.ts`'s `SYSTEM_PROMPT` as version 2, with the note "prompt v9 (#261, #266), PM eval 2026-10-19: dense 89.3/90.5";
  - it points the `active` label at version 2;
  - it records `activate_prompt` in the audit log, as `migration (owner delegated to PM, 2026-10-19)`.
- It appends a version and changes none, so rolling back is still activating version 1 in the admin area. `prompt_v9_activation_test.sql` tests both.
