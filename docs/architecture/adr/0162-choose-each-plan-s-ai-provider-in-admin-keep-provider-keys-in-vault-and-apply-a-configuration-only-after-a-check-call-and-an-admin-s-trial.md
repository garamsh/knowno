# ADR 0162: Choose each plan's AI provider in admin, keep provider keys in Vault, and apply a configuration only after a check call and an admin's trial

> Status: accepted
> Date: 2026-11-03

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #598**: the owner asked to choose the AI provider per plan in the admin area: OpenRouter, or OpenAI or Anthropic directly. The issue's comments of 2026-11-03 revise its body, and the later comment wins:
  - provider keys live in Supabase Vault only, are managed from the admin area, and are write-only there;
  - a provider and model change goes through three steps, as a prompt version does ([ADR 0073](0073-keep-the-extraction-prompt-as-append-only-versions-in-the-database-served-by-an-active-and-an-admin-only-test-label-and-record-what-served-each-call.md)): 저장 runs one real call, the saved draft serves admins only for 사진 한 장으로 시험, and 모두에게 적용 makes it live;
  - the automatic fallback provider of an earlier comment is dropped;
  - with no usable configuration, photo import shows an unavailable state and the rest of the app works;
  - `OPENROUTER_API_KEY` is read from secrets only as a transition, until an OpenRouter key exists in Vault.
- **Before this change:**
  - every call went to OpenRouter with the `OPENROUTER_API_KEY` secret;
  - each plan version held a model ([ADR 0097](0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md)), checked on save against OpenRouter's public model list ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)).
- **Vault's cost.** The owner asked whether Vault adds cost; the owner is on Supabase Pro. What the docs say:
  - Supabase's Vault guide (`supabase.com/docs/guides/database/vault`, read 2026-11-03) describes Vault as secrets stored encrypted in a table of the database, read through the `vault.decrypted_secrets` view. It names no price.
  - Supabase's billing page (`supabase.com/docs/guides/platform/billing-on-supabase`, read 2026-11-03) lists every usage item it charges: egress, database size, monthly active users (three kinds), storage size, image transformations, Edge Function invocations and Realtime messages and connections. It also lists compute, custom domains and the project add-ons. Vault and extensions are not among them.
  - Supabase's "Vault is now in beta" post (`supabase.com/blog/vault-now-in-beta`) states, in its note of June 2023: "Supabase Vault is now available on every Supabase project."
  - A key therefore costs only its row's database size, a few hundred bytes against Pro's 8 GB included.
- **Alternatives considered:**
  - **A fallback provider chosen in the admin area.** Dropped by the owner's later comment, which asks for a check before each change instead.
  - **Keys in Edge Function secrets.** These can only be set by hand on the project, so the admin area could not manage them, and it would never be clear which key is in use. Rejected by the owner.
  - **Checking a key in the web's Server Action.** The action holds the key, but the check needs the function's adapters, schema and output contract, and a save the web may make is a save an admin could make without any check. Rejected: the function checks the key and saves it through a `service_role`-only function.
  - **Keeping the model on the plan version beside the configuration.** That leaves two models for one plan. Rejected: the column is dropped, losslessly.

## Decision

- **Providers.** `extract-cards` calls OpenRouter's or OpenAI's chat completions, or Anthropic's messages, through one adapter per provider in `providers.ts`. Each adapter sends the image, the instructions and the strict JSON schema, leaving out the schema keywords that provider refuses; the parser still enforces them. The call itself, with its timeout, is shared (`model.ts`). The eval stays on OpenRouter.
- **Configurations.** `private.ai_configurations` holds append-only configurations, each a plan's provider and model. `private.ai_configuration_labels` names each plan's `active` configuration and its `test` draft.
  - `begin_extraction` serves an admin the draft while one is set, or the configuration an admin's trial names. Everyone else gets the active one.
  - It records the provider on the call record.
  - It counts no photo whose provider has no key.
- **The three steps.**
  1. **저장.** `extract-cards/settings/configuration` makes one call with the provider's key in use, the model, a 64 by 32 PNG, the output contract and the strict schema. The draft is saved only when the reply parses as the contract's envelope. The answer names what failed: `key_refused`, `model_not_found`, `no_image_input`, `bad_output` or `call_failed`.
  2. **The trial.** 사진 한 장으로 시험 reads one photo with the draft and with the active configuration at once, side by side, each with the prompt an admin is served.
  3. **모두에게 적용.** It makes the draft active. It is refused while the draft's provider has no key.
  - Each step is recorded in `private.admin_audit`.
- **Keys.**
  - **Storage.** A key is a secret in Vault. `private.provider_keys` holds its Vault id, its last four characters, and who set it and when.
  - **Reading.** Only `public.provider_key`, executable by `service_role` alone, returns a key decrypted. The function reads it through that, keeping each answer in memory for 60 s.
  - **Saving.** A key is saved through `extract-cards/settings/key`, only after the same check call with it parsed, by `public.save_provider_key`, `service_role` only. A key in use is therefore never replaced by one that fails.
  - **Removing.** A key is removed by `admin_remove_provider_key`. It is refused while an active configuration uses the provider.
  - **Recent sign-in.** Saving and removing a key require a sign-in within 10 minutes, read from the access token's `amr` times. A token refresh does not move them.
  - **Never shown.** A key appears in no log, error, answer or audit row, and the admin area shows only its last four characters.
- **The transition.** While Vault holds no OpenRouter key, the function serves OpenRouter with `OPENROUTER_API_KEY`, the only provider key it reads from its secrets. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are never read. The sequence that ends the transition:
  1. The owner saves an OpenRouter key in 설정 → AI 제공자.
  2. The PM confirms that extraction works on it.
  3. A follow-up pull request deletes the fallback: `Config.openRouterSecret`, the `secret_providers` argument of `begin_extraction`, and OpenRouter's exception in `admin_activate_ai_configuration`.
  4. The owner then removes the secret.
- **Unavailable.** A photo whose provider has no key is answered `503 {"error": "unavailable"}`, uncounted. Both clients show "지금은 사진으로 카드를 만들 수 없어요. 직접 입력이나 엑셀·CSV로 추가해 주세요." with no retry or retake. Everything else in the app works unchanged.
- **The plan's model.**
  - The migration copies every version's model into `private.plan_versions_models_before_ai`, then seeds each plan's active configuration with its current version's model on OpenRouter, so the deploy serves what was served before.
  - It then drops `plan_versions.model`, `admin_create_plan_version`'s `model` argument and `in_favour`'s same-model rule. The web's check against OpenRouter's model list goes with them.
  - It drops `private.migrate_plan_versions`, which ran once and writes the model.
  - **Revert.** Re-add the column, fill it from the backup, give a version created since then its plan's active model, and restore the functions from their earlier migrations. The steps are written in the migration's header.
- **Local and CI** run with no key through fake providers; no test calls a paid API.

This supersedes ADR 0071's model check against OpenRouter's list on save, ADR 0097's model on each version and the in-favour rule's "same model", and the OpenRouter-only call of ADR 0013 as amended since.

## Consequences

- An admin moves a plan between providers without a deploy or a secret, and no change reaches users before it has read a real call and an admin's trial.
- A plan's terms and its model now change separately: a new version changes only the quota and the amount.
- A user on an older version than its plan's current one is served the current version's model after the deploy, since a plan has one model. Where production's versions of one plan name different models, this changes some users' model. The PM checks for that before merging.
- A direct provider reports no cost, so 처리할 일 prices its photos by the eval's measured cost for the model id, or counts them apart while none is measured.
- Each check costs one small paid call to the provider.
- A key reaches PostgREST as a function argument. PostgREST sends it as a bound parameter, so a statement log does not hold it unless the project logs parameters.

## Signs the decision was wrong

- A model passes the check call but reads real pages badly, and the trial does not catch it often enough, so the check should run the eval's samples.
- An admin needs a provider with a request form the adapters cannot express, such as a Vertex or Bedrock project.
- The transition's fallback is still in the code months after the owner saved the OpenRouter key.
- A configuration's draft and its plan's version must change together, which the separate steps make awkward.
