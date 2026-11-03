-- Ends the OpenRouter transition (#598, ADR 0162): OpenRouter's key is in Vault and the
-- `OPENROUTER_API_KEY` secret is gone, so a provider is available only with a key in Vault,
-- OpenRouter as every other. `begin_extraction` loses its `secret_providers` argument, which
-- changes its signature, so it is dropped and created again with the same grants;
-- `admin_activate_ai_configuration` refuses a draft on OpenRouter without a key, as it does the
-- others'. Changes no row.
--
-- Revert: `drop function public.begin_extraction(uuid, bigint);`, then restore
-- `public.begin_extraction(uuid, bigint, text[])` with its revoke and grant, and
-- `public.admin_activate_ai_configuration(text)`, from 20261102183518_ai_providers.sql.

drop function public.begin_extraction(uuid, bigint, text[]);

-- Resolves [user_id]'s plan, its version and prompt, and the AI configuration that serves the
-- photo: for an admin naming [configuration_id], a configuration some plan's label holds; for an
-- admin otherwise the plan's 'test' configuration while one is set; for everyone else its
-- 'active' one. `available` is whether that provider has a key in Vault. Only an available photo
-- under the version's quota, or with no limit (private.unlimited), is recorded, under the
-- extraction lock. No row while the plan has no version, the active prompt or the configuration
-- is missing, or a configuration is named by a caller who is not an admin.
create function public.begin_extraction(user_id uuid, configuration_id bigint default null)
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

revoke all on function public.begin_extraction(uuid, bigint) from public, anon, authenticated;
grant execute on function public.begin_extraction(uuid, bigint) to service_role;

-- Applies [plan]'s draft to everyone (모두에게 적용): its 'test' configuration becomes 'active' and
-- the draft is cleared, recorded with the configuration before: 'activated'; 'no_test' without a
-- draft and 'no_key' while its provider has no key in Vault, recording nothing.
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
    'configuration_before', before));
  return 'activated';
end;
$$;
