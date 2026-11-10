-- A paid plan from the store (#884, ADR 0241): apply_store_entitlement grants, renews, ends and
-- replays a store grant on Pro; an admin's grant and a 스페셜 one are never read or written by it;
-- a store grant outlasts an ended admin grant; every change is recorded and a replay is not; my_plan
-- answers the plan, its source and the period's photos; and the two RevenueCat secrets are set and
-- cleared by an admin who signed in recently, never read back, never recorded.
begin;
select plan(76);

delete from private.admin_audit;

-- Free 1 a month, Pro 5 a day and Max 50 a day, from before this month.
delete from private.plan_versions where plan <> 'special';
insert into private.plan_versions (plan, quota, amount, starts_at) values
  ('free', 'monthly', 1, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('pro', 'daily', 5, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('max', 'daily', 50, date_trunc('month', now(), 'Asia/Seoul') - interval '40 days');

-- A is an admin; B a Free user; C a user with a Max grant from an admin; D one with a special
-- (무제한) grant; E one whose special grant has ended; F is no user.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000c', 'max@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000d', 'special@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000e', 'ended@example.com', now() - interval '90 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, ends_at, version_id, granted_at)
  select ('00000000-0000-4000-8000-00000000000' || g.who)::uuid, g.plan, g.ends_at, v.id,
    now() - interval '60 days'
  from (values ('c', 'max', null::timestamptz), ('d', 'special', null),
    ('e', 'special', now() - interval '1 second')) as g (who, plan, ends_at)
  join private.plan_versions as v on v.plan = g.plan;

-- Signs in as the user whose id ends in [who], [minutes] after its sign-in, or as anon for null.
create function pg_temp.sign_in(who text, minutes integer default 1) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format(
      '{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated","amr":[{"method":"oauth","timestamp":%s}]}',
      who, floor(extract(epoch from now()) - minutes * 60)::bigint), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text, integer) to public;

-- What the webhook function sends for the user whose id ends in [who].
create function pg_temp.apply(who text, plan text, ends_at timestamptz, renews boolean default true)
returns text language plpgsql as $$
declare
  answer text;
begin
  perform set_config('role', 'service_role', true);
  answer := public.apply_store_entitlement(
    ('00000000-0000-4000-8000-00000000000' || who)::uuid, plan, ends_at, renews);
  perform set_config('role', 'none', true);
  return answer;
end;
$$;

-- What [who] reads in 내 플랜, signed in.
create function pg_temp.mine(who text)
returns table (plan text, source text, ends_at timestamptz, renews boolean, photo_limit integer,
  period text, used integer)
language plpgsql as $$
begin
  perform pg_temp.sign_in(who);
  return query select * from public.my_plan();
  perform set_config('role', 'none', true);
end;
$$;

-- A purchase.

select is(pg_temp.apply('b', 'pro', now() + interval '30 days'), 'granted',
  'a purchase gives a Free user a store grant');
reset role;
select results_eq($$select plan, renews from private.store_grants
    where user_id = '00000000-0000-4000-8000-00000000000b'$$,
  $$values ('pro', true)$$, 'on Pro, renewing');
select results_eq(
  $$select m.plan, m.source, m.ends_at > now() + interval '29 days', m.renews, m.photo_limit,
    m.period, m.used from pg_temp.mine('b') as m$$,
  $$values ('pro', 'store', true, true, 5, 'day', 0)$$,
  'my_plan reads Pro from the store with its renewal, the day''s limit and nothing used');
reset role;
select is(pg_temp.apply('b', 'pro', (select ends_at from private.store_grants
    where user_id = '00000000-0000-4000-8000-00000000000b')), 'unchanged',
  'a replayed event changes nothing');
reset role;
select is(
  (select count(*) from private.admin_audit where action = 'store_grant_plan'), 1::bigint,
  'and records nothing');

-- A renewal.

create temp table before as select granted_at, version_id from private.store_grants
  where user_id = '00000000-0000-4000-8000-00000000000b';
grant select on before to public;
select is(pg_temp.apply('b', 'pro', now() + interval '60 days'), 'changed',
  'a renewal moves the end');
reset role;
select results_eq(
  $$select s.granted_at = b.granted_at, s.version_id = b.version_id, s.ends_at > now() + interval '59 days'
    from private.store_grants as s, before as b
    where s.user_id = '00000000-0000-4000-8000-00000000000b'$$,
  $$values (true, true, true)$$, 'keeping the start and the version');
select is(pg_temp.apply('b', 'pro', (select ends_at from private.store_grants
    where user_id = '00000000-0000-4000-8000-00000000000b'), false), 'changed',
  'a cancelled renewal is a change too');
reset role;
select results_eq($$select m.renews from pg_temp.mine('b') as m$$, $$values (false)$$,
  'read as no longer renewing');
reset role;

-- A used photo is counted in the period.

insert into public.extraction_usage (user_id) values ('00000000-0000-4000-8000-00000000000b');
select results_eq($$select m.used from pg_temp.mine('b') as m$$, $$values (1)$$,
  'my_plan counts the period''s photos');
reset role;

-- An expiry and a refund.

select is(pg_temp.apply('b', 'pro', now() - interval '1 second'), 'ended',
  'an entitlement whose end has passed ends the grant');
reset role;
select results_eq($$select count(*) from private.store_grants
    where user_id = '00000000-0000-4000-8000-00000000000b'$$, $$values (0::bigint)$$,
  'deleting it');
select results_eq(
  $$select m.plan, m.source, m.ends_at, m.renews, m.photo_limit, m.period, m.used
    from pg_temp.mine('b') as m$$,
  $$values ('free', 'none', null::timestamptz, null::boolean, 1, 'month', 1)$$,
  'and the user is on Free');
reset role;
select is(pg_temp.apply('b', null, null), 'unchanged', 'ending again changes nothing');
reset role;
select is(pg_temp.apply('b', 'pro', now() + interval '30 days'), 'granted', 'a repurchase grants');
reset role;
select is(pg_temp.apply('b', null, null), 'ended', 'a refund, no entitlement left, ends it');
reset role;
select is(pg_temp.apply('b', 'pro', null, false), 'granted', 'an entitlement with no end grants');
reset role;
select results_eq($$select m.plan, m.ends_at, m.renews from pg_temp.mine('b') as m$$,
  $$values ('pro', null::timestamptz, false)$$, 'with no end and no renewal');
reset role;
select is(pg_temp.apply('b', 'max', now() + interval '30 days'), 'changed',
  'another plan changes the grant');
reset role;
select results_eq($$select m.plan, m.photo_limit from pg_temp.mine('b') as m$$,
  $$values ('max', 50)$$, 'read on that plan''s limit');
reset role;
select is(pg_temp.apply('b', null, null), 'ended', 'ends');
reset role;

-- Not a user, not a plan.

select is(pg_temp.apply('f', 'pro', now() + interval '30 days'), 'no_user',
  'a user that does not exist is refused');
reset role;
select is(pg_temp.apply('b', 'special', null), 'bad_plan', 'special is never a store plan');
reset role;
select is(pg_temp.apply('b', 'free', null), 'bad_plan', 'nor is free');
reset role;
select results_eq(
  $$select action from private.admin_audit order by id$$,
  $$values ('store_grant_plan'), ('store_change_plan'), ('store_change_plan'), ('store_end_plan'),
    ('store_grant_plan'), ('store_end_plan'), ('store_grant_plan'), ('store_change_plan'),
    ('store_end_plan')$$,
  'each store change is recorded, a replay, an unknown user and a refusal are not');
select results_eq(
  $$select distinct admin_id is null, admin_email, target_kind from private.admin_audit$$,
  $$values (true, 'revenuecat', 'user')$$, 'as RevenueCat''s, on the user');

-- An admin's grant is untouched.

select is(pg_temp.apply('c', 'pro', now() + interval '30 days'), 'granted',
  'a purchase by a user with an admin''s Max grant is granted');
reset role;
select results_eq($$select m.plan, m.source, m.ends_at, m.photo_limit from pg_temp.mine('c') as m$$,
  $$values ('max', 'admin', null::timestamptz, 50)$$,
  'it never replaces the admin grant: the user is still on Max, from admin');
reset role;
select is(pg_temp.apply('c', null, null), 'ended', 'a store event ends the store grant');
reset role;
select results_eq(
  $$select plan, ends_at, granted_at < now() - interval '59 days'
    from private.user_plans where user_id = '00000000-0000-4000-8000-00000000000c'$$,
  $$values ('max', null::timestamptz, true)$$,
  'and never the admin''s grant, which stands as it was');
select results_eq($$select m.plan, m.source from pg_temp.mine('c') as m$$,
  $$values ('max', 'admin')$$, 'the user is still on Max');
reset role;

-- A 무제한 grant is untouched.

select is(pg_temp.apply('d', 'pro', now() + interval '30 days'), 'granted',
  'a purchase by a 무제한 user is granted');
reset role;
select results_eq($$select m.plan, m.source, m.photo_limit from pg_temp.mine('d') as m$$,
  $$values ('max', 'unlimited', null::integer)$$,
  'it never replaces it: no limit, shown as Max, from unlimited, nothing naming 스페셜');
reset role;
select is(pg_temp.apply('d', null, null), 'ended', 'a store event ends the store grant');
reset role;
select results_eq($$select plan, ends_at from private.user_plans
    where user_id = '00000000-0000-4000-8000-00000000000d'$$,
  $$values ('special', null::timestamptz)$$, 'never the 무제한 grant');
select results_eq($$select m.plan, m.source, m.photo_limit from pg_temp.mine('d') as m$$,
  $$values ('max', 'unlimited', null::integer)$$, 'which still serves the user');
reset role;

-- A store grant outlasts an ended 스페셜 grant, as ADR 0177 asks.

select is(pg_temp.apply('e', 'pro', now() + interval '30 days'), 'granted',
  'a user whose 스페셜 grant ended can buy');
reset role;
select results_eq($$select m.plan, m.source from pg_temp.mine('e') as m$$,
  $$values ('pro', 'store')$$, 'and is on Pro, not Free');
reset role;
update private.user_plans set ends_at = now() + interval '1 day'
  where user_id = '00000000-0000-4000-8000-00000000000e';
select results_eq($$select m.plan, m.source from pg_temp.mine('e') as m$$,
  $$values ('max', 'unlimited')$$, 'control: while the 스페셜 grant lasts it is the better one');
reset role;

-- An admin.

select results_eq($$select m.plan, m.source, m.ends_at, m.photo_limit from pg_temp.mine('a') as m$$,
  $$values ('max', 'admin', null::timestamptz, null::integer)$$,
  'an admin reads Max from admin with no limit');
reset role;
select is(pg_temp.apply('a', 'pro', now() + interval '30 days'), 'granted', 'and may also buy');
reset role;
select results_eq($$select m.source, m.ends_at from pg_temp.mine('a') as m$$,
  $$values ('admin', null::timestamptz)$$, 'still read as admin, with no end shown');
reset role;

-- No client reaches the grants.

select pg_temp.sign_in('b');
select throws_ok($$select public.apply_store_entitlement(
    '00000000-0000-4000-8000-00000000000b', 'pro', null, false)$$, '42501', null,
  'a user cannot give itself a store grant');
select throws_ok($$select * from private.store_grants$$, '42501', null, 'nor read the grants');
select throws_ok($$select * from public.store_secrets()$$, '42501', null, 'nor the secrets');
select throws_ok($$select * from public.admin_store_secrets()$$, '42501', null,
  'nor list them, as an admin does');
select throws_ok($$select public.admin_set_store_secret('knowno_store_api_key', 'sk_test_value1')$$,
  '42501', null, 'nor set one');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.my_plan()$$, '42501', null, 'anon reads no plan');
reset role;

-- The secrets.

-- What the function reads, as service_role.
create function pg_temp.secrets() returns table (webhook_authorization text, api_key text)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select * from public.store_secrets();
  perform set_config('role', 'none', true);
end;
$$;

select results_eq($$select * from pg_temp.secrets()$$,
  $$values (null::text, null::text)$$, 'control: both secrets read null while unset');
select pg_temp.sign_in('a', 20);
select is(public.admin_set_store_secret('knowno_store_api_key', 'sk_test_value1'), 'reauth',
  'setting one needs a sign-in within 10 minutes');
select is(public.admin_clear_store_secret('knowno_store_api_key'), 'reauth', 'so does clearing');
select pg_temp.sign_in('a');
select is(public.admin_set_store_secret('other', 'sk_test_value1'), 'bad_name', 'only the two names');
select is(public.admin_set_store_secret('knowno_store_api_key', 'short'), 'bad_secret',
  'an API key of under 8 characters is refused');
select is(public.admin_set_store_secret('knowno_store_api_key', 'has a space 123'), 'bad_secret',
  'or with a space');
select is(public.admin_set_store_secret('knowno_store_webhook_authorization', 'too short'),
  'bad_secret', 'a webhook value of under 16 is refused');
select is(public.admin_set_store_secret('knowno_store_api_key', 'sk_test_value1'), 'saved',
  'a valid key is saved');
select is(public.admin_set_store_secret('knowno_store_webhook_authorization', 'Bearer webhook-value-1'),
  'saved', 'and a webhook value with a space');
select results_eq($$select name, is_set, set_by_email from public.admin_store_secrets()$$,
  $$values ('knowno_store_api_key', true, 'admin@example.com'),
    ('knowno_store_webhook_authorization', true, 'admin@example.com')$$,
  'the list says each is set and by whom');
select is(public.admin_set_store_secret('knowno_store_api_key', 'sk_test_value2'), 'saved',
  'a replaced key is saved');
reset role;
select results_eq($$select * from pg_temp.secrets()$$,
  $$values ('Bearer webhook-value-1', 'sk_test_value2')$$, 'service_role reads both, the new key');
select results_eq(
  $$select action, target_kind, target_id, detail from private.admin_audit
    where action like '%store_secret' order by id$$,
  $$values ('set_store_secret', 'store_secret', 'knowno_store_api_key', '{"replaced": false}'::jsonb),
    ('set_store_secret', 'store_secret', 'knowno_store_webhook_authorization', '{"replaced": false}'::jsonb),
    ('set_store_secret', 'store_secret', 'knowno_store_api_key', '{"replaced": true}'::jsonb)$$,
  'each write is recorded by name, with no value');
select is((select count(*) from private.admin_audit
    where detail::text ~ '(sk_test|webhook-value)'), 0::bigint, 'no audit row holds a value');
select pg_temp.sign_in('a');
select is(public.admin_clear_store_secret('knowno_store_api_key'), 'cleared', 'a key is cleared');
select is(public.admin_clear_store_secret('knowno_store_api_key'), 'none', 'and clearing it again finds none');
reset role;
select results_eq($$select * from pg_temp.secrets()$$,
  $$values ('Bearer webhook-value-1', null::text)$$, 'read back as unset, the other kept');
select is((select count(*) from vault.secrets where name = 'knowno_store_api_key'), 0::bigint,
  'and gone from Vault');

-- The sync route's limit: 10 calls in 10 minutes by one user.

select is((select count(*) filter (where public.store_sync_begin('00000000-0000-4000-8000-00000000000b'))
    from generate_series(1, 10)), 10::bigint, 'a user may call the sync route 10 times');
select is(public.store_sync_begin('00000000-0000-4000-8000-00000000000b'), false, 'and not an 11th');
select is(public.store_sync_begin('00000000-0000-4000-8000-00000000000c'), true,
  'another user is not limited by it');
update private.store_sync_attempts set at = now() - interval '11 minutes'
  where user_id = '00000000-0000-4000-8000-00000000000b';
select is(public.store_sync_begin('00000000-0000-4000-8000-00000000000b'), true,
  'calls older than 10 minutes are not counted');
update private.store_sync_attempts set at = now() - interval '2 days'
  where user_id = '00000000-0000-4000-8000-00000000000c';
select public.store_sync_begin('00000000-0000-4000-8000-00000000000c');
select is((select count(*) from private.store_sync_attempts
    where user_id = '00000000-0000-4000-8000-00000000000c' and at < now() - interval '1 day'),
  0::bigint, 'a call a day old is deleted');
select pg_temp.sign_in('b');
select throws_ok($$select public.store_sync_begin('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a user cannot reset or spend its own limit');
reset role;

-- my_plan reads its source from private.grant_source, and its revert restores the old answers.

select is(pg_temp.apply('b', 'pro', now() + interval '30 days'), 'granted', 'B buys Pro again');
reset role;
create temp table mine_before as
  select w.who, m.* from (values ('a'), ('b'), ('c'), ('d'), ('e')) as w (who),
    lateral pg_temp.mine(w.who) as m;
grant select on mine_before to public;
reset role;
select results_eq(
  $$select b.who, b.source, b.ends_at, b.renews from mine_before as b
    order by b.who$$,
  $$select w.who, s.source, s.ends_at, s.renews
    from (values ('a'), ('b'), ('c'), ('d'), ('e')) as w (who),
      lateral private.grant_source(('00000000-0000-4000-8000-00000000000' || w.who)::uuid) as s
    order by w.who$$,
  'my_plan answers the source, end and renewal grant_source answers, for each source');
select lives_ok($$select private.revert_my_plan_source()$$, 'the revert runs');
select results_eq(
  $$select w.who, m.plan, m.source, m.ends_at, m.renews, m.photo_limit, m.period, m.used
    from (values ('a'), ('b'), ('c'), ('d'), ('e')) as w (who),
      lateral pg_temp.mine(w.who) as m order by w.who$$,
  $$select b.who, b.plan, b.source, b.ends_at, b.renews, b.photo_limit, b.period, b.used
    from mine_before as b order by b.who$$,
  'my_plan answers as before once reverted');
reset role;

select * from finish();
rollback;
