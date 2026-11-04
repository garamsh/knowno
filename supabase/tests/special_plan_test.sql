-- 스페셜 (#649, ADR 0177): the plan `special` has no photo limit, each photo still recorded; every
-- admin is on it; an admin grants it with an optional end and an ended one leaves the user on Free;
-- no user-facing read names it; only admin functions give and remove it; and the migration moves
-- each 무제한 grant that has not ended onto it, keeping the grants it replaces.
begin;
select plan(34);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

delete from private.admin_audit;

-- Free 1 a month and Pro 1 a day, from before this month, beside the migration's special version.
delete from private.plan_versions where plan <> 'special';
insert into private.plan_versions (plan, quota, amount, starts_at) values
  ('free', 'monthly', 1, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('pro', 'daily', 1, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days');
with c as (
  insert into private.ai_configurations (plan, provider, model, prompt_version_id) values
    ('free', 'openrouter', 'vendor/free-model', 1), ('pro', 'openrouter', 'vendor/pro-model', 1),
    ('special', 'openrouter', 'vendor/special-model', 1)
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;

-- A is an admin with a Pro grant; B a Free user; C on special without an end; D on special that
-- ended; E on special ending tomorrow; F on Pro. Each has used its period's one photo already.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'special@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'ended@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'until@example.com'),
  ('00000000-0000-4000-8000-00000000000f', 'pro@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, ends_at, version_id)
  select ('00000000-0000-4000-8000-00000000000' || g.who)::uuid, g.plan, g.ends_at, v.id
  from (values ('a', 'pro', null::timestamptz), ('c', 'special', null),
    ('d', 'special', now() - interval '1 second'), ('e', 'special', now() + interval '1 day'),
    ('f', 'pro', null)) as g (who, plan, ends_at)
  join private.plan_versions as v on v.plan = g.plan;
insert into public.extraction_usage (user_id)
  select ('00000000-0000-4000-8000-00000000000' || who)::uuid
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) as who;

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- What extract-cards gets for one photo of the user whose id ends in [who].
create function pg_temp.start(who text)
returns table (plan text, model text, photo_limit integer, allowed boolean, recorded boolean)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.model, b.photo_limit, b.allowed, b.usage_id is not null
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- What [who] reads, signed in.
create function pg_temp.allowance(who text) returns table (photo_limit integer, period text, used integer)
language plpgsql as $$
begin
  perform pg_temp.sign_in(who);
  return query select * from public.extraction_allowance();
  perform set_config('role', 'none', true);
end;
$$;

-- The plan.

select results_eq(
  $$select quota, amount from private.plan_versions where plan = 'special'$$,
  $$values ('none', null::integer)$$,
  'the migration gives special one version, with no limit');
select throws_ok(
  $$insert into private.plan_versions (plan, quota, amount, starts_at) values ('special', 'daily', 100, now())$$,
  '23514', null, 'special takes no quota that limits');
select throws_ok(
  $$insert into private.plan_versions (plan, quota, amount, starts_at) values ('max', 'none', null, now())$$,
  '23514', null, 'and no other plan takes special''s quota');
select lives_ok(
  $$insert into private.plan_versions (plan, quota, amount, starts_at) values ('max', 'unlimited', 1000, now() + interval '1 day')$$,
  'control: Max takes its own quota');

-- The metering.

select results_eq($$select * from pg_temp.start('b')$$,
  $$values ('free', 'vendor/free-model', 1, false, false)$$,
  'control: a Free user at its limit is refused, and nothing is recorded');
reset role;
select results_eq($$select * from pg_temp.start('c')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true)$$,
  'a special user past a photo is allowed on special''s model, with no limit, and the photo is recorded');
reset role;
select results_eq($$select * from pg_temp.start('a')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true)$$,
  'an admin is on special whatever it was granted');
reset role;
select results_eq($$select * from pg_temp.start('e')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true)$$,
  'so is a user whose special ends later');
reset role;
select results_eq($$select * from pg_temp.start('d')$$,
  $$values ('free', 'vendor/free-model', 1, false, false)$$,
  'an ended special leaves the user on Free, at its limit');
reset role;
select results_eq($$select * from pg_temp.start('c') union all select * from pg_temp.start('a')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true),
    ('special', 'vendor/special-model', null::integer, true, true)$$,
  'a further photo is allowed as well');
reset role;
select results_eq(
  $$select count(*) filter (where c.plan = 'special') from public.extraction_usage as u
    join private.extraction_calls as c on c.usage_id = u.id$$,
  $$values (5::bigint)$$,
  'every photo allowed is recorded as special''s, so spend stays counted');

-- What a user reads.

select results_eq($$select * from pg_temp.allowance('b')$$, $$values (1, 'month', 1)$$,
  'control: a Free user reads its limit and its month');
reset role;
select results_eq($$select * from pg_temp.allowance('c')$$, $$values (null::integer, 'day', 3)$$,
  'a special user reads no limit and the day''s photos, with nothing naming its plan');
reset role;
select results_eq($$select * from pg_temp.allowance('a')$$, $$values (null::integer, 'day', 3)$$,
  'so does an admin');
reset role;
select results_eq(
  $$select p.proname::text collate "default" from pg_proc as p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prosrc ~ '(user_plans|plan_versions|entitlement_of|ai_configuration)'
      and p.proname !~ '^admin_'
    order by 1$$,
  $$values ('assistant_allowance'::text collate "default"), ('extraction_allowance')$$,
  'the user-facing functions that read a plan are the two allowances, which answer no plan');
select ok(
  (select count(*) from pg_proc as p
    where p.pronamespace = 'public'::regnamespace
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.prosrc ~ '(user_plans|plan_versions|entitlement_of)' and p.proname ~ '^admin_') > 0,
  'control: the same search finds the admin functions that read plans');

select pg_temp.sign_in('c');
select throws_ok($$select * from private.user_plans$$, '42501', null,
  'a user cannot read the grants');
select throws_ok($$select * from private.plan_versions$$, '42501', null, 'nor the versions');
select throws_ok($$select * from private.entitlement_of('00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'nor its entitlement');
select throws_ok($$select private.unlimited('00000000-0000-4000-8000-00000000000c')$$, '42501', null,
  'nor whether a limit applies');
select throws_ok($$select * from public.admin_user_plan('00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'nor the admin''s read of its plan');
select throws_ok(
  $$select public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'special')$$,
  '42501', null, 'and it cannot give special');
select throws_ok($$select public.admin_revoke_plan('00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'nor remove it');
reset role;

-- The admin's grant.

select pg_temp.sign_in('a');
select results_eq(
  $$select plan, quota, amount, model, granted_plan from public.admin_user_plan('00000000-0000-4000-8000-00000000000a')$$,
  $$values ('special', 'none', null::integer, 'vendor/special-model', 'pro')$$,
  'an admin reads itself on special, its own Pro grant beside it');
select is(
  public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'special', now() + interval '7 days'),
  'granted', 'an admin gives special until a later end');
select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'special', now() - interval '1 day'),
  'bad_plan', 'and refuses an end in the past');
reset role;
select results_eq($$select * from pg_temp.start('b')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true)$$,
  'the grantee past its limit is now allowed');
reset role;
select pg_temp.sign_in('a');
select is(public.admin_revoke_plan('00000000-0000-4000-8000-00000000000b'), true,
  'an admin removes special, back to Free');
reset role;
select results_eq($$select action, detail ->> 'plan' from private.admin_audit order by id$$,
  $$values ('grant_plan', 'special'), ('revoke_plan', 'special')$$,
  'both are recorded, the refused end recording nothing');

-- The migration's move, on 무제한 grants as they stood before it: B's without an end over Free,
-- F's ending in three days over its Pro, and G's ended over its Pro.

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'gone@example.com');
insert into private.user_plans (user_id, plan, version_id)
  select '00000000-0000-4000-8000-000000000001', 'pro', id from private.plan_versions where plan = 'pro';
insert into private.unlimited_grants_before_special (user_id, ends_at, granted_by, granted_at) values
  ('00000000-0000-4000-8000-00000000000b', null, '00000000-0000-4000-8000-00000000000a', '2026-10-01'),
  ('00000000-0000-4000-8000-00000000000f', now() + interval '3 days',
    '00000000-0000-4000-8000-00000000000a', '2026-10-02'),
  ('00000000-0000-4000-8000-000000000001', now() - interval '1 day', null, '2026-09-01');
select results_eq(
  $$select u.email::text, p.plan from private.user_plans as p join auth.users as u on u.id = p.user_id
    where u.email in ('user@example.com', 'pro@example.com', 'gone@example.com') order by 1$$,
  $$values ('gone@example.com', 'pro'), ('pro@example.com', 'pro')$$,
  'before the move: B on Free, F and G on Pro');
select lives_ok($$select private.migrate_special_plan(); select private.migrate_special_plan();$$,
  'the move runs, and runs again');

select results_eq(
  $$select u.email::text, p.plan, p.ends_at is not null, b.email::text, p.granted_at
    from private.user_plans as p
    join auth.users as u on u.id = p.user_id
    left join auth.users as b on b.id = p.granted_by
    where u.email in ('user@example.com', 'pro@example.com', 'gone@example.com')
    order by 1$$,
  $$values
    ('gone@example.com', 'pro', false, null::text, now()),
    ('pro@example.com', 'special', true, 'admin@example.com', '2026-10-01'::timestamptz + interval '1 day'),
    ('user@example.com', 'special', false, 'admin@example.com', '2026-10-01'::timestamptz)$$,
  'each grant that had not ended is on special with its end, granter and time; the ended one, the control, stays on Pro');
select results_eq(
  $$select u.email::text, b.plan from private.user_plans_before_special as b
    join auth.users as u on u.id = b.user_id$$,
  $$values ('pro@example.com', 'pro')$$,
  'the Pro grant special replaced is kept once, for the revert');
select results_eq($$select * from pg_temp.start('f')$$,
  $$values ('special', 'vendor/special-model', null::integer, true, true)$$,
  'and its holder is past its Pro limit');
reset role;

select * from finish();
rollback;
