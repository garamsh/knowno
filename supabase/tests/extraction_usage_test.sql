-- extraction_usage: users read only their own rows, and only service_role records one, through
-- begin_extraction, which lets at most the user's plan's daily limit through per user and day in
-- Asia/Seoul; Free, every user's plan here, is set at 30 a day.
begin;
select plan(21);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

delete from private.plan_versions;
insert into private.plan_versions (plan, quota, amount, starts_at) values
  ('free', 'daily', 30, now() - interval '60 days');
with c as (
  insert into private.ai_configurations (plan, provider, model) values ('free', 'openrouter', 'anthropic/claude-haiku-5.5')
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com');
-- One row each today, and one for A just before today began, which the limit does not count.
insert into public.extraction_usage (user_id, created_at) values
  ('00000000-0000-4000-8000-00000000000a', now()),
  ('00000000-0000-4000-8000-00000000000b', now()),
  ('00000000-0000-4000-8000-00000000000a', date_trunc('day', now(), 'Asia/Seoul') - interval '1 second');

-- Whether begin_extraction let [who] through on each of [times] calls, one after another.
create function pg_temp.begin_times(who uuid, times integer) returns boolean
language plpgsql as $$
declare
  every boolean := true;
  allowed boolean;
begin
  for i in 1..times loop
    select b.allowed into allowed from public.begin_extraction(who) as b;
    every := every and allowed;
  end loop;
  return every;
end;
$$;

select results_eq(
  'select count(*) from public.extraction_usage',
  array[3::bigint],
  'the fixture holds three rows');

-- The privileges alone refuse every write, whatever the policies would allow.
select results_eq(
  $$select privilege from unnest(array['select', 'insert', 'update', 'delete']) as privilege
    where has_table_privilege('authenticated', 'public.extraction_usage', privilege)
    union all
    select 'service_role ' || privilege from unnest(array['insert', 'update', 'delete']) as privilege
    where has_table_privilege('service_role', 'public.extraction_usage', privilege)$$,
  array['select'],
  'authenticated may only select, and service_role may write only through begin_extraction');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select results_eq(
  'select count(*) from public.extraction_usage where user_id = ''00000000-0000-4000-8000-00000000000a''',
  array[2::bigint],
  'A reads its own rows');
select results_eq(
  'select count(*) from public.extraction_usage where user_id = ''00000000-0000-4000-8000-00000000000b''',
  array[0::bigint],
  'A reads none of B''s rows');
select throws_ok(
  $$insert into public.extraction_usage (user_id) values ('00000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'A cannot insert a row, even its own');
select throws_ok('update public.extraction_usage set created_at = now()', '42501', null,
  'A cannot update its rows');
select throws_ok('delete from public.extraction_usage', '42501', null, 'A cannot delete its rows');
select throws_ok(
  $$select * from public.begin_extraction('00000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'A cannot call begin_extraction');

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';

select throws_ok('select * from public.extraction_usage', '42501', null, 'anon cannot select');
select throws_ok(
  $$select * from public.begin_extraction('00000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'anon cannot call begin_extraction');

reset role;
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';

select throws_ok(
  $$insert into public.extraction_usage (user_id) values ('00000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'service_role cannot insert a row except through begin_extraction');

-- A has one row today, so 29 more are let through and the 30th call after them is refused.
select results_eq(
  $$select pg_temp.begin_times('00000000-0000-4000-8000-00000000000a', 29)$$,
  array[true],
  'begin_extraction lets A through until A has 30 rows today');
select is(
  (select allowed from public.begin_extraction('00000000-0000-4000-8000-00000000000a')), false,
  'begin_extraction refuses A''s 31st extraction today');
select results_eq(
  $$select count(*) from public.extraction_usage
    where user_id = '00000000-0000-4000-8000-00000000000a'
      and created_at >= date_trunc('day', now(), 'Asia/Seoul')$$,
  array[30::bigint],
  'the refused call recorded no row');
select is(
  (select allowed from public.begin_extraction('00000000-0000-4000-8000-00000000000b')), true,
  'B is let through while A is refused');
reset role;
insert into private.plan_versions (plan, quota, amount, starts_at, applies_to_all) values
  ('free', 'daily', 31, now(), true);
with c as (
  insert into private.ai_configurations (plan, provider, model) values ('free', 'openrouter', 'anthropic/claude-haiku-5.5')
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;
set local role service_role;
set local request.jwt.claims to '{"role":"service_role"}';
select is(
  (select allowed from public.begin_extraction('00000000-0000-4000-8000-00000000000a')), true,
  'the limit is the plan''s: A is let through once Free allows 31');

reset role;
select ok(
  exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('00000000-0000-4000-8000-00000000000a', 1) >> 32) & 4294967295
      and objid::bigint = hashtextextended('00000000-0000-4000-8000-00000000000a', 1) & 4294967295
  ),
  'begin_extraction holds A''s usage lock until commit');
select ok(
  not exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('00000000-0000-4000-8000-00000000000a', 0) >> 32) & 4294967295
      and objid::bigint = hashtextextended('00000000-0000-4000-8000-00000000000a', 0) & 4294967295
  ),
  'begin_extraction does not take A''s revision lock');

-- Only begin_extraction records a photo: the entry points an older function called are gone.
select hasnt_function('public', 'consume_extraction', 'consume_extraction is gone');
select hasnt_function('public', 'start_extraction', 'start_extraction is gone');
select has_function('public', 'begin_extraction', array['uuid', 'bigint'],
  'control: begin_extraction, which the function calls, remains');

select * from finish();
rollback;
