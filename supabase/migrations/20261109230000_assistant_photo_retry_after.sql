-- A photo read refused with 429 or 529 waits for its provider's `Retry-After`, and a read that
-- failed on our side before its request was sent does not count as a read (#816, ADR 0221).
--
-- `public.finish_assistant_job_step` takes a last argument, `retry_after_seconds`, null by
-- default. When the photo goes back on the queue, it is shown again after that many seconds, at
-- least 1 and at most 300, instead of after 30 s, or 120 s once read twice; with it null the
-- schedule of ADR 0218 holds. The worker computes the seconds from the header, which is seconds
-- or an HTTP date, and sends it for a 429 or 529 alone.
--
-- A step's outcome `not_sent` is a read that failed before its request was sent, through no fault
-- of the photo: no key for the provider, or Storage failing to sign its address. It is charged
-- nothing, and gives its read back: the photo's `attempts` goes down by the one `next_assistant_job_step`
-- added, so a missing key does not use up the photo's three reads. It is given back while the
-- photo has at most 3 steps of that outcome, this one included; the fourth counts as a read, as
-- every failed read does, so a persistent failure ends in 3 + 3 reads and the job still ends.
-- The retry's delay follows the reads begun as before.
--
-- Revert, run once against production before `private.revert_assistant_photo_charges()` if that
-- is run too: `select private.revert_assistant_photo_retry_after();`, then
-- `drop function private.revert_assistant_photo_retry_after();`. It puts `finish_assistant_job_step`
-- back as `20261109170000_assistant_photo_job_cleanup.sql` made it, and the steps of outcome
-- `not_sent` become `model_error`. It changes no row otherwise.

alter table private.assistant_job_steps drop constraint assistant_job_steps_outcome_check;
alter table private.assistant_job_steps add constraint assistant_job_steps_outcome_check
  check (outcome in ('ok', 'cut', 'model_error', 'time_limit', 'unreadable', 'not_sent'));

drop function public.finish_assistant_job_step(bigint, text, integer, integer, integer, integer, text);

-- Records how [step_id]'s read ended and what it used, once, under its user's assistant lock, which
-- charges it: a step already recorded or never begun raises P0002. A photo still queued is read on
-- `ok` or `cut`, keeping [reading]; failed on `unreadable` or on its third read; and otherwise
-- shown again on the queue after [retry_after_seconds] (1 to 300), or when it is null after 30 s,
-- or 120 s once read twice. A `not_sent` read gives its read back, at most 3 times a photo.
-- Answers the photo's status and the job's.
create function public.finish_assistant_job_step(
  step_id bigint, outcome text, input_tokens integer, output_tokens integer,
  reasoning_tokens integer, latency_ms integer, reading text,
  retry_after_seconds integer default null
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
  given_back boolean;
  delay integer;
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
    given_back := finish_assistant_job_step.outcome = 'not_sent'
      and (select count(*) from private.assistant_job_steps as s
        where s.job_id = step.job_id and s.position = step.position
          and s.outcome = 'not_sent') <= 3;
    delay := case
      when finish_assistant_job_step.retry_after_seconds is not null
        then least(greatest(finish_assistant_job_step.retry_after_seconds, 1), 300)
      when photo.attempts <= 1 then 30
      else 120
    end;
    if finish_assistant_job_step.outcome in ('ok', 'cut') then
      update private.assistant_job_photos as p
        set status = 'read', message_id = null, reading = finish_assistant_job_step.reading,
          cut = finish_assistant_job_step.outcome = 'cut'
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', photo.message_id);
    elsif finish_assistant_job_step.outcome = 'unreadable' then
      update private.assistant_job_photos as p set status = 'failed', message_id = null
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', photo.message_id);
    elsif given_back then
      update private.assistant_job_photos as p set attempts = p.attempts - 1
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.set_vt('assistant_photo_reads', photo.message_id, delay);
    elsif photo.attempts >= 3 then
      update private.assistant_job_photos as p set status = 'failed', message_id = null
        where p.job_id = photo.job_id and p.position = photo.position;
      perform pgmq.delete('assistant_photo_reads', photo.message_id);
    else
      perform pgmq.set_vt('assistant_photo_reads', photo.message_id, delay);
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

revoke all on function public.finish_assistant_job_step(
  bigint, text, integer, integer, integer, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.finish_assistant_job_step(
  bigint, text, integer, integer, integer, integer, text, integer
) to service_role;

-- The revert in the header.
create function private.revert_assistant_photo_retry_after() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  update private.assistant_job_steps set outcome = 'model_error' where outcome = 'not_sent';
  alter table private.assistant_job_steps drop constraint assistant_job_steps_outcome_check;
  alter table private.assistant_job_steps add constraint assistant_job_steps_outcome_check
    check (outcome in ('ok', 'cut', 'model_error', 'time_limit', 'unreadable'));
  drop function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text, integer);
  execute $sql$
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
  $sql$;
  revoke all on function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text
  ) from public, anon, authenticated;
  grant execute on function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text
  ) to service_role;
end;
$revert$;

revoke all on function private.revert_assistant_photo_retry_after() from public, anon, authenticated;
