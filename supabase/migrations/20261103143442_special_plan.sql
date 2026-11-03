-- 스페셜 as a plan (#649, ADR 0177): unlimited use becomes the plan `special`, whose one quota,
-- `none`, has no amount and no limit. Every admin is on it, and an admin grants it through
-- admin_grant_plan with an optional end, as Max. The separate 무제한 grant of ADR 0157 goes.
-- `private.unlimited` keeps its name and now answers whether the user's entitlement has no limit,
-- so begin_extraction and extraction_allowance keep their bodies. Special is served by its own AI
-- configuration, seeded as a copy of Max's active one.
--
-- Not additive: each 무제한 grant that has not ended becomes a special grant in
-- `private.user_plans` with its end, granter and time, replacing the user's Pro or Max grant.
-- Every 무제한 grant, ended or not, is kept in `private.unlimited_grants_before_special`, and every
-- grant replaced in `private.user_plans_before_special`.
--
-- Revert, run against production:
--   1. Recreate `private.unlimited_grants` and its index, row-level security and revoke, and
--      `admin_user_unlimited`, `admin_grant_unlimited` and `admin_revoke_unlimited`, from
--      20261102170843_unlimited.sql.
--   2. `insert into private.unlimited_grants select user_id, ends_at, granted_by, granted_at
--      from private.unlimited_grants_before_special;`
--   3. `delete from private.user_plans where plan = 'special';` then
--      `insert into private.user_plans select user_id, plan, ends_at, granted_by, granted_at,
--      version_id from private.user_plans_before_special;`
--   4. Restore `private.unlimited`, from 20261102170843_unlimited.sql, and
--      `private.entitlement_of` and `public.admin_grant_plan`, from 20261102183518_ai_providers.sql
--      and 20261026005136_plan_versions.sql.
--   5. Restore the checks: `user_plans_plan_check` to Pro and Max, `user_plans_check` to an end on
--      Max alone, and on `private.plan_versions`, after `delete from private.plan_versions where
--      plan = 'special'`, `amount` not null and the plan and quota checks without special and
--      none. Special's configurations are append-only and stay, with their checks: nothing then
--      reads them.

-- Every 무제한 grant as it was before this change. Read by nothing but the revert.
create table private.unlimited_grants_before_special (
  user_id uuid primary key references auth.users on delete cascade,
  ends_at timestamptz,
  granted_by uuid references auth.users on delete set null,
  granted_at timestamptz not null
);
create index unlimited_grants_before_special_granted_by
  on private.unlimited_grants_before_special (granted_by);
insert into private.unlimited_grants_before_special (user_id, ends_at, granted_by, granted_at)
  select g.user_id, g.ends_at, g.granted_by, g.granted_at from private.unlimited_grants as g;

-- Each Pro or Max grant a special grant replaced. Read by nothing but the revert.
create table private.user_plans_before_special (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null,
  ends_at timestamptz,
  granted_by uuid references auth.users on delete set null,
  granted_at timestamptz not null,
  version_id bigint not null
);
create index user_plans_before_special_granted_by on private.user_plans_before_special (granted_by);

alter table private.unlimited_grants_before_special enable row level security;
alter table private.user_plans_before_special enable row level security;
revoke all on private.unlimited_grants_before_special, private.user_plans_before_special
  from public, anon, authenticated, service_role;

-- Special takes the quota `none` and only it, which alone has no amount.
alter table private.plan_versions
  drop constraint plan_versions_plan_check,
  drop constraint plan_versions_quota_check,
  alter column amount drop not null,
  add constraint plan_versions_plan_check check (plan in ('free', 'pro', 'max', 'special')),
  add constraint plan_versions_quota_check
    check (quota in ('monthly', 'daily', 'unlimited', 'none')),
  add constraint plan_versions_special_check check ((plan = 'special') = (quota = 'none')),
  add constraint plan_versions_none_check check ((quota = 'none') = (amount is null));

alter table private.user_plans
  drop constraint user_plans_plan_check,
  drop constraint user_plans_check,
  add constraint user_plans_plan_check check (plan in ('pro', 'max', 'special')),
  add constraint user_plans_check check (plan in ('max', 'special') or ends_at is null);

alter table private.ai_configurations
  drop constraint ai_configurations_plan_check,
  add constraint ai_configurations_plan_check check (plan in ('free', 'pro', 'max', 'special'));
alter table private.ai_configuration_labels
  drop constraint ai_configuration_labels_plan_check,
  add constraint ai_configuration_labels_plan_check
    check (plan in ('free', 'pro', 'max', 'special'));

insert into private.plan_versions (plan, quota, amount, starts_at)
  values ('special', 'none', null, now());

-- Gives special a copy of Max's active configuration while it has no active one, so its model is
-- Max's until an admin saves another. Moves each 무제한 grant in the backup that has not ended
-- onto special, with its end, granter and time, first keeping the Pro or Max grant it replaces. A
-- second run straight after changes nothing.
create function private.migrate_special_plan() returns void
language plpgsql
set search_path = ''
as $$
begin
  with copied as (
    insert into private.ai_configurations (plan, provider, model)
      select 'special', c.provider, c.model
      from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.plan = 'max' and l.label = 'active'
        and not exists (select from private.ai_configuration_labels as s
          where s.plan = 'special' and s.label = 'active')
      returning id
  )
  insert into private.ai_configuration_labels (plan, label, configuration_id)
    select 'special', 'active', copied.id from copied;

  insert into private.user_plans_before_special
      (user_id, plan, ends_at, granted_by, granted_at, version_id)
    select p.user_id, p.plan, p.ends_at, p.granted_by, p.granted_at, p.version_id
    from private.user_plans as p
    join private.unlimited_grants_before_special as g on g.user_id = p.user_id
    where (g.ends_at is null or g.ends_at > now()) and p.plan <> 'special'
    on conflict do nothing;

  insert into private.user_plans (user_id, plan, ends_at, granted_by, granted_at, version_id)
    select g.user_id, 'special', g.ends_at, g.granted_by, g.granted_at,
      (private.plan_version_at('special', now())).id
    from private.unlimited_grants_before_special as g
    where g.ends_at is null or g.ends_at > now()
    on conflict on constraint user_plans_pkey do update
      set plan = excluded.plan, ends_at = excluded.ends_at, granted_by = excluded.granted_by,
        granted_at = excluded.granted_at, version_id = excluded.version_id;
end;
$$;

revoke all on function private.migrate_special_plan() from public, anon, authenticated;

select private.migrate_special_plan();

drop function public.admin_user_unlimited(uuid);
drop function public.admin_grant_unlimited(uuid, timestamptz);
drop function public.admin_revoke_unlimited(uuid);
drop table private.unlimited_grants;

-- What [user_id] is entitled to now, as 20261102183518_ai_providers.sql decided it, except that an
-- admin is on special's version whatever it was granted.
create or replace function private.entitlement_of(user_id uuid)
returns table (plan text, version_id bigint, quota text, amount integer, period_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  renewed timestamptz := date_trunc('month', now(), 'Asia/Seoul');
  grant_row private.user_plans;
  signed_up timestamptz;
  base private.plan_versions;
  chosen private.plan_versions;
  admin boolean := exists (
    select from private.admins as a where a.user_id = entitlement_of.user_id);
begin
  select g.* into grant_row from private.user_plans as g
    where g.user_id = entitlement_of.user_id and (g.ends_at is null or g.ends_at > now());
  if admin then
    base := private.plan_version_at('special', now());
  elsif found and grant_row.granted_at > renewed then
    select v.* into base from private.plan_versions as v where v.id = grant_row.version_id;
  elsif found then
    base := private.plan_version_at(grant_row.plan, renewed);
  else
    select u.created_at into signed_up from auth.users as u where u.id = entitlement_of.user_id;
    base := private.plan_version_at('free', greatest(signed_up, renewed));
  end if;
  if base.id is null then
    return;
  end if;
  select v.* into chosen from private.plan_versions as v
    where v.plan = base.plan and v.applies_to_all and v.starts_at <= now()
      and (v.starts_at, v.id) > (base.starts_at, base.id)
    order by v.starts_at desc, v.id desc
    limit 1;
  if not found then
    chosen := base;
  end if;
  return query select chosen.plan, chosen.id, chosen.quota, chosen.amount,
    case chosen.quota
      when 'monthly' then date_trunc('month', now(), 'Asia/Seoul')
      else date_trunc('day', now(), 'Asia/Seoul')
    end;
end;
$$;

-- Whether no photo limit applies to [user_id]: its entitlement is special's, whose quota is none.
create or replace function private.unlimited(user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select e.quota = 'none' from private.entitlement_of(unlimited.user_id) as e),
    false);
$$;

-- Puts [user_id] on Pro, or on Max or Special until [ends_at] or without an end, on the plan's
-- version a user subscribing now takes, replacing any grant, and records it: 'granted'; 'no_user'
-- for a user that does not exist, 'bad_plan' for any other plan, a plan without a version, an end
-- on Pro or an end not in the future, recording nothing.
create or replace function public.admin_grant_plan(user_id uuid, plan text, ends_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  version bigint;
begin
  perform private.require_admin();
  if not exists (select from auth.users as u where u.id = admin_grant_plan.user_id) then
    return 'no_user';
  end if;
  version := (private.plan_version_at(admin_grant_plan.plan, now())).id;
  if admin_grant_plan.plan not in ('pro', 'max', 'special')
    or version is null
    or (admin_grant_plan.plan = 'pro' and admin_grant_plan.ends_at is not null)
    or admin_grant_plan.ends_at <= now()
  then
    return 'bad_plan';
  end if;
  insert into private.user_plans (user_id, plan, ends_at, granted_by, version_id)
    values (admin_grant_plan.user_id, admin_grant_plan.plan, admin_grant_plan.ends_at,
      (select auth.uid()), version)
    on conflict on constraint user_plans_pkey do update
      set plan = excluded.plan, ends_at = excluded.ends_at, granted_by = excluded.granted_by,
        granted_at = now(), version_id = excluded.version_id;
  perform private.audit('grant_plan', 'user', admin_grant_plan.user_id::text, jsonb_build_object(
    'email', (select u.email from auth.users as u where u.id = admin_grant_plan.user_id),
    'plan', admin_grant_plan.plan, 'ends_at', admin_grant_plan.ends_at, 'version_id', version));
  return 'granted';
end;
$$;
