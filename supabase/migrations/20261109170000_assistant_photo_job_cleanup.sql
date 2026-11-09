-- A photo job that ended leaves no photo in the bucket, a retry waits longer, and the queue's
-- reader cannot deadlock (#800, ADR 0198, ADR 0218).
--
-- Adds `private.assistant_jobs.photos_cleared_at`, null until the job's photos were deleted from
-- `assistant-photos` through the Storage API, which SQL cannot do: the function's worker deletes
-- them and records it through `public.mark_assistant_job_cleared`, and finds the jobs not yet
-- cleared through `public.assistant_jobs_to_clear`. A job that ends in SQL, by the day's budget or
-- a photo's third read, is therefore found by the next worker, which the sweep requests while one
-- waits for a minute. It replaces `sweep_assistant_jobs` (also asking for the worker for such a
-- job), `purge_assistant_jobs` (deleting only a job whose photos were deleted, so the record
-- outlives a failed deletion), `next_assistant_job_step` (taking a user's lock without waiting)
-- and `finish_assistant_job_step` (a failed read shown again after 30 s, then 120 s, in place
-- of 10 s). It changes no row: the column starts null, so the next worker deletes the photos of
-- jobs that ended before this, as the job's end always meant to.
--
-- Revert, run once against production before `private.revert_assistant_job_sweeper()` and
-- `private.revert_assistant_photo_jobs()` if those are run too:
-- `select private.revert_assistant_photo_job_cleanup();`, then
-- `drop function private.revert_assistant_photo_job_cleanup();`. It puts the four functions back as
-- `20261105210000_assistant_photo_jobs.sql` and `20261108120000_assistant_job_sweeper.sql` made
-- them, drops the two functions and the column, and leaves the photos deleted.

alter table private.assistant_jobs add column photos_cleared_at timestamptz;
alter table private.assistant_jobs
  add check (photos_cleared_at is null or status <> 'running');

-- The jobs, oldest end first, at most 20, that have ended and whose photos were not yet deleted.
create function public.assistant_jobs_to_clear() returns table (user_id uuid, job_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select j.user_id, j.id from private.assistant_jobs as j
  where j.status <> 'running' and j.photos_cleared_at is null
  order by j.finished_at
  limit 20;
$$;

-- Records that [user_id]'s ended job [job_id] had its photos deleted from the bucket; nothing for
-- a running job, another user's or one already recorded.
create function public.mark_assistant_job_cleared(user_id uuid, job_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update private.assistant_jobs as j set photos_cleared_at = now()
  where j.id = mark_assistant_job_cleared.job_id
    and j.user_id = mark_assistant_job_cleared.user_id
    and j.status <> 'running' and j.photos_cleared_at is null;
$$;

-- Takes the next photo to read off the queue and begins its step, under its user's assistant lock,
-- hiding its message for 150 s, past a step's 60 s and its record. `outcome` is `step`, with what
-- the read needs; or `empty`, with `pending` the messages still queued, hidden ones included.
-- A message whose photo is no longer queued is deleted. A user's steps run three at a time: a
-- fourth is hidden for 5 s, as is a message of a user whose lock another transaction holds. A photo
-- whose job's plan has spent the day's budget is skipped, and one begun three times is failed.
--
-- It never waits for another transaction, so it is in no cycle of waits: a message is read with
-- `skip locked`, and a user's lock is only tried, since a lock taken in the loop is kept to the
-- transaction's end across users. Every other function takes at most one user's lock and waits at
-- most for a transaction of this function, which ends without waiting.
create or replace function public.next_assistant_job_step()
returns table (
  outcome text, pending bigint, step_id bigint, job_id uuid, user_id uuid, photo_id uuid,
  photo_position integer, attempt integer, plan text, configuration_id bigint, provider text,
  model text, reasoning_effort text, instructions text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  message record;
  job private.assistant_jobs;
  photo private.assistant_job_photos;
  config private.assistant_configurations;
  budget bigint;
  step bigint;
begin
  loop
    select r.msg_id, r.message as body into message
      from pgmq.read('assistant_photo_reads', 150, 1) as r;
    if not found then
      return query select 'empty'::text,
        (select m.queue_length from pgmq.metrics('assistant_photo_reads') as m),
        null::bigint, null::uuid, null::uuid, null::uuid, null::integer, null::integer,
        null::text, null::bigint, null::text, null::text, null::text, null::text;
      return;
    end if;
    select j.* into job from private.assistant_jobs as j
      where j.id = (message.body ->> 'job_id')::uuid;
    if not found then
      perform pgmq.delete('assistant_photo_reads', message.msg_id);
      continue;
    end if;
    if not pg_try_advisory_xact_lock(hashtextextended(job.user_id::text, 7)) then
      perform pgmq.set_vt('assistant_photo_reads', message.msg_id, 5);
      continue;
    end if;
    select p.* into photo from private.assistant_job_photos as p
      where p.job_id = job.id and p.position = (message.body ->> 'position')::integer;
    if not found or photo.status <> 'queued' or photo.message_id <> message.msg_id
        or job.status <> 'running' then
      perform pgmq.delete('assistant_photo_reads', message.msg_id);
      continue;
    end if;
    if (select count(*) from private.assistant_job_steps as s
        where s.user_id = job.user_id and s.outcome is null
          and s.created_at > now() - interval '150 seconds') >= 3 then
      perform pgmq.set_vt('assistant_photo_reads', message.msg_id, 5);
      continue;
    end if;
    select b.daily_tokens into budget from private.assistant_token_budgets as b
      where b.plan = job.plan;
    if photo.attempts >= 3
        or (budget is not null and private.assistant_tokens_today(job.user_id) >= budget) then
      update private.assistant_job_photos as p
        set status = case when photo.attempts >= 3 then 'failed' else 'skipped' end,
          message_id = null
        where p.job_id = job.id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', message.msg_id);
      perform private.end_assistant_job_if_read(job.id);
      continue;
    end if;
    update private.assistant_job_photos as p set attempts = p.attempts + 1
      where p.job_id = job.id and p.position = photo.position;
    insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id)
      values (job.user_id, job.id, photo.position, job.plan, job.configuration_id)
      returning assistant_job_steps.id into step;
    select c.* into config from private.assistant_configurations as c
      where c.id = job.configuration_id;
    return query select 'step'::text, null::bigint, step, job.id, job.user_id, photo.photo_id,
      photo.position, photo.attempts + 1, job.plan, config.id, config.provider, config.model,
      config.reasoning_effort, job.instructions;
    return;
  end loop;
end;
$$;

-- Records how [step_id]'s read ended and what it used, once, under its user's assistant lock, which
-- charges it: a step already recorded or never begun raises P0002. A photo still queued is read on
-- `ok` or `cut`, keeping [reading]; failed on `unreadable` or on its third read; and otherwise
-- shown again on the queue after 30 s, or 120 s once read twice. Answers the photo's status and
-- the job's.
create or replace function public.finish_assistant_job_step(
  step_id bigint, outcome text, input_tokens integer, output_tokens integer,
  reasoning_tokens integer, latency_ms integer, reading text
)
returns table (photo_status text, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  step private.assistant_job_steps;
  photo private.assistant_job_photos;
begin
  select s.user_id into owner from private.assistant_job_steps as s
    where s.id = finish_assistant_job_step.step_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(owner::text, 7));
  end if;
  update private.assistant_job_steps as s
    set outcome = finish_assistant_job_step.outcome,
      input_tokens = finish_assistant_job_step.input_tokens,
      output_tokens = finish_assistant_job_step.output_tokens,
      reasoning_tokens = finish_assistant_job_step.reasoning_tokens,
      latency_ms = finish_assistant_job_step.latency_ms
    where s.id = finish_assistant_job_step.step_id and s.outcome is null
    returning s.* into step;
  if not found then
    raise exception 'no unrecorded assistant job step %', finish_assistant_job_step.step_id
      using errcode = 'P0002';
  end if;
  select p.* into photo from private.assistant_job_photos as p
    where p.job_id = step.job_id and p.position = step.position;
  if found and photo.status = 'queued' then
    if finish_assistant_job_step.outcome in ('ok', 'cut') then
      update private.assistant_job_photos as p
        set status = 'read', message_id = null, reading = finish_assistant_job_step.reading,
          cut = finish_assistant_job_step.outcome = 'cut'
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', photo.message_id);
    elsif finish_assistant_job_step.outcome = 'unreadable' or photo.attempts >= 3 then
      update private.assistant_job_photos as p set status = 'failed', message_id = null
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', photo.message_id);
    else
      perform pgmq.set_vt('assistant_photo_reads', photo.message_id,
        case when photo.attempts <= 1 then 30 else 120 end);
    end if;
    perform private.end_assistant_job_if_read(photo.job_id);
  end if;
  return query
    select p.status, j.status
    from private.assistant_job_photos as p
    join private.assistant_jobs as j on j.id = p.job_id
    where p.job_id = step.job_id and p.position = step.position;
end;
$$;

-- Deletes the jobs begun more than 7 days ago whose photos were deleted from the bucket, their
-- photos and readings with them, their steps staying, with no job. A job with its photos still in
-- the bucket stays, as the record that they are; a job that has ended has no queued message.
create or replace function private.purge_assistant_jobs() returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.assistant_jobs as j
  where j.created_at < now() - interval '7 days' and j.photos_cleared_at is not null;
$$;

-- Requests the worker once when a running job has a queued photo and has begun no read for 3
-- minutes, or, with no read begun, was started over 3 minutes ago, as the job's poll judges it, or
-- when a job ended over a minute ago and its photos are still in the bucket. Does nothing, and
-- raises nothing, while either Vault secret is missing.
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

revoke all on function public.assistant_jobs_to_clear(),
  public.mark_assistant_job_cleared(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.assistant_jobs_to_clear(),
  public.mark_assistant_job_cleared(uuid, uuid)
  to service_role;

-- The revert in the header.
create function private.revert_assistant_photo_job_cleanup() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  drop function public.mark_assistant_job_cleared(uuid, uuid);
  drop function public.assistant_jobs_to_clear();
  alter table private.assistant_jobs drop column photos_cleared_at;
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
      perform private.request_assistant_job_worker(function_url, service_role_key);
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function private.purge_assistant_jobs() returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      perform pgmq.delete('assistant_photo_reads', array(
        select p.message_id from private.assistant_job_photos as p
        join private.assistant_jobs as j on j.id = p.job_id
        where j.created_at < now() - interval '7 days' and p.message_id is not null));
      delete from private.assistant_jobs as j where j.created_at < now() - interval '7 days';
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function public.finish_assistant_job_step(
      step_id bigint, outcome text, input_tokens integer, output_tokens integer,
      reasoning_tokens integer, latency_ms integer, reading text
    )
    returns table (photo_status text, job_status text)
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      owner uuid;
      step private.assistant_job_steps;
      photo private.assistant_job_photos;
    begin
      select s.user_id into owner from private.assistant_job_steps as s
        where s.id = finish_assistant_job_step.step_id;
      if found then
        perform pg_advisory_xact_lock(hashtextextended(owner::text, 7));
      end if;
      update private.assistant_job_steps as s
        set outcome = finish_assistant_job_step.outcome,
          input_tokens = finish_assistant_job_step.input_tokens,
          output_tokens = finish_assistant_job_step.output_tokens,
          reasoning_tokens = finish_assistant_job_step.reasoning_tokens,
          latency_ms = finish_assistant_job_step.latency_ms
        where s.id = finish_assistant_job_step.step_id and s.outcome is null
        returning s.* into step;
      if not found then
        raise exception 'no unrecorded assistant job step %', finish_assistant_job_step.step_id
          using errcode = 'P0002';
      end if;
      select p.* into photo from private.assistant_job_photos as p
        where p.job_id = step.job_id and p.position = step.position;
      if found and photo.status = 'queued' then
        if finish_assistant_job_step.outcome in ('ok', 'cut') then
          update private.assistant_job_photos as p
            set status = 'read', message_id = null, reading = finish_assistant_job_step.reading,
              cut = finish_assistant_job_step.outcome = 'cut'
            where p.job_id = photo.job_id and p.position = photo.position;
          perform pgmq.delete('assistant_photo_reads', photo.message_id);
        elsif finish_assistant_job_step.outcome = 'unreadable' or photo.attempts >= 3 then
          update private.assistant_job_photos as p set status = 'failed', message_id = null
            where p.job_id = photo.job_id and p.position = photo.position;
          perform pgmq.delete('assistant_photo_reads', photo.message_id);
        else
          perform pgmq.set_vt('assistant_photo_reads', photo.message_id, 10);
        end if;
        perform private.end_assistant_job_if_read(photo.job_id);
      end if;
      return query
        select p.status, j.status
        from private.assistant_job_photos as p
        join private.assistant_jobs as j on j.id = p.job_id
        where p.job_id = step.job_id and p.position = step.position;
    end;
    $$;
  $sql$;
  execute $sql$
    create or replace function public.next_assistant_job_step()
    returns table (
      outcome text, pending bigint, step_id bigint, job_id uuid, user_id uuid, photo_id uuid,
      photo_position integer, attempt integer, plan text, configuration_id bigint, provider text,
      model text, reasoning_effort text, instructions text
    )
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      message record;
      job private.assistant_jobs;
      photo private.assistant_job_photos;
      config private.assistant_configurations;
      budget bigint;
      step bigint;
    begin
      loop
        select r.msg_id, r.message as body into message
          from pgmq.read('assistant_photo_reads', 150, 1) as r;
        if not found then
          return query select 'empty'::text,
            (select m.queue_length from pgmq.metrics('assistant_photo_reads') as m),
            null::bigint, null::uuid, null::uuid, null::uuid, null::integer, null::integer,
            null::text, null::bigint, null::text, null::text, null::text, null::text;
          return;
        end if;
        select j.* into job from private.assistant_jobs as j
          where j.id = (message.body ->> 'job_id')::uuid;
        if not found then
          perform pgmq.delete('assistant_photo_reads', message.msg_id);
          continue;
        end if;
        perform pg_advisory_xact_lock(hashtextextended(job.user_id::text, 7));
        select p.* into photo from private.assistant_job_photos as p
          where p.job_id = job.id and p.position = (message.body ->> 'position')::integer;
        if not found or photo.status <> 'queued' or photo.message_id <> message.msg_id
            or job.status <> 'running' then
          perform pgmq.delete('assistant_photo_reads', message.msg_id);
          continue;
        end if;
        if (select count(*) from private.assistant_job_steps as s
            where s.user_id = job.user_id and s.outcome is null
              and s.created_at > now() - interval '150 seconds') >= 3 then
          perform pgmq.set_vt('assistant_photo_reads', message.msg_id, 5);
          continue;
        end if;
        select b.daily_tokens into budget from private.assistant_token_budgets as b
          where b.plan = job.plan;
        if photo.attempts >= 3
            or (budget is not null and private.assistant_tokens_today(job.user_id) >= budget) then
          update private.assistant_job_photos as p
            set status = case when photo.attempts >= 3 then 'failed' else 'skipped' end,
              message_id = null
            where p.job_id = job.id and p.position = photo.position;
          perform pgmq.delete('assistant_photo_reads', message.msg_id);
          perform private.end_assistant_job_if_read(job.id);
          continue;
        end if;
        update private.assistant_job_photos as p set attempts = p.attempts + 1
          where p.job_id = job.id and p.position = photo.position;
        insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id)
          values (job.user_id, job.id, photo.position, job.plan, job.configuration_id)
          returning assistant_job_steps.id into step;
        select c.* into config from private.assistant_configurations as c
          where c.id = job.configuration_id;
        return query select 'step'::text, null::bigint, step, job.id, job.user_id, photo.photo_id,
          photo.position, photo.attempts + 1, job.plan, config.id, config.provider, config.model,
          config.reasoning_effort, job.instructions;
        return;
      end loop;
    end;
    $$;
  $sql$;
end;
$revert$;

revoke all on function private.revert_assistant_photo_job_cleanup() from public, anon, authenticated;
