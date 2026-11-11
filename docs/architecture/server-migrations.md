# Server data migrations

The data migrations of stored rows that reach production with the schema: of vocabulary backs to senses blocks, of the plans to versions, of 무제한 grants to 스페셜, of the prompt labels into each plan's AI configuration and of every card's template and frame, each with its backup and revert.

## Current decisions

### Senses migration

- Migration `20261019180003_senses_migration.sql` turns each live card whose back is one text block of sense lines, such as `[명] 사과`, into a back of one `senses` block ([`deck.md`](deck.md), [ADR 0075](adr/0075-store-a-vocabulary-card-s-senses-as-a-typed-block-and-show-each-label-in-brackets-before-its-meaning.md), #228). It changes existing data; the owner approved it for the 105 cards the dry run found on production, and #255's dry run merges before it.
- The rules are functions in `private`: `sense_labels` holds the labels and the part of speech each names, `sense_forms` the four forms and their order, `sense_line` a line's first matching form, and `senses_block` the block a back becomes, or null when it does not convert.
- `private.migrate_senses()` converts, and the migration calls it once.
  - It locks each card it converts and first copies the card's back into `private.senses_migration_backup` (`card_id`, `back`, `migrated_at`). That table enables row-level security with no policy and grants nothing to `anon` or `authenticated`, so no client reads it. A row goes with its card's delete.
  - A second run converts nothing, since a senses block is no text block, and a backed-up card keeps its first backup.
- **How it reaches devices.** The update draws a new `revision` through the trigger, so every device pulls the card. The card keeps its `updated_at`:
  - a device holding the card synced takes the server's copy on the tie;
  - a device with an edit not yet pushed holds a later `updated_at`, so its edit wins the merge and is pushed over the migration's ([`sync.md`](sync.md) §Conflicts).
  - No front, card key, review or card state changes.
- **Revert.** `select private.revert_senses_migration();`, run by the PM against production, restores each backed-up back on a live card that still holds the block the migration wrote, and returns how many. A card edited since keeps its edit. It also draws new revisions and keeps `updated_at`.
- Every function revokes `execute` from `public`, `anon` and `authenticated`, and runs as `security invoker`: only the migration and the PM call them.

### Plan versions migration

- Migration `20261026005136_plan_versions.sql` moves the plans to versions ([ADR 0097](adr/0097-give-each-plan-versions-of-its-terms-with-a-start-free-10-a-month-pro-100-a-day-and-max-unlimited-to-1000-a-day-each-grant-taking-the-latest-at-its-monthly-renewal.md), #341). It changes existing data; the owner delegated its sign-off to the PM on 2026-10-26.
- `private.migrate_plan_versions()` converts, and the migration calls it once:
  - each plan of the settings before without a version gets them as its first version, `daily`, from when they were last set, Special's as Max's;
  - the owner's terms follow as a second version from the migration on the first's model, applying to all where they are in the users' favour, and recorded in the audit log as `migration (owner delegated to PM, 2026-10-26)`: Free `monthly` 10, at each user's renewal; Pro `daily` 100, none where its first version already is; Max `unlimited` 1,000;
  - each grant of the backup whose user has no versioned grant points at its plan's first version, Special's as Max, keeping its end, granter and time;
  - each `extraction_calls` row of `special` becomes `max`.
  - A second run changes nothing.
- **Backups.** `private.plans` is kept verbatim, renamed `private.plans_before_versions`; the grants are copied into `private.user_plans_before_versions`; the converted calls' ids are kept in `private.extraction_calls_before_versions`. Each enables row-level security with no policy and grants nothing to a client role.
- **Usage carried.** No count is reset: each period counts every photo recorded since its start. Existing Free users stay on their first version, 30 a day, until the 1st of next month; Pro's and Max's days count from 00:00 in Seoul.
- **Revert.** `select private.revert_plan_versions();`, run by the PM against production, adds for each plan a `daily` version of its settings before, from then, applying to all, Special's as Max's, each recorded, and returns how many. Max keeps its name; a return to the tables before is a later migration from the backups.
- The functions revoke `execute` from `public`, `anon` and `authenticated`, and run as `security invoker`: the migration, the PM and the `security definer` functions above call them.
- **Deploy.** Between the migration and the function's deploy, each reads the other's row as malformed and answers `500`.

### Special plan migration

- Migration `20261103143442_special_plan.sql` makes unlimited use the plan 스페셜 ([ADR 0177](adr/0177-make-unlimited-use-the-plan-special-that-no-user-sees-put-every-admin-on-it-and-move-each-unlimited-grant-onto-it.md), #649). It changes existing data, so it merges only after the owner approves it ([`server.md`](server.md) §Location and migrations, "Gate").
- It widens the plan checks to `special` and the quota check to `none`, and gives 스페셜 one version, `none` from the migration.
- `private.migrate_special_plan()` seeds and moves, and the migration calls it once:
  - while 스페셜 has no active AI configuration, it gives it a copy of Max's active one;
  - each 무제한 grant that has not ended becomes a 스페셜 grant in `private.user_plans` with its end, granter and time, on 스페셜's version;
  - the Pro or Max grant it replaces is first kept in `private.user_plans_before_special`;
  - a grant that had already ended is not moved, so its user keeps its plan;
  - a second run straight after changes nothing.
- **Backups.** Every 무제한 grant, ended or not, is kept in `private.unlimited_grants_before_special`, and every grant replaced in `private.user_plans_before_special`. Each enables row-level security with no policy and grants nothing to a client role, and a row goes with its user.
- It then drops `private.unlimited_grants`, `admin_user_unlimited`, `admin_grant_unlimited` and `admin_revoke_unlimited`, and replaces `private.unlimited`, `private.entitlement_of` and `admin_grant_plan` with their signatures unchanged. `begin_extraction` and `extraction_allowance` are not replaced.
- **Consequence.** A user holds one grant, so a 스페셜 grant that ends leaves its holder on Free, not on the Pro or Max it replaced. A holder's model becomes 스페셜's.
- **Revert.** `select private.revert_special_plan();`, run once by the PM against production, as the migration's header states:
  - it recreates `private.unlimited_grants` and its three admin functions, and restores `private.unlimited`, `private.entitlement_of` and `admin_grant_plan` as the migrations before left them;
  - each 스페셜 grant still standing, from the migration or given since, becomes a 무제한 grant with its end, granter and time, and each backed-up 무제한 grant that has ended comes back; a backed-up one not ended whose user no longer holds 스페셜 does not;
  - the 스페셜 grants go and each grant they replaced comes back, unless the user holds a grant set since, which stands;
  - 스페셜's labels go and its calls in `private.extraction_calls` become Max's, their ids kept in `private.extraction_calls_before_special_revert`, since a web from before refuses a plan it does not know in the AI settings and the photo breakdown;
  - 스페셜's versions go and the checks narrow back. Its configurations are append-only, so they and their plan check stay, with no label pointing at them.
- `private.migrate_special_plan()` and `private.revert_special_plan()` revoke `execute` from `public`, `anon` and `authenticated`, and run as `security invoker`: only the migration and the PM call them.

### Configuration prompts migration

- Migration `20261104021846_configuration_prompts.sql` makes each plan's AI configuration hold its prompt version ([ADR 0182](adr/0182-make-each-plan-s-ai-configuration-its-provider-model-and-prompt-version-with-one-draft-tried-and-applied-as-a-unit-in-one-admin-ai-section.md), #650). It changes existing data, so it merges only after the owner approves it ([`server.md`](server.md) §Location and migrations, "Gate").
- It adds `private.ai_configurations.prompt_version_id`, and `private.migrate_configuration_prompts()` moves, the migration calling it once:
  - for each plan whose active configuration has no version, it appends that configuration's provider and model with the active version of `private.prompt_labels` and points the `active` label at it;
  - while the plan had a draft or a test version was set, it appends a draft, the draft's provider and model or else the active ones, with the test version or else the active one, and points the `test` label at it, keeping who set the label and when, a new one taking the test version's;
  - so everyone is served what they were served before;
  - with no active version it raises and the migration fails; a second run straight after changes nothing.
- **Backups.** Every label row as it was is kept in `private.ai_configuration_labels_before_prompts`, and `private.prompt_labels` is renamed `private.prompt_labels_before_configurations`, unchanged. The first enables row-level security with no policy and grants nothing to a client role.
- It replaces `begin_extraction` with its signature and columns unchanged, `save_ai_configuration` with a defaulted `prompt_version_id`, `admin_ai_configurations` with the version, `admin_activate_ai_configuration`, `admin_prompt_versions` and `admin_prompt_version` without the active text; drops `admin_prompt_labels`, `admin_set_prompt_label` and `admin_clear_test_prompt`; and adds `admin_configuration_results`.
- **Deploy.** The `extract-cards` bundle from before works on the new schema: `begin_extraction` answers the same columns, and its call naming the provider and model alone resolves to `save_ai_configuration`'s default. A bundle from after, before the migration applies, answers a draft saved with a version `500`. The admin web from before fails on its AI pages and 처리할 일 until the new one is live.
- **Revert.** `select private.revert_configuration_prompts();`, run once by the PM against production, as the migration's header states:
  - it renames `private.prompt_labels_before_configurations` back to `private.prompt_labels`, so the global labels are as they were; a version applied since through a configuration is not carried;
  - it restores `begin_extraction` reading the prompt from those labels, and `admin_prompt_versions`, `admin_prompt_version`, `admin_set_prompt_label`, `admin_clear_test_prompt` and `admin_prompt_labels`, as the migrations before left them;
  - the labels keep their configurations, whose provider and model the earlier `begin_extraction` reads; the column, `save_ai_configuration`'s default, `admin_ai_configurations`' version, `admin_configuration_results` and the label backup stay.
- `private.migrate_configuration_prompts()` and `private.revert_configuration_prompts()` revoke `execute` from `public`, `anon` and `authenticated`: only the migration and the PM call them.

### Card template migration

- Migration `20261027140000_card_template_free.sql` makes every live card whose template is `flip`, `cloze` or `table` at version 1, or none, `free` at version 1, the one template the app's editor writes ([`deck.md`](deck.md), [ADR 0114](adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md), #438). It changes existing data; the owner approved it on 2026-10-27.
- `private.migrate_card_template_free()` changes them, and the migration calls it once.
  - A second run changes nothing, since `free` is not a template it reads.
  - A tombstone is left alone, so its revision, which the purge reads, does not move; so is a template or a version no build of the app wrote.
  - No backup is kept. Only the template changes, which seeds nothing once the editor has one mode, and the content is untouched.
- **How it reaches devices.** The update draws a new `revision` through the trigger, so every device pulls the card, and the card keeps its sides, its card key and its `updated_at`. Each device's schema step 13 makes the same change in its own rows, its `dirty` flags kept ([`sync.md`](sync.md)):
  - a device holding the card synced takes the server's copy on the tie;
  - a device with an edit not yet pushed wins the tie as an unsynced row, or holds a later `updated_at`, so its edit is pushed over the migration's.
  - No review or card state changes.
- The function revokes `execute` from `public`, `anon` and `authenticated`, and runs as `security invoker`: only the migration calls it.

### Card frame migration

- Migration `20261102120000_card_frame.sql` moves every live card of `free` at version 1, or of none or of `flip`, `cloze` or `table` at version 1, to the 칸 frame: its 칸 list in `front`, `[]` in `back`, `free` at version 2 ([`deck.md`](deck.md), [ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md), [ADR 0140](adr/0140-keep-every-back-that-differs-from-the-filled-text-show-a-back-blank-beside-a-front-blank-after-the-answer-and-keep-a-front-word-s-meanings-first.md), #549). It changes existing data; the PM approved it under the owner's goal on 2026-11-02, on the dry run of 4,038 live cards recorded on #488, which `supabase/card-frame-dry-run.sql` re-runs read-only before the merge.
- `private.card_frame` holds the rule, `cellsFromSides`' and the fixtures' in `supabase/fixtures/card-frame/`, and returns null for a card it leaves.
  - It leaves a block of a type or version no build wrote, as the dry run counts them.
  - It also leaves two cases the dry run does not count: a block breaking a field the rule reads, and a card it would give a 글 of no text, which `decodeCells` refuses. The app converts such a card on read. The migration's notice names how many it left.
- `private.migrate_card_frame()` converts, and the migration calls it once.
  - It holds `public.cards` in `share row exclusive` mode from before it reads a row until commit, so the row backed up is the row replaced and no writer holding a user's revision lock waits on one of its rows. Reads go on. At 5,000 cards it took about 2 s on the test stack, inside the 8 s of `authenticated`'s statement timeout that bounds a writer's wait.
  - It copies each changed row into `private.card_frame_backup` first: `card_id`, `user_id`, `front`, `back`, `template`, `template_version`, the `front` it wrote as `written`, and `migrated_at`. That table enables row-level security with no policy and grants nothing to `anon` or `authenticated`, so no client reads it. A row goes with its card's delete, so with its account. A later migration drops the table once the owner closes the window.
  - A back exactly equal to the filled text drops from the card and stays in the backup. Every other back is kept.
  - A second run converts nothing, since `free` v2 is not among the templates it reads. A tombstone, a card already in the frame, and a template or version no build wrote are left alone.
- **How it reaches devices.** The update draws a new `revision` through the trigger, so every device pulls the card, which keeps its `card_key` and `updated_at`. Each device's schema step 14 makes the same change in its own rows ([`sync.md`](sync.md)):
  - a device holding the card synced takes the server's copy on the tie;
  - a device with an edit not yet pushed wins the tie as an unsynced row, or holds a later `updated_at`, so its edit is pushed over the migration's, in the frame after step 14 and at v1 on a build without it.
  - No review or card state changes.
- **Revert.** `select private.revert_card_frame();`, run by the PM against production and again until no device writes the frame, returns how many cards it changed. It runs before any earlier app build is reinstalled, since that build opens a `free` v2 card read-only.
  - A backed-up live card still as the migration wrote it takes back its `front`, `back`, `template` and `template_version` exactly.
  - Any other live card at `free` v2, written in the frame before or after the migration, takes the projection of `sidesOf` at `free` v1, through `private.card_frame_parts`: every part shown before the reveal on the front, every part added by it on the back, a 칸 with blanks or of an unknown shape on the front as it is stored.
  - Each takes a new revision and keeps `card_key` and `updated_at`. A tombstone stays, and so does a card a build has since written outside the frame.
- Every function revokes `execute` from `public`, `anon` and `authenticated`, and runs as `security invoker`: only the migration and the PM call them.

## Rationale

- [ADR 0137](adr/0137-frame-a-card-by-its-blocks-each-block-type-deciding-whether-it-has-a-front-and-a-back.md) and [ADR 0140](adr/0140-keep-every-back-that-differs-from-the-filled-text-show-a-back-blank-beside-a-front-blank-after-the-answer-and-keep-a-front-word-s-meanings-first.md) record the card frame's rule, its migration, its backup and its revert.
- [ADR 0114](adr/0114-write-every-card-as-a-free-block-list-remove-the-flip-cloze-and-table-forms-and-migrate-every-card-to-free.md) records why every card's template became `free`, why its content and `updated_at` were kept, and how the migration meets each device's own schema step through sync.

## Open questions

- None.
