-- Where a user's plan comes from, in the admin area (#899, ADR 0241): `private.grant_source` answers
-- the source of the grant `private.live_grant` picks, and `admin_user_plan` and `admin_users` each
-- return it with a store grant's end and renewal. Both functions keep every column they had and
-- gain three at the end, `source`, `store_ends_at` and `store_renews`; `user_plan`, `plan` and the
-- plan filter already read `private.entitlement_of`, which takes the live store grant.
--
-- Changes no row: additive.
--
-- Revert: `drop function public.admin_user_plan(uuid)` and `public.admin_users(text, text, text,
-- integer, integer)`, recreate them as 20261102183518_ai_providers.sql and
-- 20261104012615_admin_user_list.sql define them, each with its revoke from public and anon and its
-- grant to authenticated, then `drop function private.grant_source(uuid);`.

-- The source of [user_id]'s plan, as `public.my_plan` names it: 'admin' for an admin account or an
-- admin's grant of Pro or Max, 'store' for a store grant, 'unlimited' for a 스페셜 grant, 'none' on
-- Free with no live grant. A store grant's end and whether it renews, null for any other source.
-- One row for any id.
create function private.grant_source(user_id uuid)
returns table (source text, ends_at timestamptz, renews boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when a.v then 'admin'
      when g.source = 'store' then 'store'
      when g.plan = 'special' then 'unlimited'
      when g.source = 'admin' then 'admin'
      else 'none'
    end,
    case when g.source = 'store' and not a.v then g.ends_at end,
    case when g.source = 'store' and not a.v then g.renews end
  from (select exists (
    select from private.admins as m where m.user_id = grant_source.user_id) as v) as a
  left join lateral private.live_grant(grant_source.user_id) as g on true;
$$;

revoke all on function private.grant_source(uuid) from public, anon, authenticated;

drop function public.admin_user_plan(uuid);

-- [user_id]'s entitlement now with the grant behind it, as 20261102183518_ai_providers.sql
-- returns it, and the source of the plan with a store grant's end and renewal.
create function public.admin_user_plan(user_id uuid)
returns table (
  plan text,
  version_id bigint,
  quota text,
  amount integer,
  provider text,
  model text,
  used integer,
  granted_plan text,
  ends_at timestamptz,
  granted_at timestamptz,
  granted_by_email text,
  source text,
  store_ends_at timestamptz,
  store_renews boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select e.plan, e.version_id, e.quota, e.amount, c.provider, c.model,
    case when e.plan is not null then (select count(*) from public.extraction_usage as x
      where x.user_id = u.id and x.created_at >= e.period_start)::integer end,
    g.plan, g.ends_at, g.granted_at, b.email::text,
    s.source, s.ends_at, s.renews
  from auth.users as u
  left join lateral private.entitlement_of(u.id) as e on true
  left join private.ai_configuration_labels as l on l.plan = e.plan and l.label = 'active'
  left join private.ai_configurations as c on c.id = l.configuration_id
  left join private.user_plans as g on g.user_id = u.id
  left join auth.users as b on b.id = g.granted_by
  cross join lateral private.grant_source(u.id) as s
  where u.id = admin_user_plan.user_id;
end;
$$;

revoke all on function public.admin_user_plan(uuid) from public, anon;
grant execute on function public.admin_user_plan(uuid) to authenticated;

drop function public.admin_users(text, text, text, integer, integer);

-- A page of users as 20261104012615_admin_user_list.sql returns it, with the source of each plan
-- and a store grant's end and renewal after `total`.
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
  total bigint,
  source text,
  store_ends_at timestamptz,
  store_renews boolean
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
    c.user_plan, c.admin, c.suspended, c.total,
    s.source, s.ends_at, s.renews
  from chosen as c
  cross join lateral private.grant_source(c.id) as s
  order by c.created_at desc, c.id;
end;
$$;

revoke all on function public.admin_users(text, text, text, integer, integer) from public, anon;
grant execute on function public.admin_users(text, text, text, integer, integer) to authenticated;
