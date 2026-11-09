# ADR 0218: Record that an ended photo job's photos were deleted and let the worker delete the rest, take a user's lock without waiting, and retry a failed read after 30 and 120 seconds

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #800**, from the review of #757. ADR 0198 decided that a job's photos are deleted when the job ends. Three gaps in what merged:
  - **A job that ends in SQL kept its photos.** The worker deleted a job's photos only when its own `finish_assistant_job_step` ended the job, and the cancel paths when they cancelled. `next_assistant_job_step` also ends a job, when the day's budget runs out or a photo is at its third read, and no TypeScript runs then. A deletion that failed was swallowed too. Storage refuses a delete of its objects in SQL, so the database cannot do it. The daily purge deleted the job's rows, and the objects stayed until the account was deleted.
  - **`next_assistant_job_step` could deadlock.** It took each user's advisory lock inside its loop, a lock held to the transaction's end, and its branches that move on to the next message kept it. Two transactions that read messages in opposite orders could each hold one user's lock and wait for the other's: with messages A1 and B1 for one and B2 and A2 for the other, `skip locked` lets each read the first of its own and then the message the other left, and each waits for the user the other holds. Postgres aborts one with `40P01`; the worker read it as Supabase not answering and logged nothing.
  - **A failed read came back after 10 s,** three reads in about 30 s, so one provider 429 or a missing key failed every photo for good.
- **Alternatives considered:**
  - **Deleting the photos from the cron purge or from a database function through pg_net.** Storage's API is the one way to delete an object, and pg_net's request is not retried or answered to the database. Rejected: the worker deletes, the database keeps the record.
  - **A table of objects to delete.** A second place to keep in step with the jobs. Rejected: a job that ended with `photos_cleared_at` null is that record, and its photos are listed by the job.
  - **A fixed order for the locks.** The user of the next message is unknown before it is read, so an order cannot be kept. Rejected for trying the lock.
  - **Ordering the queue's reads by user.** pgmq's read has no such order. Rejected.
  - **Honouring a provider's `Retry-After`, or not counting a failure on our side, a missing key or a signing failure, as a read.** Better aimed than a fixed backoff, but it changes what a failed read is charged and counted as. Not built; a recommendation in #800.

## Decision

- **The record.** `private.assistant_jobs.photos_cleared_at` is null until the job's photos were deleted from `assistant-photos`, and is set only on a job that is not running. `public.assistant_jobs_to_clear()` lists, at most 20, the jobs that ended with it null, oldest end first, and `public.mark_assistant_job_cleared(user_id, job_id)` sets it, once.
- **The deletion.** `clearJob` deletes the job's photos through Storage and then records it. The worker clears a job as before when its own step ended it, and at the end of every invocation clears each job `assistant_jobs_to_clear` lists, a failure logged and the next job still tried. A job that ended in SQL, or whose deletion failed, is therefore cleared by the next worker.
- **The sweep** also requests the worker when a job ended over a minute ago with its photos still in the bucket, so no running job or poll is needed.
- **The purge** deletes only a job begun over 7 days ago whose photos were recorded deleted, so a failed deletion's record outlives it; an ended job has no queued message, so the purge no longer deletes messages.
- **The lock.** `next_assistant_job_step` tries a user's lock with `pg_try_advisory_xact_lock`, and hides the message for 5 s, as it does for a user at three steps, when another transaction holds it. It then never waits for another transaction, so it is in no cycle of waits: a message is read with `skip locked`, a lock is only tried, and every other job function takes one user's lock and waits at most for a transaction of this function, which ends without waiting. A row lock taken by the purge or by an account's deletion is outside this: the purge deletes only ended jobs, whose rows this function does not write, and the deletion of an account that has a running job waits at most for that job's transaction.
- **The retry.** `finish_assistant_job_step` shows a failed read again after 30 s when the photo has been read once, and after 120 s when twice; the third failure fails the photo, as before. A photo's reads then span about 2.5 minutes, past a provider's usual rate-limit window of a minute, and inside the sweep's 3 minutes without a read begun.
- **A lane that fails on Supabase is logged** as a `work` line with outcome `unavailable`; the queue keeps the photo and the sweep or a poll asks for the worker again, so it is not asked for from the failed invocation.
- Migration `20261109170000_assistant_photo_job_cleanup.sql`. It changes no row; the column starts null, so the next worker deletes the photos of jobs that ended before it.

## Consequences

- No ended job keeps its photos past the next worker, which the sweep requests within about 2 minutes of the end once the owner has the Vault secrets; without them, the next job's worker or any poll's.
- A user whose lock is held is passed over for 5 s instead of waited for, so a worker may find the queue empty while a message waits; its lane waits 5 s and asks again, as it does for any hidden message.
- A failed photo takes about 2.5 minutes to fail where it took 30 s, and a job that fails every read takes as long to end.
- What a failed read is charged and what an upload that no job reads costs are not decided here (#800, for the owner).

## Signs the decision was wrong

- Photos in `assistant-photos` of jobs with `photos_cleared_at` set, or ended jobs that stay uncleared for more than a few minutes with the secrets in Vault.
- `40P01` in the logs of `next_assistant_job_step`, or users whose photos wait long behind their lock.
- Reads that fail for a minute of a provider's trouble and are failed for good by the third, which asks for a `Retry-After`.
