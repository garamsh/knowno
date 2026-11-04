-- The 말랑이 assistant's server side (#713, ADR 0190): the seed of each plan's configuration and
-- daily limit; a message counted under the user's lock up to the limit, and not without a key;
-- what a turn used recorded once; the allowance; a draft saved, served to admins, applied and ended;
-- a limit set; every write recorded; configurations append-only; no client reaching the tables or
-- the service functions; and the revert.
begin;
select plan(74);

delete from private.admin_audit;

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
  daily_limit integer, used integer, allowed boolean, message_id bigint)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.configuration_id, b.provider, b.model, b.available, b.daily_limit,
    b.used, b.allowed, b.message_id
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
  $$select plan, daily_messages from private.assistant_limits
    order by array_position(array['free', 'pro', 'max', 'special'], plan)$$,
  $$values ('free', 10), ('pro', 100), ('max', 300), ('special', null::integer)$$,
  'the daily limits are 10, 100 and 300 messages, and none for 스페셜');
select is((select count(*) from private.assistant_configuration_labels where label = 'test'),
  0::bigint, 'no plan has an assistant draft');
select is((select count(*) from private.assistant_prompts), 1::bigint,
  'the first prompt is the one assistant prompt');

-- No client reaches the tables or the service functions.

select pg_temp.sign_in('b');
select throws_ok($$select * from private.assistant_messages$$, '42501', null,
  'a signed-in user reads no message row');
select throws_ok($$select * from private.assistant_configurations$$, '42501', null,
  'a signed-in user reads no configuration');
select throws_ok($$select * from public.begin_assistant_message('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a signed-in user counts no message');
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
    ('admin_assistant_limits', true), ('admin_assistant_prompts', true),
    ('admin_clear_assistant_test', true), ('admin_save_assistant_prompt', true),
    ('admin_set_assistant_limit', true), ('assistant_allowance', true),
    ('begin_assistant_message', true), ('finish_assistant_message', true),
    ('save_assistant_configuration', true)$$,
  'every assistant function runs as its owner with an empty search_path');

-- Counting messages.

select results_eq($$select available, allowed, message_id from pg_temp.start('b')$$,
  $$values (false, false, null::bigint)$$,
  'without OpenRouter''s key in Vault a message is unavailable');
select is(pg_temp.messages('b'), 0::bigint, 'and it is not counted');

insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', gen_random_uuid(), '0000');
-- A message of B's from yesterday in Seoul, which today's count leaves out.
insert into private.assistant_messages (user_id, plan, configuration_id, created_at)
  values ('00000000-0000-4000-8000-00000000000b', 'free', pg_temp.config('free', 'active'),
    date_trunc('day', now(), 'Asia/Seoul') - interval '1 minute');

select results_eq(
  $$select configuration_id = pg_temp.config('free', 'active'), provider, available, daily_limit,
      used, allowed, message_id is not null
    from pg_temp.start('b')$$,
  $$values (true, 'openrouter', true, 10, 1, true, true)$$,
  'B''s first message today is allowed on Free''s configuration, yesterday''s not counted');
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
do $$ begin for i in 1..9 loop perform pg_temp.start('b'); end loop; end $$;
select is(pg_temp.messages('b'), 11::bigint, 'ten messages today are counted, beside yesterday''s');
select results_eq($$select used, allowed, message_id from pg_temp.start('b')$$,
  $$values (10, false, null::bigint)$$, 'the eleventh is refused at the limit');
select is(pg_temp.messages('b'), 11::bigint, 'and nothing is recorded for it');

select results_eq(
  $$select daily_limit, allowed from pg_temp.start('a') limit 1$$,
  $$values (null::integer, true)$$, 'an admin, on 스페셜, has no limit');
do $$ begin for i in 1..300 loop perform pg_temp.start('a'); end loop; end $$;
select results_eq($$select used, allowed from pg_temp.start('a')$$, $$values (302, true)$$,
  'and is let through past Max''s limit, each message counted');

-- What a turn used.

select lives_ok(format($$select pg_temp.finish(%s, 'ok')$$, pg_temp.last_message('b')),
  'service_role records a turn''s outcome and usage');
select lives_ok(format($$select pg_temp.finish(%s, 'cut'), pg_temp.finish(%s, 'cancelled')$$,
    pg_temp.last_message('a') - 1, pg_temp.last_message('a') - 2),
  'a reply cut at the output limit and a turn the client left are recorded');
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
    from private.assistant_messages where outcome is not null order by outcome$$,
  $$values ('cancelled', 2, 3000, 400, 50, 1, 4200), ('cut', 2, 3000, 400, 50, 1, 4200),
    ('ok', 2, 3000, 400, 50, 1, 4200)$$,
  'the record holds what the turn used, the refused records nothing');

-- The allowance.

select pg_temp.sign_in('b');
select results_eq($$select daily_limit, used from public.assistant_allowance()$$,
  $$values (10, 10)$$, 'B reads its limit and today''s messages');
select pg_temp.sign_in('a');
select results_eq($$select daily_limit, used from public.assistant_allowance()$$,
  $$values (null::integer, 302)$$, 'an admin reads no limit');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.assistant_allowance()$$, '42501', null,
  'anon reads no allowance');
reset role;

-- The admin functions refuse a user who is not an admin and anon.

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_assistant_configurations()$$, '42501', null,
  'a user reads no assistant configuration');
select throws_ok($$select * from public.admin_assistant_limits()$$, '42501', null,
  'a user reads no limit');
select throws_ok($$select public.admin_set_assistant_limit('free', 1000)$$, '42501', null,
  'a user sets no limit');
select throws_ok($$select public.admin_activate_assistant_configuration('free')$$, '42501', null,
  'a user applies no draft');
select throws_ok($$select public.admin_clear_assistant_test('free')$$, '42501', null,
  'a user ends no draft');
select throws_ok($$select public.admin_save_assistant_prompt('Be kind.', 'mine')$$, '42501', null,
  'a user saves no prompt');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_assistant_limits()$$, '42501', null,
  'anon reads no limit');
select pg_temp.sign_in('a');
select is((select count(*) from public.admin_assistant_configurations()), 4::bigint,
  'control: an admin reads each plan''s active configuration');
select isnt(public.admin_save_assistant_prompt('Be kind.', ' v2 '), null,
  'control: an admin saves a prompt');
select results_eq(
  $$select left(text, 12), note, created_by_email, labels from public.admin_assistant_prompts()$$,
  $$values ('Be kind.', 'v2', 'admin@example.com', '{}'::text[]),
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

-- A limit.

select pg_temp.sign_in('a');
select is(public.admin_set_assistant_limit('free', -1), 'bad_limit', 'a negative limit is refused');
select is(public.admin_set_assistant_limit('gold', 5), 'bad_plan', 'a plan without one is refused');
select is(public.admin_set_assistant_limit('free', 10), 'unchanged', 'the same limit changes nothing');
select is(public.admin_set_assistant_limit('free', 12), 'set', 'control: a new limit is set');
reset role;
select results_eq($$select allowed, used from pg_temp.start('b')$$, $$values (true, 11)$$,
  'B is let through again under the new limit');

select results_eq(
  $$select action, target_id from private.admin_audit order by id$$,
  $$values ('save_assistant_prompt', (select max(id)::text from private.assistant_prompts)),
    ('save_assistant_configuration', 'special'), ('activate_assistant_configuration', 'special'),
    ('save_assistant_configuration', 'pro'), ('clear_assistant_test', 'pro'),
    ('set_assistant_limit', 'free')$$,
  'each write is recorded once, and no refused or unchanged one');

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

-- The revert: every table and function the migration made is gone, its own revert aside.

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
    'assistant_configurations', 'assistant_limits', 'assistant_messages', 'assistant_prompts'],
  'control: the migration''s five tables are found before the revert');
select is(pg_temp.made_functions(), array['private.assistant_effort_fits',
    'private.keep_assistant_configuration', 'private.revert_assistant',
    'private.seed_assistant_configurations',
    'public.admin_activate_assistant_configuration', 'public.admin_assistant_configurations',
    'public.admin_assistant_limits', 'public.admin_assistant_prompts',
    'public.admin_clear_assistant_test', 'public.admin_save_assistant_prompt',
    'public.admin_set_assistant_limit', 'public.assistant_allowance',
    'public.begin_assistant_message', 'public.finish_assistant_message',
    'public.save_assistant_configuration'],
  'control: its fifteen functions are found before the revert');
select lives_ok($$select private.revert_assistant()$$, 'the revert runs');
select is(pg_temp.made_tables(), '{}'::text[], 'every table is gone');
select is(pg_temp.made_functions(), array['private.revert_assistant'],
  'every function is gone but the revert, which the PM drops next');

select * from finish();
rollback;
