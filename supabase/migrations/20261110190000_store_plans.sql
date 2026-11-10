-- A paid plan from the store (#884, ADR 0241): RevenueCat's purchase of the entitlement `plus`
-- gives the user a store grant on plan `pro`, kept in `private.store_grants` beside the admin
-- grants of `private.user_plans`, so no store event reads or writes an admin's grant or a 스페셜
-- one. `private.entitlement_of` takes the better of the two live grants; `public.my_plan` is the
-- one read behind 내 플랜; `public.apply_store_entitlement` is what the `store-webhook` Edge
-- Function calls with the entitlement it read from RevenueCat; the admin functions set and clear
-- the two Vault secrets the function needs, which are never read back.
--
-- Changes no row and no plan version or limit, and stores no secret: additive. The owner enters
-- the two secrets in admin.
--
-- Revert, run once against production: `select private.revert_store_plans();`, then
-- `drop function private.revert_store_plans();`. It restores `private.entitlement_of` as
-- 20261103143442_special_plan.sql left it, drops the functions and the two tables with the store
-- grants, and deletes nothing in Vault.

-- One store grant per user: the plan, its end (null when the entitlement has none), whether it
-- renews at that end, and the plan's version in effect when it began, as `user_plans` holds it.
create table private.store_grants (
  user_id uuid primary key references auth.users on delete cascade,
  plan text not null check (plan in ('pro', 'max')),
  ends_at timestamptz,
  renews boolean not null default false,
  granted_at timestamptz not null default now(),
  version_id bigint not null,
  constraint store_grants_version_id_plan_fkey foreign key (version_id, plan)
    references private.plan_versions (id, plan)
);
create index store_grants_version_id on private.store_grants (version_id);
alter table private.store_grants enable row level security;
revoke all on table private.store_grants from public, anon, authenticated, service_role;

-- The two Vault secrets the function needs, by name, with who set each and when.
create table private.store_secrets (
  name text primary key
    check (name in ('knowno_store_webhook_authorization', 'knowno_store_api_key')),
  secret_id uuid not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);
create index store_secrets_set_by on private.store_secrets (set_by);
alter table private.store_secrets enable row level security;
revoke all on table private.store_secrets from public, anon, authenticated, service_role;

-- The grant [user_id] holds now, the better of its live admin grant and live store grant by plan
-- (special, max, pro), the admin's on a tie; no row for none. `source` is 'admin' or 'store'.
create function private.live_grant(user_id uuid)
returns table (
  source text, plan text, granted_at timestamptz, version_id bigint, ends_at timestamptz,
  renews boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.source, g.plan, g.granted_at, g.version_id, g.ends_at, g.renews
  from (
    select 'admin' as source, 1 as tie, p.plan, p.granted_at, p.version_id, p.ends_at,
      false as renews
    from private.user_plans as p
    where p.user_id = live_grant.user_id and (p.ends_at is null or p.ends_at > now())
    union all
    select 'store', 0, s.plan, s.granted_at, s.version_id, s.ends_at, s.renews
    from private.store_grants as s
    where s.user_id = live_grant.user_id and (s.ends_at is null or s.ends_at > now())
  ) as g
  order by case g.plan when 'special' then 3 when 'max' then 2 else 1 end desc, g.tie desc
  limit 1;
$$;

revoke all on function private.live_grant(uuid) from public, anon, authenticated;

-- What [user_id] is entitled to now, as 20261103143442_special_plan.sql decided it, except that
-- the grant is the better of the admin's and the store's (private.live_grant).
create or replace function private.entitlement_of(user_id uuid)
returns table (plan text, version_id bigint, quota text, amount integer, period_start timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  renewed timestamptz := date_trunc('month', now(), 'Asia/Seoul');
  grant_row record;
  signed_up timestamptz;
  base private.plan_versions;
  chosen private.plan_versions;
  admin boolean := exists (
    select from private.admins as a where a.user_id = entitlement_of.user_id);
begin
  select g.* into grant_row from private.live_grant(entitlement_of.user_id) as g;
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

-- Sets [user_id]'s store grant to what RevenueCat says it is entitled to: [plan] 'pro' or 'max'
-- until [ends_at] (null for none) and [renews] there, or no grant when [plan] is null or its end is
-- not in the future. Answers 'granted', 'changed' (another plan, end or renewal; the start and
-- version are kept unless the plan differs), 'ended', 'unchanged' (a replay, or nothing to end),
-- 'no_user' for an id that is no user and 'bad_plan' for another plan or one with no version, the
-- last two recording nothing. A change is recorded with no admin id and the email `revenuecat`.
-- It never reads or writes private.user_plans.
create function public.apply_store_entitlement(
  user_id uuid, plan text, ends_at timestamptz, renews boolean
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  want_plan text := case when apply_store_entitlement.ends_at <= now() then null
    else apply_store_entitlement.plan end;
  want_renews boolean := case when want_plan is null then false
    else coalesce(apply_store_entitlement.renews, false) end;
  existing private.store_grants;
  version bigint;
  email text;
  had boolean;
begin
  select u.email into email from auth.users as u where u.id = apply_store_entitlement.user_id;
  if not found then
    return 'no_user';
  end if;
  if apply_store_entitlement.plan is not null
    and apply_store_entitlement.plan not in ('pro', 'max')
  then
    return 'bad_plan';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(apply_store_entitlement.user_id::text, 10));
  select s.* into existing from private.store_grants as s
    where s.user_id = apply_store_entitlement.user_id for update;
  had := found;
  if want_plan is null then
    if not had then
      return 'unchanged';
    end if;
    delete from private.store_grants as s where s.user_id = apply_store_entitlement.user_id;
    insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
      values (null, 'revenuecat', 'store_end_plan', 'user', apply_store_entitlement.user_id::text,
        jsonb_build_object('email', email, 'plan', existing.plan, 'ends_at', existing.ends_at,
          'renews', existing.renews));
    return 'ended';
  end if;
  if had and existing.plan = want_plan
    and existing.ends_at is not distinct from apply_store_entitlement.ends_at
    and existing.renews = want_renews
  then
    return 'unchanged';
  end if;
  if not had or existing.plan <> want_plan then
    version := (private.plan_version_at(want_plan, now())).id;
    if version is null then
      return 'bad_plan';
    end if;
  end if;
  if not had then
    insert into private.store_grants (user_id, plan, ends_at, renews, version_id)
      values (apply_store_entitlement.user_id, want_plan, apply_store_entitlement.ends_at,
        want_renews, version);
  elsif existing.plan <> want_plan then
    update private.store_grants as s
      set plan = want_plan, ends_at = apply_store_entitlement.ends_at, renews = want_renews,
        granted_at = now(), version_id = version
      where s.user_id = apply_store_entitlement.user_id;
  else
    update private.store_grants as s
      set ends_at = apply_store_entitlement.ends_at, renews = want_renews
      where s.user_id = apply_store_entitlement.user_id;
  end if;
  insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
    values (null, 'revenuecat', case when had then 'store_change_plan' else 'store_grant_plan' end,
      'user', apply_store_entitlement.user_id::text,
      jsonb_build_object('email', email, 'plan', want_plan,
        'ends_at', apply_store_entitlement.ends_at, 'renews', want_renews));
  return case when had then 'changed' else 'granted' end;
end;
$$;

revoke all on function public.apply_store_entitlement(uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.apply_store_entitlement(uuid, text, timestamptz, boolean)
  to service_role;

-- The two secrets decrypted, each null while unset, for the Edge Function. A secret is found only
-- through its private.store_secrets row, so one added to Vault by hand is never read.
create function public.store_secrets()
returns table (webhook_authorization text, api_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select d.decrypted_secret from private.store_secrets as k
      join vault.decrypted_secrets as d on d.id = k.secret_id
      where k.name = 'knowno_store_webhook_authorization'),
    (select d.decrypted_secret from private.store_secrets as k
      join vault.decrypted_secrets as d on d.id = k.secret_id
      where k.name = 'knowno_store_api_key');
$$;

revoke all on function public.store_secrets() from public, anon, authenticated;
grant execute on function public.store_secrets() to service_role;

-- Creates or replaces the Vault secret [name] and records it with no value: 'saved'; 'reauth' when
-- the caller did not sign in within the last 10 minutes, 'bad_name' for another name, and
-- 'bad_secret' for a webhook value not of 16 to 1,000 printable ASCII characters or an API key not
-- of 8 to 1,000 without whitespace, each recording nothing.
create function public.admin_set_store_secret(name text, value text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.store_secrets;
  secret uuid;
begin
  perform private.require_admin();
  if not private.signed_in_recently() then
    return 'reauth';
  end if;
  if admin_set_store_secret.name not in
    ('knowno_store_webhook_authorization', 'knowno_store_api_key')
  then
    return 'bad_name';
  end if;
  if admin_set_store_secret.value is null
    or (admin_set_store_secret.name = 'knowno_store_webhook_authorization'
      and (char_length(admin_set_store_secret.value) not between 16 and 1000
        or admin_set_store_secret.value ~ '[^ -~]'))
    or (admin_set_store_secret.name = 'knowno_store_api_key'
      and (char_length(admin_set_store_secret.value) not between 8 and 1000
        or admin_set_store_secret.value ~ '\s'))
  then
    return 'bad_secret';
  end if;
  select k.* into existing from private.store_secrets as k
    where k.name = admin_set_store_secret.name for update;
  if found then
    perform vault.update_secret(existing.secret_id, admin_set_store_secret.value);
    update private.store_secrets as k
      set set_by = (select auth.uid()), set_at = now()
      where k.name = admin_set_store_secret.name;
  else
    secret := vault.create_secret(admin_set_store_secret.value, admin_set_store_secret.name,
      'knowno: RevenueCat secret, set in the admin area (ADR 0241)');
    insert into private.store_secrets (name, secret_id, set_by)
      values (admin_set_store_secret.name, secret, (select auth.uid()));
  end if;
  perform private.audit('set_store_secret', 'store_secret', admin_set_store_secret.name,
    jsonb_build_object('replaced', existing.name is not null));
  return 'saved';
end;
$$;

-- Removes the Vault secret [name] and records it: 'cleared'; 'reauth' without a sign-in within the
-- last 10 minutes, 'bad_name' for another name and 'none' when it is unset, each recording nothing.
create function public.admin_clear_store_secret(name text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed private.store_secrets;
begin
  perform private.require_admin();
  if not private.signed_in_recently() then
    return 'reauth';
  end if;
  if admin_clear_store_secret.name not in
    ('knowno_store_webhook_authorization', 'knowno_store_api_key')
  then
    return 'bad_name';
  end if;
  delete from private.store_secrets as k where k.name = admin_clear_store_secret.name
    returning * into removed;
  if not found then
    return 'none';
  end if;
  delete from vault.secrets as s where s.id = removed.secret_id;
  perform private.audit('clear_store_secret', 'store_secret', removed.name, '{}'::jsonb);
  return 'cleared';
end;
$$;

-- Each secret's name with whether it is set, when and by whom; never a value or part of one.
create function public.admin_store_secrets()
returns table (name text, is_set boolean, set_at timestamptz, set_by_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
    select n.name, k.name is not null, k.set_at, u.email::text
    from (values ('knowno_store_webhook_authorization'), ('knowno_store_api_key'))
      as n (name)
    left join private.store_secrets as k on k.name = n.name
    left join auth.users as u on u.id = k.set_by
    order by n.name;
end;
$$;

revoke all on function
  public.admin_set_store_secret(text, text),
  public.admin_clear_store_secret(text),
  public.admin_store_secrets()
  from public, anon;
grant execute on function
  public.admin_set_store_secret(text, text),
  public.admin_clear_store_secret(text),
  public.admin_store_secrets()
  to authenticated;

-- The caller's plan for 내 플랜: the plan it is on (스페셜 as max, so no read names it), where it
-- comes from, a store grant's end and renewal, and the period's photo limit and photos used, as
-- extraction_allowance counts them. No row without a caller or a plan version.
create function public.my_plan()
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
$$;

revoke all on function public.my_plan() from public, anon;
grant execute on function public.my_plan() to authenticated;

-- The revert in the header.
create function private.revert_store_plans() returns void
language plpgsql
security definer
set search_path = ''
as $revert$
begin
  drop function public.my_plan();
  drop function public.admin_set_store_secret(text, text);
  drop function public.admin_clear_store_secret(text);
  drop function public.admin_store_secrets();
  drop function public.store_secrets();
  drop function public.apply_store_entitlement(uuid, text, timestamptz, boolean);
  execute $sql$
    create or replace function private.entitlement_of(user_id uuid)
    returns table (plan text, version_id bigint, quota text, amount integer, period_start timestamptz)
    language plpgsql
    stable
    security definer
    set search_path = ''
    as $fn$
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
    $fn$;
  $sql$;
  drop function private.live_grant(uuid);
  drop table private.store_secrets;
  drop table private.store_grants;
end;
$revert$;

revoke all on function private.revert_store_plans() from public, anon, authenticated;
