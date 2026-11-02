-- Unlimited use (#597, ADR 0157): an admin and a holder of a 무제한 grant that has not ended are
-- never refused by a photo limit, each photo still recorded; an ended grant falls back to the
-- user's plan; a user at the limit without either is refused. extraction_allowance answers no
-- limit for the first two. Only an admin reads, grants and revokes 무제한, each write recorded.
begin;
select plan(32);

delete from private.admin_audit;

-- Each plan on one version from before this month: Free 1 a month and Pro 1 a day.
delete from private.plan_versions;
insert into private.plan_versions (plan, quota, amount, model, starts_at) values
  ('free', 'monthly', 1, 'vendor/free-model', date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('pro', 'daily', 1, 'vendor/pro-model', date_trunc('month', now(), 'Asia/Seoul') - interval '40 days'),
  ('max', 'unlimited', 1, 'vendor/max-model', date_trunc('month', now(), 'Asia/Seoul') - interval '40 days');

-- A is an admin on Free; B a Free user; C a Free user granted 무제한 without an end; D a Pro user
-- whose 무제한 has ended; E a Free user whose 무제한 ends tomorrow. Each has used its period's one
-- photo already.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'unlimited@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'ended@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'until@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, version_id) values
  ('00000000-0000-4000-8000-00000000000d', 'pro', (select id from private.plan_versions where plan = 'pro'));
insert into private.unlimited_grants (user_id, ends_at, granted_by) values
  ('00000000-0000-4000-8000-00000000000c', null, '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000d', now() - interval '1 second', '00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000e', now() + interval '1 day', '00000000-0000-4000-8000-00000000000a');
insert into public.extraction_usage (user_id)
  select ('00000000-0000-4000-8000-00000000000' || who)::uuid from unnest(array['a', 'b', 'c', 'd', 'e']) as who;

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
returns table (plan text, photo_limit integer, period text, allowed boolean, recorded boolean)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.photo_limit, b.period, b.allowed, b.usage_id is not null
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

-- The photos recorded for [who], with a call record each.
create function pg_temp.recorded(who text) returns bigint language sql as $$
  select count(*) from public.extraction_usage as u
  join private.extraction_calls as c on c.usage_id = u.id
  where u.user_id = ('00000000-0000-4000-8000-00000000000' || who)::uuid;
$$;

-- The metering.

select results_eq($$select * from pg_temp.start('b')$$, $$values ('free', 1, 'month', false, false)$$,
  'control: a user at the limit with neither role nor grant is refused, and nothing is recorded');
reset role;
select results_eq($$select * from pg_temp.start('a')$$, $$values ('free', 1, 'month', true, true)$$,
  'an admin past its plan''s limit is allowed, on its plan, and the photo is recorded');
reset role;
select results_eq($$select * from pg_temp.start('c')$$, $$values ('free', 1, 'month', true, true)$$,
  'a 무제한 holder past its plan''s limit is allowed, and the photo is recorded');
reset role;
select results_eq($$select * from pg_temp.start('e')$$, $$values ('free', 1, 'month', true, true)$$,
  'so is one whose 무제한 ends later');
reset role;
select results_eq($$select * from pg_temp.start('d')$$, $$values ('pro', 1, 'day', false, false)$$,
  'an ended 무제한 falls back to the user''s plan, Pro, and its limit refuses');
reset role;
select results_eq($$select * from pg_temp.start('a') union all select * from pg_temp.start('c')$$,
  $$values ('free', 1, 'month', true, true), ('free', 1, 'month', true, true)$$,
  'a second photo past the limit is allowed as well');
reset role;
select results_eq(
  $$select pg_temp.recorded('a'), pg_temp.recorded('b'), pg_temp.recorded('c'),
    pg_temp.recorded('d'), pg_temp.recorded('e')$$,
  $$values (2::bigint, 0::bigint, 2::bigint, 0::bigint, 1::bigint)$$,
  'every photo allowed is recorded with its call, so spend stays counted');
reset role;

-- The allowance.

select results_eq($$select * from pg_temp.allowance('b')$$, $$values (1, 'month', 1)$$,
  'control: a user without either reads its limit');
reset role;
select results_eq($$select * from pg_temp.allowance('a')$$, $$values (null::integer, 'month', 3)$$,
  'an admin reads no limit, with its period''s photos');
reset role;
select results_eq($$select * from pg_temp.allowance('c')$$, $$values (null::integer, 'month', 3)$$,
  'a 무제한 holder reads no limit');
reset role;
select results_eq($$select * from pg_temp.allowance('d')$$, $$values (1, 'day', 1)$$,
  'one whose 무제한 ended reads its plan''s limit');
reset role;

-- The role.

-- Every admin 무제한 function, called with arguments that change nothing.
create function pg_temp.calls() returns setof text language sql as $$
  values
    ($q$select * from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000b')$q$),
    ($q$select public.admin_grant_unlimited('00000000-0000-4000-8000-00000000ffff')$q$),
    ($q$select public.admin_revoke_unlimited('00000000-0000-4000-8000-00000000000b')$q$)
$$;
grant execute on function pg_temp.calls() to public;

-- The calls [who] is refused with insufficient_privilege, or the error of one that failed otherwise.
create function pg_temp.refused_as(who text) returns setof text language plpgsql as $$
declare
  call text;
begin
  for call in select * from pg_temp.calls() loop
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

select results_eq(
  $$select count(*) from pg_temp.refused_as('c') as r (call) where call not like 'failed: %'$$,
  $$values (3::bigint)$$,
  'a signed-in user who is not an admin, a 무제한 holder among them, is refused by every admin 무제한 function');
reset role;
select results_eq(
  $$select count(*) from pg_temp.refused_as(null) as r (call) where call not like 'failed: %'$$,
  $$values (3::bigint)$$,
  'anon is refused by every admin 무제한 function');
reset role;
select is_empty($$select * from pg_temp.refused_as('a')$$,
  'control: an admin is refused by none, and none fails');
reset role;

select pg_temp.sign_in('c');
select throws_ok($$select * from private.unlimited_grants$$, '42501', null,
  'a user cannot read the grants');
select throws_ok($$insert into private.unlimited_grants (user_id) values ('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'nor grant itself 무제한');
select throws_ok($$select private.unlimited('00000000-0000-4000-8000-00000000000b')$$, '42501', null,
  'nor ask the decision for anyone');
reset role;
select is_empty($$select * from private.admin_audit$$, 'nothing so far was recorded');

-- The admin's reads and writes.

select pg_temp.sign_in('a');
select results_eq(
  $$select * from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000b')$$,
  $$values (false, null::timestamptz, null::timestamptz, null::text)$$,
  'a user with neither is not unlimited and has no grant');
select results_eq(
  $$select unlimited, ends_at is not null, granted_by_email from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000d')$$,
  $$values (false, true, 'admin@example.com')$$,
  'an ended grant shows with the user not unlimited');
select results_eq(
  $$select unlimited, ends_at from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000a')$$,
  $$values (true, null::timestamptz)$$,
  'an admin is unlimited without a grant');
select is_empty($$select * from public.admin_user_unlimited('00000000-0000-4000-8000-00000000ffff')$$,
  'no row for a user that does not exist');

select results_eq(
  $$select public.admin_grant_unlimited('00000000-0000-4000-8000-00000000000b', now() - interval '1 second'),
           public.admin_grant_unlimited('00000000-0000-4000-8000-00000000ffff')$$,
  $$values ('bad_end', 'no_user')$$,
  'an end not in the future and an unknown user are refused');
reset role;
select is_empty($$select * from private.admin_audit$$, 'and record nothing');

select pg_temp.sign_in('a');
select is(public.admin_grant_unlimited('00000000-0000-4000-8000-00000000000b', now() + interval '7 days'),
  'granted', 'an admin grants 무제한 until a later end');
reset role;
select results_eq(
  $$select action, target_kind, target_id, detail ->> 'email', (detail ->> 'ends_at')::timestamptz = now() + interval '7 days'
    from private.admin_audit$$,
  $$values ('grant_unlimited', 'user', '00000000-0000-4000-8000-00000000000b', 'user@example.com', true)$$,
  'the grant is recorded with the email and the end');
reset role;
select results_eq($$select * from pg_temp.start('b')$$, $$values ('free', 1, 'month', true, true)$$,
  'the grantee past its limit is now allowed');
reset role;

select pg_temp.sign_in('a');
select is(public.admin_grant_unlimited('00000000-0000-4000-8000-00000000000d'), 'granted',
  'granting again replaces an ended grant, here without an end');
select results_eq(
  $$select unlimited, ends_at from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000d')$$,
  $$values (true, null::timestamptz)$$, 'and the user is unlimited again');

select results_eq(
  $$select public.admin_revoke_unlimited('00000000-0000-4000-8000-00000000000b'),
           public.admin_revoke_unlimited('00000000-0000-4000-8000-00000000000b')$$,
  $$values (true, false)$$, 'revoking removes the grant once, and then finds none');
reset role;
select results_eq(
  $$select action, detail ->> 'email' from private.admin_audit order by id$$,
  $$values ('grant_unlimited', 'user@example.com'), ('grant_unlimited', 'ended@example.com'),
    ('revoke_unlimited', 'user@example.com')$$,
  'the revoke is recorded once, the second recording nothing');
reset role;
select results_eq($$select * from pg_temp.start('b')$$, $$values ('free', 1, 'month', false, false)$$,
  'once revoked, the user is refused at its limit again');
reset role;

select * from finish();
rollback;
