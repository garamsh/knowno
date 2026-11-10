# ADR 0245: Reach the database's Edge Function callers through one project_url Vault secret and a path each

> Status: accepted; its owner approval before merge superseded by ADR-0246
> Date: 2026-11-11

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #906.** Three database callers read a Vault secret each, holding the full URL of the function they call: `assistant_function_url` ([ADR 0203](0203-resume-a-stalled-photo-job-from-the-server-with-a-pg-cron-sweep-that-requests-the-worker-through-pg-net-its-url-and-key-in-vault.md)), `screening_function_url` ([ADR 0238](0238-screen-a-note-by-rules-in-the-publish-note-function-keyed-by-a-hash-of-its-text-and-let-no-client-write-make-a-deck-public.md)) and `triage_function_url` ([ADR 0244](0244-judge-a-reported-note-once-by-a-model-after-two-reporters-within-a-daily-spend-cap-ship-it-judge-only-and-let-it-hide-or-dismiss-only-by-an-admin-set-switch-with-every-action-undoable.md)). Each was created by hand in production, and a missing one makes its feature do nothing, silently.
- **The URL is no secret.** It is the project's address plus a fixed function path; only the address varies by environment.

## Decision

- **One Vault secret, `project_url`,** `https://<project ref>.supabase.co`, is the database's only record of the project's address. Each caller appends its function's path, which lives in the migration that owns the caller. A new function the database calls needs its path and no manual production step.
- **Every caller does nothing, and raises nothing, while `project_url` is missing,** as it did while its own secret was missing. A per-function URL secret is no longer read.
- **Production keeps working without a manual step.** The migration derives `project_url` from the address of the first per-function secret present, in the order assistant, screening, triage, when `project_url` is missing, and then deletes the three per-function secrets. With none of the four present it changes nothing.
- **The migration is not additive,** since it changes Vault rows, so it merges only after the owner approves it ([`server.md`](../server.md) §Location and migrations, "Gate").
- **Supersedes** the URL-secret part of ADRs 0203, 0238 and 0244: the secrets named above and the owner's step of creating each. Their other decisions stand.

## Alternatives considered

- **Keep a secret per function.** Each new function repeats the manual step, and its absence is silent.
- **Store the address in a table or a setting.** Vault already holds the sweepers' key beside it, and the address is read by the same lookup.
- **Fall back to a per-function secret while `project_url` is missing.** Two sources for one address, and a callers' fallback that outlives the migration that removes the old secrets.

## Consequences

- **An environment sets one secret,** `project_url`, beside `assistant_service_role_key`; local stacks, previews and CI set none and every caller stays idle.
- **The migration's revert** recreates the three per-function secrets from `project_url` and restores the five callers' earlier bodies; `project_url` stays.
- **A function a later migration adds** for the database to call appends its own path to `project_url`.
