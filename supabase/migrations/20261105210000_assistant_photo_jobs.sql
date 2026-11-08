-- 말랑이 reads the user's photos in a background job (#750, ADR 0198): the chat's photos are
-- uploaded to a private bucket first, a job over them is queued on Supabase Queues (pgmq), one
-- message per photo, and the assistant function's worker reads each photo with the plan's
-- assistant configuration, each read a step charged against the day's token budget under the
-- user's assistant lock.
--
-- Changes no row of an existing table. It creates the bucket `assistant-photos` and its policies,
-- the pgmq extension and the queue `assistant_photo_reads`, `private.assistant_jobs`,
-- `private.assistant_job_photos` and `private.assistant_job_steps`, the job functions and the daily
-- cron job `purge-assistant-jobs`. It replaces `private.assistant_tokens_today`, so the day's
-- tokens charged include each recorded step's: what a message is allowed changes, so it merges with
-- the owner's approval.
--
-- Revert, run once against production before `private.revert_card_form_skills()`,
-- `private.revert_assistant_tokens()` or `private.revert_assistant()` if those are run too:
-- `select private.revert_assistant_photo_jobs();`, then
-- `drop function private.revert_assistant_photo_jobs();`. It unschedules the cron job, drops the
-- functions, tables and queue this made and puts `assistant_tokens_today` back as
-- `20261105090000_assistant_tokens.sql` made it, so steps are no longer charged. The bucket's
-- policies are dropped and the bucket is kept: Storage refuses a delete of its objects in SQL, so
-- the PM empties it through the Storage API and then deletes it there.

-- The chat's photos, each at {owner}/{photo id}, of the types and size photo import reads (6 MiB,
-- `ai-extraction.md` §Contract). config.toml declares the same for the local stack.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('assistant-photos', 'assistant-photos', false, 6291456,
    array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Its owner uploads a photo only into its own folder, under a uuid; no one updates one, so a photo
-- a job reads never changes.
create policy assistant_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'assistant-photos'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy assistant_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'assistant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy assistant_photos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'assistant-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- A suspended user uploads no photo to the bucket; other buckets are left to their own policies.
create policy assistant_photos_not_suspended_insert on storage.objects as restrictive
  for insert to authenticated
  with check (bucket_id <> 'assistant-photos' or not (select public.is_suspended()));

-- Supabase Queues is pgmq; a no-op where the project's owner enabled it first.
create extension if not exists pgmq;

-- One message per photo a job reads: {job_id, position}.
select pgmq.create('assistant_photo_reads');

-- A job over the photos of one chat message: the plan and assistant configuration it started on,
-- which read every photo of it, and what the user asked of the photos. A user has one running job.
create table private.assistant_jobs (
  id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  plan text not null,
  configuration_id bigint not null references private.assistant_configurations,
  instructions text not null check (char_length(instructions) <= 4000),
  status text not null default 'running' check (status in ('running', 'done', 'cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'running') = (finished_at is null))
);

create unique index assistant_jobs_one_running on private.assistant_jobs (user_id)
  where status = 'running';
create index assistant_jobs_user_id_created_at on private.assistant_jobs (user_id, created_at);
create index assistant_jobs_configuration_id on private.assistant_jobs (configuration_id);

-- Each photo of a job, in the order the message attached them: its queue message while it is
-- queued, the reads begun on it, and once read, what the model read from it, cut when the reading
-- stopped at the output cap.
create table private.assistant_job_photos (
  job_id uuid not null references private.assistant_jobs on delete cascade,
  position integer not null check (position between 1 and 50),
  photo_id uuid not null,
  message_id bigint,
  status text not null default 'queued'
    check (status in ('queued', 'read', 'failed', 'skipped', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  reading text check (char_length(reading) <= 50000),
  cut boolean,
  primary key (job_id, position),
  unique (job_id, photo_id),
  check ((status = 'queued') = (message_id is not null)),
  check (num_nulls(reading, cut) = case when status = 'read' then 0 else 2 end)
);

-- One read of one photo, the unit a job is charged in: begun under the user's assistant lock, and
-- once it ended its outcome and usage, all null or all set; no text. It outlives its job.
create table private.assistant_job_steps (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  job_id uuid references private.assistant_jobs on delete set null,
  position integer not null check (position between 1 and 50),
  plan text not null,
  configuration_id bigint not null references private.assistant_configurations,
  created_at timestamptz not null default now(),
  outcome text check (outcome in ('ok', 'cut', 'model_error', 'time_limit', 'unreadable')),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  latency_ms integer check (latency_ms >= 0),
  check (num_nulls(outcome, input_tokens, output_tokens, reasoning_tokens, latency_ms) in (0, 5))
);

create index assistant_job_steps_user_id_created_at
  on private.assistant_job_steps (user_id, created_at);
create index assistant_job_steps_job_id on private.assistant_job_steps (job_id);
create index assistant_job_steps_configuration_id
  on private.assistant_job_steps (configuration_id);

alter table private.assistant_jobs enable row level security;
alter table private.assistant_job_photos enable row level security;
alter table private.assistant_job_steps enable row level security;
revoke all on private.assistant_jobs, private.assistant_job_photos, private.assistant_job_steps
  from public, anon, authenticated, service_role;

-- The tokens charged to [user_id] today in Asia/Seoul: each recorded message's and each recorded
-- job step's input and output tokens, the output including reasoning. A message or step not yet
-- recorded is charged nothing.
create or replace function private.assistant_tokens_today(user_id uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (
    select coalesce(sum(m.input_tokens::bigint + m.output_tokens), 0)
    from private.assistant_messages as m
    where m.user_id = assistant_tokens_today.user_id
      and m.created_at >= date_trunc('day', now(), 'Asia/Seoul')
  ) + (
    select coalesce(sum(s.input_tokens::bigint + s.output_tokens), 0)
    from private.assistant_job_steps as s
    where s.user_id = assistant_tokens_today.user_id
      and s.created_at >= date_trunc('day', now(), 'Asia/Seoul')
  );
$$;

-- Ends [job_id] as done once it is running and none of its photos is queued.
create function private.end_assistant_job_if_read(job_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  update private.assistant_jobs as j set status = 'done', finished_at = now()
  where j.id = end_assistant_job_if_read.job_id and j.status = 'running'
    and not exists (select from private.assistant_job_photos as p
      where p.job_id = j.id and p.status = 'queued');
$$;

-- Starts a job over [photo_ids], each an object of [user_id]'s in the bucket, for the assistant
-- configuration serving the user, as `begin_assistant_message` resolves it, under the user's
-- assistant lock. `outcome` is `started`; `unavailable` when its provider has no key; `rate_limited`
-- when the day's tokens charged have reached the budget; `busy` while another job of the user runs;
-- `bad_photos` for none, over 50 or a photo twice; `missing_photos` when one is not uploaded. No
-- row while the plan has no configuration or budget row.
create function public.start_assistant_job(
  user_id uuid, job_id uuid, photo_ids uuid[], instructions text
)
returns table (outcome text, plan text, token_budget bigint, tokens_used bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitled text;
  admin boolean;
  config private.assistant_configurations;
  budget bigint;
  charged bigint;
  verdict text;
  photo uuid;
  place integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(start_assistant_job.user_id::text, 7));
  select e.plan into entitled from private.entitlement_of(start_assistant_job.user_id) as e;
  if not found then
    return;
  end if;
  admin := exists (
    select from private.admins as a where a.user_id = start_assistant_job.user_id);
  select c.* into config
  from private.assistant_configuration_labels as l
  join private.assistant_configurations as c on c.id = l.configuration_id
  where l.plan = entitled and (l.label = 'active' or (l.label = 'test' and admin))
  order by l.label = 'test' desc
  limit 1;
  if not found then
    return;
  end if;
  select b.daily_tokens into budget from private.assistant_token_budgets as b
    where b.plan = entitled;
  if not found then
    return;
  end if;
  charged := private.assistant_tokens_today(start_assistant_job.user_id);
  if not exists (select from private.provider_keys as k where k.provider = config.provider) then
    verdict := 'unavailable';
  elsif budget is not null and charged >= budget then
    verdict := 'rate_limited';
  elsif exists (select from private.assistant_jobs as j
      where j.user_id = start_assistant_job.user_id and j.status = 'running') then
    verdict := 'busy';
  elsif coalesce(cardinality(photo_ids), 0) not between 1 and 50
      or (select count(distinct p) from unnest(photo_ids) as p) <> cardinality(photo_ids)
      or array_position(photo_ids, null) is not null then
    verdict := 'bad_photos';
  elsif exists (select from unnest(photo_ids) as p
      where not exists (select from storage.objects as o
        where o.bucket_id = 'assistant-photos'
          and o.name = start_assistant_job.user_id::text || '/' || p::text)) then
    verdict := 'missing_photos';
  else
    verdict := 'started';
    insert into private.assistant_jobs (id, user_id, plan, configuration_id, instructions)
      values (start_assistant_job.job_id, start_assistant_job.user_id, entitled, config.id,
        start_assistant_job.instructions);
    foreach photo in array photo_ids loop
      place := place + 1;
      insert into private.assistant_job_photos (job_id, position, photo_id, message_id)
        values (start_assistant_job.job_id, place, photo,
          (select pgmq.send('assistant_photo_reads',
            jsonb_build_object('job_id', start_assistant_job.job_id, 'position', place))));
    end loop;
  end if;
  return query select verdict, entitled, budget, charged;
end;
$$;

-- Takes the next photo to read off the queue and begins its step, under its user's assistant lock,
-- hiding its message for 150 s, past a step's 60 s and its record. `outcome` is `step`, with what
-- the read needs; or `empty`, with `pending` the messages still queued, hidden ones included.
-- A message whose photo is no longer queued is deleted. A user's steps run three at a time: a
-- fourth is hidden for 5 s. A photo whose job's plan has spent the day's budget is skipped, and one
-- begun three times is failed.
create function public.next_assistant_job_step()
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

-- Records how [step_id]'s read ended and what it used, once, under its user's assistant lock, which
-- charges it: a step already recorded or never begun raises P0002. A photo still queued is read on
-- `ok` or `cut`, keeping [reading]; failed on `unreadable` or on its third read; and otherwise
-- shown again on the queue in 10 s. Answers the photo's status and the job's.
create function public.finish_assistant_job_step(
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

-- Cancels [user_id]'s running job [job_id] under the user's assistant lock: its queued photos are
-- cancelled and their messages deleted; a read in flight is still charged when it ends. Answers the
-- job's status after, `cancelled`, or `done` or `cancelled` as it had ended; null when the user has
-- no such job.
create function public.cancel_assistant_job(user_id uuid, job_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  job private.assistant_jobs;
begin
  perform pg_advisory_xact_lock(hashtextextended(cancel_assistant_job.user_id::text, 7));
  select j.* into job from private.assistant_jobs as j
    where j.id = cancel_assistant_job.job_id and j.user_id = cancel_assistant_job.user_id;
  if not found then
    return null;
  end if;
  if job.status <> 'running' then
    return job.status;
  end if;
  perform pgmq.delete('assistant_photo_reads', array(
    select p.message_id from private.assistant_job_photos as p
    where p.job_id = job.id and p.status = 'queued'));
  update private.assistant_job_photos as p set status = 'cancelled', message_id = null
    where p.job_id = job.id and p.status = 'queued';
  update private.assistant_jobs as j set status = 'cancelled', finished_at = now()
    where j.id = job.id;
  return 'cancelled';
end;
$$;

-- [user_id]'s job [job_id]: its status, when it started, ended and last began a read, and each
-- photo in order with its status, reads begun, and its reading once read. No row when the user has
-- no such job.
create function public.assistant_job(user_id uuid, job_id uuid)
returns table (
  status text, created_at timestamptz, finished_at timestamptz, last_step_at timestamptz,
  photos jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.status, j.created_at, j.finished_at,
    (select max(s.created_at) from private.assistant_job_steps as s where s.job_id = j.id),
    (select coalesce(jsonb_agg(jsonb_build_object(
        'position', p.position, 'photo_id', p.photo_id, 'status', p.status,
        'attempts', p.attempts, 'cut', p.cut, 'reading', p.reading) order by p.position), '[]')
      from private.assistant_job_photos as p where p.job_id = j.id)
  from private.assistant_jobs as j
  where j.id = assistant_job.job_id and j.user_id = assistant_job.user_id;
$$;

-- Deletes the jobs begun more than 7 days ago, their photos and readings with them, and the
-- messages any still had queued; their steps stay, with no job.
create function private.purge_assistant_jobs() returns void
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

revoke all on function private.end_assistant_job_if_read(uuid),
  private.purge_assistant_jobs()
  from public, anon, authenticated;
revoke all on function public.start_assistant_job(uuid, uuid, uuid[], text),
  public.next_assistant_job_step(),
  public.finish_assistant_job_step(bigint, text, integer, integer, integer, integer, text),
  public.cancel_assistant_job(uuid, uuid),
  public.assistant_job(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_assistant_job(uuid, uuid, uuid[], text),
  public.next_assistant_job_step(),
  public.finish_assistant_job_step(bigint, text, integer, integer, integer, integer, text),
  public.cancel_assistant_job(uuid, uuid),
  public.assistant_job(uuid, uuid)
  to service_role;

-- 18:30 UTC, 03:30 in Korea, after the tombstone purge; pg_cron reads the schedule in GMT.
select cron.schedule('purge-assistant-jobs', '30 18 * * *',
  'select private.purge_assistant_jobs()');

-- The revert in the header.
create function private.revert_assistant_photo_jobs() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  perform cron.unschedule('purge-assistant-jobs');
  drop function private.purge_assistant_jobs();
  drop function public.assistant_job(uuid, uuid);
  drop function public.cancel_assistant_job(uuid, uuid);
  drop function public.finish_assistant_job_step(bigint, text, integer, integer, integer, integer,
    text);
  drop function public.next_assistant_job_step();
  drop function public.start_assistant_job(uuid, uuid, uuid[], text);
  drop function private.end_assistant_job_if_read(uuid);
  execute $sql$
    create or replace function private.assistant_tokens_today(user_id uuid) returns bigint
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select coalesce(sum(m.input_tokens::bigint + m.output_tokens), 0)::bigint
      from private.assistant_messages as m
      where m.user_id = assistant_tokens_today.user_id
        and m.created_at >= date_trunc('day', now(), 'Asia/Seoul');
    $$
  $sql$;
  drop table private.assistant_job_steps;
  drop table private.assistant_job_photos;
  drop table private.assistant_jobs;
  perform pgmq.drop_queue('assistant_photo_reads');
  drop policy assistant_photos_not_suspended_insert on storage.objects;
  drop policy assistant_photos_delete on storage.objects;
  drop policy assistant_photos_select on storage.objects;
  drop policy assistant_photos_insert on storage.objects;
end;
$revert$;

revoke all on function private.revert_assistant_photo_jobs() from public, anon, authenticated;
