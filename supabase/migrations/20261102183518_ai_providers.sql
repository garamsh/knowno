-- The AI provider per plan (#598, ADR 0162): each plan is served by an AI configuration, a
-- provider (OpenRouter, OpenAI or Anthropic) and its model, saved only after one real call through
-- extract-cards parsed, served to admins as a draft ('test') until an admin applies it to everyone
-- ('active'). Provider keys live in Supabase Vault; only service_role reads one decrypted.
--
-- Not additive: the configuration becomes the plan's one model, so `private.plan_versions.model`
-- is dropped, with `admin_create_plan_version`'s `model` argument and `in_favour`'s model rule,
-- after every version's model is copied into `private.plan_versions_models_before_ai`. Every call
-- recorded before this change was OpenRouter's, which `extraction_calls.provider` records.
--
-- Revert: `alter table private.plan_versions add column model text;` then
-- `update private.plan_versions as v set model = b.model from private.plan_versions_models_before_ai
-- as b where b.version_id = v.id;`, a version created since taking its plan's active
-- configuration's model, and the functions of 20261026005136_plan_versions.sql and
-- 20261102170843_unlimited.sql restored from those files. The configurations, keys and labels can
-- stay: nothing then reads them.

-- Every version's model as it was before this change, kept with its version.
create table private.plan_versions_models_before_ai (
  version_id bigint primary key references private.plan_versions on delete cascade,
  model text not null
);

insert into private.plan_versions_models_before_ai (version_id, model)
  select v.id, v.model from private.plan_versions as v;

-- The provider each extraction was served by; before this change only OpenRouter served any.
alter table private.extraction_calls add column provider text;
update private.extraction_calls set provider = 'openrouter';
alter table private.extraction_calls
  alter column provider set not null,
  add constraint extraction_calls_provider_check
    check (provider in ('openrouter', 'openai', 'anthropic'));

-- A model id each provider takes: OpenRouter's `vendor/model`, the others' bare ids.
create function private.model_fits(provider text, model text) returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select case model_fits.provider
    when 'openrouter' then model_fits.model ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+$'
    when 'openai' then model_fits.model ~ '^[A-Za-z0-9_.:-]+$'
    when 'anthropic' then model_fits.model ~ '^[A-Za-z0-9_.:-]+$'
    else false
  end and char_length(model_fits.model) <= 200;
$$;

-- Every saved AI configuration: a plan's provider and model, who saved it and when. A row exists
-- only after extract-cards' check call on it parsed; rows are never changed or removed.
create table private.ai_configurations (
  id bigint generated always as identity primary key,
  plan text not null check (plan in ('free', 'pro', 'max')),
  provider text not null check (provider in ('openrouter', 'openai', 'anthropic')),
  model text not null check (private.model_fits(provider, model)),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (id, plan)
);

create index ai_configurations_created_by on private.ai_configurations (created_by);

-- Refuses any change to a configuration but its author's removal, which deleting that account sets.
create function private.keep_ai_configuration() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.plan = old.plan
    and new.provider = old.provider and new.model = old.model
    and new.created_at = old.created_at and new.created_by is null
  then
    return new;
  end if;
  raise exception 'AI configurations are append-only' using errcode = '55000';
end;
$$;

create trigger ai_configurations_append_only before update or delete on private.ai_configurations
  for each row execute function private.keep_ai_configuration();

-- Which configuration serves each plan: 'active' for its users, and 'test', when set, for admins.
create table private.ai_configuration_labels (
  plan text not null check (plan in ('free', 'pro', 'max')),
  label text not null check (label in ('active', 'test')),
  configuration_id bigint not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now(),
  primary key (plan, label),
  foreign key (configuration_id, plan) references private.ai_configurations (id, plan)
);

create index ai_configuration_labels_configuration_id
  on private.ai_configuration_labels (configuration_id);
create index ai_configuration_labels_set_by on private.ai_configuration_labels (set_by);

-- Each provider whose key is in Vault: the Vault secret's id and the key's last four characters,
-- who set it and when. The key itself is only in `vault.secrets`, encrypted.
create table private.provider_keys (
  provider text primary key check (provider in ('openrouter', 'openai', 'anthropic')),
  secret_id uuid not null unique,
  last_four text not null check (char_length(last_four) = 4),
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);

create index provider_keys_set_by on private.provider_keys (set_by);

alter table private.plan_versions_models_before_ai enable row level security;
alter table private.ai_configurations enable row level security;
alter table private.ai_configuration_labels enable row level security;
alter table private.provider_keys enable row level security;
revoke all on private.plan_versions_models_before_ai, private.ai_configurations,
  private.ai_configuration_labels, private.provider_keys
  from public, anon, authenticated, service_role;

-- The seed: each plan's current version's model on OpenRouter, active, so the deploy serves every
-- plan what it served before.
insert into private.ai_configurations (plan, provider, model)
  select p.plan, 'openrouter', (private.plan_version_at(p.plan, now())).model
  from (values ('free'), ('pro'), ('max')) as p (plan)
  where (private.plan_version_at(p.plan, now())).id is not null
  order by array_position(array['free', 'pro', 'max'], p.plan);

insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from private.ai_configurations as c;

-- The terms without a model. Every function reading the column is replaced before it goes.
drop function public.admin_create_plan_version(text, text, integer, text, timestamptz, boolean);
drop function public.admin_plan_versions();
drop function public.admin_user_plan(uuid);
drop function public.extraction_allowance();
drop function public.begin_extraction(uuid);
drop function private.entitlement_of(uuid);
drop function private.in_favour(text, text, integer, text, timestamptz);
drop function private.revert_plan_versions();
-- It ran once, in its own migration, and inserts the model this change removes.
drop function private.migrate_plan_versions();

alter table private.plan_versions drop column model;

-- Whether a version of [plan] on these terms from [starts_at] is in the users' favour: every
-- version started by then counts no more generously (monthly, then daily, then unlimited) and
-- allows no more photos in its period.
create function private.in_favour(plan text, quota text, amount integer, starts_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select from private.plan_versions as v
    where v.plan = in_favour.plan and v.starts_at <= in_favour.starts_at
      and (array_position(array['monthly', 'daily', 'unlimited'], v.quota)
          > array_position(array['monthly', 'daily', 'unlimited'], in_favour.quota)
        or v.amount > in_favour.amount)
  );
$$;

-- What [user_id] is entitled to now: the plan, its version and the start of the period its photos
-- are counted from, as 20261026005136_plan_versions.sql decided it, without a model.
create function private.entitlement_of(user_id uuid)
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
begin
  select g.* into grant_row from private.user_plans as g
    where g.user_id = entitlement_of.user_id and (g.ends_at is null or g.ends_at > now());
  if found and grant_row.granted_at > renewed then
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

-- Puts every plan back on its settings before 20261026005136_plan_versions.sql, as that migration's
-- revert did, without the model the configuration now holds. Returns how many versions it added.
create function private.revert_plan_versions() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  added integer := 0;
  setting private.plans_before_versions;
  version private.plan_versions;
begin
  for setting in select * from private.plans_before_versions as p
    order by array_position(array['free', 'pro', 'special'], p.id)
  loop
    insert into private.plan_versions (plan, quota, amount, starts_at, applies_to_all)
      values (case setting.id when 'special' then 'max' else setting.id end, 'daily',
        setting.daily_limit, now(), true)
      returning * into version;
    insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
      values (null, 'revert of 20261026005136_plan_versions.sql (PM)', 'create_plan_version',
        'plan', version.plan, jsonb_build_object('version_id', version.id, 'quota', version.quota,
          'amount', version.amount, 'starts_at', version.starts_at, 'applies_to_all', true));
    added := added + 1;
  end loop;
  return added;
end;
$$;

revoke all on function
  private.model_fits(text, text),
  private.in_favour(text, text, integer, timestamptz),
  private.entitlement_of(uuid),
  private.revert_plan_versions()
  from public, anon, authenticated;

-- Records one admin write by [admin_id], for a write extract-cards makes for that admin through
-- service_role, where `auth.uid()` names no one.
create function private.audit_by(
  admin_id uuid, action text, target_kind text, target_id text, detail jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
  select u.id, coalesce(u.email, ''), audit_by.action, audit_by.target_kind, audit_by.target_id,
    audit_by.detail
  from auth.users as u
  where u.id = audit_by.admin_id;
$$;

-- Raises insufficient_privilege unless [admin_id] is an admin, for a function service_role calls
-- on an admin's behalf.
create function private.require_admin_id(admin_id uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if admin_id is null
    or not exists (select from private.admins as a where a.user_id = require_admin_id.admin_id)
  then
    raise exception 'only an admin may call this' using errcode = '42501';
  end if;
end;
$$;

-- Whether the caller signed in within the last 10 minutes: the latest of the session's
-- authentication times, the JWT's `amr` timestamps, which a token refresh does not move.
create function private.signed_in_recently() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max((m ->> 'timestamp')::double precision), 0)
      >= extract(epoch from now()) - 600
  from jsonb_array_elements(coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)) as m
  where jsonb_typeof(m -> 'timestamp') = 'number';
$$;

revoke all on function
  private.audit_by(uuid, text, text, text, jsonb),
  private.require_admin_id(uuid),
  private.signed_in_recently()
  from public, anon, authenticated;

-- Resolves [user_id]'s plan, its version and prompt, and the AI configuration that serves the
-- photo: for an admin naming [configuration_id], a configuration some plan's label holds; for an
-- admin otherwise the plan's 'test' configuration while one is set; for everyone else its
-- 'active' one. `available` is whether that provider can be called: it has a key in Vault, or is
-- among [secret_providers], those extract-cards holds a transition secret for. Only an available
-- photo under the version's quota, or with no limit (private.unlimited), is recorded, under the
-- extraction lock. No row while the plan has no version, the active prompt or the configuration
-- is missing, or a configuration is named by a caller who is not an admin.
create function public.begin_extraction(
  user_id uuid, configuration_id bigint default null, secret_providers text[] default '{}'
)
returns table (
  plan text, provider text, model text, available boolean, photo_limit integer, period text,
  allowed boolean, prompt_version_id bigint, prompt text, usage_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitled record;
  admin boolean;
  version private.prompt_versions;
  config private.ai_configurations;
  usable boolean;
  used bigint;
  permitted boolean := false;
  usage bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(begin_extraction.user_id::text, 1));
  select * into entitled from private.entitlement_of(begin_extraction.user_id);
  if not found then
    return;
  end if;
  admin := exists (select from private.admins as a where a.user_id = begin_extraction.user_id);
  select v.* into version
  from private.prompt_labels as l
  join private.prompt_versions as v on v.id = l.version_id
  where l.label = 'active' or (l.label = 'test' and admin)
  order by l.label = 'test' desc
  limit 1;
  if not found then
    return;
  end if;
  if begin_extraction.configuration_id is not null then
    if not admin then
      return;
    end if;
    select c.* into config from private.ai_configurations as c
      where c.id = begin_extraction.configuration_id
        and exists (select from private.ai_configuration_labels as l
          where l.configuration_id = c.id);
  else
    select c.* into config
    from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.plan = entitled.plan and (l.label = 'active' or (l.label = 'test' and admin))
    order by l.label = 'test' desc
    limit 1;
  end if;
  if not found then
    return;
  end if;
  usable := config.provider = any (begin_extraction.secret_providers)
    or exists (select from private.provider_keys as k where k.provider = config.provider);
  if usable then
    select count(*) into used from public.extraction_usage as u
      where u.user_id = begin_extraction.user_id and u.created_at >= entitled.period_start;
    permitted := used < entitled.amount or private.unlimited(begin_extraction.user_id);
  end if;
  if permitted then
    insert into public.extraction_usage (user_id) values (begin_extraction.user_id)
      returning id into usage;
    insert into private.extraction_calls (usage_id, plan, provider, model, prompt_version_id)
      values (usage, entitled.plan, config.provider, config.model, version.id);
  end if;
  return query select entitled.plan, config.provider, config.model, usable, entitled.amount,
    private.quota_period(entitled.quota), permitted, version.id, version.text, usage;
end;
$$;

revoke all on function public.begin_extraction(uuid, bigint, text[]) from public, anon, authenticated;
grant execute on function public.begin_extraction(uuid, bigint, text[]) to service_role;

-- The caller's photo limit, null when none applies (private.unlimited), the period it counts over
-- and the photos counted in it, as begin_extraction counts them. Unchanged but for the entitlement
-- it reads.
create function public.extraction_allowance()
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

-- Takes [cursor] for [user_id], as before, also returning the provider of the photo's first read.
drop function public.resume_extraction(uuid, uuid);
create function public.resume_extraction(user_id uuid, cursor uuid)
returns table (
  usage_id bigint, plan text, provider text, model text, prompt_version_id bigint, prompt text,
  cards_read integer, continuations integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  taken bigint;
begin
  delete from private.extraction_cursors as k
  using public.extraction_usage as u
  where k.token = resume_extraction.cursor and k.expires_at > now()
    and u.id = k.usage_id and u.user_id = resume_extraction.user_id
  returning k.usage_id into taken;
  if taken is null then
    return;
  end if;
  return query
  select c.usage_id, c.plan, c.provider, c.model, c.prompt_version_id, v.text, c.cards_returned,
    coalesce(c.continuations, 0)
  from private.extraction_calls as c
  join private.prompt_versions as v on v.id = c.prompt_version_id
  where c.usage_id = taken;
end;
$$;

revoke all on function public.resume_extraction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.resume_extraction(uuid, uuid) to service_role;

-- Every plan version, as before, without a model.
create function public.admin_plan_versions()
returns table (
  id bigint, plan text, quota text, amount integer, starts_at timestamptz,
  applies_to_all boolean, current boolean, created_at timestamptz, created_by_email text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select v.id, v.plan, v.quota, v.amount, v.starts_at, v.applies_to_all,
    v.id = (private.plan_version_at(v.plan, now())).id, v.created_at, u.email::text
  from private.plan_versions as v
  left join auth.users as u on u.id = v.created_by
  order by array_position(array['free', 'pro', 'max'], v.plan), v.starts_at desc, v.id desc;
end;
$$;

-- Creates a version of [plan] on these terms from [starts_at], as before, without a model:
-- 'created', 'past_start', 'unchanged' or 'not_in_favour'.
create function public.admin_create_plan_version(
  plan text, quota text, amount integer, starts_at timestamptz default null,
  applies_to_all boolean default false
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  start timestamptz := coalesce(admin_create_plan_version.starts_at, now());
  previous private.plan_versions;
  added private.plan_versions;
begin
  if start < now() then
    return 'past_start';
  end if;
  -- Versions are created one at a time, under a lock seeded with 5, so two cannot read one previous.
  perform pg_advisory_xact_lock(hashtextextended('private.plan_versions', 5));
  previous := private.plan_version_at(admin_create_plan_version.plan, start);
  if previous.quota = admin_create_plan_version.quota
    and previous.amount = admin_create_plan_version.amount
  then
    return 'unchanged';
  end if;
  if admin_create_plan_version.applies_to_all and not private.in_favour(
    admin_create_plan_version.plan, admin_create_plan_version.quota,
    admin_create_plan_version.amount, start)
  then
    return 'not_in_favour';
  end if;
  insert into private.plan_versions (plan, quota, amount, starts_at, applies_to_all, created_by)
    values (admin_create_plan_version.plan, admin_create_plan_version.quota,
      admin_create_plan_version.amount, start, admin_create_plan_version.applies_to_all, caller)
    returning * into added;
  perform private.audit('create_plan_version', 'plan', added.plan, jsonb_build_object(
    'version_id', added.id, 'quota', added.quota, 'amount', added.amount,
    'starts_at', added.starts_at, 'applies_to_all', added.applies_to_all,
    'quota_before', previous.quota, 'amount_before', previous.amount));
  return 'created';
end;
$$;

-- [user_id]'s entitlement now, as before, with the provider and model of its plan's active
-- configuration in place of the version's model.
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
  granted_by_email text
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
    g.plan, g.ends_at, g.granted_at, b.email::text
  from auth.users as u
  left join lateral private.entitlement_of(u.id) as e on true
  left join private.ai_configuration_labels as l on l.plan = e.plan and l.label = 'active'
  left join private.ai_configurations as c on c.id = l.configuration_id
  left join private.user_plans as g on g.user_id = u.id
  left join auth.users as b on b.id = g.granted_by
  where u.id = admin_user_plan.user_id;
end;
$$;

revoke all on function
  public.admin_plan_versions(),
  public.admin_create_plan_version(text, text, integer, timestamptz, boolean),
  public.admin_user_plan(uuid)
  from public, anon;
grant execute on function
  public.admin_plan_versions(),
  public.admin_create_plan_version(text, text, integer, timestamptz, boolean),
  public.admin_user_plan(uuid)
  to authenticated;

-- [provider]'s key, decrypted from Vault, or null when it has none. Only extract-cards calls it.
create function public.provider_key(provider text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from private.provider_keys as k
  join vault.decrypted_secrets as d on d.id = k.secret_id
  where k.provider = provider_key.provider;
$$;

-- Stores [key] as [provider]'s key in Vault for [admin_id], replacing any it had, after
-- extract-cards' check call with it parsed, and records it by the provider alone: 'saved'.
-- An unknown provider or a key of fewer than 8 or more than 1,000 characters is refused, recording
-- nothing.
create function public.save_provider_key(admin_id uuid, provider text, key text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing private.provider_keys;
  secret uuid;
begin
  perform private.require_admin_id(save_provider_key.admin_id);
  if save_provider_key.provider not in ('openrouter', 'openai', 'anthropic')
    or char_length(save_provider_key.key) not between 8 and 1000
    or save_provider_key.key ~ '\s'
  then
    return 'bad_key';
  end if;
  select k.* into existing from private.provider_keys as k
    where k.provider = save_provider_key.provider for update;
  if found then
    perform vault.update_secret(existing.secret_id, save_provider_key.key);
    update private.provider_keys as k
      set last_four = right(save_provider_key.key, 4), set_by = save_provider_key.admin_id,
        set_at = now()
      where k.provider = save_provider_key.provider;
  else
    secret := vault.create_secret(save_provider_key.key,
      'knowno_provider_key_' || save_provider_key.provider,
      'knowno: ' || save_provider_key.provider || ' API key, set in the admin area (ADR 0162)');
    insert into private.provider_keys (provider, secret_id, last_four, set_by)
      values (save_provider_key.provider, secret, right(save_provider_key.key, 4),
        save_provider_key.admin_id);
  end if;
  perform private.audit_by(save_provider_key.admin_id, 'set_provider_key', 'provider',
    save_provider_key.provider, jsonb_build_object('replaced', existing.provider is not null));
  return 'saved';
end;
$$;

-- Saves [provider] and [model] as [plan]'s configuration for [admin_id], after extract-cards'
-- check call on them parsed, and makes it the plan's draft, served to admins: the 'test' label,
-- replacing any draft before. Records it and returns the configuration's id.
create function public.save_ai_configuration(
  admin_id uuid, plan text, provider text, model text
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  added private.ai_configurations;
begin
  perform private.require_admin_id(save_ai_configuration.admin_id);
  insert into private.ai_configurations (plan, provider, model, created_by)
    values (save_ai_configuration.plan, save_ai_configuration.provider,
      save_ai_configuration.model, save_ai_configuration.admin_id)
    returning * into added;
  insert into private.ai_configuration_labels (plan, label, configuration_id, set_by)
    values (added.plan, 'test', added.id, save_ai_configuration.admin_id)
    on conflict on constraint ai_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  perform private.audit_by(save_ai_configuration.admin_id, 'save_ai_configuration', 'plan',
    added.plan, jsonb_build_object('configuration_id', added.id, 'provider', added.provider,
      'model', added.model));
  return added.id;
end;
$$;

revoke all on function
  public.provider_key(text),
  public.save_provider_key(uuid, text, text),
  public.save_ai_configuration(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function
  public.provider_key(text),
  public.save_provider_key(uuid, text, text),
  public.save_ai_configuration(uuid, text, text, text)
  to service_role;

-- Whether the calling admin signed in within the last 10 minutes, which saving or removing a
-- provider's key requires.
create function public.admin_ai_session() returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return private.signed_in_recently();
end;
$$;

-- Each provider, with its key's last four characters, who set it and when, null while Vault holds
-- none, and whether an active configuration uses it. Never the key.
create function public.admin_provider_keys()
returns table (
  provider text, last_four text, set_at timestamptz, set_by_email text, in_use boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.provider, k.last_four, k.set_at, u.email::text,
    exists (select from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.label = 'active' and c.provider = p.provider)
  from (values ('openrouter'), ('openai'), ('anthropic')) as p (provider)
  left join private.provider_keys as k on k.provider = p.provider
  left join auth.users as u on u.id = k.set_by
  order by array_position(array['openrouter', 'openai', 'anthropic'], p.provider);
end;
$$;

-- Each plan's labelled configurations: its 'active' one and its 'test' draft, with who saved each
-- and when, and when the label was set.
create function public.admin_ai_configurations()
returns table (
  plan text, label text, configuration_id bigint, provider text, model text,
  created_at timestamptz, created_by_email text, set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.plan, l.label, c.id, c.provider, c.model, c.created_at, u.email::text, l.set_at
  from private.ai_configuration_labels as l
  join private.ai_configurations as c on c.id = l.configuration_id
  left join auth.users as u on u.id = c.created_by
  order by array_position(array['free', 'pro', 'max'], l.plan), l.label;
end;
$$;

-- Applies [plan]'s draft to everyone (모두에게 적용): its 'test' configuration becomes 'active' and
-- the draft is cleared, recorded with the configuration before: 'activated'; 'no_test' without a
-- draft and 'no_key' while its provider has no key in Vault, recording nothing. OpenRouter is
-- served by its transition secret until it has one (ADR 0162), so it is not refused for none.
create function public.admin_activate_ai_configuration(plan text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  draft private.ai_configurations;
  before bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.ai_configuration_labels', 6));
  select c.* into draft from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.plan = admin_activate_ai_configuration.plan and l.label = 'test';
  if not found then
    return 'no_test';
  end if;
  if draft.provider <> 'openrouter'
    and not exists (select from private.provider_keys as k where k.provider = draft.provider)
  then
    return 'no_key';
  end if;
  select l.configuration_id into before from private.ai_configuration_labels as l
    where l.plan = draft.plan and l.label = 'active';
  insert into private.ai_configuration_labels (plan, label, configuration_id, set_by)
    values (draft.plan, 'active', draft.id, caller)
    on conflict on constraint ai_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  delete from private.ai_configuration_labels as l where l.plan = draft.plan and l.label = 'test';
  perform private.audit('activate_ai_configuration', 'plan', draft.plan, jsonb_build_object(
    'configuration_id', draft.id, 'provider', draft.provider, 'model', draft.model,
    'configuration_before', before));
  return 'activated';
end;
$$;

-- Ends [plan]'s draft, so admins are served its active configuration again, and records it,
-- answering whether there was one; with none it records nothing.
create function public.admin_clear_ai_test(plan text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared bigint;
begin
  perform private.require_admin();
  delete from private.ai_configuration_labels as l
    where l.plan = admin_clear_ai_test.plan and l.label = 'test'
    returning l.configuration_id into cleared;
  if cleared is null then
    return false;
  end if;
  perform private.audit('clear_ai_test', 'plan', admin_clear_ai_test.plan,
    jsonb_build_object('configuration_id', cleared));
  return true;
end;
$$;

-- Removes [provider]'s key from Vault and records it: 'removed'; 'reauth' when the caller did not
-- sign in within the last 10 minutes, 'in_use' while an active configuration uses the provider,
-- and 'none' when it has no key, each removing and recording nothing.
create function public.admin_remove_provider_key(provider text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed private.provider_keys;
begin
  perform private.require_admin();
  if not private.signed_in_recently() then
    return 'reauth';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('private.ai_configuration_labels', 6));
  if exists (select from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and c.provider = admin_remove_provider_key.provider)
  then
    return 'in_use';
  end if;
  delete from private.provider_keys as k where k.provider = admin_remove_provider_key.provider
    returning * into removed;
  if not found then
    return 'none';
  end if;
  delete from vault.secrets as s where s.id = removed.secret_id;
  perform private.audit('remove_provider_key', 'provider', removed.provider, '{}'::jsonb);
  return 'removed';
end;
$$;

revoke all on function
  public.admin_ai_session(),
  public.admin_provider_keys(),
  public.admin_ai_configurations(),
  public.admin_activate_ai_configuration(text),
  public.admin_clear_ai_test(text),
  public.admin_remove_provider_key(text)
  from public, anon;
grant execute on function
  public.admin_ai_session(),
  public.admin_provider_keys(),
  public.admin_ai_configurations(),
  public.admin_activate_ai_configuration(text),
  public.admin_clear_ai_test(text),
  public.admin_remove_provider_key(text)
  to authenticated;
