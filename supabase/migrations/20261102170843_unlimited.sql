-- Unlimited use (#597, ADR 0157): an admin, and a user an admin grants 무제한 until an optional
-- end, are never refused by a photo limit. The grant sits beside the user's plan, so an ended one
-- leaves the user on that plan; each photo is still recorded. begin_extraction keeps its row and
-- extraction_allowance its signature, answering no limit for such a caller. Additive: one table,
-- four new functions, and the two count functions replaced with the same signatures.

create table private.unlimited_grants (
  user_id uuid primary key references auth.users on delete cascade,
  ends_at timestamptz,
  granted_by uuid references auth.users on delete set null,
  granted_at timestamptz not null default now()
);

-- The account-deletion set null through the column no primary key leads with.
create index unlimited_grants_granted_by on private.unlimited_grants (granted_by);

alter table private.unlimited_grants enable row level security;
revoke all on private.unlimited_grants from public, anon, authenticated, service_role;

-- Whether no photo limit applies to [user_id]: an admin, or a holder of a 무제한 grant that has
-- not ended.
create function private.unlimited(user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select from private.admins as a where a.user_id = unlimited.user_id)
    or exists (select from private.unlimited_grants as g
      where g.user_id = unlimited.user_id and (g.ends_at is null or g.ends_at > now()));
$$;

revoke all on function private.unlimited(uuid) from public, anon, authenticated;

-- Resolves [user_id]'s plan, its version and prompt, and, under the version's quota for its
-- period or with no limit (private.unlimited), records the photo with what serves it, under the
-- extraction lock, returning the usage row recorded, or null when the photo is refused. The limit
-- returned is the version's either way. An admin is served the 'test' version when one is set,
-- everyone else the 'active' one. No row while the plan has no version or the active prompt is
-- missing.
create or replace function public.begin_extraction(user_id uuid)
returns table (
  plan text, model text, photo_limit integer, period text, allowed boolean,
  prompt_version_id bigint, prompt text, usage_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitled record;
  version private.prompt_versions;
  used bigint;
  permitted boolean;
  usage bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(begin_extraction.user_id::text, 1));
  select * into entitled from private.entitlement_of(begin_extraction.user_id);
  if not found then
    return;
  end if;
  select v.* into version
  from private.prompt_labels as l
  join private.prompt_versions as v on v.id = l.version_id
  where l.label = 'active'
    or (l.label = 'test'
      and exists (select 1 from private.admins as a where a.user_id = begin_extraction.user_id))
  order by l.label = 'test' desc
  limit 1;
  if not found then
    return;
  end if;
  select count(*) into used from public.extraction_usage as u
    where u.user_id = begin_extraction.user_id and u.created_at >= entitled.period_start;
  permitted := used < entitled.amount or private.unlimited(begin_extraction.user_id);
  if permitted then
    insert into public.extraction_usage (user_id) values (begin_extraction.user_id)
      returning id into usage;
    insert into private.extraction_calls (usage_id, plan, model, prompt_version_id)
      values (usage, entitled.plan, entitled.model, version.id);
  end if;
  return query select entitled.plan, entitled.model, entitled.amount,
    private.quota_period(entitled.quota), permitted, version.id, version.text, usage;
end;
$$;

revoke all on function public.begin_extraction(uuid) from public, anon, authenticated;
grant execute on function public.begin_extraction(uuid) to service_role;

-- The caller's photo limit, null when none applies (private.unlimited), the period it counts over
-- and the photos counted in it: the version begin_extraction resolves and the rows it counts, so
-- the two agree. No row while the plan has no version. Only the caller's own; it takes no user.
create or replace function public.extraction_allowance()
returns table (photo_limit integer, period text, used integer)
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.unlimited((select auth.uid())) then null else e.amount end,
    private.quota_period(e.quota),
    (select count(*) from public.extraction_usage as u
      where u.user_id = (select auth.uid()) and u.created_at >= e.period_start)::integer
  from private.entitlement_of((select auth.uid())) as e
  where (select auth.uid()) is not null
$$;

revoke all on function public.extraction_allowance() from public, anon;
grant execute on function public.extraction_allowance() to authenticated;

-- Whether no photo limit applies to [user_id] now, and its 무제한 grant when it has one, ended or
-- not: its end and who granted it when. No row for a user that does not exist.
create function public.admin_user_unlimited(user_id uuid)
returns table (unlimited boolean, ends_at timestamptz, granted_at timestamptz, granted_by_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select private.unlimited(u.id), g.ends_at, g.granted_at, b.email::text
  from auth.users as u
  left join private.unlimited_grants as g on g.user_id = u.id
  left join auth.users as b on b.id = g.granted_by
  where u.id = admin_user_unlimited.user_id;
end;
$$;

-- Grants [user_id] 무제한 until [ends_at] or without an end, replacing any earlier grant, and
-- records it: 'granted'; 'no_user' for a user that does not exist and 'bad_end' for an end not in
-- the future, recording nothing.
create function public.admin_grant_unlimited(user_id uuid, ends_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
begin
  if not exists (select from auth.users as u where u.id = admin_grant_unlimited.user_id) then
    return 'no_user';
  end if;
  if admin_grant_unlimited.ends_at <= now() then
    return 'bad_end';
  end if;
  insert into private.unlimited_grants (user_id, ends_at, granted_by)
    values (admin_grant_unlimited.user_id, admin_grant_unlimited.ends_at, caller)
    on conflict on constraint unlimited_grants_pkey do update
      set ends_at = excluded.ends_at, granted_by = excluded.granted_by, granted_at = now();
  perform private.audit('grant_unlimited', 'user', admin_grant_unlimited.user_id::text,
    jsonb_build_object(
      'email', (select u.email from auth.users as u where u.id = admin_grant_unlimited.user_id),
      'ends_at', admin_grant_unlimited.ends_at));
  return 'granted';
end;
$$;

-- Removes [user_id]'s 무제한 grant and records it, answering whether there was one; with none it
-- records nothing.
create function public.admin_revoke_unlimited(user_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ended timestamptz;
begin
  perform private.require_admin();
  delete from private.unlimited_grants as g where g.user_id = admin_revoke_unlimited.user_id
    returning g.ends_at into ended;
  if not found then
    return false;
  end if;
  perform private.audit('revoke_unlimited', 'user', admin_revoke_unlimited.user_id::text,
    jsonb_build_object(
      'email', coalesce((select u.email from auth.users as u
        where u.id = admin_revoke_unlimited.user_id), ''),
      'ends_at', ended));
  return true;
end;
$$;

revoke all on function
  public.admin_user_unlimited(uuid),
  public.admin_grant_unlimited(uuid, timestamptz),
  public.admin_revoke_unlimited(uuid)
  from public, anon;
grant execute on function
  public.admin_user_unlimited(uuid),
  public.admin_grant_unlimited(uuid, timestamptz),
  public.admin_revoke_unlimited(uuid)
  to authenticated;
