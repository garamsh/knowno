-- extraction_allowance: the caller's own photo limit, its period and the photos counted in it,
-- which agree with what begin_extraction resolves and counts, for each quota: a calendar month in
-- Asia/Seoul, a day there, and unlimited with its fair-use cap a day; and on a Max that has ended.
-- anon is refused.
begin;
select plan(13);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

-- Each plan on one version from before this month: Free 3 a month, Pro 2 a day, Max unlimited
-- with a fair-use cap of 4 a day.
delete from private.plan_versions;
insert into private.plan_versions (plan, quota, amount, starts_at) values
  ('free', 'monthly', 3, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('pro', 'daily', 2, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('max', 'unlimited', 4, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days');
with c as (
  insert into private.ai_configurations (plan, provider, model, prompt_version_id) values ('free', 'openrouter', 'vendor/free-model', 1), ('pro', 'openrouter', 'vendor/pro-model', 1), ('max', 'openrouter', 'vendor/max-model', 1)
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000b', 'free@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'pro@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'max@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'ended@example.com');
insert into private.user_plans (user_id, plan, ends_at, version_id) values
  ('00000000-0000-4000-8000-00000000000c', 'pro', null, (select id from private.plan_versions where plan = 'pro')),
  ('00000000-0000-4000-8000-00000000000d', 'max', now() + interval '1 day', (select id from private.plan_versions where plan = 'max')),
  ('00000000-0000-4000-8000-00000000000e', 'max', now() - interval '1 second', (select id from private.plan_versions where plan = 'max'));
-- The Free user's photo just after this month began counts, and the one just before it does not;
-- the Pro and Max users' photos just before today began in Seoul do not count.
insert into public.extraction_usage (user_id, created_at) values
  ('00000000-0000-4000-8000-00000000000b', date_trunc('month', now(), 'Asia/Seoul')),
  ('00000000-0000-4000-8000-00000000000b', date_trunc('month', now(), 'Asia/Seoul') - interval '1 second'),
  ('00000000-0000-4000-8000-00000000000c', date_trunc('day', now(), 'Asia/Seoul') - interval '1 second'),
  ('00000000-0000-4000-8000-00000000000d', date_trunc('day', now(), 'Asia/Seoul') - interval '1 second');

-- What [who] reads, signed in.
create function pg_temp.allowance(who text) returns table (photo_limit integer, period text, used integer)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-00000000000' || who, 'role', 'authenticated')::text,
    true);
  perform set_config('role', 'authenticated', true);
  return query select * from public.extraction_allowance();
  perform set_config('role', 'none', true);
end;
$$;

-- The limit and period begin_extraction resolves for [who], recording one photo when allowed.
create function pg_temp.begin(who text) returns table (photo_limit integer, period text, allowed boolean)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.photo_limit, b.period, b.allowed
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

select results_eq($$select * from pg_temp.allowance('b')$$, $$values (3, 'month', 1)$$,
  'a Free user reads its monthly limit and this month''s photo, last month''s left out');
reset role;
select results_eq($$select * from pg_temp.allowance('c')$$, $$values (2, 'day', 0)$$,
  'a Pro user reads its daily limit, yesterday''s photo left out');
reset role;
select results_eq($$select * from pg_temp.allowance('d')$$, $$values (4, 'day', 0)$$,
  'a Max user before its end reads its fair-use cap a day, yesterday''s photo left out');
reset role;
select results_eq($$select * from pg_temp.allowance('e')$$, $$values (3, 'month', 0)$$,
  'a Max that has ended reads Free''s');
reset role;

-- The two agree: begin_extraction's limit and period for each user are the ones the allowance
-- read, and each photo it lets through is one more used.
select results_eq(
  $$select photo_limit, period from pg_temp.begin('b') union all select photo_limit, period from pg_temp.begin('c')
    union all select photo_limit, period from pg_temp.begin('d') union all select photo_limit, period from pg_temp.begin('e')$$,
  $$values (3, 'month'), (2, 'day'), (4, 'day'), (3, 'month')$$,
  'begin_extraction resolves the same limit and period for each');
reset role;
select results_eq(
  $$select used from pg_temp.allowance('b') union all select used from pg_temp.allowance('c')
    union all select used from pg_temp.allowance('d') union all select used from pg_temp.allowance('e')$$,
  $$values (2), (1), (1), (1)$$,
  'a photo begin_extraction let through is one more used for each');
reset role;

-- Each quota refuses the photo after its last, as the allowance says.
select results_eq($$select allowed from pg_temp.begin('b') union all select allowed from pg_temp.begin('b')$$,
  $$values (true), (false)$$, 'monthly: the photo after the month''s 3 is refused');
reset role;
select results_eq($$select * from pg_temp.allowance('b')$$, $$values (3, 'month', 3)$$,
  'with the allowance used up');
reset role;
select results_eq($$select allowed from pg_temp.begin('c') union all select allowed from pg_temp.begin('c')$$,
  $$values (true), (false)$$, 'daily: the photo after the day''s 2 is refused');
reset role;
select results_eq(
  $$select allowed from pg_temp.begin('d') union all select allowed from pg_temp.begin('d')
    union all select allowed from pg_temp.begin('d') union all select allowed from pg_temp.begin('d')$$,
  $$values (true), (true), (true), (false)$$, 'unlimited: the photo after the day''s fair-use 4 is refused');
reset role;
select results_eq(
  $$select * from pg_temp.allowance('c') union all select * from pg_temp.allowance('d')$$,
  $$values (2, 'day', 2), (4, 'day', 4)$$, 'with each allowance used up');
reset role;

select function_privs_are('public', 'extraction_allowance', '{}', 'authenticated', '{EXECUTE}',
  'control: authenticated may call it');
set local role anon;
select throws_ok($$select * from public.extraction_allowance()$$, '42501', null,
  'anon is refused');
reset role;

select * from finish();
rollback;
