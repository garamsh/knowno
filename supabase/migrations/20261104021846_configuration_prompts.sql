-- One AI configuration per plan (#650, ADR 0182): a configuration is a plan's provider, model and
-- prompt version, and a plan has at most one draft, its 'test' configuration, tried and applied as
-- a unit. The global prompt labels of ADR 0073 go: begin_extraction takes the prompt from the
-- configuration that serves the photo, as it takes the provider and the model.
--
-- Not additive. `private.ai_configurations` gains `prompt_version_id`. Configurations are
-- append-only, so none is changed: `private.migrate_configuration_prompts()` appends, for each plan
-- whose active configuration has no prompt,
--   - its active configuration's provider and model with the active prompt version, and points
--     the plan's 'active' label at it;
--   - while the plan has a draft or a test prompt version was set, a draft: the draft's provider
--     and model, or else the active ones, with the test prompt version, or else the active one,
--     and points the plan's 'test' label at it.
-- What each user and each admin is served stays as it was. The rows it changes:
--   - every row of `private.ai_configuration_labels` (one 'active' per plan, and each 'test') is
--     pointed at an appended configuration, its `set_by` and `set_at` kept;
--   - a plan without a draft gets a 'test' row while a test prompt version was set;
--   - `private.prompt_labels` is renamed `private.prompt_labels_before_configurations`, unchanged.
-- Backups: every label row as it was, in `private.ai_configuration_labels_before_prompts`; the
-- prompt labels, verbatim, in `private.prompt_labels_before_configurations`.
--
-- Deploy. begin_extraction keeps its signature and its columns, and save_ai_configuration's new
-- argument has a default, so the extract-cards bundle deployed before this change works on it. A
-- bundle deployed before this migration applies answers 500 to a draft saved with a prompt. The
-- admin web deployed before this change fails on its AI pages and 처리할 일 until the new one is
-- live, since admin_prompt_labels, admin_set_prompt_label and admin_clear_test_prompt are gone.
--
-- Revert, run once against production: `select private.revert_configuration_prompts();`
--   1. `private.prompt_labels_before_configurations` is renamed back to `private.prompt_labels`,
--      so the global labels are what they were before this change; a prompt applied since in a
--      configuration is not carried over.
--   2. begin_extraction reads the prompt from those labels again, as
--      20261103133627_remove_openrouter_transition.sql defined it.
--   3. admin_prompt_versions, admin_prompt_version, admin_set_prompt_label,
--      admin_clear_test_prompt and admin_prompt_labels are restored from
--      20261019210000_prompts.sql and 20261102160718_admin_jobs.sql.
--   The labels keep their configurations, whose provider and model are what the earlier
--   begin_extraction reads. The column, save_ai_configuration's default argument,
--   admin_ai_configurations' extra column, admin_configuration_results, the label backup and the
--   two functions stay: the earlier extract-cards bundle and web read them as before.

-- Every label row as it was before this change. Read by nothing but a person checking the move.
create table private.ai_configuration_labels_before_prompts (
  plan text not null,
  label text not null,
  configuration_id bigint not null,
  set_by uuid,
  set_at timestamptz not null,
  primary key (plan, label)
);
insert into private.ai_configuration_labels_before_prompts
  (plan, label, configuration_id, set_by, set_at)
  select l.plan, l.label, l.configuration_id, l.set_by, l.set_at
  from private.ai_configuration_labels as l;

-- The global prompt labels, kept verbatim; the revert renames them back.
alter table private.prompt_labels rename to prompt_labels_before_configurations;

alter table private.ai_configuration_labels_before_prompts enable row level security;
revoke all on private.ai_configuration_labels_before_prompts
  from public, anon, authenticated, service_role;

-- The prompt version a configuration sends. Null only on a configuration saved before this change,
-- which no label names once the move has run.
alter table private.ai_configurations
  add column prompt_version_id bigint references private.prompt_versions;
create index ai_configurations_prompt_version_id
  on private.ai_configurations (prompt_version_id);

-- Refuses any change to a configuration but its author's removal, the prompt included.
create or replace function private.keep_ai_configuration() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.plan = old.plan
    and new.provider = old.provider and new.model = old.model
    and new.prompt_version_id is not distinct from old.prompt_version_id
    and new.created_at = old.created_at and new.created_by is null
  then
    return new;
  end if;
  raise exception 'AI configurations are append-only' using errcode = '55000';
end;
$$;

-- The move the header names. A second run changes nothing, since every active configuration then
-- has a prompt.
create function private.migrate_configuration_prompts() returns void
language plpgsql
set search_path = ''
as $$
declare
  active_version bigint;
  test private.prompt_labels_before_configurations;
  plan_name text;
  serving private.ai_configurations;
  draft private.ai_configurations;
  draft_label private.ai_configuration_labels;
  added bigint;
begin
  select b.version_id into active_version
    from private.prompt_labels_before_configurations as b where b.label = 'active';
  select b.* into test
    from private.prompt_labels_before_configurations as b where b.label = 'test';
  for plan_name in
    select l.plan from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and c.prompt_version_id is null
    order by array_position(array['free', 'pro', 'max', 'special'], l.plan)
  loop
    if active_version is null then
      raise exception 'no active prompt version to move' using errcode = '55000';
    end if;
    select c.* into serving from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.plan = plan_name and l.label = 'active';
    select l.* into draft_label from private.ai_configuration_labels as l
      where l.plan = plan_name and l.label = 'test';
    select c.* into draft from private.ai_configurations as c
      where c.id = draft_label.configuration_id;
    insert into private.ai_configurations (plan, provider, model, prompt_version_id)
      values (plan_name, serving.provider, serving.model, active_version)
      returning id into added;
    update private.ai_configuration_labels as l set configuration_id = added
      where l.plan = plan_name and l.label = 'active';
    if draft.id is not null or test.version_id is not null then
      insert into private.ai_configurations (plan, provider, model, prompt_version_id)
        values (plan_name, coalesce(draft.provider, serving.provider),
          coalesce(draft.model, serving.model), coalesce(test.version_id, active_version))
        returning id into added;
      if draft_label.plan is null then
        insert into private.ai_configuration_labels (plan, label, configuration_id, set_by, set_at)
          values (plan_name, 'test', added, test.set_by, test.set_at);
      else
        update private.ai_configuration_labels as l set configuration_id = added
          where l.plan = plan_name and l.label = 'test';
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.migrate_configuration_prompts() from public, anon, authenticated;
select private.migrate_configuration_prompts();

-- Resolves [user_id]'s plan, its version, and the AI configuration that serves the photo, with
-- the provider, model and prompt it holds: for an admin naming [configuration_id], a
-- configuration some plan's label holds; for an admin otherwise the plan's draft while one is
-- set; for everyone else its active one. `available` is whether that provider has a key in Vault.
-- Only an available photo under the version's quota, or with no limit (private.unlimited), is
-- recorded, under the extraction lock. No row while the plan has no version or configuration, the
-- configuration has no prompt, or a configuration is named by a caller who is not an admin.
create or replace function public.begin_extraction(user_id uuid, configuration_id bigint default null)
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
  select v.* into version from private.prompt_versions as v where v.id = config.prompt_version_id;
  if not found then
    return;
  end if;
  usable := exists (select from private.provider_keys as k where k.provider = config.provider);
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

-- Saves [provider], [model] and [prompt_version_id] as [plan]'s configuration for [admin_id],
-- after extract-cards' check call on the provider and model parsed, and makes it the plan's one
-- draft, served to admins: the 'test' label, replacing any draft before. Without a prompt version
-- it keeps the draft's, or else the active one's. Records it and returns the configuration's id;
-- null, recording nothing, for a prompt version that does not exist or a plan with none to keep.
drop function public.save_ai_configuration(uuid, text, text, text);
create function public.save_ai_configuration(
  admin_id uuid, plan text, provider text, model text, prompt_version_id bigint default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  prompt bigint := save_ai_configuration.prompt_version_id;
  added private.ai_configurations;
begin
  perform private.require_admin_id(save_ai_configuration.admin_id);
  if prompt is null then
    select c.prompt_version_id into prompt from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.plan = save_ai_configuration.plan
      order by l.label = 'test' desc
      limit 1;
  end if;
  if not exists (select from private.prompt_versions as v where v.id = prompt) then
    return null;
  end if;
  insert into private.ai_configurations (plan, provider, model, prompt_version_id, created_by)
    values (save_ai_configuration.plan, save_ai_configuration.provider,
      save_ai_configuration.model, prompt, save_ai_configuration.admin_id)
    returning * into added;
  insert into private.ai_configuration_labels (plan, label, configuration_id, set_by)
    values (added.plan, 'test', added.id, save_ai_configuration.admin_id)
    on conflict on constraint ai_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  perform private.audit_by(save_ai_configuration.admin_id, 'save_ai_configuration', 'plan',
    added.plan, jsonb_build_object('configuration_id', added.id, 'provider', added.provider,
      'model', added.model, 'prompt_version_id', added.prompt_version_id));
  return added.id;
end;
$$;

revoke all on function public.save_ai_configuration(uuid, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.save_ai_configuration(uuid, text, text, text, bigint)
  to service_role;

-- Each plan's labelled configurations: its 'active' one and its draft, with the prompt version
-- each sends, who saved each and when, and when the label was set.
drop function public.admin_ai_configurations();
create function public.admin_ai_configurations()
returns table (
  plan text, label text, configuration_id bigint, provider text, model text,
  prompt_version_id bigint, created_at timestamptz, created_by_email text, set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.plan, l.label, c.id, c.provider, c.model, c.prompt_version_id, c.created_at,
    u.email::text, l.set_at
  from private.ai_configuration_labels as l
  join private.ai_configurations as c on c.id = l.configuration_id
  left join auth.users as u on u.id = c.created_by
  order by array_position(array['free', 'pro', 'max', 'special'], l.plan), l.label;
end;
$$;

revoke all on function public.admin_ai_configurations() from public, anon;
grant execute on function public.admin_ai_configurations() to authenticated;

-- Applies [plan]'s draft to everyone (모두에게 적용): its provider, model and prompt become
-- 'active' together and the draft is cleared, recorded with the configuration before:
-- 'activated'; 'no_test' without a draft and 'no_key' while its provider has no key in Vault,
-- recording nothing.
create or replace function public.admin_activate_ai_configuration(plan text) returns text
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
  if not exists (select from private.provider_keys as k where k.provider = draft.provider) then
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
    'prompt_version_id', draft.prompt_version_id, 'configuration_before', before));
  return 'activated';
end;
$$;

-- Every version, newest first, with its note, length, author, and the labels of the
-- configurations sending it: 'active' while some plan's active configuration does, 'test' while
-- some plan's draft does.
create or replace function public.admin_prompt_versions()
returns table (
  id bigint, note text, length integer, created_by_email text, created_at timestamptz,
  labels text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select v.id, v.note, char_length(v.text), u.email::text, v.created_at,
    coalesce((select array_agg(distinct l.label order by l.label)
      from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where c.prompt_version_id = v.id), '{}')
  from private.prompt_versions as v
  left join auth.users as u on u.id = v.created_by
  order by v.id desc;
end;
$$;

-- One version with its text and labels, as admin_prompt_versions names them; no row for no version.
drop function public.admin_prompt_version(bigint);
create function public.admin_prompt_version(version_id bigint)
returns table (
  id bigint, text text, note text, created_by_email text, created_at timestamptz, labels text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select v.id, v.text, v.note, u.email::text, v.created_at,
    coalesce((select array_agg(distinct l.label order by l.label)
      from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where c.prompt_version_id = v.id), '{}')
  from private.prompt_versions as v
  left join auth.users as u on u.id = v.created_by
  where v.id = admin_prompt_version.version_id;
end;
$$;

revoke all on function public.admin_prompt_version(bigint) from public, anon;
grant execute on function public.admin_prompt_version(bigint) to authenticated;

drop function public.admin_set_prompt_label(text, bigint);
drop function public.admin_clear_test_prompt();
drop function public.admin_prompt_labels();

-- Over the last 1 to 90 UTC days, 30 by default, one row per provider, model and prompt version
-- that served a recorded photo, whichever plan: `calls` with an outcome, `ok`, `no_cards`,
-- `invalid_output`, `model_error`, `failure_rate`, the share of `calls` that failed to four
-- places, null with none, and `unrecorded`, the calls with no outcome.
create function public.admin_configuration_results(days integer default 30)
returns table (
  provider text,
  model text,
  prompt_version_id bigint,
  calls bigint,
  ok bigint,
  no_cards bigint,
  invalid_output bigint,
  model_error bigint,
  failure_rate numeric,
  unrecorded bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select c.provider, c.model, c.prompt_version_id,
    count(c.outcome),
    count(*) filter (where c.outcome = 'ok'),
    count(*) filter (where c.outcome = 'no_cards'),
    count(*) filter (where c.outcome = 'invalid_output'),
    count(*) filter (where c.outcome = 'model_error'),
    round(count(*) filter (where c.outcome in ('invalid_output', 'model_error'))::numeric
      / nullif(count(c.outcome), 0), 4),
    count(*) filter (where c.outcome is null)
  from private.extraction_calls as c
  join public.extraction_usage as u on u.id = c.usage_id
  where u.created_at >= date_trunc('day', now(), 'UTC')
    - make_interval(days => least(greatest(admin_configuration_results.days, 1), 90) - 1)
  group by 1, 2, 3
  order by count(*) desc, 1, 2, 3;
end;
$$;

revoke all on function public.admin_configuration_results(integer) from public, anon;
grant execute on function public.admin_configuration_results(integer) to authenticated;

-- The revert the header names. Run once, by the PM.
create function private.revert_configuration_prompts() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  alter table private.prompt_labels_before_configurations rename to prompt_labels;

  create or replace function public.begin_extraction(user_id uuid, configuration_id bigint default null)
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
    usable := exists (select from private.provider_keys as k where k.provider = config.provider);
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

  create or replace function public.admin_prompt_versions()
  returns table (
    id bigint, note text, length integer, created_by_email text, created_at timestamptz,
    labels text[]
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $$
  begin
    perform private.require_admin();
    return query
    select v.id, v.note, char_length(v.text), u.email::text, v.created_at,
      coalesce((select array_agg(l.label order by l.label) from private.prompt_labels as l
        where l.version_id = v.id), '{}')
    from private.prompt_versions as v
    left join auth.users as u on u.id = v.created_by
    order by v.id desc;
  end;
  $$;

  drop function public.admin_prompt_version(bigint);
  create function public.admin_prompt_version(version_id bigint)
  returns table (
    id bigint, text text, note text, created_by_email text, created_at timestamptz, labels text[],
    active_id bigint, active_text text
  )
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $$
  begin
    perform private.require_admin();
    return query
    select v.id, v.text, v.note, u.email::text, v.created_at,
      coalesce((select array_agg(l.label order by l.label) from private.prompt_labels as l
        where l.version_id = v.id), '{}'),
      a.id, a.text
    from private.prompt_versions as v
    left join auth.users as u on u.id = v.created_by
    left join private.prompt_labels as al on al.label = 'active'
    left join private.prompt_versions as a on a.id = al.version_id
    where v.id = admin_prompt_version.version_id;
  end;
  $$;

  create function public.admin_set_prompt_label(label text, version_id bigint) returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    caller uuid := private.require_admin();
    previous bigint;
    cleared boolean := false;
  begin
    if admin_set_prompt_label.label not in ('active', 'test') then
      raise exception 'no prompt label %', admin_set_prompt_label.label using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('private.prompt_labels', 4));
    select l.version_id into previous from private.prompt_labels as l
      where l.label = admin_set_prompt_label.label;
    if previous is not distinct from admin_set_prompt_label.version_id then
      return false;
    end if;
    insert into private.prompt_labels (label, version_id, set_by)
      values (admin_set_prompt_label.label, admin_set_prompt_label.version_id, caller)
      on conflict on constraint prompt_labels_pkey do update
        set version_id = excluded.version_id, set_by = excluded.set_by, set_at = now();
    if admin_set_prompt_label.label = 'active' then
      delete from private.prompt_labels as l
        where l.label = 'test' and l.version_id = admin_set_prompt_label.version_id;
      cleared := found;
    end if;
    perform private.audit(
      case admin_set_prompt_label.label when 'active' then 'activate_prompt' else 'test_prompt' end,
      'prompt', admin_set_prompt_label.version_id::text,
      jsonb_build_object('previous', previous, 'test_cleared', cleared));
    return true;
  end;
  $$;

  create function public.admin_clear_test_prompt() returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
  declare
    cleared bigint;
  begin
    perform private.require_admin();
    perform pg_advisory_xact_lock(hashtextextended('private.prompt_labels', 4));
    delete from private.prompt_labels as l where l.label = 'test' returning l.version_id into cleared;
    if cleared is null then
      return false;
    end if;
    perform private.audit('clear_test_prompt', 'prompt', cleared::text, '{}'::jsonb);
    return true;
  end;
  $$;

  create function public.admin_prompt_labels()
  returns table (label text, version_id bigint, set_at timestamptz)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $$
  begin
    perform private.require_admin();
    return query
    select l.label, l.version_id, l.set_at from private.prompt_labels as l order by l.label;
  end;
  $$;

  revoke all on function public.admin_prompt_version(bigint), public.admin_set_prompt_label(text, bigint),
    public.admin_clear_test_prompt(), public.admin_prompt_labels()
    from public, anon;
  grant execute on function public.admin_prompt_version(bigint), public.admin_set_prompt_label(text, bigint),
    public.admin_clear_test_prompt(), public.admin_prompt_labels()
    to authenticated;
end;
$revert$;

revoke all on function private.revert_configuration_prompts() from public, anon, authenticated;
