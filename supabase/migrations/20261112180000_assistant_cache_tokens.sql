-- 말랑이's record keeps the input tokens its provider read from its prompt cache and wrote to it
-- (#1028, ADR 0195's record): a message's, and a photo read's.
--
-- `private.assistant_messages` and `private.assistant_job_steps` each get `cache_read_tokens` and
-- `cache_write_tokens`, integers from 0, not null, 0 by default, so a row that existed before them
-- and a row begun and not yet recorded read 0. Both are parts of `input_tokens`, which already
-- holds every input token the provider counted, so the charge `private.assistant_tokens_today`
-- sums, the budgets and every limit stay as they were: nothing here is charged or refused.
--
-- `public.finish_assistant_message` and `public.finish_assistant_job_step` take two trailing
-- arguments, `cache_read_tokens` and `cache_write_tokens`, 0 by default, and record them with the
-- rest. A caller that sends neither, the earlier function bundle or the sweeper's
-- `finish_assistant_job_step` calls in SQL, records 0. Each function is dropped and made again with
-- its other arguments and body as they were, for a new argument changes its signature.
--
-- Revert, run once against production: `select private.revert_assistant_cache_tokens();`, then
-- `drop function private.revert_assistant_cache_tokens();`. It puts the two functions back as
-- `20261105090000_assistant_tokens.sql` and `20261109230000_assistant_photo_retry_after.sql` made
-- them and drops the four columns with the counts in them, and changes no other row.

alter table private.assistant_messages
  add column cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  add column cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0);

alter table private.assistant_job_steps
  add column cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  add column cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0);

drop function public.finish_assistant_message(
  bigint, text, integer, integer, integer, integer, integer, integer);

-- Records how [message_id]'s turn ended and what it used, once, under its user's assistant lock,
-- which charges it: a message already recorded or never begun raises P0002.
create function public.finish_assistant_message(
  message_id bigint, outcome text, model_calls integer, input_tokens integer,
  output_tokens integer, reasoning_tokens integer, web_search_requests integer, latency_ms integer,
  cache_read_tokens integer default 0, cache_write_tokens integer default 0
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select m.user_id into owner from private.assistant_messages as m
    where m.id = finish_assistant_message.message_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(owner::text, 7));
  end if;
  update private.assistant_messages as m
    set outcome = finish_assistant_message.outcome,
      model_calls = finish_assistant_message.model_calls,
      input_tokens = finish_assistant_message.input_tokens,
      output_tokens = finish_assistant_message.output_tokens,
      reasoning_tokens = finish_assistant_message.reasoning_tokens,
      web_search_requests = finish_assistant_message.web_search_requests,
      latency_ms = finish_assistant_message.latency_ms,
      cache_read_tokens = finish_assistant_message.cache_read_tokens,
      cache_write_tokens = finish_assistant_message.cache_write_tokens
    where m.id = finish_assistant_message.message_id and m.outcome is null;
  if not found then
    raise exception 'no unrecorded assistant message %', finish_assistant_message.message_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.finish_assistant_message(
  bigint, text, integer, integer, integer, integer, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.finish_assistant_message(
  bigint, text, integer, integer, integer, integer, integer, integer, integer, integer
) to service_role;

drop function public.finish_assistant_job_step(
  bigint, text, integer, integer, integer, integer, text, integer);

-- Records how [step_id]'s read ended and what it used, once, under its user's assistant lock, which
-- charges it: a step already recorded or never begun raises P0002. A photo still queued is read on
-- `ok` or `cut`, keeping [reading]; failed on `unreadable` or on its third read; and otherwise
-- shown again on the queue after [retry_after_seconds] (1 to 300), or when it is null after 30 s,
-- or 120 s once read twice. A `not_sent` read gives its read back, at most 3 times a photo.
-- Answers the photo's status and the job's.
create function public.finish_assistant_job_step(
  step_id bigint, outcome text, input_tokens integer, output_tokens integer,
  reasoning_tokens integer, latency_ms integer, reading text,
  retry_after_seconds integer default null,
  cache_read_tokens integer default 0, cache_write_tokens integer default 0
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
      latency_ms = finish_assistant_job_step.latency_ms,
      cache_read_tokens = finish_assistant_job_step.cache_read_tokens,
      cache_write_tokens = finish_assistant_job_step.cache_write_tokens
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
  bigint, text, integer, integer, integer, integer, text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.finish_assistant_job_step(
  bigint, text, integer, integer, integer, integer, text, integer, integer, integer
) to service_role;

-- The revert in the header.
create function private.revert_assistant_cache_tokens() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  drop function public.finish_assistant_message(
    bigint, text, integer, integer, integer, integer, integer, integer, integer, integer);
  drop function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text, integer, integer, integer);
  alter table private.assistant_messages
    drop column cache_read_tokens, drop column cache_write_tokens;
  alter table private.assistant_job_steps
    drop column cache_read_tokens, drop column cache_write_tokens;
  execute $sql$
    create function public.finish_assistant_message(
      message_id bigint, outcome text, model_calls integer, input_tokens integer,
      output_tokens integer, reasoning_tokens integer, web_search_requests integer,
      latency_ms integer
    ) returns void
    language plpgsql
    security definer
    set search_path = ''
    as $$
    declare
      owner uuid;
    begin
      select m.user_id into owner from private.assistant_messages as m
        where m.id = finish_assistant_message.message_id;
      if found then
        perform pg_advisory_xact_lock(hashtextextended(owner::text, 7));
      end if;
      update private.assistant_messages as m
        set outcome = finish_assistant_message.outcome,
          model_calls = finish_assistant_message.model_calls,
          input_tokens = finish_assistant_message.input_tokens,
          output_tokens = finish_assistant_message.output_tokens,
          reasoning_tokens = finish_assistant_message.reasoning_tokens,
          web_search_requests = finish_assistant_message.web_search_requests,
          latency_ms = finish_assistant_message.latency_ms
        where m.id = finish_assistant_message.message_id and m.outcome is null;
      if not found then
        raise exception 'no unrecorded assistant message %', finish_assistant_message.message_id
          using errcode = 'P0002';
      end if;
    end;
    $$;
  $sql$;
  revoke all on function public.finish_assistant_message(
    bigint, text, integer, integer, integer, integer, integer, integer
  ) from public, anon, authenticated;
  grant execute on function public.finish_assistant_message(
    bigint, text, integer, integer, integer, integer, integer, integer
  ) to service_role;
  execute $sql$
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
  $sql$;
  revoke all on function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text, integer
  ) from public, anon, authenticated;
  grant execute on function public.finish_assistant_job_step(
    bigint, text, integer, integer, integer, integer, text, integer
  ) to service_role;
end;
$revert$;

revoke all on function private.revert_assistant_cache_tokens() from public, anon, authenticated;
