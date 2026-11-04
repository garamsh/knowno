# ADR 0182: Make each plan's AI configuration its provider, model and prompt version, with one draft tried and applied as a unit in one admin AI section

> Status: accepted
> Date: 2026-11-04

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #650**, the owner of 2026-11-03: "사진 ai 와 설정의 ai 부분이 있는것처럼 관리가 묶이지 않고 흩어져 있잖아. 이건 잘못된거야." The issue's PM decisions: a configuration is provider, model and prompt version, per plan; a plan's draft changes any of the three; "사진 한 장으로 시험" runs the draft beside the active configuration, "관리자만 테스트" serves the draft to admins, "모두에게 적용" makes it active; prompt versions stay append-only and a configuration names one; one admin section, AI, as the approved mockup's section 5.
- **The PM's decision of 2026-11-04 on the issue**: one draft per plan, holding provider, model and prompt together. A prompt under test goes into each plan's draft, merged with any provider or model change already drafted there, not into a draft of its own.
- **Before this change** there were two draft flows:
  - the prompt: `private.prompt_labels`, one global `active` and `test` ([ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md)), set on 사진 AI's version pages;
  - the provider and model: `private.ai_configuration_labels`, an `active` and a `test` per plan over append-only `private.ai_configurations` ([ADR 0162](0162-choose-each-plan-s-ai-provider-in-admin-keep-provider-keys-in-vault-and-apply-a-configuration-only-after-a-check-call-and-an-admin-s-trial.md)), set on 설정's AI 제공자;
  - `begin_extraction` read the two separately, so an admin was served the test prompt and the plan's draft together while each could be applied apart.
- **Production**, as the dispatch of #650 states it: every plan's active configuration is OpenRouter's `anthropic/claude-haiku-5.5`; provider keys are in Vault.
- **Alternatives considered:**
  - **A separate draft per plan for a prompt under test** (W102's open question). Rejected by the PM: a plan would hold two drafts, so "applied as a unit" would not hold.
  - **Filling `prompt_version_id` on the existing configurations.** Configurations are append-only and a call record names what served it; giving an old row a prompt it never held rewrites that. Rejected: the move appends a configuration per label.
  - **Keeping the global labels beside the configurations for the deploy window.** A write to them from the earlier admin web would then succeed and serve nothing. Rejected: they are renamed into the backup, and the earlier web's prompt actions fail visibly until the new web is live.
  - **A configuration id on each call record.** The provider, model and prompt version each call records already name the configuration's content, and the results per configuration read them, older calls included. Rejected as a column nothing needs.

## Decision

- **A configuration** is a row of `private.ai_configurations` with the plan, provider, model and `prompt_version_id`, append-only as before. `begin_extraction` takes the prompt from the configuration serving the photo, as it takes the provider and the model, and records all three on the call. Its signature and columns are unchanged.
- **One draft per plan.** A plan's `test` label is its draft. `save_ai_configuration(admin_id, plan, provider, model, prompt_version_id default null)` replaces it, after extract-cards' check call on the provider and model; without a version it keeps the draft's, or else the active one's. extract-cards' `settings/configuration` takes an optional `prompt_version_id`.
- **The flow.** 저장 saves the draft, which serves admins (관리자만 테스트); 사진 한 장으로 시험 reads one photo with the draft and the active configuration side by side, each with its own prompt; 모두에게 적용 makes the three active together; 테스트 끝내기 clears the draft. A new prompt version is saved, serves no one, and reaches a plan only through its draft.
- **The global labels go.** `admin_set_prompt_label`, `admin_clear_test_prompt` and `admin_prompt_labels` are dropped. A version's labels read `active` while some plan's active configuration sends it and `test` while some plan's draft does.
- **The results** read per provider, model and prompt version over 1 to 90 UTC days through `admin_configuration_results`.
- **The admin section AI** (`/ai`) holds all of it, as the mockup's section 5: the plans' active configurations with cost and 7-day failure rate, the selected plan's draft panel with the trial, apply and end, provider keys, prompt versions, and results per configuration over 30 days. `/ai/[id]`, `/ai/new` and `/settings/ai` are removed.
- **The migration** `20261104021846_configuration_prompts.sql` changes existing data, so it merges after the owner approves it:
  - for each plan, it appends the active configuration's provider and model with the active prompt version and points the `active` label at it;
  - while the plan has a draft or a test version was set, it appends a draft: the draft's provider and model, or else the active ones, with the test version, or else the active one;
  - everyone is served what they were served before;
  - every label row is kept in `private.ai_configuration_labels_before_prompts`, and the global labels, renamed, in `private.prompt_labels_before_configurations`;
  - `private.revert_configuration_prompts()` renames the labels back and restores `begin_extraction` and the three prompt functions as they were.

This supersedes ADR 0073's global `active` and `test` labels, the admin functions that set them, and the trial served the admin's test version; and ADR 0162's configuration as a provider and model alone, its prompt served apart, and its settings page under 설정.

## Consequences

- A prompt change reaches a plan's users only through that plan's draft. Testing one version on several plans means saving it in each plan's draft.
- Plans can now send different prompt versions; the eval still names the version it measured.
- Between the migration and the new web going live, the earlier web's 처리할 일 and AI pages fail on the dropped functions; the earlier extract-cards bundle keeps working on the new schema.
- A prompt applied after the migration is not carried by the revert, which puts back the global labels as they were.

## Signs the decision was wrong

- Operators keep saving the same version into every plan's draft one by one, so a version applied across plans at once earns a place.
- A draft that changes only the prompt pays a check call it does not need often enough to matter.
- A plan's results mix calls from configurations that share a provider, model and version but differ in plan, and the owner needs them apart.
