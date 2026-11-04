-- The admin area's list of every user (ADR 0181): admin_users reads for an admin only, pages
-- newest sign-up first with the matches in all, searches the email, filters by plan and status,
-- counts each user's live notes and cards and last answer, and leaves anonymous users out.
begin;
select plan(13);

-- A is an admin, so on 스페셜; B a Free user; C on Pro; D a suspended Free user; E anonymous.
-- Each signed up a day after the one before, so newest first is E, D, C, B, A.
insert into auth.users (id, email, created_at, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '5 days', false),
  ('00000000-0000-4000-8000-00000000000b', 'bea@example.com', now() - interval '4 days', false),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.com', now() - interval '3 days', false),
  ('00000000-0000-4000-8000-00000000000d', 'dan@sample.org', now() - interval '2 days', false),
  ('00000000-0000-4000-8000-00000000000e', null, now() - interval '1 day', true);
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, version_id)
  select '00000000-0000-4000-8000-00000000000c', 'pro', v.id from private.plan_versions as v
  where v.plan = 'pro' and v.starts_at <= now() order by v.starts_at desc, v.id desc limit 1;
insert into private.suspensions (user_id, reason) values ('00000000-0000-4000-8000-00000000000d', 'spam');
-- C has a live note with two live cards, a deleted card, a deleted note's card, and one answer.
insert into public.decks (id, user_id, name, created_at, updated_at, deleted_at) values
  ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'Live', now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'Gone', now(), now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at, deleted_at) values
  ('c0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c1', '[]', '[]', 'a', 'manual', now(), now(), null),
  ('c0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c1', '[]', '[]', 'b', 'manual', now(), now(), null),
  ('c0000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c1', '[]', '[]', 'c', 'manual', now(), now(), now()),
  ('c0000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c2', '[]', '[]', 'd', 'manual', now(), now(), null);
insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at) values
  ('e0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-0000000000c1', 'good', '2026-11-01 10:00+00', 1000, now());

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

-- The setup: C is on Pro and A on 스페셜, as the plan filter below reads them.
select results_eq(
  $$select e.plan from private.entitlement_of('00000000-0000-4000-8000-00000000000c') as e
    union all select e.plan from private.entitlement_of('00000000-0000-4000-8000-00000000000a') as e$$,
  $$values ('pro'), ('special')$$, 'setup: C is entitled to Pro and the admin to 스페셜');

-- The role.

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_users()$$, '42501', null,
  'a signed-in user who is not an admin is refused');
reset role;
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_users()$$, '42501', null, 'anon is refused');
reset role;

select pg_temp.sign_in('a');
select results_eq(
  $$select email, total from public.admin_users()$$,
  $$values ('dan@sample.org', 4::bigint), ('carol@example.com', 4::bigint),
    ('bea@example.com', 4::bigint), ('admin@example.com', 4::bigint)$$,
  'control: an admin reads every user but the anonymous one, newest sign-up first, with the total');

-- Paging.

select results_eq(
  $$select email, total from public.admin_users('', null, null, 2, 2)$$,
  $$values ('bea@example.com', 4::bigint), ('admin@example.com', 4::bigint)$$,
  'the second page of two holds the two oldest, with the total of all the matches');
select is_empty($$select * from public.admin_users('', null, null, 2, 4)$$, 'past the last page, no one');
select results_eq(
  $$select count(*) from public.admin_users('', null, null, 0, 0)$$,
  $$values (1::bigint)$$, 'a page holds at least one');

-- The search and each filter.

select results_eq(
  $$select email, total from public.admin_users(' EXAMPLE ')$$,
  $$values ('carol@example.com', 3::bigint), ('bea@example.com', 3::bigint), ('admin@example.com', 3::bigint)$$,
  'the search finds the emails holding it, ignoring case and the spaces around it');
select results_eq(
  $$select email, user_plan from public.admin_users('', 'pro')$$,
  $$values ('carol@example.com', 'pro')$$, 'the plan filter keeps those on Pro');
select results_eq(
  $$select email, user_plan, admin from public.admin_users('', 'special')$$,
  $$values ('admin@example.com', 'special', true)$$, 'an admin is on 스페셜');
select results_eq(
  $$select email, total from public.admin_users('', 'free')$$,
  $$values ('dan@sample.org', 2::bigint), ('bea@example.com', 2::bigint)$$,
  'the free filter keeps the users without a grant, its total counting them alone');
select results_eq(
  $$select email, suspended from public.admin_users('', null, 'suspended')
    union all select email, suspended from public.admin_users('example', 'free', 'active')$$,
  $$values ('dan@sample.org', true), ('bea@example.com', false)$$,
  'the status filter keeps the suspended or the active, alongside the search and the plan');

-- What each row counts.

select results_eq(
  $$select decks, cards, last_answer_at from public.admin_users('carol')$$,
  $$values (1::bigint, 2::bigint, '2026-11-01 10:00+00'::timestamptz)$$,
  'a user''s live notes, its live cards in them and its last answer');
reset role;

select * from finish();
rollback;
