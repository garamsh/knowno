# ADR 0221: Wait a refused photo read's Retry-After up to 300 seconds, and give back a read that failed before it was sent, three times a photo

> Status: accepted
> Date: 2026-11-09

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #816**, the two follow-ups ADR 0218 and ADR 0219 named and left out, recommended by #807 and #800: a photo read refused by its provider waited a fixed 30 s, then 120 s, whatever the provider asked, and a failure on our side used up one of the photo's three reads.
- **The header's form**, read 2026-11-09 for each provider the configurations can name:
  - OpenRouter (`https://openrouter.ai/docs/api-reference/errors`): "a standard HTTP `Retry-After` response header indicating how many seconds to wait before retrying", on 429 and 503 responses and some 402; its example is `Retry-After: 60`.
  - Anthropic, whose Claude is the model of the seed's `anthropic/claude-haiku-5.5` and a provider of its own (`https://platform.claude.com/docs/en/api/rate-limits`, §Response headers): `retry-after`, "the number of seconds to wait until you can retry the request"; not every 429 carries it, and a spend-cap 429 never does. The errors page (`https://platform.claude.com/docs/en/api/errors`) gives 529 as overloaded and says nothing of the header on it.
  - OpenAI (`https://developers.openai.com/api/docs/guides/rate-limits`): `Retry-After`, "the minimum number of seconds to wait before retrying a temporary rate-limit error, when present", on 429 responses.
  - None names the HTTP-date form, which RFC 9110 §10.2.3 allows beside seconds, and a gateway between us and a provider may send it, so both are read.
- **Alternatives considered:**
  - **Counting a refused read as no read, as a read of ours that failed.** The provider answered before reading the image, so nothing is charged, but a provider that keeps refusing would then keep the job alive without bound. Rejected: a refused read still counts, and a `Retry-After` only moves when the next one is tried.
  - **A bound of 120 s, the longest wait of ADR 0218.** A provider that asks for 300 s is refused again at 120 s and the read is counted for nothing. Rejected for 300 s, which the worker's chain of invocations can hold: its lanes wait for a hidden message and ask for a fresh invocation every 120 s.
  - **A column counting the reads given back.** A second place to keep in step. Rejected: the photo's steps of outcome `not_sent` are that count.
  - **Giving a read back without limit.** A key that stays missing would keep the job running for ever. Rejected for three.

## Decision

- **The wait.** The worker reads `Retry-After` from a 429 or 529 response, as seconds or an HTTP date turned into the seconds until it (0 for a date past), and sends it as `finish_assistant_job_step`'s last argument, `retry_after_seconds`, null by default; any other status, no header and a header that is neither form send null. When the photo goes back on the queue it is shown again after those seconds, at least 1 and at most 300, bounded in SQL alone; null keeps ADR 0218's 30 s, or 120 s once read twice. The refused read still counts as a read, charged nothing as before, so the photo's third read still fails it, and a photo's waits are at most 3 × 300 s.
- **The read given back.** A step's outcome `not_sent` is a read that failed before its request was sent, through no fault of the photo: no key for the provider, or Storage failing to sign the photo's address. The worker records it with no tokens, and `finish_assistant_job_step` gives the read back by taking one off the photo's `attempts`, showing it again after 30 s, as long as the photo has at most 3 steps of that outcome, the one being recorded included. The fourth counts as a read as any failed read does. A failure that stays therefore ends the photo in 3 given-back and 3 counted reads, six steps, and the job ends with it: it cannot loop. A photo Storage does not hold stays `unreadable`, failed at once.
- Migration `20261109230000_assistant_photo_retry_after.sql` allows `not_sent` among the steps' outcomes and replaces `finish_assistant_job_step`, now of eight arguments with the last defaulting to null, so the sweep's seven-argument call is unchanged. It changes no row. A read is charged as ADR 0219 decided, and nothing else.

## Consequences

- A provider that asks for a minute is waited a minute, so a rate-limited job takes the provider's pace and not a fixed 2.5 minutes; one that asks for little is retried sooner than 30 s, at 1 s at the least, with the third read the last.
- A missing key or a Storage outage no longer fails a photo in three tries: it is tried three more times first, each 30 s after the last, then counts as a read as before, so a job whose key stays missing ends after six steps, about 4 minutes in all.
- A job waiting on a 300 s `Retry-After` keeps a hidden message, so the worker's lanes poll for it as they do for any hidden message, and the sweep's request after 3 minutes of no read begun finds a worker already running.

## Signs the decision was wrong

- Photos failed after three reads refused with a `Retry-After`, which asks for a longer bound or no count for a refused read.
- A header no provider documents arriving as neither form, or `not_sent` steps at the rate of the photos, which means a key or Storage is down and no photo is being read.
