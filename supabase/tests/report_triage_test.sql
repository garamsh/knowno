-- A reported note is judged once by a model (#887, ADR 0244): only from its second distinct
-- reporter, one verdict per content hash, within a daily spend cap and a daily notes cap, and
-- judge-only by default; acting hides spam or an ad and dismisses false reports above a threshold,
-- never acts on copyright and the other categories, audits each action as AI, undoes it by one
-- admin function, samples it for a person, pauses on the undo rate, and compares verdicts with the
-- admins' decisions; the owner appeals once; the configuration is append-only and activated only
-- with the providers' keys; the sweeper and the severe trigger; no client reaching the service
-- functions; and the revert. Each rule has a control that a near miss cannot pass.
begin;
select plan(182);

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

-- The agreement with the admins' own decisions, in judge-only mode so that nothing acts.
update private.triage_settings set mode = 'judge_only';
create function pg_temp.decide(n text, act text, ago interval default '0 seconds') returns void
language sql security definer as $$
  insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, created_at)
    values ('00000000-0000-4000-8000-00000000000c', 'admin@example.com', act, 'deck',
      pg_temp.id(n)::text, now() - ago);
$$;
select pg_temp.reported('40');
select pg_temp.reported('41');
select pg_temp.reported('42');
select pg_temp.reported('43');
select pg_temp.reported('44');
select pg_temp.judge('40', 'spam', 0.99);
select pg_temp.judge('41', 'spam', 0.99);
select pg_temp.judge('42', 'ok', 0.99);
select pg_temp.judge('43', 'other', 0.99);
select pg_temp.judge('44', 'spam', 0.99);
select pg_temp.decide('40', 'hide_deck');
select pg_temp.decide('40', 'allow_deck');
select pg_temp.decide('41', 'allow_deck');
select pg_temp.decide('42', 'dismiss_reports');
select pg_temp.decide('43', 'hide_deck');
select pg_temp.decide('44', 'hide_deck', '1 day');
select pg_temp.sign_in('c');
select results_eq($$select category, compared, agreed from public.admin_triage_agreement()$$,
  $$values ('ok'::text, 1::bigint, 1::bigint), ('spam'::text, 2::bigint, 1::bigint)$$,
  'agreement: the first decision after the verdict counts, other and an earlier decision do not');
select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_triage_agreement()$$, '42501', null, 'a user who is not an admin cannot read it');
reset role;

-- The settings.
select pg_temp.sign_in('c');
select is((select mode || '/' || daily_cap_usd || '/' || act_threshold from public.admin_triage_settings()),
  'judge_only/0.5/0.9', 'the settings are read');
select is(public.admin_set_triage_settings(mode => 'acting', daily_cap_usd => 0.75), true, 'an admin sets the mode and the cap');
select is((select mode || '/' || daily_cap_usd || '/' || act_threshold from public.admin_triage_settings()),
  'acting/0.75/0.9', 'what was given changed, the rest stayed');
select is(pg_temp.audited('set_triage_settings'), 1::bigint, 'the change is audited');
select throws_ok($$select public.admin_set_triage_settings(mode => 'wild')$$, '23514', null, 'an unknown mode is refused');
select throws_ok($$select public.admin_set_triage_settings(act_threshold => 0.2)$$, '23514', null, 'a threshold under a half is refused');
select throws_ok($$select public.admin_set_triage_settings(sample_percent => 101)$$, '23514', null, 'a sample over a hundred percent is refused');
select throws_ok($$select public.admin_set_triage_settings(daily_cap_usd => -1)$$, '23514', null, 'a negative cap is refused');
select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_triage_settings()$$, '42501', null, 'a user who is not an admin cannot read the settings');
select throws_ok($$select public.admin_set_triage_settings(mode => 'acting')$$, '42501', null, 'nor change them');
reset role;

-- The sample: a sampled action waits for a person, an unsampled one does not.
update private.triage_settings set undo_threshold = 1, sample_percent = 100, daily_cap_usd = 5;
select pg_temp.reported('30');
select is(pg_temp.judge('30', 'spam', 0.99), 'hidden', 'acting hides note 30');
update private.triage_settings set sample_percent = 0;
select pg_temp.reported('31');
select is(pg_temp.judge('31', 'spam', 0.99), 'hidden', 'acting hides note 31');
select pg_temp.sign_in('c');
select is((select count(*) from public.admin_triage_sample() where deck_id = pg_temp.id('30')), 1::bigint,
  'the sampled action is queued for a person');
select is((select count(*) from public.admin_triage_sample() where deck_id = pg_temp.id('31')), 0::bigint,
  'the unsampled one is not');
select is(public.admin_recheck_triage_action(pg_temp.action('31'), true), 'not_sampled', 'an unsampled action is not rechecked');
select is(public.admin_recheck_triage_action(0, true), 'not_found', 'an unknown action is not found');
select is(public.admin_recheck_triage_action(pg_temp.action('30'), true), 'rechecked', 'a person rechecks the sampled action');
select is(public.admin_recheck_triage_action(pg_temp.action('30'), false), 'already', 'only once');
select is((select count(*) from public.admin_triage_sample() where deck_id = pg_temp.id('30')), 0::bigint,
  'a rechecked action leaves the queue');
select is(pg_temp.audited('recheck_triage_action'), 1::bigint, 'the recheck is audited');
select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_triage_sample()$$, '42501', null, 'a user who is not an admin cannot read the sample');
reset role;

create function pg_temp.undone(n text) returns boolean language sql security definer as $$
  select undone_at is not null from private.triage_actions where id = pg_temp.action(n);
$$;

-- The undo-rate pause. Six actions stand, two undone; undoing one more makes it exactly a half.
select pg_temp.sign_in('c');
select is(public.admin_undo_triage_action(pg_temp.action('25')), 'undone', 'a third action is undone');
reset role;
update private.triage_settings set undo_threshold = 0.5;
select pg_temp.reported('32');
select is(pg_temp.judge('32', 'spam', 0.99), 'hidden', 'exactly at the threshold: not above it, still acting');
update private.triage_settings set undo_min_actions = 8, undo_threshold = 0.1;
select pg_temp.reported('33');
select is(pg_temp.judge('33', 'spam', 0.99), 'hidden', 'seven actions, under the minimum of eight: still acting');
select pg_temp.reported('34');
select is(pg_temp.judge('34', 'spam', 0.99), 'paused', 'eight actions and the rate above the threshold: paused');
select is(pg_temp.state('34'), 'public/false', 'the note is not hidden');
select is((select paused_reason from private.triage_settings), 'undo_rate', 'the reason is kept');
select is(pg_temp.audited('pause_triage'), 1::bigint, 'the pause is audited');
select is((select admin_id is null and admin_email = 'ai' from private.admin_audit where action = 'pause_triage'), true,
  'as the automation');
select pg_temp.reported('35');
select is(pg_temp.judge('35', 'spam', 0.99), 'recorded', 'while paused the verdict is recorded and nothing acts');
select is(pg_temp.state('35'), 'public/false', 'and the note is not hidden');
select pg_temp.sign_in('b');
select throws_ok($$select public.admin_resume_triage()$$, '42501', null, 'a user who is not an admin cannot resume');
reset role;
update private.triage_settings set undo_threshold = 0.9;
select pg_temp.sign_in('c');
select is(public.admin_resume_triage(), true, 'an admin resumes it');
select is(public.admin_resume_triage(), false, 'a second resume does nothing');
select is(pg_temp.audited('resume_triage'), 1::bigint, 'the resume is audited');
select is((select round(undo_rate, 2) from public.admin_triage_settings()), 0.38, 'the settings show the undo rate');
reset role;
select pg_temp.reported('36');
select is(pg_temp.judge('36', 'spam', 0.99), 'hidden', 'with the threshold raised and resumed, it acts again');

-- The appeal: once, by the owner, of a note the AI hid.
select pg_temp.note('50', 'a');
update public.decks set hidden = true, publication = 'held' where id = pg_temp.id('50');
insert into private.deck_screening (deck_id, hold) values (pg_temp.id('50'), 'admin');
select pg_temp.sign_in('b');
select is(public.appeal_ai_hidden_note(pg_temp.id('36')), 'not_hidden_by_ai', 'another user cannot appeal');
select is(public.my_triage_state(pg_temp.id('36')), null, 'and sees nothing of it');
reset role;
select pg_temp.sign_in('a');
select is((public.my_triage_state(pg_temp.id('36')) ->> 'hidden_by_ai')::boolean, true, 'the owner sees the AI hid it');
select is((public.my_triage_state(pg_temp.id('36')) ->> 'appealed')::boolean, false, 'with no appeal yet');
select is(public.appeal_ai_hidden_note(pg_temp.id('50')), 'not_hidden_by_ai', 'a note an admin hid is not appealed here');
select is(public.appeal_ai_hidden_note(pg_temp.id('36')), 'appealed', 'the owner appeals');
select is(public.appeal_ai_hidden_note(pg_temp.id('36')), 'already', 'only once');
select is((public.my_triage_state(pg_temp.id('36')) ->> 'appealed')::boolean, true, 'the state shows the appeal');
reset role;
select pg_temp.sign_in('c');
select is((select count(*) from public.admin_triage_appeals() where deck_id = pg_temp.id('36')), 1::bigint,
  'a person sees the appeal');
select is((select category || coalesce(passage, '') from public.admin_triage_appeals()), 'spama passage', 'with the verdict and its passage');
select is(public.admin_resolve_triage_appeal(pg_temp.id('36'), false), 'upheld', 'a person upholds the hide');
select is(pg_temp.state('36'), 'held/true', 'the note stays hidden');
select is(public.admin_resolve_triage_appeal(pg_temp.id('36'), false), 'not_found', 'a resolved appeal is not open');
select is((select count(*) from public.admin_triage_appeals()), 0::bigint, 'the list is empty');
reset role;
select pg_temp.sign_in('a');
select is(public.appeal_ai_hidden_note(pg_temp.id('36')), 'already', 'a resolved appeal is not made again');
select is((public.my_triage_state(pg_temp.id('36')) ->> 'resolved')::boolean, true, 'the state shows it resolved');
select is(public.appeal_ai_hidden_note(pg_temp.id('32')), 'appealed', 'another AI-hidden note is appealed');
reset role;
select pg_temp.sign_in('c');
select is(public.admin_resolve_triage_appeal(pg_temp.id('32'), true), 'restored', 'a person restores it');
select is(pg_temp.state('32'), 'public/false', 'the note is shown again');
select is(pg_temp.undone('32'), true, 'the action is undone');
reset role;

-- The configuration: saved as a draft, activated only with both providers' keys, never changed.
select throws_ok($$select public.save_triage_configuration('00000000-0000-4000-8000-00000000000b',
  'anthropic', 'claude-haiku-5-5', 'openrouter', 'acme/strong', 'p', 1, 5, 3, 15, 0.7, 3000, 5)$$,
  '42501', null, 'an id that is not an admin saves nothing');
select throws_ok($$select public.save_triage_configuration('00000000-0000-4000-8000-00000000000c',
  'anthropic', 'bad model', 'openrouter', 'acme/strong', 'p', 1, 5, 3, 15, 0.7, 3000, 5)$$,
  '23514', null, 'a model that does not fit its provider is refused');
select lives_ok($$select public.save_triage_configuration('00000000-0000-4000-8000-00000000000c',
  'anthropic', 'claude-haiku-5-5', 'openrouter', 'acme/strong', 'New prompt', 1, 5, 3, 15, 0.7, 3000, 5)$$,
  'an admin saves a draft');
select pg_temp.sign_in('c');
select is((select count(*) from public.admin_triage_configurations() where label = 'test' and prompt = 'New prompt'),
  1::bigint, 'the draft is listed');
select is(public.admin_activate_triage_configuration(), 'no_key', 'no key at all: not activated');
reset role;
insert into private.provider_keys (provider, secret_id, last_four)
  values ('anthropic', vault.create_secret('sk-ant-test-0000'), '0000');
select pg_temp.sign_in('c');
select is(public.admin_activate_triage_configuration(), 'no_key', 'the strong tier''s key missing: not activated');
reset role;
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-0000'), '0000');
select pg_temp.sign_in('b');
select throws_ok($$select public.admin_activate_triage_configuration()$$, '42501', null, 'a user who is not an admin cannot activate');
select pg_temp.sign_in('c');
select is(public.admin_activate_triage_configuration(), 'activated', 'both keys present: activated');
select is((select count(*) from public.admin_triage_configurations() where label = 'test'), 0::bigint, 'the draft label is gone');
select is((select prompt from public.admin_triage_configurations() where label = 'active'), 'New prompt', 'the draft is active');
select is(public.admin_activate_triage_configuration(), 'no_test', 'nothing left to activate');
select is(pg_temp.audited('activate_triage_configuration'), 1::bigint, 'the activation is audited');
reset role;
select throws_ok($$update private.triage_configurations set prompt = 'x'$$, '55000', null, 'a saved configuration is never changed');
select throws_ok($$delete from private.triage_configurations$$, '55000', null, 'or removed');
select public.save_triage_configuration('00000000-0000-4000-8000-00000000000c',
  'anthropic', 'claude-haiku-5-5', 'anthropic', 'claude-sonnet-5-5', 'Another', 1, 5, 3, 15, 0.7, 3000, 5);
select pg_temp.sign_in('c');
select is(public.admin_clear_triage_test(), true, 'an admin clears the draft');
select is(public.admin_clear_triage_test(), false, 'a second clear does nothing');
select is((select count(*) from public.admin_triage_configurations()), 1::bigint, 'only the active one is left');
reset role;

-- No client reaches the service functions or the admin ones without being an admin.
select pg_temp.sign_in('a');
select throws_ok($$select * from public.triage_due()$$, '42501', null, 'a signed-in user cannot list the due notes');
select throws_ok($$select public.triage_claim(gen_random_uuid())$$, '42501', null, 'nor claim one');
select throws_ok($$select public.record_triage(null::uuid, null, null, null, null, null, null, null, null, null, null, null, null, null, null)$$,
  '42501', null, 'nor record a verdict');
select throws_ok($$select public.save_triage_configuration(null::uuid, null, null, null, null, null, null, null, null, null, null, null, null)$$,
  '42501', null, 'nor save a configuration');
select throws_ok($$select public.admin_recheck_triage_action(1, true)$$, '42501', null, 'nor recheck an action');
select throws_ok($$select * from public.admin_triage_appeals()$$, '42501', null, 'nor read the appeals');
reset role;
set local role anon;
select throws_ok($$select * from public.admin_triage_queue()$$, '42501', null, 'a visitor cannot read the queue');
select throws_ok($$select public.appeal_ai_hidden_note(gen_random_uuid())$$, '42501', null, 'nor appeal');
reset role;

-- The sweeper and the severe trigger.
create function pg_temp.sweep() returns bigint language plpgsql security definer as $$
begin
  delete from net.http_request_queue;
  perform private.sweep_report_triage();
  return (select count(*) from net.http_request_queue);
end;
$$;
create function pg_temp.queued() returns bigint language sql security definer as $$
  select count(*) from net.http_request_queue;
$$;
select is(pg_temp.due(), '01,02,03', 'three notes are due');
select is(pg_temp.sweep(), 0::bigint, 'a due note and no secrets: nothing requested');
select vault.create_secret('https://example.supabase.co/functions/v1/triage-reports', 'triage_function_url');
select is(pg_temp.sweep(), 0::bigint, 'a due note and no key: nothing requested');
select vault.create_secret('service-key', 'assistant_service_role_key');
select is(pg_temp.sweep(), 1::bigint, 'a due note and both secrets: the worker requested once');
select results_eq($$select method::text, url, headers ->> 'Authorization', convert_from(body, 'utf8')::jsonb ->> 'severe' from net.http_request_queue$$,
  $$values ('POST', 'https://example.supabase.co/functions/v1/triage-reports/work', 'Bearer service-key', 'false')$$,
  'a POST to the work route with the service key, not severe');
update private.triage_settings set daily_cap_usd = 0;
select is(pg_temp.sweep(), 0::bigint, 'the spend cap closed: nothing requested');
update private.triage_settings set daily_cap_usd = 5;
select is(pg_temp.sweep(), 1::bigint, 'the cap open again: requested');
select is((select schedule from cron.job where jobname = 'sweep-report-triage'), '*/5 * * * *', 'cron runs it every five minutes');
select pg_temp.sign_in('a');
select throws_ok($$select private.sweep_report_triage()$$, '42501', null, 'no client reaches the sweep');
reset role;

delete from net.http_request_queue;
select pg_temp.note('60', 'a');
select pg_temp.report('60', 'd', 'inappropriate');
select is(pg_temp.queued(), 0::bigint, 'one inappropriate report: nothing requested');
select pg_temp.report('60', 'e', 'inappropriate');
select is(pg_temp.queued(), 1::bigint, 'the second reporter of an inappropriate report: the worker requested at once');
select is((select convert_from(body, 'utf8')::jsonb ->> 'severe' from net.http_request_queue), 'true', 'as severe');
delete from net.http_request_queue;
select pg_temp.note('61', 'a');
select pg_temp.report('61', 'd', 'spam');
select pg_temp.report('61', 'e', 'spam');
select is(pg_temp.queued(), 0::bigint, 'two spam reports wait for the batch');
update private.triage_settings set daily_cap_usd = 0;
select pg_temp.note('62', 'a');
select pg_temp.report('62', 'd', 'inappropriate');
select pg_temp.report('62', 'e', 'inappropriate');
select is(pg_temp.queued(), 0::bigint, 'a severe report with the spend cap closed requests nothing');

-- The revert.
select lives_ok($$select private.revert_report_triage()$$, 'the revert runs');
select is((select count(*) from cron.job where jobname = 'sweep-report-triage'), 0::bigint, 'the job is gone');
select is((select count(*) from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'private' and c.relname like 'triage\_%'), 0::bigint, 'its tables are gone');
select is((select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname like '%triage%' and p.proname <> 'revert_report_triage'),
  0::bigint, 'and its functions');
select is((select count(*) from pg_trigger where tgname = 'triage_severe_report'), 0::bigint, 'and its trigger');

select * from finish();
rollback;
