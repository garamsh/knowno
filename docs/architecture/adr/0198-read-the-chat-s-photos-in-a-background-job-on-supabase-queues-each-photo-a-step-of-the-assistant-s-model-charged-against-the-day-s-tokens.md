# ADR 0198: Read the chat's photos in a background job on Supabase Queues, each photo a step of the assistant's model charged against the day's tokens

> Status: accepted; its alternative "pg_cron with pg_net calling the worker every minute", rejected for now, superseded by ADR-0203
> Date: 2026-11-07

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #750**, the owner of 2026-11-04: 말랑이 reads and analyses the user's photos itself, dozens at once, as a conversational agent: it follows the user's instructions given before and during the reading, asks when unsure, and builds notes and cards. Photo import's one-photo extraction is not enough. The PM's design: photos are uploaded to storage first and a chat message carries references; the assistant has a tool to start a background analysis job on a durable queue, Supabase Queues (pgmq) preferred; the job reads each photo with the assistant's own multimodal model, the plan's assistant configuration; the assistant then composes the whole by the user's instructions into grouped proposals, one form a group (ADR 0197); the client sees progress, and the user can steer or cancel; usage is metered by tokens under the daily budget (ADR 0195), charged per step under the same lock. Issue #711's PM comment of 2026-11-04 names jobs that run for minutes, such as reading dozens of photos, as the case for a queue with background workers rather than a separate server.
- **The platform's limits.** Supabase's Edge Function limits page (https://supabase.com/docs/guides/functions/limits, read 2026-11-05): wall clock 150 s on the Free plan and 400 s on paid plans, request idle timeout 150 s, CPU time 2 s, memory 256 MB; a worker "can serve multiple requests or process background tasks" within its wall clock. Its Background Tasks page (https://supabase.com/docs/guides/functions/background-tasks, read 2026-11-05): "The Function instance continues to run until the promise provided to `waitUntil` completes", capped by those limits. A message is already held to 120 s under the 150 s (ADR 0190), so one request cannot read 30 photos at a call of tens of seconds each.
- **Supabase Queues** (https://supabase.com/docs/guides/queues, read 2026-11-05): "a Postgres-native durable Message Queue system with guaranteed delivery", "built on the pgmq database extension"; "A Message is delivered exactly once to a consumer within a customizable visibility window." Its API page (https://supabase.com/docs/guides/queues/api, read 2026-11-05) gives `send`, `send_batch`, `read` with a visibility timeout, `delete` and `archive`. The local stack's image, `public.ecr.aws/supabase/postgres:17.11.0.006`, ships pgmq 1.5.1 and pg_net 0.20.4 beside pg_cron 1.6.4.
- **A photo to the model by address.** Anthropic's Vision page (https://platform.claude.com/docs/en/build-with-claude/vision, read 2026-11-05) takes an image block whose source is "A URL reference to an image hosted online", JPEG, PNG, GIF or WebP, at most 10 MB base64-encoded on the Claude API, and lists Claude Haiku 5.5 among its models; a standard-tier image costs at most 1,568 visual tokens, a high-resolution one, Claude 4.7 and later, at most 4,784. OpenAI's chat completions take an `image_url` part with an https URL. OpenRouter's Responses API is sent the Responses `input_image` part with `image_url`; its schema text was not read here.
- **Photo import** reads a JPEG, PNG or WebP of at most 6 MiB, sent in the request ([`ai-extraction.md`](../ai-extraction.md) §Contract); the private `media` bucket names each file `{owner}/{id}` (ADR 0107).
- **Alternatives considered:**
  - **A table polled as the queue.** It works, but hand-builds the visibility timeout, redelivery and deletion pgmq has. Rejected: pgmq, the PM's preference, whose messages live in Postgres, so a step's begin and record move the message in the same transaction as the job's rows.
  - **A separate worker Edge Function.** It would import the assistant's adapters across functions, or move them to `_shared/`, and be a fifth function to deploy and secure. Rejected: a route of the `assistant` function, `POST /assistant/jobs/work`, taking the service-role key alone.
  - **pg_cron with pg_net calling the worker every minute.** The documented sweeper, but it needs the function's URL and a service key in the database, a secret the production project lacks. Rejected for now: the worker asks for itself when its time runs out, a job's start asks for it, and a client's poll asks again when a running job has begun no read for 3 minutes.
  - **Reading every photo in the chat message.** It hits the 120 s turn. Rejected.
  - **Downloading each photo into the function and sending its bytes.** Base64 of a 6 MiB photo costs CPU against the 2 s and memory against the 256 MB. Rejected: the provider is given a signed address, good for 10 minutes, and fetches the photo itself.
  - **Applying the user's instructions while reading.** "1단원만" would skip pages, but an instruction given mid-way would miss the photos read before it. Rejected: each photo is read whole, the job's instructions only telling the reading what to notice, and the instructions are applied when the assistant composes, from the whole conversation.
  - **Letting a job's steps hold a message back as `busy`.** The user could not steer or ask during the job. Rejected: steps are counted apart from messages, three at a time a user.

## Decision

- **Photos.** The chat's photos are uploaded by the user to the private bucket `assistant-photos`, each `{owner}/{photo id}`, a uuid, JPEG, PNG or WebP of at most 6 MiB, photo import's limit; its owner uploads, reads and deletes its own, a suspended user uploads none, and no one overwrites one. A user turn names them as `photos`, 1 to 50 ids.
- **A job.** `start_photo_job(instructions)` starts a job over the photos of the latest user turn that attached any, under the user's assistant lock: on the plan's serving assistant configuration, while its provider has a key, the day's tokens are under the budget and the user runs no other job, each photo uploaded. Each photo is one message on the pgmq queue `assistant_photo_reads`. The stream sends a `job` event the client keeps on its assistant turn.
- **A step.** The worker takes a photo off the queue, hidden 150 s, and begins a step under the user's lock: refused while three of the user's steps are in flight, the photo hidden 5 s; skipped once the job's plan has spent the day's budget; failed when begun three times. A step is one model call of the job's configuration, with fixed reading instructions, the job's instructions and the photo's signed address, no tools and no web search, at most 60 s. It is recorded once under the lock, which charges its input and output tokens: read on a reply, kept cut when the reply stopped at the output cap; failed at once when Storage holds no such photo; otherwise shown again in 10 s, and failed on its third failure. A failure is charged what its provider reported, or an estimate of its input, as a message's is (ADR 0195).
- **The worker.** `POST /assistant/jobs/work` answers 202 and runs in the background: three lanes take steps while 60 s of its 120 s remain, waiting 5 s when every queued photo is hidden, and with time run out ask for a fresh invocation. A job's start asks for it; a poll asks again when a running job has begun no read for 3 minutes.
- **The end.** A job is done when none of its photos is queued, and its photos are deleted from the bucket, their readings kept. `cancel_photo_job`, or the client's cancel, cancels its queued photos and deletes its photos; a read in flight is still charged.
- **Composing.** The assistant reads the readings with `read_photo_job`, a page of 60,000 characters at a time, and builds proposals with the existing tools from the whole conversation, so instructions given before and during the job both apply.
- **Progress.** The client polls `GET /assistant/jobs/{id}`: the job's and each photo's status, never a reading.
- **The budget.** The day's tokens charged are a user's recorded messages' and recorded steps' together. A message that crosses the budget is still charged whole; with steps three at a time beside it, the budget is overrun by at most one message and three steps.
- **Storage of text.** A job keeps the user's instructions and each photo's reading until it is purged, 7 days after it began, by the daily cron job `purge-assistant-jobs`; a step keeps only its usage, and outlives its job.

## Consequences

- From the user's side one request reads up to 50 photos, each retried on its own.
- The server now stores text from the user for up to 7 days: a job's instructions and what was read of its photos, beside the conversation it still does not store.
- A photo costs its image tokens and a reading of up to 8,192 output tokens; about 2,000 to 6,000 tokens a photo at the standard tier, so 30 photos are some 60,000 to 180,000 tokens, most of Free's 200,000 a day.
- A crashed worker leaves its photos hidden for 150 s and the job waits on the client's next poll; with no client polling, a job whose chain broke waits until one does.
- Photos uploaded and never named by a job stay in the bucket until the account is deleted.
- The provider fetches each photo from Supabase Storage by a signed address, good for 10 minutes; one the provider cannot fetch fails as a model error.

## Signs the decision was wrong

- Jobs stall between polls often enough that users wait on a job they left.
- A photo's reading misses what the user asked for so often that reading whole pages costs more than it helps.
- OpenRouter or a provider refuses photos by address, and bytes must be sent after all.
- Users leave uploaded photos unread in numbers that make the bucket's size matter.
