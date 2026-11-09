# ADR 0219: Charge a killed photo read a fixed estimate of 4,784 tokens, close its step in the sweep, and delete uploads no job names after 24 hours

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #811**, the two cost decisions left by #800 and ADR 0218, decided by the owner on 2026-11-09 and built by #812:
  - **A failed photo read was charged nothing for its image.** On an abort or a stream that broke off, the worker estimated the input from the request body's bytes, which hold a signed address and no image. A step killed at the platform's wall clock was never recorded, so it was never charged, and its message came back after 150 s: a read the provider may have billed was retried for free.
  - **An upload no job reads stayed in the bucket.** `assistant_photos_insert` allows any number of uploads, and a photo is deleted only when its job ends.
- **The estimate's source.** The photo reads go to the plan's configuration, OpenRouter's `anthropic/claude-haiku-5.5` in the seed, and OpenRouter's documentation of image input (`https://openrouter.ai/docs/features/multimodal/images`, read 2026-11-09) states no token count for an image. The model's vendor does. Anthropic's vision guide (`https://platform.claude.com/docs/en/build-with-claude/vision`, §Resolution and token cost, read 2026-11-09) says an image costs `⌈width / 28⌉ × ⌈height / 28⌉` visual tokens and that each model caps it: 1,568 for the standard tier, and 4,784, at a long edge of 2,576 px, for "Claude 4.7 and later models", the high-resolution tier. `claude-haiku-5-5` is in that guide's supported models, and the guide's example prices a 4K image at 4,784 tokens on Claude Opus 5.5. 4,784 is therefore the most an Anthropic model charges an image. The bucket's 6 MiB limit bounds a file, not its pixels, so it gives no tighter bound.
- **Alternatives considered:**
  - **Charge a failed read nothing, with three reads a photo as the bound (#811 B).** A user then costs the provider up to three full reads of a photo for no tokens counted. Rejected by the owner.
  - **A smaller estimate, the standard tier's 1,568.** A read on a high-resolution model costs up to three times that, so it undercharges the plan the seed uses. Rejected for the maximum, since a failed read that the provider bills is charged at most what it can bill.
  - **A per-user cap on uploads in the insert policy (#811 B).** A new refusal the app must explain. Rejected by the owner: no cap.
  - **A table of uploads to delete.** The bucket and the job photo rows already say which objects exist and which a job names. Rejected.
  - **Charging a request the provider refused with a 429 or 529.** The provider answered before reading the image and bills nothing. Not charged.
  - **Honouring `Retry-After`, and not counting our own failures (no key, signing failed) as a read.** Each changes the signature of `finish_assistant_job_step` and what a failed read counts as, beyond the two decisions. Not built here; filed as their own issue.

## Decision

- **The estimate** is 4,784 input tokens and no output, one named value in each of two places: `ASSISTANT_PHOTO_ESTIMATE_TOKENS` in `functions/assistant/worker.ts` and `private.assistant_photo_estimate_tokens()`. A test compares them. It is the model's maximum, which a plan on another provider may exceed or not reach; the owner changes both with the configuration if that matters.
- **A read that fails after its request was sent** (a network error, an abort, a stream that breaks off) is recorded as `time_limit` past 60 s and otherwise `model_error`, charged the larger of the estimate and the tokens its provider reported before it broke off. A response with an error status is charged what it was before, nothing.
- **The sweep closes a killed step.** Each run of `private.sweep_assistant_jobs` first records every step with no outcome begun over 150 s ago, 100 at most, as `time_limit` with the estimate and 150 s of latency, through `finish_assistant_job_step`, so its photo follows the rules of any failed read: queued again after 30 s, or 120 s once read twice, and failed on its third read. A step a worker recorded in the meantime raises `P0002`, which the sweep ignores, so a step is charged once. A user's lock is only tried, as `next_assistant_job_step` tries it, so the sweep, which would hold the locks of several users to its transaction's end, waits for none; a user whose lock is held keeps the step for the next minute.
- **The unread uploads.** `public.assistant_unread_photos()` lists, 100 at most, objects of `assistant-photos` older than 24 hours that no job photo row names as `{user id}/{photo id}`. At the end of each invocation the worker deletes what it lists, in up to 10 batches, through the Storage deletion that clears an ended job, a failure logged as `unavailable`. `private.sweep_assistant_unread_photos()`, scheduled daily at 18:45 UTC by the cron job `sweep-assistant-unread-photos`, requests the worker when it lists any, with the Vault secrets of the other sweep. Any worker deletes what has aged, so the daily request only makes sure one runs.
- Migration `20261109210000_assistant_photo_charges.sql`. Its first sweep closes the steps unrecorded before it, charging each once, and the first worker after it deletes every unread upload that has aged.

## Consequences

- A killed or aborted read costs the user at most 4,784 tokens of the day's budget; a user's day can reach its budget through failed reads, which it could not before.
- A step stays open for 150 s to 210 s after a kill; the sweep, which runs each minute, closes it, and its photo is shown again 30 s later.
- An upload no job names lives 24 to 48 hours. A photo uploaded and sent within 24 hours is protected by its job's row; a job whose photos were deleted keeps its rows for 7 days and its objects are gone.

## Signs the decision was wrong

- Steps with no outcome older than 4 minutes, which means the sweep does not run or a user's lock stays held.
- Objects of `assistant-photos` older than 48 hours that no job names, which means the worker's deletion or the daily request does not run.
- Users reaching the daily budget through `time_limit` steps of a provider that was refusing, which asks for the `Retry-After` follow-up first.
