# ADR 0239: Judge a note the rules passed with a cheap model, then a strong one, keyed by the note's hash, capped by a daily spend, and let a banned word alone ask the model instead of refusing

> Status: accepted
> Date: 2026-11-10

Append-only: once merged, the body below is not rewritten. A fact later found wrong is corrected in an appended note, not edited out; a revised decision is a new ADR that supersedes this one.

## Context

- **Issue #863**, the AI layer [ADR 0238](0238-screen-a-note-by-rules-in-the-publish-note-function-keyed-by-a-hash-of-its-text-and-let-no-client-write-make-a-deck-public.md) left as a hand-off: `private.required_screening_layers()` and the `unsure` outcome. The model evaluation that picks the models is #864; the admin screen for the settings below is #866.
- **What rules cannot see.** Sexual content, hate, violence, illegal trade, self-harm, harassment and spam that holds no number or link are words in context. A banned word alone refused a note under ADR 0238 although the same word teaches a medical, legal or language note.
- **What a call costs.** Every public note is a call, and a note that does not change is screened again only when its text does.

## Decision

- **A layer `ai`**, required beside `rules`: `private.required_screening_layers()` is `array['rules', 'ai']`. The function calls it only for a note the rules passed or found a banned word alone in; a note the rules refused, or found severe, is decided without a call.
- **The call is server-side only**, in `publish-note`, through OpenRouter with the key in Vault, the path card extraction takes ([ADR 0162](0162-choose-each-plan-s-ai-provider-in-admin-keep-provider-keys-in-vault-and-apply-a-configuration-only-after-a-check-call-and-an-admin-s-trial.md) names its providers). A card's photos go as images, read from the `media` bucket with the service role.
- **Categories:** personal data, spam, sexual (minors above all), hate, violence, illegal trade, self-harm and harassment. Copyright is not judged.
- **A cascade.** A cheap model reads the note first. Its clean or severe verdict at or above a confidence floor stands. Anything else, unsure or under the floor, goes to a strong model, whose verdict at or above the floor stands and otherwise is unsure.
- **Outcomes.** Clean lets the note be public once the rules are clean. Unsure holds it (`검토 중`, hold `ai`) for the admin queue. Severe refuses it, records the verdict as a violation of its owner, and the owner reads the categories and where, never the text.
- **A bounded payload.** The name and description, then the cards the rules flagged, then a random sample of the others, fixed by the note's hash so the same text always sends the same sample, up to a token cap and a photo cap. A card goes whole or not at all.
- **One verdict per note by hash.** The `ai` verdict is stored in `private.screening_verdicts` under its settings version; a stored decision for the hash is reused whatever the settings now are, so an edit and an undo, and a republish, cost one call. A verdict that could not decide is stored as `unsure` with the version `unavailable`, which no later request reuses.
- **Versioned settings, nothing fixed to a model.** `private.screening_settings` is append-only and its latest row is in force: both models, the confidence floor, the sample size, the token and photo caps, the daily cap, the price charged for a call that reports none, and the prompt. An admin saves a version through an audited function that records the models and the cap, never the prompt. A migration seeds the first, whose models stand until #864 chooses.
- **A daily spend cap.** `private.screening_calls` records each call's tier, model, tokens and cost, never any text. The day is the Asia/Seoul one. Before each call, the strong one included, the function reads the day's sum; at the cap it makes no call and the note is held for a person. A call that reports no cost is charged the settings' assumed price.
- **A banned word alone no longer refuses.** This supersedes ADR 0238's rule that a banned term refuses a note. The rules layer records `unsure` for a note whose findings are all banned words, and the database counts an `unsure` only from the `ai` layer, so the model decides it: clean publishes, unsure is held, severe is refused. Any other category (resident number, account, phone, link, messenger id, contact prompt, repeated promotion) refuses at once, and with a banned word beside it the note is refused too. With the model unavailable or over the cap a banned-word note is held, not refused and not published. `RULES_VERSION` is 3 so the stored verdicts of the old rules are made again.
- **Findings keep their field.** `private.screening_findings`, and so `admin_screening_findings` and `my_deck_screening`, answer each finding's `field`, the path of the string its offsets index. A model's finding names the card and the place and carries no offsets.
- **No text is logged or stored.** The function's log holds ids, the layer's outcome, categories and the reason a call was not made.
- **The sweeper's key.** The Vault secret `assistant_service_role_key` holds the value the platform sets as the functions' `SUPABASE_SERVICE_ROLE_KEY`: on a project with the new API keys, the `sb_secret_…` secret key, not the legacy `service_role` JWT, which `/work` answers 401.
- **The migration** `20261110160000_screening_ai.sql` adds the two tables and the functions, replaces four functions and changes no row. It adds a model cost, so it merges with the owner's approval ([`server.md`](../server.md) §Edge Function deploys, "Gate"). Its revert is `private.revert_screening_ai()`.

## Alternatives considered

- **One model.** A strong model on every note costs more for the great majority that are clean; a cheap one alone is wrong on the notes that matter.
- **Judging every card.** Cost grows with the note; a flagged card and a fixed sample bound it, and the rules already read every card.
- **A verdict per settings version,** screening a note again when the prompt changes. A prompt edit would re-run the whole public catalog under the cap; an admin who wants a note judged again can hold and allow it.
- **A banned word refusing, with an appeal.** A false refusal tells the owner their study material is abuse; a held note says only that a person will look.
- **Failing open when the model is down,** publishing on the rules alone. A cost cap would then be a switch to publish unscreened notes.

## Consequences

- **A note waits for a model.** A public note's edit is hidden for the rules, a call or two and the sweeper's minute. A note held for a cap or an outage reaches the admin queue.
- **Existing public notes are screened too.** The backfill's notes with no decided hash are asked by the sweeper, 20 a minute, and are held if the model is unavailable or the cap is reached.
- **A model cost.** The owner approves the first settings and the cap at the Gate; the seeded cap and models are placeholders until #864.
- **A photo is judged when it is in the sample,** up to the photo cap; the others of a large note are not.
- **The `ai` layer is reused by hash, not by settings:** a better model later does not re-judge what was decided.
- **The rules layer's `unsure`** is a value only the rules layer records, and `apply_screening` ignores it from any other layer.
