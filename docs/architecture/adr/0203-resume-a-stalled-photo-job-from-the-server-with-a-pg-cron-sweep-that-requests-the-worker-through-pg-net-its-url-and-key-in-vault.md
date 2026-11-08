# ADR 0203: Resume a stalled photo job from the server with a pg_cron sweep that requests the worker through pg_net, its URL and key in Vault

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #760.** ADR 0198 let a photo job's worker chain break with no one to restart it: the worker asks for itself when its time runs out, a job's start asks for it, and a client's poll asks again for a stale job, so a job whose chain broke while no client polls waits until one does. It rejected "pg_cron with pg_net calling the worker every minute" for now, since the database needs the function's URL and a service key, "a secret the production project lacks".
- **Supabase Vault** stores secrets encrypted and serves them decrypted through `vault.decrypted_secrets`, readable by name inside the database; a secret put there by the owner is in no migration and no repository. The local stack's image ships pg_net 0.20.4 beside pg_cron 1.6.4 (ADR 0198), and the project already runs `pg_cron` for `purge-assistant-jobs`.
- **Alternatives considered:**
  - **Calling the worker from every cron tick.** Needless requests while no job is running, each a cold start. Rejected: the sweep asks first whether a job is stale and calls only then.
  - **The Edge Function scheduling itself.** It is the thing that broke. Rejected.
  - **A secret in the migration or in `ALTER DATABASE` settings.** It would be in the repository or in the dump. Rejected: Vault, by name.
  - **A cooldown between requests of one stalled job.** A worker that begins no read within a minute is asked again by the next tick, so a job whose photos are all hidden for 150 s after a crash can have two or three idle workers at once, each waiting at most 120 s. Not built: the poll's request has the same property, and a worker holding no step costs one wait loop.

## Decision

- **The sweep.** A `pg_cron` job, `sweep-assistant-jobs`, runs `private.sweep_assistant_jobs()` every minute. It requests the worker once when some running job has a queued photo and has begun no read for 3 minutes, or, with none begun, was started over 3 minutes ago: the judgement of the job's poll, `STALE_MS`. Otherwise it does nothing.
- **The request.** `private.request_assistant_job_worker(function_url, service_role_key)` queues, through `net.http_post`, a POST of `{function_url}/jobs/work` with the service-role key as `apikey` and bearer token, as the worker's own request for itself sends it. pg_net sends it after the transaction commits and the sweep reads no response.
- **The secrets.** The function's URL, the assistant function's address `https://<project ref>.supabase.co/functions/v1/assistant`, is the Vault secret `assistant_function_url`, and the service-role key `assistant_service_role_key`. The sweep reads both by name; with either missing it does nothing and raises nothing, so local stacks, previews and CI need no secret and production sweeps once the owner has created them.
- pg_net is enabled by the migration where it is not yet.

## Consequences

- A job whose chain broke is resumed within about 4 minutes of its last read begun, with no client polling, once the owner has put the two secrets into production; until then behaviour is ADR 0198's.
- One request a minute for as long as a job is stale, and none while no job is.
- The service-role key is a second place that must be changed when it is rotated.

## Signs the decision was wrong

- Stalled jobs the sweep does not resume, or workers piling up past a few at once for one job, which asks for a cooldown.
- pg_net's request queue growing, or its responses showing refusals, after a key rotation nobody carried into Vault.
