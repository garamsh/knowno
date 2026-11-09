-- The sweep of stalled photo jobs (#760, ADR 0203): it requests the worker once for a running job
-- with a queued photo and no read begun for 3 minutes, or one that ended over a minute ago with its
-- photos still in the bucket (#800), and nothing for a job that is fresh, that
-- has begun a read lately, that has no queued photo or that is not running, nor while either Vault
-- secret is missing; the request carries the service-role key; cron schedules it each minute; no
-- client reaches it; and the revert. pg_net is not sent to: its queue is read inside the
-- transaction, which rolls back before the background worker sees a row.
begin;
select plan(19);

create function pg_temp.queued() returns bigint language sql as $$
  select count(*) from net.http_request_queue;
$$;

-- Runs the sweep and answers the requests it queued.
create function pg_temp.sweep() returns bigint language plpgsql as $$
begin
  delete from net.http_request_queue;
  perform private.sweep_assistant_jobs();
  return pg_temp.queued();
end;
$$;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');

-- A job of B's over one queued photo, started 10 minutes ago.
insert into private.assistant_jobs (id, user_id, plan, configuration_id, instructions, created_at)
  select 'f0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000b', 'free',
    configuration_id, '', now() - interval '10 minutes'
  from private.assistant_configuration_labels where plan = 'free' and label = 'active';
insert into private.assistant_job_photos (job_id, position, photo_id, message_id)
  values ('f0000000-0000-4000-8000-000000000001', 1, 'e0000000-0000-4000-8000-000000000001',
    pgmq.send('assistant_photo_reads', '{}'));

select results_eq($$select j.status, p.status from private.assistant_jobs as j
    join private.assistant_job_photos as p on p.job_id = j.id$$,
  $$values ('running', 'queued')$$, 'the setup made a running job with one queued photo');

-- Without the secrets, nothing is requested, and nothing raised.
select is(pg_temp.sweep(), 0::bigint, 'a stale job and no secrets: nothing requested');

select vault.create_secret('https://example.supabase.co/functions/v1/assistant',
  'assistant_function_url');
select is(pg_temp.sweep(), 0::bigint, 'a stale job and no key: nothing requested');
delete from vault.secrets where name = 'assistant_function_url';
select vault.create_secret('service-key', 'assistant_service_role_key');
select is(pg_temp.sweep(), 0::bigint, 'a stale job and no URL: nothing requested');

-- The control: with both secrets the same job is requested once.
select vault.create_secret('https://example.supabase.co/functions/v1/assistant',
  'assistant_function_url');
select is(pg_temp.sweep(), 1::bigint, 'a stale job and both secrets: the worker requested once');
select results_eq($$select method::text, url, headers ->> 'Authorization', headers ->> 'apikey'
    from net.http_request_queue$$,
  $$values ('POST', 'https://example.supabase.co/functions/v1/assistant/jobs/work',
    'Bearer service-key', 'service-key')$$,
  'a POST of the worker route with the service-role key');

-- A job that has begun no read for under 3 minutes is left, with the stale one as control.
update private.assistant_jobs set created_at = now() - interval '2 minutes';
select is(pg_temp.sweep(), 0::bigint, 'a job started 2 minutes ago and read from: nothing requested');
update private.assistant_jobs set created_at = now() - interval '4 minutes';
select is(pg_temp.sweep(), 1::bigint, 'the same job at 4 minutes: requested');

-- A read begun lately holds the job back, an older one does not.
insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id,
    created_at)
  select user_id, id, 1, plan, configuration_id, now() - interval '1 minute'
  from private.assistant_jobs;
select is(pg_temp.sweep(), 0::bigint, 'a read begun a minute ago: nothing requested');
update private.assistant_job_steps set created_at = now() - interval '4 minutes';
select is(pg_temp.sweep(), 1::bigint, 'the read begun 4 minutes ago: requested');

-- A job with no queued photo, or not running, is left.
update private.assistant_job_photos set status = 'cancelled', message_id = null;
select is(pg_temp.sweep(), 0::bigint, 'no queued photo: nothing requested');
update private.assistant_job_photos set status = 'queued',
  message_id = (select pgmq.send('assistant_photo_reads', '{}'));
update private.assistant_jobs set status = 'cancelled', finished_at = now();
select is(pg_temp.sweep(), 0::bigint, 'a job not running: nothing requested');

-- A job that ended with its photos still in the bucket is requested a minute after it ended, and
-- not once they are deleted.
update private.assistant_jobs set finished_at = now() - interval '2 minutes';
select is(pg_temp.sweep(), 1::bigint,
  'a job that ended 2 minutes ago with its photos in the bucket: requested');
update private.assistant_jobs set photos_cleared_at = now();
select is(pg_temp.sweep(), 0::bigint, 'its photos deleted: nothing requested');
update private.assistant_jobs set photos_cleared_at = null;
update private.assistant_jobs set status = 'running', finished_at = null;
select is(pg_temp.sweep(), 1::bigint, 'running with a queued photo again: requested');

-- The schedule and the grants.
select results_eq($$select schedule, command from cron.job where jobname = 'sweep-assistant-jobs'$$,
  $$values ('* * * * *', 'select private.sweep_assistant_jobs()')$$, 'cron runs the sweep each minute');
select results_eq($$select count(*), count(*) filter (where has_function_privilege('postgres', p.oid, 'execute')),
    count(*) filter (where has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
      or has_function_privilege('service_role', p.oid, 'execute'))
  from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('sweep_assistant_jobs', 'request_assistant_job_worker')$$,
  $$values (2::bigint, 2::bigint, 0::bigint)$$,
  'both functions are found and the owner executes them, and no client role does');

-- The revert.
select lives_ok($$select private.revert_assistant_job_sweeper()$$, 'the revert runs');
select results_eq(
  $$select (select count(*) from cron.job where jobname = 'sweep-assistant-jobs'),
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname in ('sweep_assistant_jobs', 'request_assistant_job_worker'))$$,
  $$values (0::bigint, 0::bigint)$$, 'the cron job and the functions are gone');

select * from finish();
rollback;
