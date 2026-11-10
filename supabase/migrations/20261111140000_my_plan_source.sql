-- One definition of where a plan comes from (#902): `public.my_plan` takes its `source`, `ends_at`
-- and `renews` from `private.grant_source` (20261111120000_admin_plan_source.sql), which the admin's
-- reads already use, instead of holding the same `case` itself. Its columns, their order and their
-- values are those 20261110190000_store_plans.sql gave it.
--
-- Changes no row: additive.
--
-- Revert, run once against production: `select private.revert_my_plan_source();`, then
-- `drop function private.revert_my_plan_source();`. It restores `public.my_plan` as
-- 20261110190000_store_plans.sql defined it.

create or replace function public.my_plan()
returns table (
  plan text, source text, ends_at timestamptz, renews boolean, photo_limit integer, period text,
  used integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.plan = 'special' then 'max' else e.plan end,
    s.source, s.ends_at, s.renews,
    case when private.unlimited((select auth.uid())) then null else e.amount end,
    private.quota_period(e.quota),
    (select count(*) from public.extraction_usage as u
      where u.user_id = (select auth.uid()) and u.created_at >= e.period_start)::integer
  from private.entitlement_of((select auth.uid())) as e
  cross join lateral private.grant_source((select auth.uid())) as s
  where (select auth.uid()) is not null
$$;

-- The revert in the header.
create function private.revert_my_plan_source() returns void
language plpgsql
security definer
set search_path = ''
as $revert$
begin
  execute $sql$
    create or replace function public.my_plan()
    returns table (
      plan text, source text, ends_at timestamptz, renews boolean, photo_limit integer,
      period text, used integer
    )
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      select case when e.plan = 'special' then 'max' else e.plan end,
        case
          when exists (select from private.admins as a where a.user_id = (select auth.uid()))
            then 'admin'
          when g.source = 'store' then 'store'
          when g.plan = 'special' then 'unlimited'
          when g.source = 'admin' then 'admin'
          else 'none'
        end,
        case when g.source = 'store' and not is_admin.v then g.ends_at end,
        case when g.source = 'store' and not is_admin.v then g.renews end,
        case when private.unlimited((select auth.uid())) then null else e.amount end,
        private.quota_period(e.quota),
        (select count(*) from public.extraction_usage as u
          where u.user_id = (select auth.uid()) and u.created_at >= e.period_start)::integer
      from private.entitlement_of((select auth.uid())) as e
      cross join lateral (select exists (
        select from private.admins as a where a.user_id = (select auth.uid())) as v) as is_admin
      left join lateral private.live_grant((select auth.uid())) as g on true
      where (select auth.uid()) is not null
    $fn$;
  $sql$;
end;
$revert$;

revoke all on function private.revert_my_plan_source() from public, anon, authenticated;
