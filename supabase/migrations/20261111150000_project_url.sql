-- One Vault secret, `project_url` (`https://<project ref>.supabase.co`), replaces the three
-- per-function URL secrets the database's Edge Function callers read (#906, ADR 0245):
-- `assistant_function_url`, `screening_function_url` and `triage_function_url`. Each caller
-- appends its function's path, `/functions/v1/assistant`, `/functions/v1/publish-note` or
-- `/functions/v1/triage-reports`, and does nothing, and raises nothing, while `project_url` or
-- `assistant_service_role_key` is missing.
--
-- Not additive: it changes Vault rows, so it needs the owner's Gate approval before it merges.
-- `private.adopt_project_url()`, run by this migration, creates `project_url` from the address of
-- the first per-function secret present (assistant, screening, triage) when `project_url` is
-- missing, then deletes the three per-function secrets once `project_url` exists. With none of
-- the four present it changes nothing.
--
-- Revert, run once against production: `select private.revert_project_url();`, then
-- `drop function private.revert_project_url();`. It restores the five callers as the earlier
-- migrations defined them and, from `project_url`, the per-function secrets that are missing;
-- `project_url` stays.

create function private.adopt_project_url() returns void
language plpgsql
set search_path = ''
as $$
declare
  per_function text[] := array['assistant_function_url', 'screening_function_url',
    'triage_function_url'];
  address text;
begin
  if not exists (select from vault.decrypted_secrets as d where d.name = 'project_url') then
    select substring(d.decrypted_secret from '^https://[^/]+') into address
      from vault.decrypted_secrets as d
      where d.name = any (per_function) and d.decrypted_secret ~ '^https://[^/]+'
      order by array_position(per_function, d.name)
      limit 1;
    if address is not null then
      perform vault.create_secret(address, 'project_url');
    end if;
  end if;
  if exists (select from vault.decrypted_secrets as d where d.name = 'project_url') then
    delete from vault.secrets as s where s.name = any (per_function);
  end if;
end;
$$;

select private.adopt_project_url();

create or replace function private.sweep_assistant_jobs() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
  stale record;
begin
  for stale in
    select s.id, s.user_id from private.assistant_job_steps as s
    where s.outcome is null and s.created_at < now() - interval '150 seconds'
    order by s.id
    limit 100
  loop
    if not pg_try_advisory_xact_lock(hashtextextended(stale.user_id::text, 7)) then
      continue;
    end if;
    begin
      perform public.finish_assistant_job_step(stale.id, 'time_limit',
        private.assistant_photo_estimate_tokens(), 0, 0, 150000, null);
    exception when sqlstate 'P0002' then
      null;
    end;
  end loop;
  if not exists (
    select from private.assistant_jobs as j
    where (j.status = 'running'
      and exists (select from private.assistant_job_photos as p
        where p.job_id = j.id and p.status = 'queued')
      and coalesce(
        (select max(s.created_at) from private.assistant_job_steps as s where s.job_id = j.id),
        j.created_at) < now() - interval '3 minutes')
      or (j.status <> 'running' and j.photos_cleared_at is null
        and j.finished_at < now() - interval '1 minute')
  ) then
    return;
  end if;
  select d.decrypted_secret || '/functions/v1/assistant' into function_url from vault.decrypted_secrets as d
    where d.name = 'project_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  perform private.request_assistant_job_worker(function_url, service_role_key);
end;
$$;

create or replace function private.sweep_assistant_unread_photos() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  if not exists (select from public.assistant_unread_photos()) then
    return;
  end if;
  select d.decrypted_secret || '/functions/v1/assistant' into function_url from vault.decrypted_secrets as d
    where d.name = 'project_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  perform private.request_assistant_job_worker(function_url, service_role_key);
end;
$$;

create or replace function private.sweep_deck_screening() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  select d.decrypted_secret || '/functions/v1/publish-note' into function_url from vault.decrypted_secrets as d
    where d.name = 'project_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  if not exists (select from public.screening_due(1)) then
    return;
  end if;
  perform private.request_screening_worker(function_url, service_role_key);
end;
$$;

create or replace function private.sweep_report_triage() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  select d.decrypted_secret || '/functions/v1/triage-reports' into function_url from vault.decrypted_secrets as d
    where d.name = 'project_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  if not exists (select from public.triage_due(1, false)) then
    return;
  end if;
  perform private.request_triage_worker(function_url, service_role_key, false);
end;
$$;

create or replace function private.triage_severe_report() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  begin
    if not private.triage_is_due(new.deck_id, true) then
      return null;
    end if;
    select d.decrypted_secret || '/functions/v1/triage-reports' into function_url from vault.decrypted_secrets as d
      where d.name = 'project_url';
    select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
      where d.name = 'assistant_service_role_key';
    if function_url is not null and service_role_key is not null then
      perform private.request_triage_worker(function_url, service_role_key, true);
    end if;
  exception when others then
    return null;
  end;
  return null;
end;
$$;

revoke all on function private.adopt_project_url() from public, anon, authenticated;

-- The revert in the header.
create function private.revert_project_url() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  if exists (select from vault.decrypted_secrets as d where d.name = 'project_url') then
    perform vault.create_secret(d.decrypted_secret || p.path, p.name)
      from vault.decrypted_secrets as d
      cross join (values ('assistant_function_url', '/functions/v1/assistant'),
        ('screening_function_url', '/functions/v1/publish-note'),
        ('triage_function_url', '/functions/v1/triage-reports')) as p (name, path)
      where d.name = 'project_url'
        and not exists (select from vault.secrets as s where s.name = p.name);
  end if;
  execute $sql$
    create or replace function private.sweep_assistant_jobs() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
      stale record;
    begin
      for stale in
        select s.id, s.user_id from private.assistant_job_steps as s
        where s.outcome is null and s.created_at < now() - interval '150 seconds'
        order by s.id
        limit 100
      loop
        if not pg_try_advisory_xact_lock(hashtextextended(stale.user_id::text, 7)) then
          continue;
        end if;
        begin
          perform public.finish_assistant_job_step(stale.id, 'time_limit',
            private.assistant_photo_estimate_tokens(), 0, 0, 150000, null);
        exception when sqlstate 'P0002' then
          null;
        end;
      end loop;
      if not exists (
        select from private.assistant_jobs as j
        where (j.status = 'running'
          and exists (select from private.assistant_job_photos as p
            where p.job_id = j.id and p.status = 'queued')
          and coalesce(
            (select max(s.created_at) from private.assistant_job_steps as s where s.job_id = j.id),
            j.created_at) < now() - interval '3 minutes')
          or (j.status <> 'running' and j.photos_cleared_at is null
            and j.finished_at < now() - interval '1 minute')
      ) then
        return;
      end if;
      select d.decrypted_secret into function_url from vault.decrypted_secrets as d
        where d.name = 'assistant_function_url';
      select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
        where d.name = 'assistant_service_role_key';
      if function_url is null or service_role_key is null then
        return;
      end if;
      perform private.request_assistant_job_worker(function_url, service_role_key);
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function private.sweep_assistant_unread_photos() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
    begin
      if not exists (select from public.assistant_unread_photos()) then
        return;
      end if;
      select d.decrypted_secret into function_url from vault.decrypted_secrets as d
        where d.name = 'assistant_function_url';
      select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
        where d.name = 'assistant_service_role_key';
      if function_url is null or service_role_key is null then
        return;
      end if;
      perform private.request_assistant_job_worker(function_url, service_role_key);
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function private.sweep_deck_screening() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
    begin
      select d.decrypted_secret into function_url from vault.decrypted_secrets as d
        where d.name = 'screening_function_url';
      select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
        where d.name = 'assistant_service_role_key';
      if function_url is null or service_role_key is null then
        return;
      end if;
      if not exists (select from public.screening_due(1)) then
        return;
      end if;
      perform private.request_screening_worker(function_url, service_role_key);
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function private.sweep_report_triage() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
    begin
      select d.decrypted_secret into function_url from vault.decrypted_secrets as d
        where d.name = 'triage_function_url';
      select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
        where d.name = 'assistant_service_role_key';
      if function_url is null or service_role_key is null then
        return;
      end if;
      if not exists (select from public.triage_due(1, false)) then
        return;
      end if;
      perform private.request_triage_worker(function_url, service_role_key, false);
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function private.triage_severe_report() returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
    begin
      begin
        if not private.triage_is_due(new.deck_id, true) then
          return null;
        end if;
        select d.decrypted_secret into function_url from vault.decrypted_secrets as d
          where d.name = 'triage_function_url';
        select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
          where d.name = 'assistant_service_role_key';
        if function_url is not null and service_role_key is not null then
          perform private.request_triage_worker(function_url, service_role_key, true);
        end if;
      exception when others then
        return null;
      end;
      return null;
    end;
    $$;
  $sql$;
  drop function private.adopt_project_url();
end;
$revert$;

revoke all on function private.revert_project_url() from public, anon, authenticated;
