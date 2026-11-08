-- The 말랑이 assistant's server side (#713, ADR 0190, ADR 0195): the seed of each plan's
-- configuration and token budget; a message started under the user's lock while the budget is not
-- spent and no other message runs, and not without a key; what a turn used recorded once under the
-- lock, which charges it; the allowance; a draft saved, served to admins, applied and ended; a
-- budget set; every write recorded; configurations append-only; no client reaching the tables or
-- the service functions; and both reverts.
begin;
select plan(96);

delete from private.admin_audit;
-- The card-form skills' migration gives each plan a draft sending prompt v2, which
-- card_form_skills_test.sql tests; this file tests the assistant without them.
delete from private.assistant_configuration_labels where label = 'test';

-- A is an admin, so on 스페셜; B is on Free; both from long ago.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format(
      '{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- What the assistant gets for one message of the user whose id ends in [who].
create function pg_temp.start(who text)
returns table (configuration_id bigint, provider text, model text, available boolean,
  token_budget bigint, tokens_used bigint, busy boolean, allowed boolean, message_id bigint)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.configuration_id, b.provider, b.model, b.available, b.token_budget,
    b.tokens_used, b.busy, b.allowed, b.message_id
    from public.begin_assistant_message(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- Records [message]'s turn as service_role does, with [outcome].
create function pg_temp.finish(message bigint, outcome text) returns void language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  perform public.finish_assistant_message(message, outcome, 2, 3000, 400, 50, 1, 4200);
  perform set_config('role', 'none', true);
end;
$$;

create function pg_temp.last_message(who text) returns bigint language sql stable as $$
  select max(id) from private.assistant_messages
  where user_id = ('00000000-0000-4000-8000-00000000000' || who)::uuid;
$$;

create function pg_temp.config(plan text, label text) returns bigint language sql stable as $$
  select configuration_id from private.assistant_configuration_labels as l
  where l.plan = config.plan and l.label = config.label;
$$;

create function pg_temp.messages(who text) returns bigint language sql stable as $$
  select count(*) from private.assistant_messages
  where user_id = ('00000000-0000-4000-8000-00000000000' || who)::uuid;
$$;

-- The seed.

select results_eq(
  $$select l.plan, c.provider = p.provider and c.model = p.model, c.web_search, c.max_searches,
      c.reasoning_effort, v.note
    from private.assistant_configuration_labels as l
    join private.assistant_configurations as c on c.id = l.configuration_id
    join private.assistant_prompts as v on v.id = c.prompt_version_id
    join private.ai_configuration_labels as pl on pl.plan = l.plan and pl.label = 'active'
    join private.ai_configurations as p on p.id = pl.configuration_id
    where l.label = 'active'
    order by array_position(array['free', 'pro', 'max', 'special'], l.plan)$$,
  $$values ('free', true, false, 3, 'none', '말랑이 assistant prompt v1 (#713)'),
    ('pro', true, true, 3, 'none', '말랑이 assistant prompt v1 (#713)'),
    ('max', true, true, 3, 'none', '말랑이 assistant prompt v1 (#713)'),
    ('special', true, true, 3, 'none', '말랑이 assistant prompt v1 (#713)')$$,
  'each plan''s assistant is served its photo provider and model with the first prompt, search off for Free alone');
select results_eq(
  $$select plan, daily_tokens from private.assistant_token_budgets
    order by array_position(array['free', 'pro', 'max', 'special'], plan)$$,
  $$values ('free', 200000::bigint), ('pro', 2000000), ('max', 6000000), ('special', null)$$,
  'the daily budgets are 200,000, 2,000,000 and 6,000,000 tokens, and none for 스페셜');
select results_eq(
  $$select plan, daily_messages from private.assistant_limits
    order by array_position(array['free', 'pro', 'max', 'special'], plan)$$,
  $$values ('free', 10), ('pro', 100), ('max', 300), ('special', null::integer)$$,
  'the message limits stay as they were, for the revert');
select is((select count(*) from private.assistant_prompts), 2::bigint,
  'the first prompt and v2 are the assistant prompts');

-- No client reaches the tables or the service functions.

select pg_temp.sign_in('b');
select throws_ok($$select * from private.assistant_messages$$, '42501', null,
  'a signed-in user reads no message row');
select throws_ok($$select * from private.assistant_configurations$$, '42501', null,
  'a signed-in user reads no configuration');
select throws_ok($$select * from public.begin_assistant_message('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a signed-in user starts no message');
select throws_ok($$select private.assistant_tokens_today('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a signed-in user reads no charge');
select throws_ok($$select public.assistant_effort_fits('anthropic', 'claude-opus-5-5', 'none')$$,
  '42501', null, 'a signed-in user asks no effort check');
set local role service_role;
select results_eq(
  $$select public.assistant_effort_fits('anthropic', 'claude-opus-5-5', e)
    from (values ('none'), ('low')) as t (e)$$,
  $$values (false), (true)$$,
  'service_role asks whether a model runs at an effort, as the configurations are held to it');
reset role;
select pg_temp.sign_in('b');
select throws_ok($$select public.finish_assistant_message(1, 'ok', 1, 1, 1, 0, 0, 1)$$,
  '42501', null, 'a signed-in user records no turn');
select throws_ok($$select public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a',
  'free', 'openrouter', 'vendor/model')$$, '42501', null, 'a signed-in user saves no configuration');
reset role;
select results_eq(
  $$select p.proname::text collate "default", p.prosecdef and p.proconfig = array['search_path=""']
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ 'assistant' order by p.proname$$,
  $$values ('admin_activate_assistant_configuration', true), ('admin_assistant_configurations', true),
    ('admin_assistant_prompts', true), ('admin_assistant_token_budgets', true),
    ('admin_clear_assistant_test', true), ('admin_save_assistant_prompt', true),
    ('admin_set_assistant_token_budget', true), ('assistant_allowance', true), ('assistant_effort_fits', true),
    ('assistant_job', true), ('begin_assistant_message', true), ('cancel_assistant_job', true),
    ('finish_assistant_job_step', true), ('finish_assistant_message', true),
    ('next_assistant_job_step', true), ('save_assistant_configuration', true),
    ('start_assistant_job', true)$$,
  'every assistant function runs as its owner with an empty search_path');

-- Starting and charging messages.

select results_eq($$select available, allowed, message_id from pg_temp.start('b')$$,
  $$values (false, false, null::bigint)$$,
  'without OpenRouter''s key in Vault a message is unavailable');
select is(pg_temp.messages('b'), 0::bigint, 'and it is not recorded');

insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', gen_random_uuid(), '0000');
-- A message of B's from yesterday in Seoul, past Free's whole budget, which today leaves out.
insert into private.assistant_messages (user_id, plan, configuration_id, created_at, outcome,
    model_calls, input_tokens, output_tokens, reasoning_tokens, web_search_requests, latency_ms)
  values ('00000000-0000-4000-8000-00000000000b', 'free', pg_temp.config('free', 'active'),
    date_trunc('day', now(), 'Asia/Seoul') - interval '1 minute', 'ok', 1, 900000, 100000, 0, 0,
    1000);

select results_eq(
  $$select configuration_id = pg_temp.config('free', 'active'), provider, available,
      token_budget, tokens_used, busy, allowed, message_id is not null
    from pg_temp.start('b')$$,
  $$values (true, 'openrouter', true, 200000::bigint, 0::bigint, false, true, true)$$,
  'B''s first message today is allowed on Free''s configuration, yesterday''s tokens not charged');
select ok(
  exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('00000000-0000-4000-8000-00000000000b', 7) >> 32) & 4294967295
      and objid::bigint = hashtextextended('00000000-0000-4000-8000-00000000000b', 7) & 4294967295),
  'begin_assistant_message holds B''s assistant lock until commit');
select ok(
  not exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('00000000-0000-4000-8000-00000000000a', 7) >> 32) & 4294967295
      and objid::bigint = hashtextextended('00000000-0000-4000-8000-00000000000a', 7) & 4294967295),
  'and not A''s');

select results_eq($$select busy, allowed, message_id from pg_temp.start('b')$$,
  $$values (true, false, null::bigint)$$,
  'a second message while the first is running is refused as busy');
select is(pg_temp.messages('b'), 2::bigint, 'and nothing is recorded for it');

select lives_ok(format($$select pg_temp.finish(%s, 'cancelled')$$, pg_temp.last_message('b')),
  'service_role records a turn the client left, with what it used');
select results_eq($$select tokens_used, busy, allowed from pg_temp.start('b')$$,
  $$values (3400::bigint, false, true)$$,
  'control: once it is recorded the next starts, charged its input and output tokens');
select lives_ok(format($$select pg_temp.finish(%s, 'cut')$$, pg_temp.last_message('b')),
  'a reply cut at the output limit is recorded');

-- A message begun 151 s ago and never recorded, as when the function stopped before its record.
insert into private.assistant_messages (user_id, plan, configuration_id, created_at)
  values ('00000000-0000-4000-8000-00000000000b', 'free', pg_temp.config('free', 'active'),
    now() - interval '151 seconds');
select results_eq($$select tokens_used, busy, allowed from pg_temp.start('b')$$,
  $$values (6800::bigint, false, true)$$,
  'a message unrecorded past 150 s holds no one back and is charged nothing');
select lives_ok(format($$select pg_temp.finish(%s, 'ok')$$, pg_temp.last_message('b')),
  'service_role records a turn''s outcome and usage');

-- Today's tokens one short of Free's budget of 200,000.
insert into private.assistant_messages (user_id, plan, configuration_id, created_at, outcome,
    model_calls, input_tokens, output_tokens, reasoning_tokens, web_search_requests, latency_ms)
  values ('00000000-0000-4000-8000-00000000000b', 'free', pg_temp.config('free', 'active'),
    now() - interval '1 hour', 'ok', 1, 179799, 10000, 900, 0, 1000);
select results_eq($$select tokens_used, allowed from pg_temp.start('b')$$,
  $$values (199999::bigint, true)$$, 'a message starts while one token of the budget is left');
select lives_ok(format($$select pg_temp.finish(%s, 'model_error')$$, pg_temp.last_message('b')),
  'a failed turn is recorded');
select results_eq($$select tokens_used, busy, allowed, message_id from pg_temp.start('b')$$,
  $$values (203399::bigint, false, false, null::bigint)$$,
  'the last message is charged whole past the budget, and the next is refused');
select is(pg_temp.messages('b'), 7::bigint, 'and nothing is recorded for it');

select results_eq(
  $$select token_budget, allowed from pg_temp.start('a') limit 1$$,
  $$values (null::bigint, true)$$, 'an admin, on 스페셜, has no budget');
select lives_ok(format($$select pg_temp.finish(%s, 'ok')$$, pg_temp.last_message('a')),
  'the admin''s message is recorded');
insert into private.assistant_messages (user_id, plan, configuration_id, created_at, outcome,
    model_calls, input_tokens, output_tokens, reasoning_tokens, web_search_requests, latency_ms)
  values ('00000000-0000-4000-8000-00000000000a', 'special', pg_temp.config('special', 'active'),
    now() - interval '1 hour', 'ok', 1, 2000000000, 2000000000, 0, 0, 1000);
select results_eq($$select tokens_used, allowed from pg_temp.start('a')$$,
  $$values (4000003400::bigint, true)$$,
  'and is let through past every budget, each message charged');

-- The record.

select throws_ok(format($$select pg_temp.finish(%s, 'ok')$$, pg_temp.last_message('b')),
  'P0002', null, 'a second record of the same message is refused');
select throws_ok($$select pg_temp.finish(-1, 'ok')$$, 'P0002', null,
  'a message never begun is refused');
select throws_ok(format($$select pg_temp.finish(%s, 'sideways')$$, pg_temp.last_message('a')),
  '23514', null, 'an unknown outcome is refused');
reset role;
select results_eq(
  $$select outcome, model_calls, input_tokens, output_tokens, reasoning_tokens,
      web_search_requests, latency_ms
    from private.assistant_messages where latency_ms = 4200 order by outcome$$,
  $$values ('cancelled', 2, 3000, 400, 50, 1, 4200), ('cut', 2, 3000, 400, 50, 1, 4200),
    ('model_error', 2, 3000, 400, 50, 1, 4200), ('ok', 2, 3000, 400, 50, 1, 4200),
    ('ok', 2, 3000, 400, 50, 1, 4200)$$,
  'the record holds what the turn used, the refused records nothing');

-- C's message, begun in no transaction of this test's: its record takes C's lock.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000c', 'other@example.com', now() - interval '90 days');
insert into private.assistant_messages (user_id, plan, configuration_id)
  values ('00000000-0000-4000-8000-00000000000c', 'free', pg_temp.config('free', 'active'));
create function pg_temp.holds_c() returns boolean language sql stable as $$
  select exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('00000000-0000-4000-8000-00000000000c', 7) >> 32) & 4294967295
      and objid::bigint = hashtextextended('00000000-0000-4000-8000-00000000000c', 7) & 4294967295);
$$;
select ok(not pg_temp.holds_c(), 'setup: C''s assistant lock is not held');
select pg_temp.finish(pg_temp.last_message('c'), 'ok');
select ok(pg_temp.holds_c(), 'finish_assistant_message charges C''s message under C''s lock');

-- The allowance.

select pg_temp.sign_in('b');
select results_eq($$select token_budget, tokens_used, tokens_left from public.assistant_allowance()$$,
  $$values (200000::bigint, 203399::bigint, 0::bigint)$$,
  'B reads its budget, today''s tokens and none left');
select pg_temp.sign_in('c');
select results_eq($$select token_budget, tokens_used, tokens_left from public.assistant_allowance()$$,
  $$values (200000::bigint, 3400::bigint, 196600::bigint)$$, 'C reads what is left');
select pg_temp.sign_in('a');
select results_eq($$select token_budget, tokens_left from public.assistant_allowance()$$,
  $$values (null::bigint, null::bigint)$$, 'an admin reads no budget');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.assistant_allowance()$$, '42501', null,
  'anon reads no allowance');
reset role;

-- The admin functions refuse a user who is not an admin and anon.

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_assistant_configurations()$$, '42501', null,
  'a user reads no assistant configuration');
select throws_ok($$select * from public.admin_assistant_token_budgets()$$, '42501', null,
  'a user reads no budget');
select throws_ok($$select public.admin_set_assistant_token_budget('free', 1000)$$, '42501', null,
  'a user sets no budget');
select throws_ok($$select public.admin_activate_assistant_configuration('free')$$, '42501', null,
  'a user applies no draft');
select throws_ok($$select public.admin_clear_assistant_test('free')$$, '42501', null,
  'a user ends no draft');
select throws_ok($$select public.admin_save_assistant_prompt('Be kind.', 'mine')$$, '42501', null,
  'a user saves no prompt');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_assistant_token_budgets()$$, '42501', null,
  'anon reads no budget');
select pg_temp.sign_in('a');
select is((select count(*) from public.admin_assistant_configurations()), 4::bigint,
  'control: an admin reads each plan''s active configuration');
select isnt(public.admin_save_assistant_prompt('Be kind.', ' v2 '), null,
  'control: an admin saves a prompt');
select results_eq(
  $$select left(text, 12), note, created_by_email, labels from public.admin_assistant_prompts()$$,
  $$values ('Be kind.', 'v2', 'admin@example.com', '{}'::text[]),
    ('You are 말랑이,', '말랑이 assistant prompt v2, its working order and card forms (#751)', null,
      '{}'::text[]),
    ('You are 말랑이,', '말랑이 assistant prompt v1 (#713)', null, '{active}'::text[])$$,
  'the prompts list newest first, the new one serving no one');
reset role;

-- A draft.

set local role service_role;
select throws_ok($$select public.save_assistant_configuration('00000000-0000-4000-8000-00000000000b',
  'special', 'openrouter', 'vendor/draft')$$, '42501', null, 'a draft is saved for an admin alone');
select is(public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a', 'special',
  'openrouter', 'vendor/draft', -1), null, 'a prompt version that does not exist saves nothing');
select is(public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a', 'special',
  'anthropic', 'claude-opus-5-5', null, false, null, 'none'), null,
  'a model whose thinking is always on saves nothing at no reasoning');
select is(public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a', 'special',
  'anthropic', 'claude-haiku-4-5', null, false, null, 'low'), null,
  'a model with extended thinking alone saves nothing at an effort');
select isnt(public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a', 'special',
  'anthropic', 'claude-draft', null, false, null, 'low'), null,
  'control: an admin''s draft on 스페셜 is saved');
reset role;
select is((select count(*) from private.assistant_configurations
    where model in ('vendor/draft', 'claude-opus-5-5', 'claude-haiku-4-5')),
  0::bigint, 'the refused saves appended nothing');
select results_eq(
  $$select c.provider, c.model, c.web_search, c.max_searches, c.reasoning_effort,
      c.prompt_version_id = a.prompt_version_id
    from private.assistant_configurations as c, private.assistant_configurations as a
    where c.id = pg_temp.config('special', 'test') and a.id = pg_temp.config('special', 'active')$$,
  $$values ('anthropic', 'claude-draft', false, 3, 'low', true)$$,
  'the draft holds what was given and keeps the active one''s prompt and cap');
select results_eq($$select configuration_id = pg_temp.config('special', 'test'), available
    from pg_temp.start('a')$$,
  $$values (true, false)$$, 'the admin is served the draft, unavailable without Anthropic''s key');
select results_eq($$select configuration_id = pg_temp.config('free', 'active') from pg_temp.start('b')$$,
  $$values (true)$$, 'a user is still served its plan''s active configuration');

select pg_temp.sign_in('a');
select is(public.admin_activate_assistant_configuration('special'), 'no_key',
  'a draft whose provider has no key is not applied');
reset role;
insert into private.provider_keys (provider, secret_id, last_four)
  values ('anthropic', gen_random_uuid(), '1111');
select pg_temp.sign_in('a');
select is(public.admin_activate_assistant_configuration('special'), 'activated',
  'with the key in Vault it is applied to everyone');
reset role;
select is((select model from private.assistant_configurations
    where id = pg_temp.config('special', 'active')), 'claude-draft', 'the draft is active');
select is(pg_temp.config('special', 'test'), null, 'and no draft is left');
select pg_temp.sign_in('a');
select is(public.admin_activate_assistant_configuration('special'), 'no_test',
  'a plan without a draft has nothing to apply');
reset role;

set local role service_role;
select public.save_assistant_configuration('00000000-0000-4000-8000-00000000000a', 'pro',
  'openrouter', 'vendor/second');
reset role;
select pg_temp.sign_in('a');
select ok(public.admin_clear_assistant_test('pro'), 'a draft is ended');
select ok(not public.admin_clear_assistant_test('pro'), 'and ending none changes nothing');
reset role;

-- A budget.

select pg_temp.sign_in('a');
select is(public.admin_set_assistant_token_budget('free', -1), 'bad_budget',
  'a negative budget is refused');
select is(public.admin_set_assistant_token_budget('free', 1000000001), 'bad_budget',
  'a budget over 1,000,000,000 is refused');
select is(public.admin_set_assistant_token_budget('gold', 5), 'bad_plan',
  'a plan without one is refused');
select is(public.admin_set_assistant_token_budget('free', 200000), 'unchanged',
  'the same budget changes nothing');
select is(public.admin_set_assistant_token_budget('free', 300000), 'set',
  'control: a new budget is set');
select results_eq(
  $$select plan, daily_tokens, set_by_email from public.admin_assistant_token_budgets()$$,
  $$values ('free', 300000::bigint, 'admin@example.com'), ('pro', 2000000, null),
    ('max', 6000000, null), ('special', null, null)$$,
  'an admin reads each plan''s budget and who set it');
reset role;
select results_eq($$select tokens_used, allowed from pg_temp.start('b')$$,
  $$values (203399::bigint, true)$$, 'B is let through again under the new budget');

select results_eq(
  $$select action, target_id from private.admin_audit order by id$$,
  $$values ('save_assistant_prompt', (select max(id)::text from private.assistant_prompts)),
    ('save_assistant_configuration', 'special'), ('activate_assistant_configuration', 'special'),
    ('save_assistant_configuration', 'pro'), ('clear_assistant_test', 'pro'),
    ('set_assistant_token_budget', 'free')$$,
  'each write is recorded once, and no refused or unchanged one');
select is((select detail from private.admin_audit where action = 'set_assistant_token_budget'),
  '{"daily_tokens": 300000, "daily_tokens_before": 200000}'::jsonb,
  'a budget is recorded with the one before');

-- Append-only.

select throws_ok($$update private.assistant_configurations set model = 'vendor/other'
    where id = pg_temp.config('free', 'active')$$, '55000', null,
  'a configuration is never changed');
select lives_ok($$update private.assistant_configurations set created_by = null
    where created_by = '00000000-0000-4000-8000-00000000000a'$$,
  'control: its author''s removal is let through');

-- A model and an effort, by Anthropic's per-model thinking table.

select results_eq(
  $$select private.assistant_effort_fits(provider, model, effort)
    from (values ('anthropic', 'claude-opus-5-5', 'none'), ('anthropic', 'claude-opus-5-5', 'low'),
      ('anthropic', 'claude-fable-5-1', 'none'), ('anthropic', 'claude-mythos-preview', 'none'),
      ('anthropic', 'claude-haiku-4-5-20251001', 'medium'), ('anthropic', 'claude-haiku-4-5', 'none'),
      ('anthropic', 'claude-haiku-5-5', 'none'), ('anthropic', 'claude-sonnet-5-5', 'none'),
      ('openrouter', 'anthropic/claude-opus-5.5', 'none')) as t (provider, model, effort)$$,
  $$values (false), (true), (false), (false), (false), (true), (true), (true), (true)$$,
  'always-on thinking refuses none and extended thinking alone refuses an effort, nothing else');
select throws_ok($$insert into private.assistant_configurations
    (plan, provider, model, prompt_version_id, web_search, max_searches, reasoning_effort)
    values ('free', 'anthropic', 'claude-opus-5-5',
      (select min(id) from private.assistant_prompts), false, 3, 'none')$$,
  '23514', null, 'the table refuses such a configuration however it is written');

-- The seed on photo models of each kind: an always-on Anthropic model seeded at 'low', against
-- one that runs without thinking seeded at 'none'.

with c as (
  insert into private.ai_configurations (plan, provider, model, prompt_version_id) values
    ('free', 'anthropic', 'claude-opus-5-5', (select min(id) from private.prompt_versions)),
    ('pro', 'anthropic', 'claude-haiku-5-5', (select min(id) from private.prompt_versions))
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;
delete from private.assistant_configuration_labels where plan in ('free', 'pro');
create temp table configurations_before as select id from private.assistant_configurations;
select results_eq(
  $$select l.plan, c.provider, c.model, exists (select from private.assistant_configuration_labels
      as a where a.plan = l.plan)
    from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and l.plan in ('free', 'pro') order by l.plan$$,
  $$values ('free', 'anthropic', 'claude-opus-5-5', false),
    ('pro', 'anthropic', 'claude-haiku-5-5', false)$$,
  'setup: Free''s photo model thinks always and Pro''s need not, and neither has an assistant');
select lives_ok($$select private.seed_assistant_configurations()$$, 'the seed runs on them');
select lives_ok($$select private.seed_assistant_configurations()$$, 'and runs again');
select results_eq(
  $$select c.plan, c.provider, c.model, c.reasoning_effort,
      exists (select from private.assistant_configuration_labels as l
        where l.configuration_id = c.id and l.label = 'active')
    from private.assistant_configurations as c
    where c.id not in (select id from configurations_before) order by c.plan$$,
  $$values ('free', 'anthropic', 'claude-opus-5-5', 'low', true),
    ('pro', 'anthropic', 'claude-haiku-5-5', 'none', true)$$,
  'the always-on model is seeded at low and the other at none, once over two runs, no other plan');

-- The reverts: the token budget's puts the message limit back, and then the assistant's leaves
-- nothing the two migrations made but the reverts.

-- The photo jobs' revert runs before them (assistant_photo_jobs_test.sql tests it).
select private.revert_assistant_photo_jobs();
drop function private.revert_assistant_photo_jobs();

create function pg_temp.made_tables() returns text[] language sql stable as $$
  select coalesce(array_agg(c.relname::text order by c.relname), '{}')
  from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'private' and c.relkind = 'r' and c.relname like 'assistant%';
$$;
create function pg_temp.made_functions() returns text[] language sql stable as $$
  select coalesce(array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname), '{}')
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private') and p.proname like '%assistant%';
$$;

select is(pg_temp.made_tables(), array['assistant_configuration_labels',
    'assistant_configurations', 'assistant_limits', 'assistant_messages', 'assistant_prompts',
    'assistant_token_budgets'],
  'control: the six tables are found before the reverts');
select is(pg_temp.made_functions(), array['private.assistant_effort_fits',
    'private.assistant_tokens_today', 'private.keep_assistant_configuration',
    'private.revert_assistant', 'private.revert_assistant_tokens',
    'private.seed_assistant_configurations',
    'public.admin_activate_assistant_configuration', 'public.admin_assistant_configurations',
    'public.admin_assistant_prompts', 'public.admin_assistant_token_budgets',
    'public.admin_clear_assistant_test', 'public.admin_save_assistant_prompt',
    'public.admin_set_assistant_token_budget', 'public.assistant_allowance', 'public.assistant_effort_fits',
    'public.begin_assistant_message', 'public.finish_assistant_message',
    'public.save_assistant_configuration'],
  'control: the eighteen functions are found before the reverts');
select lives_ok($$select private.revert_assistant_tokens()$$, 'the token budget''s revert runs');
select is(pg_temp.made_tables(), array['assistant_configuration_labels',
    'assistant_configurations', 'assistant_limits', 'assistant_messages', 'assistant_prompts'],
  'the budgets are gone and the limits and messages kept');
select is(pg_temp.made_functions(), array['private.assistant_effort_fits',
    'private.keep_assistant_configuration', 'private.revert_assistant',
    'private.revert_assistant_tokens', 'private.seed_assistant_configurations',
    'public.admin_activate_assistant_configuration', 'public.admin_assistant_configurations',
    'public.admin_assistant_limits', 'public.admin_assistant_prompts',
    'public.admin_clear_assistant_test', 'public.admin_save_assistant_prompt',
    'public.admin_set_assistant_limit', 'public.assistant_allowance',
    'public.begin_assistant_message', 'public.finish_assistant_message',
    'public.save_assistant_configuration'],
  'the message limit''s functions are back');
set local role service_role;
select results_eq(
  $$select daily_limit, used, allowed
    from public.begin_assistant_message('00000000-0000-4000-8000-00000000000b')$$,
  $$values (10, 8, true)$$, 'a message is counted against the day''s limit again');
reset role;
select pg_temp.sign_in('b');
select results_eq($$select daily_limit, used from public.assistant_allowance()$$,
  $$values (10, 8)$$, 'and the allowance reads the limit');
select pg_temp.sign_in('a');
select is(public.admin_set_assistant_limit('free', 10), 'unchanged',
  'and an admin sets the limit again');
reset role;
select lives_ok($$select private.revert_assistant()$$, 'the assistant''s revert runs after it');
select is(pg_temp.made_tables(), '{}'::text[], 'every table is gone');
select is(pg_temp.made_functions(),
  array['private.revert_assistant', 'private.revert_assistant_tokens'],
  'every function is gone but the reverts, which the PM drops next');

select * from finish();
rollback;
