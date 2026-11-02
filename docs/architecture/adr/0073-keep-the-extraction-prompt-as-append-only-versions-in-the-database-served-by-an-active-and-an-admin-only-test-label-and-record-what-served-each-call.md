# ADR 0073: Keep the extraction prompt as append-only versions in the database, served by an active and an admin-only test label, and record what served each call

> Status: accepted; its `start_extraction` and `consume_extraction` kept beside `begin_extraction` superseded by ADR-0078; its invalid output saving no card, for a reply some of whose cards keep every rule, superseded by ADR-0124; its 프롬프트 page as a section of its own superseded by ADR-0155; its trial counted against the admin's daily limit superseded by ADR-0157
> Date: 2026-10-19

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #234**, with the PM's comments of 2026-10-19 relaying the owner's direction:
  - The admin area edits the prompt text. The owner validates a prompt before pasting it in.
  - The text lives in the database as append-only versions, `{id, text, note, created_by, created_at}`.
  - Each plan, or one global setting as the ADR decides, points to its **active** version.
  - Saving creates a version. Activating is a separate confirmed action, and rollback is activating an earlier version. Everything is audited.
  - The output contract stays in the function: the JSON schema, the parser and its validation. The editable text is the model's instructions only.
  - The text is non-empty with a size limit the ADR sets. The page shows a diff against the active version before activating.
  - "Test on one photo" runs the draft on an uploaded image and shows the cards. It is admin-only, counted against the admin's own daily limit, and logged.
  - The seed is the production prompt, "v7 if merged, else v6", as version 1, active, so the deploy changes nothing.
  - `tools/eval/` can run a version from the database by its id.
  - A second comment added a **per-call record** (each extraction's prompt version, model and plan, with no image or card content) and a **test label**: admins are served the test version, everyone else the active one. Promoting test to active is the activate. A gradual rollout is out of scope.
- **Before this change:**
  - The prompt was the constant `SYSTEM_PROMPT` in a versioned file under `supabase/functions/extract-cards/`, `prompt_v8.ts` since #260. Changing it took a pull request and a deploy.
  - [ADR 0013](0013-extract-cards-function-and-eval.md) made "the prompt a versioned file", so an eval names the prompt it measured.
  - `public.start_extraction` ([ADR 0071](0071-give-each-user-a-plan-whose-model-and-daily-limit-an-admin-sets-in-the-database-and-make-one-model-call-per-photo.md)) resolved the plan and counted the photo. It recorded no model or prompt per call.
- **#260**, prompt v8 ([ADR 0076](0076-ask-prompt-v8-for-each-sense-s-printed-labels-and-examples-transcribed-never-inferred-and-eval-labels-on-pages-that-print-none.md)), merged as `92d02ce81a3e73ed6d32327a1ad31f1aaa2b3f17`, after #225's prompt v7, so `main` serves prompt v8.
- **Request bodies:** a Server Action takes at most 1 MB by default (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md`, "bodySizeLimit", Next 16.4.1). A Vercel Function takes at most 4.5 MB.
- **Alternatives considered:**
  - **A prompt per plan.** Every plan runs the same contract on the same pages. A prompt per plan multiplies the versions the eval must measure by the plans, and the owner asked for one active version with a test beside it. A plan that needs its own instructions can take a label of its own later.
  - **Editing a version in place.** A rollback would then need the old text kept elsewhere, and the per-call record would name a version whose text changed after the call. Versions are append-only, and only the labels move.
  - **Choosing among prompt files** (#234's first scope). The owner replaced it with editing the text.
  - **A separate "test on a photo" function** that takes a draft text. It would add a second path to the model with its own limits. The trial runs `extract-cards` itself as the admin, so the admin is served the test version, counted and recorded as any call.
  - **Raising the Server Action body limit** so the trial uploads the original photo. The limit is global to every action, and Vercel refuses a body over 4.5 MB whatever Next allows. The browser downscales the photo instead.

## Decision

- **Versions** are rows of `private.prompt_versions`: an identity `id`, the `text`, a `note`, `created_by` (set null when that account is deleted) and `created_at`.
  - The text is the model's system prompt only. The user turn, which carries the deck's language hints, and the output contract stay in the function: the schema in `response_format`, and the parser. A text that makes the model break the schema fails as invalid output, `502`, and saves no card.
  - The text holds at least one non-space character and at most 20,000 characters, nearly twice prompt v8's 11,373. The note holds at most 200.
  - A trigger refuses every update and delete, even by the table's owner, except clearing `created_by` when the author's account is deleted.
- **Labels** are rows of `private.prompt_labels`, one global setting rather than one per plan: `active`, which every user is served, and `test`, which admins are served while it is set.
  - Label changes run one at a time under an advisory lock seeded with 4.
  - Activating the test version clears the test label, so admins follow the active one again.
  - Rollback is activating an earlier version. No version is ever deleted.
- **The admin functions**, each checking the role and recording itself as [ADR 0070](0070-run-the-service-from-a-web-admin-area-whose-role-and-audit-log-live-in-the-database-and-whose-every-read-and-write-is-checked-there.md) decides:
  - `admin_prompt_versions` and `admin_prompt_version`. The second returns the active version's text beside the version's, for the diff.
  - `admin_save_prompt`, recorded as `save_prompt` on a `prompt`, with the note and the length but not the text.
  - `admin_set_prompt_label`, recorded as `activate_prompt` or `test_prompt`, with the version before.
  - `admin_clear_test_prompt`, recorded as `clear_test_prompt`.
  - Saving labels nothing.
- **Serving.** `extract-cards` calls `public.begin_extraction(user_id)` in place of `start_extraction`.
  - Under the same extraction lock, it resolves the plan, its model and limit, and the prompt: the test version for an admin while one is set, the active version otherwise.
  - Under the limit, it records the photo in `extraction_usage` and the call in `private.extraction_calls`: the usage row, the plan, the model and the version id. No image, card or prompt text is recorded.
  - It returns the version's id and text. The function sends the text as the system prompt and logs the id as `prompt_version`.
  - `start_extraction` and `consume_extraction` stay in the database and count the same rows, so a function deployed before this change still counts each photo once.
- **The seed** is version 1, active: the text of `SYSTEM_PROMPT` in `prompt_v8.ts`, which `main` serves. `prompt_seed_test.ts` compares the migration's text with that constant, character for character.
  - `prompt_v8.ts` stays: it is the seed's source, the eval's default prompt, and the home of the user turn.
  - A new prompt is a saved version, not a new file. This supersedes ADR 0013's "the prompt a versioned file".
- **The eval** runs prompt v8 by default. With `--prompt-version <id>`, it reads that version through `public.prompt_version`, executable only by `service_role`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The ledger and the report name the run's prompt as `version <id>`.
- **The web page 프롬프트** (`/admin/prompts`):
  - the trial on one photo, which names the version it runs;
  - the form that saves a new version, starting from the active version or the one the address names;
  - the versions, newest first, with their labels.
  - A version's page shows its text and, unless it is active, its line diff against the active version, each changed line marked − or + and named in words for a screen reader, not by colour alone.
  - Its actions, each asked first: "모든 사용자에게 적용", "관리자만 테스트" and "테스트 끝내기".
- **The trial** is a Server Action.
  - It refuses a user who is not an admin before calling anything.
  - It then posts the photo to `extract-cards` with the admin's own session, so the admin is served the test version when one is set, the photo counts against the admin's daily limit, and the call is recorded with its version.
  - The browser first turns the photo upright and scales its long side to at most 2048 px, as the app does, encoding it as JPEG from quality 85 down to 40 until it is at most 900,000 bytes. That fits the Server Action's default 1 MB body with room for the form.
- **The migration** `20261019210000_prompts.sql` creates three tables in `private`, their indexes, the trigger and the functions, and seeds version 1. It changes no existing row and replaces no existing object.

## Consequences

- An admin changes what every user's extraction is told without a deploy. The output contract, and with it every check on what is saved, still changes only through a pull request.
- A merged change to `prompt_v8.ts` or a new prompt file no longer changes what production serves. A new prompt reaches users only when an admin saves and activates it.
- Each extraction from this deploy on names its plan, model and prompt version, so usage and cost can be broken down by version. Extractions before it have no call record.
- An admin's own extractions in the app also run the test version while one is set.
- Merging deploys the migration and `extract-cards` in no stated order. Should the function arrive first, `begin_extraction` is not yet there, and each extraction answers `500` until the migration applies.
- The trial's photo is the browser's downscale at up to 900,000 bytes, smaller than the app's 6 MiB cap, so a dense page may read slightly worse in the trial than in the app.

## Signs the decision was wrong

- Operators want a different prompt per plan, or per model, and the one global label forces a compromise.
- Versions accumulate faster than anyone can review them, and the list needs paging or archiving.
- A saved prompt breaks the schema often enough that invalid output reaches users before an admin notices. A check at save time, such as running the samples, would then earn its place.
- The trial and the app disagree on the same page because of the downscale.
