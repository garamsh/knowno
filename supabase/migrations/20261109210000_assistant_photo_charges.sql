-- What a killed photo read is charged, and the uploads no job read (#812, ADR 0219, the owner's
-- decisions in #811).
--
-- A step no worker recorded, killed at the platform's wall clock, was never charged and its photo
-- was retried for free. `private.sweep_assistant_jobs` now first closes each step with no outcome
-- begun over 150 s ago, the time its queue message stays hidden, as `time_limit` charged
-- `private.assistant_photo_estimate_tokens()` input tokens and no output, through
-- `finish_assistant_job_step`, so its photo follows the attempt rules of any failed read, once: a
-- step already recorded is skipped. It takes a user's lock only by trying it, as
-- `next_assistant_job_step` does, and leaves that user's steps to the next minute when it is held.
-- The estimate is the one value `ASSISTANT_PHOTO_ESTIMATE_TOKENS` in
-- `functions/assistant/worker.ts` also charges a read that fails after its request was sent, and
-- ADR 0219 states its source.
--
-- The bucket `assistant-photos` keeps an upload no job names, since a photo is deleted only with
-- its job. `public.assistant_unread_photos()` lists, at most 100, the objects older than 24 hours
-- that no job photo row names, oldest first, and the worker deletes them through Storage after
-- the ended jobs' photos; `private.sweep_assistant_unread_photos()` requests the worker once a day
-- when there are any. The cron job `sweep-assistant-unread-photos` runs it at 18:45 UTC, 03:45 in
-- Korea, after the purge. Any worker deletes what has aged, so the daily request only guarantees
-- one runs.
--
-- It changes no row at the upgrade: the first sweep closes the steps already unrecorded, which
-- charges each once, and the first worker after the first run deletes the unread uploads of any age.
--
-- Revert, run once against production before `private.revert_assistant_photo_job_cleanup()` if that
-- is run too: `select private.revert_assistant_photo_charges();`, then
-- `drop function private.revert_assistant_photo_charges();`. It unschedules the cron job, drops
-- the three new functions and puts `sweep_assistant_jobs` back as
-- `20261109170000_assistant_photo_job_cleanup.sql` made it. A step already closed stays closed and
-- charged, and an unread upload already deleted stays deleted.

-- The input tokens one failed photo read is charged: the most a photo costs a model, ADR 0219.
create function private.assistant_photo_estimate_tokens() returns integer
language sql
immutable
set search_path = ''
as $$ select 4784; $$;

-- The objects of the bucket older than 24 hours that no job photo row names, oldest first, at
-- most 100, as `{user id}/{photo id}`.
create function public.assistant_unread_photos() returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.name from storage.objects as o
  where o.bucket_id = 'assistant-photos'
    and o.created_at < now() - interval '24 hours'
    and not exists (
      select from private.assistant_job_photos as p
      join private.assistant_jobs as j on j.id = p.job_id
      where j.user_id::text || '/' || p.photo_id::text = o.name)
  order by o.created_at
  limit 100;
$$;

-- Requests the worker once when an unread upload is over 24 hours old. Does nothing, and raises
-- nothing, while either Vault secret is missing.
create function private.sweep_assistant_unread_photos() returns void
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

-- Closes the steps begun over 150 s ago with no outcome, once each, then requests the worker once
-- when a running job has a queued photo and has begun no read for 3 minutes, or, with no read
-- begun, was started over 3 minutes ago, as the job's poll judges it, or when a job ended over a
-- minute ago and its photos are still in the bucket. Does nothing, and raises nothing, while either
-- Vault secret is missing.
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

revoke all on function public.assistant_unread_photos() from public, anon, authenticated;
grant execute on function public.assistant_unread_photos() to service_role;
revoke all on function private.assistant_photo_estimate_tokens(),
  private.sweep_assistant_unread_photos() from public, anon, authenticated;

select cron.schedule('sweep-assistant-unread-photos', '45 18 * * *',
  'select private.sweep_assistant_unread_photos()');

-- The revert in the header.
create function private.revert_assistant_photo_charges() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  perform cron.unschedule('sweep-assistant-unread-photos');
  drop function private.sweep_assistant_unread_photos();
  drop function public.assistant_unread_photos();
  execute $sql$
    create or replace function private.sweep_assistant_jobs() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      function_url text;
      service_role_key text;
    begin
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
  drop function private.assistant_photo_estimate_tokens();
end;
$revert$;

revoke all on function private.revert_assistant_photo_charges() from public, anon, authenticated;
