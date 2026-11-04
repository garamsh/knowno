-- Plans (ADR 0097): each user's plan resolves to Free, Pro or an unended Max, on the version a new
-- grant began on until its renewal, the version in effect at the last renewal after it, and a
-- later version for all once it starts; extract-cards counts a photo by that version; only an
-- admin creates versions and grants plans, each write recorded.
begin;
select plan(43);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

-- The log starts empty here, and so do the versions: the migration records and creates its own,
-- which plan_versions_migration_test.sql covers.
delete from private.admin_audit;
delete from private.plan_versions;

-- The last renewal, the 1st of this month at 00:00 Asia/Seoul, and a time this month before now.
create function pg_temp.renewed() returns timestamptz language sql stable as $$
  select date_trunc('month', now(), 'Asia/Seoul');
$$;
create function pg_temp.this_month(fraction double precision) returns timestamptz language sql stable as $$
  select pg_temp.renewed() + (now() - pg_temp.renewed()) * fraction;
$$;

-- Each plan's versions: Free's from before this month and one begun this month; Pro's from two
-- months back, one before the renewal and one begun this month; Max's from before and one for all
-- begun this month; and a version for all of Free's that starts tomorrow.
create table pg_temp.ids (name text primary key, id bigint);
with added as (
  insert into private.plan_versions (plan, quota, amount, starts_at, applies_to_all)
  values
    ('free', 'monthly', 5, pg_temp.renewed() - interval '40 days', false),
    ('free', 'monthly', 2, pg_temp.this_month(0.5), false),
    ('free', 'monthly', 50, now() + interval '1 day', true),
    ('pro', 'daily', 7, pg_temp.renewed() - interval '60 days', false),
    ('pro', 'daily', 3, pg_temp.renewed() - interval '20 days', false),
    ('pro', 'daily', 1, pg_temp.this_month(0.5), false),
    ('max', 'daily', 1, pg_temp.renewed() - interval '40 days', false),
    ('max', 'unlimited', 4, pg_temp.this_month(0.5), true)
  returning id, plan, amount
) insert into pg_temp.ids select plan || amount, id from added;
-- Each plan's one model, its active configuration (ADR 0162), whichever version a user is on.
with c as (
  insert into private.ai_configurations (plan, provider, model, prompt_version_id) values
    ('free', 'openrouter', 'vendor/free-model', 1), ('pro', 'openrouter', 'vendor/pro-model', 1),
    ('max', 'openrouter', 'vendor/max-model', 1)
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;
create function pg_temp.id(name text) returns bigint language sql stable as $$
  select id from pg_temp.ids where ids.name = id.name;
$$;
grant select on pg_temp.ids to public;
grant execute on function pg_temp.id(text), pg_temp.renewed(), pg_temp.this_month(double precision) to public;

-- A is an admin and B a Free user who is not, both from before this month; C on Pro from before
-- the renewal, its grant on Pro's version of two months back; D on Pro since this month, after
-- Pro's latest version; E on Max from before the renewal; F on a Max that has ended; 1 a Free
-- user who signed up after Free's latest version; 2 a user Pro is granted now.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-00000000000c', 'pro@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-00000000000d', 'new-pro@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-00000000000e', 'max@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-00000000000f', 'ended@example.com', pg_temp.renewed() - interval '50 days'),
  ('00000000-0000-4000-8000-000000000001', 'new@example.com', now()),
  ('00000000-0000-4000-8000-000000000002', 'granted@example.com', pg_temp.renewed() - interval '50 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, ends_at, granted_at, version_id) values
  ('00000000-0000-4000-8000-00000000000c', 'pro', null, pg_temp.renewed() - interval '30 days', pg_temp.id('pro7')),
  ('00000000-0000-4000-8000-00000000000d', 'pro', null, pg_temp.this_month(0.75), pg_temp.id('pro1')),
  ('00000000-0000-4000-8000-00000000000e', 'max', now() + interval '1 day', pg_temp.renewed() - interval '30 days', pg_temp.id('max1')),
  ('00000000-0000-4000-8000-00000000000f', 'max', now() - interval '1 second', pg_temp.renewed() - interval '30 days', pg_temp.id('max1'));

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

-- Every admin plan function, called with arguments that change nothing.
create function pg_temp.calls() returns setof text language sql as $$
  values
    ($q$select * from public.admin_plan_versions()$q$),
    ($q$select public.admin_create_plan_version('pro', 'daily', 9, now() - interval '1 day')$q$),
    ($q$select * from public.admin_user_plan('00000000-0000-4000-8000-00000000000b')$q$),
    ($q$select public.admin_grant_plan('00000000-0000-4000-8000-00000000ffff', 'pro')$q$),
    ($q$select public.admin_revoke_plan('00000000-0000-4000-8000-00000000000b')$q$)
$$;
grant execute on function pg_temp.calls() to public;

-- The calls [who] is refused with insufficient_privilege, or the error of one that failed otherwise.
create function pg_temp.refused_as(who text) returns setof text language plpgsql as $$
declare
  call text;
begin
  for call in select * from pg_temp.calls() loop
    -- A refusal rolls the block back, the sign-in with it.
    begin
      perform pg_temp.sign_in(who);
      execute call;
      perform set_config('role', 'none', true);
    exception
      when insufficient_privilege then
        return next call;
      when others then
        return next 'failed: ' || call || ': ' || sqlerrm;
    end;
  end loop;
end;
$$;

-- What extract-cards gets for one photo of the user whose id ends in [who].
create function pg_temp.start(who text)
returns table (plan text, model text, photo_limit integer, period text, allowed boolean)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.model, b.photo_limit, b.period, b.allowed
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- The role.

select results_eq(
  $$select count(*) from pg_temp.refused_as('b') as r (call) where call not like 'failed: %'$$,
  $$values (5::bigint)$$,
  'a signed-in user who is not an admin is refused by every admin plan function');
reset role;
select results_eq(
  $$select count(*) from pg_temp.refused_as(null) as r (call) where call not like 'failed: %'$$,
  $$values (5::bigint)$$,
  'anon is refused by every admin plan function');
reset role;
select is_empty($$select * from pg_temp.refused_as('a')$$,
  'control: an admin is refused by none, and none fails');
reset role;

select pg_temp.sign_in('b');
select throws_ok($$select * from public.begin_extraction('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a signed-in user cannot start an extraction itself');
select throws_ok($$select * from private.plan_versions$$, '42501', null, 'nor read the versions');
select throws_ok($$select * from private.user_plans$$, '42501', null, 'nor read the grants');
select throws_ok($$insert into private.user_plans (user_id, plan, version_id) values ('00000000-0000-4000-8000-00000000000b', 'pro', 1)$$,
  '42501', null, 'nor grant itself a plan');
reset role;

-- Resolution.

select results_eq($$select plan, model, photo_limit, period from pg_temp.start('b')$$,
  $$values ('free', 'vendor/free-model', 5, 'month')$$,
  'a Free user from before this month is on the Free version in effect at the renewal');
reset role;
select results_eq($$select plan, model, photo_limit, period from pg_temp.start('1')$$,
  $$values ('free', 'vendor/free-model', 2, 'month')$$,
  'a Free user who signed up since Free''s latest version is on it at once');
reset role;
select results_eq($$select plan, photo_limit, period from pg_temp.start('c')$$,
  $$values ('pro', 3, 'day')$$,
  'a grant from before the renewal is on the version in effect at the renewal, not the one it began on');
reset role;
select results_eq($$select plan, photo_limit from pg_temp.start('d')$$,
  $$values ('pro', 1)$$,
  'a grant begun this month keeps the version it began on, not the one in effect at the renewal');
reset role;
select results_eq($$select plan, model, photo_limit, period from pg_temp.start('e')$$,
  $$values ('max', 'vendor/max-model', 4, 'day')$$,
  'a later version for all applies to a grant from before it, its fair-use cap a day');
reset role;
select results_eq($$select plan, model, photo_limit from pg_temp.start('f')$$,
  $$values ('free', 'vendor/free-model', 5)$$, 'a Max past its end is on Free');
reset role;

select results_eq(
  $$select allowed from pg_temp.start('1') union all select allowed from pg_temp.start('1')$$,
  $$values (true), (false)$$, 'the new Free user''s third photo this month is over its 2');
reset role;
select results_eq(
  $$select user_id, count(*) from public.extraction_usage group by user_id order by user_id$$,
  $$values ('00000000-0000-4000-8000-000000000001'::uuid, 2::bigint),
           ('00000000-0000-4000-8000-00000000000b'::uuid, 1::bigint), ('00000000-0000-4000-8000-00000000000c'::uuid, 1::bigint),
           ('00000000-0000-4000-8000-00000000000d'::uuid, 1::bigint), ('00000000-0000-4000-8000-00000000000e'::uuid, 1::bigint),
           ('00000000-0000-4000-8000-00000000000f'::uuid, 1::bigint)$$,
  'only allowed photos are recorded');

-- Admin writes.

select pg_temp.sign_in('a');
select results_eq(
  $$select plan, amount, current from public.admin_plan_versions()$$,
  $$values ('free', 50, false), ('free', 2, true), ('free', 5, false),
           ('pro', 1, true), ('pro', 3, false), ('pro', 7, false),
           ('max', 4, true), ('max', 1, false)$$,
  'the versions by plan, the latest start first, each plan''s new subscribers'' marked');
select is(public.admin_grant_plan('00000000-0000-4000-8000-000000000002', 'pro'), 'granted',
  'grant Pro now');
reset role;
select results_eq($$select photo_limit from pg_temp.start('2')$$, $$values (1)$$,
  'a user granted a plan now is on its latest version at once');
reset role;

select pg_temp.sign_in('a');
select is(public.admin_create_plan_version('pro', 'daily', 9), 'created',
  'create a Pro version from now');
select is(public.admin_create_plan_version('pro', 'daily', 9), 'unchanged',
  'the same terms again change nothing');
select is(public.admin_create_plan_version('pro', 'daily', 12, now() - interval '1 minute'),
  'past_start', 'a start before now is refused');
select is(public.admin_create_plan_version('pro', 'daily', 2, null, true),
  'not_in_favour', 'fewer photos cannot apply to all');
select is(public.admin_create_plan_version('pro', 'monthly', 20, null, true),
  'not_in_favour', 'nor a monthly count where a daily one was');
select is(public.admin_create_plan_version('free', 'monthly', 60, now() + interval '2 days'),
  'created', 'create a Free version that starts in two days');
reset role;
select results_eq($$select photo_limit from pg_temp.start('d')$$, $$values (1)$$,
  'control: an existing grant keeps its version after a version not for all');
reset role;
select results_eq($$select photo_limit from pg_temp.start('2')$$, $$values (1)$$,
  'and so does one granted before it this month');
reset role;
select pg_temp.sign_in('a');
select is(public.admin_create_plan_version('pro', 'daily', 20, null, true),
  'created', 'more photos a day apply to all');
reset role;
select results_eq(
  $$select photo_limit from pg_temp.start('c') union all select photo_limit from pg_temp.start('d')
    union all select photo_limit from pg_temp.start('2')$$,
  $$values (20), (20), (20)$$, 'every Pro grant is on it at once');
reset role;
select pg_temp.sign_in('a');
select throws_ok($$select public.admin_create_plan_version('pro', 'daily', 100001)$$, '23514', null,
  'nor an amount over 100,000');
select throws_ok($$select public.admin_create_plan_version('pro', 'weekly', 30)$$, '23514', null,
  'nor a quota of another kind');
select throws_ok($$select public.admin_create_plan_version('gold', 'daily', 30)$$, '23514', null,
  'nor a plan that does not exist');
select results_eq($$select plan, amount, current from public.admin_plan_versions() where plan = 'free'$$,
  $$values ('free', 60, false), ('free', 50, false), ('free', 2, true), ('free', 5, false)$$,
  'a version starting later is listed and not yet current');

select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'max', now() + interval '7 days'), 'granted',
  'grant Max with an end');
select results_eq(
  $$select plan, quota, amount, granted_plan, ends_at > now(), granted_by_email from public.admin_user_plan('00000000-0000-4000-8000-00000000000b')$$,
  $$values ('max', 'unlimited', 4, 'max', true, 'admin@example.com')$$,
  'the user is on Max, with its terms and the grant behind it');
select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'pro'), 'granted', 'replace it with Pro');
select results_eq($$select plan, ends_at, version_id = pg_temp.id('pro1') from public.admin_user_plan('00000000-0000-4000-8000-00000000000b')$$,
  $$values ('pro', null::timestamptz, false)$$, 'one grant per user, the latest, on the latest version');
select results_eq(
  $$select public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'pro', now() + interval '1 day'),
           public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'max', now() - interval '1 day'),
           public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'free'),
           public.admin_grant_plan('00000000-0000-4000-8000-00000000000b', 'gold'),
           public.admin_grant_plan('00000000-0000-4000-8000-00000000ffff', 'pro')$$,
  $$values ('bad_plan', 'bad_plan', 'bad_plan', 'bad_plan', 'no_user')$$,
  'Pro with an end, Max ending in the past, Free, a plan that does not exist and an unknown user are refused');
select results_eq(
  $$select plan, amount, used, granted_plan from public.admin_user_plan('00000000-0000-4000-8000-00000000000f')$$,
  $$values ('free', 5, 1, 'max')$$,
  'an ended Max shows its grant beside Free, with the photos counted this month');
select is(public.admin_revoke_plan('00000000-0000-4000-8000-00000000000b'), true, 'revoke the plan');
select is(public.admin_revoke_plan('00000000-0000-4000-8000-00000000000b'), false, 'revoking again changes nothing');
reset role;
select results_eq(
  $$select action, target_kind, target_id, detail - 'ends_at' - 'starts_at' - 'version_id' from private.admin_audit order by id$$,
  $$values
    ('grant_plan', 'user', '00000000-0000-4000-8000-000000000002', '{"email": "granted@example.com", "plan": "pro"}'::jsonb),
    ('create_plan_version', 'plan', 'pro', '{"quota": "daily", "amount": 9, "applies_to_all": false, "quota_before": "daily", "amount_before": 1}'::jsonb),
    ('create_plan_version', 'plan', 'free', '{"quota": "monthly", "amount": 60, "applies_to_all": false, "quota_before": "monthly", "amount_before": 50}'::jsonb),
    ('create_plan_version', 'plan', 'pro', '{"quota": "daily", "amount": 20, "applies_to_all": true, "quota_before": "daily", "amount_before": 9}'::jsonb),
    ('grant_plan', 'user', '00000000-0000-4000-8000-00000000000b', '{"email": "user@example.com", "plan": "max"}'::jsonb),
    ('grant_plan', 'user', '00000000-0000-4000-8000-00000000000b', '{"email": "user@example.com", "plan": "pro"}'::jsonb),
    ('revoke_plan', 'user', '00000000-0000-4000-8000-00000000000b', '{"email": "user@example.com", "plan": "pro"}'::jsonb)$$,
  'each change is recorded once, and the refusals and no-ops not at all');

-- Account deletion.

update private.user_plans set granted_by = '00000000-0000-4000-8000-00000000000a' where user_id = '00000000-0000-4000-8000-00000000000c';
delete from auth.users where id in ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000e');
select results_eq(
  $$select user_id, granted_by from private.user_plans order by user_id$$,
  $$values ('00000000-0000-4000-8000-000000000002'::uuid, null::uuid),
           ('00000000-0000-4000-8000-00000000000c'::uuid, null::uuid), ('00000000-0000-4000-8000-00000000000d'::uuid, null::uuid),
           ('00000000-0000-4000-8000-00000000000f'::uuid, null::uuid)$$,
  'a deleted user''s grant goes with it, and a deleted admin''s grants stay with no granter');
select results_eq($$select count(*) from private.plan_versions where amount = 20 and created_by is null$$,
  $$values (1::bigint)$$, 'and the version it created stays, with no author');

select * from finish();
rollback;
