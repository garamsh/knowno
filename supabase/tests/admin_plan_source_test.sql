-- Where a plan comes from in the admin area (#899, ADR 0241): admin_user_plan and admin_users
-- return the source of the grant behind a user's plan (store, admin, unlimited or none), and a
-- store grant's end and renewal, for an admin only. The better of a store and an admin grant wins,
-- the admin's on a tie, and an admin account is on 'admin' whatever a store grant holds.
begin;
select plan(17);

-- A is an admin; B has no grant; C a store grant of Pro; D an admin grant of Max; E a store grant
-- of Pro and an admin grant of Max; F an admin grant of Pro and a store grant of Max; G a 스페셜
-- grant; H an admin grant of Pro and a store grant of Pro (a tie); I an admin with a store grant.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'none@example.com', now() - interval '89 days'),
  ('00000000-0000-4000-8000-00000000000c', 'store@example.com', now() - interval '88 days'),
  ('00000000-0000-4000-8000-00000000000d', 'adminmax@example.com', now() - interval '87 days'),
  ('00000000-0000-4000-8000-00000000000e', 'both@example.com', now() - interval '86 days'),
  ('00000000-0000-4000-8000-00000000000f', 'storemax@example.com', now() - interval '85 days'),
  ('00000000-0000-4000-8000-000000000010', 'special@example.com', now() - interval '84 days'),
  ('00000000-0000-4000-8000-000000000011', 'tie@example.com', now() - interval '83 days'),
  ('00000000-0000-4000-8000-000000000012', 'adminstore@example.com', now() - interval '82 days');
insert into private.admins (user_id) values
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-000000000012');

-- The latest version of [plan] in effect now.
create function pg_temp.v(plan text) returns bigint language sql as $$
  select v.id from private.plan_versions as v
  where v.plan = $1 and v.starts_at <= now() order by v.starts_at desc, v.id desc limit 1;
$$;
create function pg_temp.id(who text) returns uuid language sql as $$
  select ('00000000-0000-4000-8000-' || lpad($1, 12, '0'))::uuid;
$$;
insert into private.user_plans (user_id, plan, version_id, granted_at)
  select pg_temp.id(g.who), g.plan, pg_temp.v(g.plan), now() - interval '60 days'
  from (values ('00000000000d', 'max'), ('00000000000e', 'max'), ('00000000000f', 'pro'),
    ('000000000010', 'special'), ('000000000011', 'pro')) as g (who, plan);
insert into private.store_grants (user_id, plan, ends_at, renews, granted_at, version_id)
  select pg_temp.id(g.who), g.plan, now() + g.days * interval '1 day', g.renews,
    now() - interval '60 days', pg_temp.v(g.plan)
  from (values ('00000000000c', 'pro', 30, true), ('00000000000e', 'pro', 20, false),
    ('00000000000f', 'max', 10, true), ('000000000011', 'pro', 5, true),
    ('000000000012', 'pro', 15, true)) as g (who, plan, days, renews);

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      format('{"sub":"00000000-0000-4000-8000-%s","role":"authenticated"}', lpad(who, 12, '0')), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- What admin_user_plan answers for [who].
create function pg_temp.source_of(who text)
returns table (plan text, source text, store_ends_at timestamptz, store_renews boolean)
language plpgsql as $$
begin
  perform pg_temp.sign_in('00000000000a');
  return query select p.plan, p.source, p.store_ends_at, p.store_renews
    from public.admin_user_plan(pg_temp.id(who)) as p;
  perform set_config('role', 'none', true);
end;
$$;
grant execute on function pg_temp.source_of(text) to public;

-- The setup: the store and admin grants are what the cases below name.
select results_eq(
  $$select (select count(*) from private.store_grants), (select count(*) from private.user_plans)$$,
  $$values (5::bigint, 5::bigint)$$, 'setup: five store grants and five admin grants');

-- The role.

select pg_temp.sign_in('00000000000b');
select throws_ok($$select * from public.admin_user_plan('00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'a signed-in user who is not an admin cannot read a plan source');
select throws_ok($$select * from public.admin_users()$$, '42501', null,
  'a signed-in user who is not an admin cannot list the sources');
reset role;
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_user_plan('00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'anon cannot read a plan source');
reset role;

-- admin_user_plan.

select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('00000000000b')$$,
  $$values ('free', 'none', true, null::boolean)$$, 'no grant: Free, source none, no end (the control)');
select results_eq($$select plan, source, store_ends_at > now() + interval '29 days', store_renews from pg_temp.source_of('00000000000c')$$,
  $$values ('pro', 'store', true, true)$$, 'a store grant: Pro from the store with its end and renewal');
select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('00000000000d')$$,
  $$values ('max', 'admin', true, null::boolean)$$, 'an admin grant: Max from an admin, no store end');
select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('00000000000e')$$,
  $$values ('max', 'admin', true, null::boolean)$$, 'a store Pro with an admin Max: the admin grant is better');
select results_eq($$select plan, source, store_ends_at > now() + interval '9 days', store_renews from pg_temp.source_of('00000000000f')$$,
  $$values ('max', 'store', true, true)$$, 'an admin Pro with a store Max: the store grant is better');
select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('000000000010')$$,
  $$values ('special', 'unlimited', true, null::boolean)$$, 'a 스페셜 grant: unlimited');
select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('000000000011')$$,
  $$values ('pro', 'admin', true, null::boolean)$$, 'equal grants: the admin one');
select results_eq($$select plan, source, store_ends_at is null, store_renews from pg_temp.source_of('000000000012')$$,
  $$values ('special', 'admin', true, null::boolean)$$, 'an admin account with a store grant: admin, no store end');

-- admin_users.

select pg_temp.sign_in('00000000000a');
select results_eq(
  $$select email, source, store_ends_at is not null, store_renews from public.admin_users('', null, null, 100, 0)
    where email in ('none@example.com', 'store@example.com', 'adminmax@example.com', 'both@example.com',
      'storemax@example.com', 'special@example.com', 'tie@example.com', 'adminstore@example.com')
    order by email$$,
  $$values ('adminmax@example.com', 'admin', false, null::boolean),
    ('adminstore@example.com', 'admin', false, null),
    ('both@example.com', 'admin', false, null),
    ('none@example.com', 'none', false, null),
    ('special@example.com', 'unlimited', false, null),
    ('store@example.com', 'store', true, true),
    ('storemax@example.com', 'store', true, true),
    ('tie@example.com', 'admin', false, null)$$,
  'the list carries each user''s source and a store grant''s end and renewal');
select results_eq(
  $$select email, user_plan, source from public.admin_users('', 'pro') order by email$$,
  $$values ('store@example.com', 'pro', 'store'), ('tie@example.com', 'pro', 'admin')$$,
  'the Pro filter counts a store grant beside an admin one, and not the Free user');
select results_eq(
  $$select email, source from public.admin_users('', 'max') order by email$$,
  $$values ('adminmax@example.com', 'admin'), ('both@example.com', 'admin'), ('storemax@example.com', 'store')$$,
  'the Max filter counts a store Max');
select results_eq(
  $$select total from public.admin_users('', 'pro', null, 1, 0)$$, $$values (2::bigint)$$,
  'the total counts the store plans the filter matches');
select results_eq(
  $$select email, user_plan, source from public.admin_users('none')$$,
  $$values ('none@example.com', 'free', 'none')$$, 'the control with no grant is Free from none');
reset role;
select * from finish();
rollback;
