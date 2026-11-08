-- Resumes a stalled photo job from the server (#760, ADR 0203): every minute pg_cron asks
-- `private.sweep_photo_jobs()` whether a running photo job (ADR 0198) has a queued photo and
-- has begun no read for 3 minutes, `STALE_MS` in `functions/assistant/handler.ts`, and if so
-- requests the assistant function's worker, `POST /functions/v1/assistant/jobs/work`, through
-- pg_net, with no client polling.
--
-- Changes no row and no existing object. It enables pg_net, and creates the two functions and the
-- cron job `sweep-photo-jobs`. The function's URL and the service-role key are read by name
-- from Supabase Vault, `assistant_function_url`, the assistant function's address
-- `https://<project ref>.supabase.co/functions/v1/assistant`, and `assistant_service_role_key`;
-- the migration stores neither, and the sweep does nothing while either is missing.
--
-- Revert, run once against production before `private.revert_assistant_photo_jobs()` if that is
-- run too: `select private.revert_photo_job_sweeper();`, then
-- `drop function private.revert_photo_job_sweeper();`. It unschedules the cron job and drops
-- the functions; pg_net stays enabled and the Vault secrets stay.

-- Supabase's pg_net, which creates its own schema `net`; a no-op where it is already enabled.
create extension if not exists pg_net with schema extensions;

-- Queues a POST of the worker's route at [function_url] with [service_role_key]; pg_net sends it
-- after the transaction commits and keeps the response in `net._http_response`.
create function private.request_photo_worker(function_url text, service_role_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := request_photo_worker.function_url || '/jobs/work',
    headers := jsonb_build_object(
      'apikey', request_photo_worker.service_role_key,
      'Authorization', 'Bearer ' || request_photo_worker.service_role_key),
    timeout_milliseconds := 5000);
$$;

-- Requests the worker once when a running job has a queued photo and has begun no read for 3
-- minutes, or, with no read begun, was started over 3 minutes ago, as the job's poll judges it.
-- Does nothing, and raises nothing, while either Vault secret is missing.
create function private.sweep_photo_jobs() returns void
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
    where j.status = 'running'
      and exists (select from private.assistant_job_photos as p
        where p.job_id = j.id and p.status = 'queued')
      and coalesce(
        (select max(s.created_at) from private.assistant_job_steps as s where s.job_id = j.id),
        j.created_at) < now() - interval '3 minutes'
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
  perform private.request_photo_worker(function_url, service_role_key);
end;
$$;

revoke all on function private.request_photo_worker(text, text),
  private.sweep_photo_jobs()
  from public, anon, authenticated;

select cron.schedule('sweep-photo-jobs', '* * * * *', 'select private.sweep_photo_jobs()');

-- The revert in the header.
create function private.revert_photo_job_sweeper() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  perform cron.unschedule('sweep-photo-jobs');
  drop function private.sweep_photo_jobs();
  drop function private.request_photo_worker(text, text);
end;
$revert$;

revoke all on function private.revert_photo_job_sweeper() from public, anon, authenticated;
