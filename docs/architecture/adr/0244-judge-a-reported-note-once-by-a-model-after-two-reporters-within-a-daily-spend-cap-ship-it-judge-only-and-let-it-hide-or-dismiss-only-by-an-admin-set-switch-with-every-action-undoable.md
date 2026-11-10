# ADR 0244: Judge a reported note once by a model after two reporters, within a daily spend cap, ship it judge-only, and let it hide or dismiss only by an admin's switch with every action undoable

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #887**, part of #591 and #590. [ADR 0240](0240-keep-note-screening-to-rules-and-let-reports-catch-the-rest-and-return-each-finding-s-field.md) kept no model at publish and left what the rules miss to reports, three of which hide a note until an admin decides. The owner asked on 2026-11-10 for a model to judge reported notes, so the admins' queue is shorter, at a cost the owner sets.
- **Cost rules binding the design** (#590's comment of 2026-11-03): one verdict per note by its content hash; a judgment only from two distinct reporters; a cheap model, a stronger one only when unsure; a bounded payload; scheduled batches, severe categories at once; a daily spend cap past which no model is called and everything goes to a person.
- **What reports carry.** `deck_reports` holds a reporter, a deck and one of four reasons, no text. A report cannot name the card it is about.

## Decision

- **A server job judges reported notes.** `triage-reports`, an Edge Function with the same shape as `publish-note`, runs on a schedule and, for the one severe case below, at once. Nothing is judged at publish; ADR 0240 stands.
- **One verdict per content.** `private.triage_verdicts` is keyed by the note's content hash, `private.note_content_hash`. A verdict is reused until a card or the text changes, then the changed note is due again if it is still reported by two.
- **Due means two distinct reporters, no verdict for the current hash, a live public note,** and spend, the day's notes and the batch under their caps. The first of the two reporters triggers nothing.
- **Severe goes at once.** Reports have four reasons, so a note with an `inappropriate` report among two reporters is judged by the trigger on `deck_reports` as the second reporter arrives; every other reason waits for the batch, run every 5 minutes. A verdict whose category is `severe` is never acted on.
- **Cheap first.** A configuration names a cheap and a strong model, each with its provider. The strong one is called only when the cheap one's confidence is below the configuration's `escalate_below`, or its category is `other`.
- **A bounded payload,** built by the function: the name and description; the cards the rules flagged; a fixed sample of the others, ordered by the hash of the content hash and the card hash, so a retry sends the same cards; all under the configuration's token cap. Report reasons go in the prompt. Cards "matching the report's reason" cannot be chosen beyond the rules' flags, since a report has no text.
- **A verdict** holds a category (`spam`, `ad`, `inappropriate`, `copyright`, `severe`, `other`, `ok`, or `unjudged`), a confidence, the quoted passage and its field, the card's hash, the tier, provider, model and configuration, tokens, and the cost. A reply that does not parse after tokens were spent is recorded `unjudged`, goes to a person and is not retried; a network failure, a 429 or a 5xx records nothing and the note stays due.
- **The daily spend cap is `private.triage_settings.daily_cap_usd`,** default 0.50, counted over the UTC day's verdicts. At or past it `triage_due` returns no note and `triage_claim` none, so no call is made and everything stays in the human queue. A note's two tiers may take the day a little past the cap; the next claim sees it.
- **Configuration follows ADRs 0162 and 0182:** `private.triage_configurations` is append-only, labelled `active` and `test`; a save is a settings route of the function that checks both tiers with one call each, parsed, through the key already in Vault, and then a service-only function; an admin activates it, refused while a provider has no key. The prompt text is held in the configuration, not in the prompt store, since a verdict names its configuration and so the prompt it was judged by. ADR 0162's trial on real photos is replaced by judge-only mode, which is the trial: verdicts accrue beside the admins' own decisions and `admin_triage_agreement` compares them. No configuration is seeded, so the job does nothing until an admin saves and activates one.
- **Modes.** `private.triage_settings.mode` is `judge_only`, the default, or `acting`, set by an admin. Judge-only records verdicts and changes no note, report or audit row beyond the verdict. Acting, while not paused, may only:
  - hide a note judged `spam` or `ad` at or above `act_threshold` (the note becomes `held` with the `ai` hold, as a report hold does);
  - dismiss the reports on a note judged `ok` at or above the threshold, after archiving them.
  It never unpublishes, removes or suspends, never acts on `copyright`, `severe`, `other` or `inappropriate`, and never on `unjudged`; copyright always goes to a person.
- **Accountability.** Every action writes `private.triage_actions` and an audit row with no admin id and `admin_email = 'ai'`, naming the model and the reason. `admin_undo_triage_action` reverses one (unhides the note, or restores the archived reports). A fixed share of actions, `sample_percent` (10), chosen by a hash of the content hash, is queued for a person to re-check. Automation pauses itself, setting `paused_at`, when over the window `undo_window_hours` at least `undo_min_actions` actions stand and the share undone passes `undo_threshold`; an admin resumes it.
- **Agreement.** `admin_triage_agreement` compares each verdict with the first decision an admin made on the same note after it: a verdict that the note is bad agrees with hide, unpublish and remove; a verdict `ok` agrees with dismiss, allow and unhide.
- **Appeals.** The owner of a note an action hid may appeal once; the appeal reaches the admin queue, and only an admin resolves it.
- **Left out of this change:** a per-user daily report cap and a lower weight for often-dismissed reporters, which #590 lists and #887 does not.

## Alternatives considered

- **Judging at the first report.** It spends on every spiteful report; two distinct users is #590's rule.
- **A model at publish.** ADR 0240 decided against it.
- **A separate prompt table.** A verdict would need two ids to name what judged it; the configuration holds the prompt.
- **Acting from the start.** The owner's cost rules and the accountability the issue asks for are both met only by measuring first; judge-only is the default and the agreement RPC is the measure.
- **Counting severity from the model's reply to decide timing.** The model is not called until the note is judged, so timing must come from the report's reason.

## Consequences

- **Cost is bounded per day,** by the cap, and per note by the payload cap; the PR states the expected monthly cost at three volumes.
- **A note over the cap waits for a person or the next UTC day.**
- **Web (#888) and app (#889)** read the functions §Report triage of [`server.md`](../server.md) lists.
- **The owner creates a Vault secret** `triage_function_url`, as for `screening_function_url`; without it the sweeper and the trigger do nothing.
