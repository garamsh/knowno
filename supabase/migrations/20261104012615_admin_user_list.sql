-- The admin area's 사용자 as one paged list of every user (#651, ADR 0181): `admin_users` reads a
-- page of the users whose email holds a search, all of them for a blank one, on a plan and in a
-- status, newest sign-up first, each with its counts, plan and state and the matches in all. It
-- replaces `admin_search_users`, which found no one for a blank search and which nothing calls
-- now.
--
-- Additive in data: it changes no row. It drops one function.
--
-- Revert: recreate `public.admin_search_users` as 20261019200000_admin_users.sql defines it, with
-- its revoke from public and anon and its grant to authenticated, then
-- `drop function public.admin_users(text, text, text, integer, integer);`.

drop function public.admin_search_users(text, integer, integer);

-- A page of the users that are not anonymous whose email holds [query], ignoring case, every one
-- for a blank [query], on [plan] ('free', 'pro', 'max' or 'special', any for null) by the plan
-- they are entitled to now, and in [status] ('active' or 'suspended', any for null), newest
-- sign-up first: each with its last answer, live notes and cards, plan (`user_plan`, since `plan`
-- names the filter), whether it is an admin and whether it is suspended, and the matches in all.
-- A page holds 1 to 100.
create function public.admin_users(
  query text default '',
  plan text default null,
  status text default null,
  page_size integer default 20,
  page_offset integer default 0
)
returns table (
  user_id uuid,
  email text,
  created_at timestamptz,
  last_answer_at timestamptz,
  decks bigint,
  cards bigint,
  user_plan text,
  admin boolean,
  suspended boolean,
  total bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  needle text := lower(btrim(coalesce(admin_users.query, '')));
begin
  perform private.require_admin();
  return query
  with matched as (
    select u.id, u.email::text as email, u.created_at,
      (select e.plan from private.entitlement_of(u.id) as e) as user_plan,
      exists (select from private.admins as a where a.user_id = u.id) as admin,
      exists (select from private.suspensions as s where s.user_id = u.id) as suspended
    from auth.users as u
    where not u.is_anonymous
      and (needle = '' or strpos(lower(u.email), needle) > 0)
  ), chosen as (
    select m.*, count(*) over () as total
    from matched as m
    where (admin_users.plan is null or m.user_plan = admin_users.plan)
      and (admin_users.status is null
        or (admin_users.status = 'suspended' and m.suspended)
        or (admin_users.status = 'active' and not m.suspended))
    order by m.created_at desc, m.id
    limit least(greatest(admin_users.page_size, 1), 100)
    offset greatest(admin_users.page_offset, 0)
  )
  select c.id, c.email, c.created_at,
    (select max(r.reviewed_at) from public.reviews as r where r.user_id = c.id),
    (select count(*) from public.decks as d where d.user_id = c.id and d.deleted_at is null),
    (select count(*) from public.cards as k
      join public.decks as d on d.user_id = k.user_id and d.id = k.deck_id and d.deleted_at is null
      where k.user_id = c.id and k.deleted_at is null),
    c.user_plan, c.admin, c.suspended, c.total
  from chosen as c
  order by c.created_at desc, c.id;
end;
$$;

revoke all on function public.admin_users(text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_users(text, text, text, integer, integer) to authenticated;
