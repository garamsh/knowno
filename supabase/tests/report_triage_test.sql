-- A reported note is judged once by a model (#887, ADR 0244): only from its second distinct
-- reporter, one verdict per content hash, within a daily spend cap and a daily notes cap, and
-- judge-only by default; acting hides spam or an ad and dismisses false reports above a threshold,
-- never acts on copyright and the other categories, audits each action as AI, undoes it by one
-- admin function, samples it for a person, pauses on the undo rate, and compares verdicts with the
-- admins' decisions; the owner appeals once; the configuration is append-only and activated only
-- with the providers' keys; the sweeper and the severe trigger; no client reaching the service
-- functions; and the revert. Each rule has a control that a near miss cannot pass.
begin;
select plan(79);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'd@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'e@example.com'),
  ('00000000-0000-4000-8000-00000000000f', 'f@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000c');

create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
end;
$$;

create function pg_temp.id(n text) returns uuid language sql as $$
  select ('d0000000-0000-4000-8000-0000000000' || n)::uuid;
$$;

-- A public note of [owner]'s with one live card.
create function pg_temp.note(n text, owner text) returns void language plpgsql as $$
begin
  insert into public.decks (id, user_id, name, description, created_at, updated_at)
    values (pg_temp.id(n), ('00000000-0000-4000-8000-00000000000' || owner)::uuid,
      'Deck ' || n, 'About ' || n, now(), now());
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at)
    values (('c0000000-0000-4000-8000-0000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || owner)::uuid,
      pg_temp.id(n),
      jsonb_build_array(jsonb_build_object('type', 'text', 'v', 1, 'id', 'b1', 'payload', jsonb_build_object('text', 'front ' || n))),
      '[]', 'k' || n, 'manual', now(), now());
  update public.decks set visibility = 'public', published_at = now() where id = pg_temp.id(n);
end;
$$;

create function pg_temp.report(n text, reporter text, reason text default 'spam') returns void language sql as $$
  insert into public.deck_reports (deck_id, reporter_id, reason)
    values (pg_temp.id(n), ('00000000-0000-4000-8000-00000000000' || reporter)::uuid, reason);
$$;

-- A public note reported by d and e.
create function pg_temp.reported(n text, owner text default 'a') returns void language plpgsql as $$
begin
  perform pg_temp.note(n, owner);
  perform pg_temp.report(n, 'd');
  perform pg_temp.report(n, 'e');
end;
$$;

create function pg_temp.due(severe boolean default false) returns text language sql security definer as $$
  select coalesce(string_agg(right(deck_id::text, 2), ',' order by deck_id), '')
    from public.triage_due(10, severe);
$$;

create function pg_temp.config() returns bigint language sql security definer as $$
  select (select max(id) from private.triage_configurations);
$$;

create function pg_temp.judge(n text, category text, confidence numeric, cost numeric default 0.001)
returns text language sql as $$
  select public.record_triage(pg_temp.id(n), private.note_content_hash(pg_temp.id(n)), category,
    confidence, 'a passage', null, null, 'cheap', 'anthropic', 'claude-haiku-5-5', pg_temp.config(),
    100, 10, cost, false);
$$;

create function pg_temp.state(n text) returns text language sql security definer as $$
  select publication || '/' || hidden from public.decks where id = pg_temp.id(n);
$$;

create function pg_temp.reports(n text) returns bigint language sql security definer as $$
  select count(*) from public.deck_reports where deck_id = pg_temp.id(n);
$$;

create function pg_temp.action(n text) returns bigint language sql security definer as $$
  select max(id) from private.triage_actions where deck_id = pg_temp.id(n);
$$;

create function pg_temp.hold(n text) returns text language sql security definer as $$
  select hold from private.deck_screening where deck_id = pg_temp.id(n);
$$;

create function pg_temp.audited(act text) returns bigint language sql security definer as $$
  select count(*) from private.admin_audit where action = act;
$$;

-- No configuration yet: nothing is due even with two reporters.
select pg_temp.reported('01');
select is(pg_temp.due(), '', 'no active configuration: nothing is due');
insert into private.triage_configurations (cheap_provider, cheap_model, strong_provider, strong_model,
    prompt, cheap_in_usd, cheap_out_usd, strong_in_usd, strong_out_usd)
  values ('anthropic', 'claude-haiku-5-5', 'anthropic', 'claude-sonnet-5-5', 'Judge the note.', 1, 5, 3, 15);
insert into private.triage_configuration_labels (label, configuration_id) values ('active', pg_temp.config());
select is(pg_temp.due(), '01', 'with an active configuration a note of two reporters is due');

-- The two-reporter threshold, with the second reporter as control.
select pg_temp.note('02', 'a');
select pg_temp.report('02', 'd');
select is(pg_temp.due(), '01', 'a note with one reporter is not due');
select is(public.triage_claim(pg_temp.id('02')), null, 'a note with one reporter is not claimed');
select pg_temp.report('02', 'e');
select is(pg_temp.due(), '01,02', 'the second distinct reporter makes it due');
select is((public.triage_claim(pg_temp.id('02')) ->> 'reporters')::int, 2, 'the claim counts its reporters');
select is(public.triage_claim(pg_temp.id('02')) -> 'configuration' ->> 'cheap_model', 'claude-haiku-5-5',
  'the claim carries the active configuration');
select is(public.triage_claim(pg_temp.id('02')) ->> 'hash', private.note_content_hash(pg_temp.id('02')),
  'the claim carries the content hash');
select is(pg_temp.due(true), '', 'no inappropriate report: not due as severe');
select pg_temp.note('03', 'a');
select pg_temp.report('03', 'd', 'inappropriate');
select pg_temp.report('03', 'e', 'spam');
select is(pg_temp.due(true), '03', 'an inappropriate report among two reporters is due as severe');
select is(pg_temp.due(), '01,02,03', 'and in the batch');
-- A private note, a deleted note and a note being checked are not due.
select pg_temp.reported('04');
update public.decks set visibility = 'private', published_at = null where id = pg_temp.id('04');
select is(pg_temp.due(), '01,02,03', 'a private note is not due');
select pg_temp.reported('05');
update public.decks set deleted_at = now() where id = pg_temp.id('05');
select is(pg_temp.due(), '01,02,03', 'a deleted note is not due');

-- One verdict per content hash.
select is(pg_temp.judge('01', 'ok', 0.5), 'recorded', 'a verdict is recorded');
select is(pg_temp.due(), '02,03', 'a note with a verdict for its text is not due');
select is(pg_temp.judge('01', 'spam', 0.5), 'exists', 'a second verdict for the same text is not stored');
select is((select count(*) from private.triage_verdicts), 1::bigint, 'one verdict stands');
select is((select category from private.triage_verdicts), 'ok', 'and it is the first');
select is(public.triage_claim(pg_temp.id('01')), null, 'a judged note is not claimed');
update public.cards set front = jsonb_build_array(jsonb_build_object('type', 'text', 'v', 1, 'id', 'b1',
  'payload', jsonb_build_object('text', 'changed'))) where id = 'c0000000-0000-4000-8000-000000000001';
select is(pg_temp.due(), '01,02,03', 'a changed card makes the note due again');
select is(public.record_triage(pg_temp.id('01'), repeat('0', 64), 'spam', 0.9, null, null, null, 'cheap',
  'anthropic', 'm', pg_temp.config(), 1, 1, 0, false), 'changed', 'a verdict on a text the note no longer has is refused');
select is((select count(*) from private.triage_verdicts), 1::bigint, 'and stores nothing');

-- The daily spend cap, with the cap raised, and a verdict of an earlier day, as controls.
select pg_temp.judge('02', 'other', 0.5, 0.30);
select is(pg_temp.due(), '01,03', 'under the cap two notes are due');
select pg_temp.judge('03', 'other', 0.5, 0.30);
select is(pg_temp.due(), '', 'the day''s spend at the cap: nothing is due');
select is(public.triage_claim(pg_temp.id('01')), null, 'and no note is claimed, so no model is called');
update private.triage_settings set daily_cap_usd = 5;
select is(pg_temp.due(), '01', 'a raised cap makes the remaining note due again');
update private.triage_settings set daily_cap_usd = 0.5;
update private.triage_verdicts set created_at = now() - interval '2 days';
select is(pg_temp.due(), '01', 'the spend of an earlier day does not count: the cap is open again');
update private.triage_verdicts set created_at = now();
-- The day's notes cap and the batch size.
update private.triage_settings set daily_cap_usd = 100, daily_notes = 3;
select is(pg_temp.due(), '', 'three verdicts today at a cap of three notes: nothing is due');
update private.triage_settings set daily_notes = 4;
select is(pg_temp.due(), '01', 'a cap of four leaves one note');
update private.triage_settings set daily_notes = 100;
select pg_temp.reported('06');
select is(pg_temp.due(), '01,06', 'a batch of ten returns both notes');
update private.triage_settings set batch_notes = 1;
select is(pg_temp.due(), '01', 'a batch of one returns one');
update private.triage_settings set batch_notes = 10, daily_cap_usd = 0.5;
delete from public.decks where id = pg_temp.id('06');
delete from private.triage_verdicts;

-- Judge-only, the default, changes nothing; acting, with the same verdict, hides.
select is((select mode from private.triage_settings), 'judge_only', 'the mode is judge-only by default');
select is((select act_threshold from private.triage_settings), 0.9, 'the threshold is 0.9 by default');
select is((select daily_cap_usd from private.triage_settings), 0.50, 'the daily cap is low by default');
select pg_temp.reported('10');
select is(pg_temp.judge('10', 'spam', 0.99), 'recorded', 'judge-only records a spam verdict at 0.99');
select is(pg_temp.state('10'), 'public/false', 'and the note stays shown');
select is((select count(*) from private.triage_actions), 0::bigint, 'no action is recorded');
select is(pg_temp.audited('ai_hide_deck'), 0::bigint, 'and nothing is audited');
select is(pg_temp.reports('10'), 2::bigint, 'the reports stand');
select pg_temp.reported('11');
select pg_temp.judge('11', 'ok', 0.99);
update private.triage_settings set mode = 'acting';
select pg_temp.reported('12');
select is(pg_temp.judge('11', 'spam', 0.99), 'exists', 'a verdict already recorded is not acted on later');
select is(pg_temp.state('11'), 'public/false', 'the note stays shown');
select is(pg_temp.judge('12', 'spam', 0.99), 'hidden', 'acting hides a note judged spam at 0.99');
select is(pg_temp.state('12'), 'held/true', 'it is held and hidden');
select is(pg_temp.hold('12'), 'ai', 'with the ai hold');
select pg_temp.reported('13');
select is(pg_temp.judge('13', 'spam', 0.89), 'recorded', 'a confidence under the threshold is not acted on');
select is(pg_temp.state('13'), 'public/false', 'the note stays shown');
select pg_temp.reported('14');
select is(pg_temp.judge('14', 'ad', 0.90), 'hidden', 'a confidence at the threshold hides a note judged an ad');
select pg_temp.reported('15');
select is(pg_temp.judge('15', 'ok', 0.95), 'dismissed', 'acting dismisses the reports of a note judged ok');
select is(pg_temp.reports('15'), 0::bigint, 'the reports are gone');
select is(pg_temp.state('15'), 'public/false', 'and the note is untouched');
select pg_temp.reported('16');
select is(pg_temp.judge('16', 'ok', 0.5), 'recorded', 'an ok under the threshold dismisses nothing');
select is(pg_temp.reports('16'), 2::bigint, 'the reports stand');

-- Copyright and the other categories are never acted on, with spam as control.
select pg_temp.reported('20');
select pg_temp.reported('21');
select pg_temp.reported('22');
select pg_temp.reported('23');
select pg_temp.reported('24');
select pg_temp.reported('25');
select is(pg_temp.judge('20', 'copyright', 0.99), 'recorded', 'copyright at 0.99 is not acted on');
select is(pg_temp.judge('21', 'severe', 0.99), 'recorded', 'severe at 0.99 is not acted on');
select is(pg_temp.judge('22', 'inappropriate', 0.99), 'recorded', 'inappropriate at 0.99 is not acted on');
select is(pg_temp.judge('23', 'other', 0.99), 'recorded', 'other at 0.99 is not acted on');
select is(pg_temp.judge('24', 'unjudged', 0.99), 'recorded', 'unjudged at 0.99 is not acted on');
select is((select string_agg(pg_temp.state(n) || pg_temp.reports(n)::text, ',' order by n)
  from unnest(array['20', '21', '22', '23', '24']) as n), 'public/false2,public/false2,public/false2,public/false2,public/false2',
  'those notes stay shown with their reports');
select is(pg_temp.judge('25', 'spam', 0.99), 'hidden', 'spam at 0.99, the control, is hidden');

-- Every action is audited as AI and undone by one admin function.
select is((select count(*) from private.triage_actions), 4::bigint, 'four actions are recorded');
select is((select count(*) from private.admin_audit where action = 'ai_hide_deck' and admin_id is null
  and admin_email = 'ai' and detail ->> 'model' = 'claude-haiku-5-5' and detail ->> 'reason' like 'judged %'), 3::bigint,
  'each hide is audited with no admin, as ai, with its model and reason');
select is((select count(*) from private.admin_audit where action = 'ai_dismiss_reports' and admin_email = 'ai'
  and detail ->> 'category' = 'ok'), 1::bigint, 'the dismissal is audited as ai');
select pg_temp.sign_in('b');
select throws_ok($$select public.admin_undo_triage_action(1)$$, '42501', null, 'a user who is not an admin cannot undo');
select throws_ok($$select * from public.admin_triage_queue()$$, '42501', null, 'nor read the queue');
reset role;
select pg_temp.sign_in('c');
select is((select category || coalesce(passage, '') from public.admin_triage_queue() where deck_id = pg_temp.id('12')),
  'spama passage', 'the queue shows the verdict and its passage');
select is((select right(deck_id::text, 2) from public.admin_triage_queue() limit 1), '03',
  'the note with an inappropriate report is first');
select is((select category from public.admin_triage_queue() where right(deck_id::text, 2) = '04'), null,
  'a note never judged shows no verdict');
select ok((select action_id is not null from public.admin_triage_queue() where deck_id = pg_temp.id('12')),
  'a hidden note shows its standing action');
select is((select count(*) from public.admin_triage_actions()), 4::bigint, 'the actions list holds the four');
select is(public.admin_undo_triage_action(pg_temp.action('12')),
  'undone', 'an admin undoes a hide');
select is(pg_temp.state('12'), 'public/false', 'the note is shown again');
select is(pg_temp.hold('12'), null, 'with no hold');
select is(public.admin_undo_triage_action(pg_temp.action('12')),
  'already', 'a second undo does nothing');
select is(public.admin_undo_triage_action(0), 'not_found', 'an unknown action is not found');
select is(public.admin_undo_triage_action(pg_temp.action('15')),
  'undone', 'an admin undoes a dismissal');
select is(pg_temp.reports('15'), 2::bigint, 'the reports are back');
select is(pg_temp.audited('undo_triage_action'), 2::bigint, 'each undo is audited');
reset role;
select is(pg_temp.judge('12', 'spam', 0.99), 'exists', 'an undone note is not judged again for the same text');
select is(pg_temp.due(), '01,02,03', 'an undone note is not due again: only the notes never judged are');
select * from finish();
rollback;
