-- 말랑이's photo jobs (#750, ADR 0198): the chat photos' bucket and its owner rule; a job started
-- over uploaded photos alone, one at a time a user, and refused without a key or budget; its
-- photos taken off the queue three at a time a user, each read a step charged under the user's
-- lock; a failed read retried and failed on its third, a photo past the budget skipped; a job done
-- once none is queued, and cancelled; the snapshot its owner alone reads; the purge; no client
-- reaching the tables or the functions; and the revert.
begin;
select plan(53);

delete from private.assistant_configuration_labels where label = 'test';

-- A is an admin, B is on Free.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

create function pg_temp.photo(n int) returns uuid language sql immutable as $$
  select ('e0000000-0000-4000-8000-00000000000' || n)::uuid;
$$;
create function pg_temp.job(n int) returns uuid language sql immutable as $$
  select ('f0000000-0000-4000-8000-00000000000' || n)::uuid;
$$;
create function pg_temp.b() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000000b'::uuid;
$$;

-- Starts a job of B's over [photos] as service_role does.
create function pg_temp.start(job uuid, photos uuid[]) returns text language plpgsql as $$
declare
  verdict text;
begin
  perform set_config('role', 'service_role', true);
  select s.outcome into verdict
    from public.start_assistant_job(pg_temp.b(), job, photos, '1단원만, 표는 표로') as s;
  perform set_config('role', 'none', true);
  return verdict;
end;
$$;

-- The next step as service_role takes it: its outcome, the photo's position and the step's id.
create function pg_temp.next()
returns table (outcome text, pending bigint, step_id bigint, photo_position integer,
  attempt integer)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select n.outcome, n.pending, n.step_id, n.photo_position, n.attempt
    from public.next_assistant_job_step() as n;
  perform set_config('role', 'none', true);
end;
$$;

-- Records [step] as service_role does: 1,000 tokens in and 200 out.
create function pg_temp.finish(step bigint, outcome text)
returns table (photo_status text, job_status text) language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select f.photo_status, f.job_status
    from public.finish_assistant_job_step(step, outcome, 1000, 200, 0, 3000,
      case when outcome in ('ok', 'cut') then '# 1단원' end) as f;
  perform set_config('role', 'none', true);
end;
$$;

-- Shows [job]'s message for [position] on the queue now, as its hiding would have ended.
create function pg_temp.show(job uuid, place int) returns void language sql as $$
  select pgmq.set_vt('assistant_photo_reads', p.message_id, 0)
  from private.assistant_job_photos as p where p.job_id = job and p.position = place;
$$;

create function pg_temp.statuses(job uuid) returns text[] language sql stable as $$
  select array_agg(p.status order by p.position) from private.assistant_job_photos as p
  where p.job_id = job;
$$;

create function pg_temp.queued() returns bigint language sql stable as $$
  select queue_length from pgmq.metrics('assistant_photo_reads');
$$;

grant execute on all functions in schema pg_temp to public;

-- The bucket.

select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets
    where id = 'assistant-photos'$$,
  $$values (false, 6291456::bigint, array['image/jpeg', 'image/png', 'image/webp'])$$,
  'the bucket is private and takes photo import''s types and size');

insert into storage.objects (bucket_id, name) values
  ('assistant-photos', '00000000-0000-4000-8000-00000000000a/' || pg_temp.photo(9));
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    select 'assistant-photos', '00000000-0000-4000-8000-00000000000b/' || pg_temp.photo(n)
    from generate_series(1, 5) as n$$,
  'the owner uploads photos into its folder, each under a uuid');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('assistant-photos', '00000000-0000-4000-8000-00000000000a/' || pg_temp.photo(8))$$,
  '42501', null, 'no one uploads into another user''s folder');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('assistant-photos', '00000000-0000-4000-8000-00000000000b/page.jpg')$$,
  '42501', null, 'a photo named other than by a uuid is refused');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('assistant-photos', '00000000-0000-4000-8000-00000000000b/x/' || pg_temp.photo(8))$$,
  '42501', null, 'a photo in a folder below the owner''s is refused');
select results_eq(
  $$select count(*)::int from storage.objects where bucket_id = 'assistant-photos'$$,
  $$values (5)$$, 'the owner reads its own photos and none of another user''s');
reset role;
insert into private.suspensions (user_id, reason) values (pg_temp.b(), 'test');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values
    ('assistant-photos', '00000000-0000-4000-8000-00000000000b/' || pg_temp.photo(8))$$,
  '42501', null, 'a suspended user uploads no photo, where it uploaded before');
reset role;
delete from private.suspensions;

-- No client reaches the tables or the job functions.

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select throws_ok($$select * from private.assistant_jobs$$, '42501', null,
  'a signed-in user reads no job');
select throws_ok($$select * from private.assistant_job_steps$$, '42501', null,
  'a signed-in user reads no step');
select throws_ok(
  $$select * from public.start_assistant_job(pg_temp.b(), pg_temp.job(1), array[pg_temp.photo(1)], '')$$,
  '42501', null, 'a signed-in user starts no job');
select throws_ok($$select * from public.next_assistant_job_step()$$, '42501', null,
  'a signed-in user takes no step');
select throws_ok($$select * from public.assistant_job(pg_temp.b(), pg_temp.job(1))$$, '42501', null,
  'a signed-in user reads no job through the service function');
select throws_ok($$select public.cancel_assistant_job(pg_temp.b(), pg_temp.job(1))$$, '42501',
  null, 'a signed-in user cancels nothing through the service function');
reset role;
select results_eq(
  $$select p.proname::text collate "default", p.prosecdef and p.proconfig = array['search_path=""']
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.proname ~ 'assistant_job'
    order by p.proname$$,
  $$values ('assistant_job', true), ('cancel_assistant_job', true),
    ('end_assistant_job_if_read', true), ('finish_assistant_job_step', true),
    ('next_assistant_job_step', true), ('purge_assistant_jobs', true),
    ('start_assistant_job', true)$$,
  'every job function runs as its owner with an empty search_path');

-- Starting a job.

select is(pg_temp.start(pg_temp.job(1), array[pg_temp.photo(1)]), 'unavailable',
  'without the provider''s key in Vault no job starts');
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', gen_random_uuid(), '0000');
select is(pg_temp.start(pg_temp.job(1), array[pg_temp.photo(1), pg_temp.photo(8)]),
  'missing_photos', 'a photo not uploaded refuses the job');
select is(pg_temp.start(pg_temp.job(1), array[pg_temp.photo(1), pg_temp.photo(1)]),
  'bad_photos', 'a photo twice refuses the job');
select is(pg_temp.start(pg_temp.job(1), array[pg_temp.photo(9)]), 'missing_photos',
  'another user''s photo is not the user''s to read');
select is((select count(*) from private.assistant_jobs), 0::bigint, 'and none was recorded');
select is(
  pg_temp.start(pg_temp.job(1), array[pg_temp.photo(1), pg_temp.photo(2), pg_temp.photo(3),
    pg_temp.photo(4)]),
  'started', 'four uploaded photos start a job');
select results_eq(
  $$select j.plan, j.configuration_id = l.configuration_id, j.instructions, j.status,
      pg_temp.statuses(j.id), pg_temp.queued()
    from private.assistant_jobs as j
    join private.assistant_configuration_labels as l on l.plan = 'free' and l.label = 'active'$$,
  $$values ('free', true, '1단원만, 표는 표로', 'running',
    array['queued', 'queued', 'queued', 'queued'], 4::bigint)$$,
  'on the Free plan''s active configuration, each photo queued with a message');
select is(pg_temp.start(pg_temp.job(2), array[pg_temp.photo(5)]), 'busy',
  'a second job waits until the first ends');

-- Steps.

create temporary table steps as select * from pg_temp.next();
insert into steps select * from pg_temp.next();
insert into steps select * from pg_temp.next();
select results_eq($$select outcome, photo_position, attempt from steps order by photo_position$$,
  $$values ('step', 1, 1), ('step', 2, 1), ('step', 3, 1)$$,
  'three photos are taken off the queue in order, a step begun for each');
set local role service_role;
select results_eq(
  $$select n.outcome, n.pending, n.photo_id from public.next_assistant_job_step() as n$$,
  $$values ('empty', 4::bigint, null::uuid)$$,
  'a fourth waits while three of the user''s steps are in flight');
reset role;
select is(pg_temp.queued(), 4::bigint, 'and its message stays queued, hidden a moment');
select results_eq(
  $$select * from pg_temp.finish((select step_id from steps where photo_position = 1), 'ok')$$,
  $$values ('read', 'running')$$, 'a read photo is recorded read, the job still running');
select results_eq(
  $$select status, reading, cut from private.assistant_job_photos where position = 1$$,
  $$values ('read', '# 1단원', false)$$, 'with its reading');
select is(pg_temp.queued(), 3::bigint, 'and its message deleted');
select throws_ok(
  $$select * from pg_temp.finish((select step_id from steps where photo_position = 1), 'ok')$$,
  'P0002', null, 'a step is recorded once');
select pg_temp.show(pg_temp.job(1), 4);
create temporary table free_config as select c.provider, c.model
  from private.assistant_configuration_labels as l
  join private.assistant_configurations as c on c.id = l.configuration_id
  where l.plan = 'free' and l.label = 'active';
grant select on free_config to service_role;
set local role service_role;
select results_eq(
  $$select n.outcome, n.photo_position, n.provider, n.model, n.instructions, n.photo_id
    from public.next_assistant_job_step() as n$$,
  $$select 'step', 4, provider, model, '1단원만, 표는 표로', pg_temp.photo(4) from free_config$$,
  'once one ends the fourth is taken, read with the job''s configuration and instructions');
reset role;
select results_eq(
  $$select * from pg_temp.finish((select max(id) from private.assistant_job_steps), 'cut')$$,
  $$values ('read', 'running')$$, 'a reading cut at the output cap is kept as read');

-- A failed read is retried, and failed on its third.

select results_eq(
  $$select * from pg_temp.finish((select step_id from steps where photo_position = 2),
    'model_error')$$,
  $$values ('queued', 'running')$$, 'a failed read leaves the photo queued');
select pg_temp.show(pg_temp.job(1), 2);
insert into steps select * from pg_temp.next();
select * from pg_temp.finish((select max(step_id) from steps), 'time_limit');
select pg_temp.show(pg_temp.job(1), 2);
insert into steps select * from pg_temp.next();
select results_eq($$select attempt from steps where photo_position = 2 order by step_id$$,
  $$values (1), (2), (3)$$, 'and it is read again, each read counted');
select results_eq($$select * from pg_temp.finish((select max(step_id) from steps), 'model_error')$$,
  $$values ('failed', 'running')$$, 'the third failure fails it');
select results_eq(
  $$select * from pg_temp.finish((select step_id from steps where photo_position = 3),
    'unreadable')$$,
  $$values ('failed', 'done')$$,
  'a photo that cannot be read fails at once, and the job is done with none queued');
select results_eq(
  $$select status, finished_at is not null, pg_temp.queued() from private.assistant_jobs$$,
  $$values ('done', true, 0::bigint)$$, 'its end recorded and the queue empty');

-- The charge.

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select results_eq($$select tokens_used from public.assistant_allowance()$$,
  $$values (7200::bigint)$$, 'each recorded step is charged against the day''s budget');
reset role;

-- The snapshot.

set local role service_role;
select results_eq(
  $$select status, jsonb_path_query_array(photos, '$[*].status'),
      photos -> 0 ->> 'reading', photos -> 0 ->> 'photo_id'
    from public.assistant_job(pg_temp.b(), pg_temp.job(1))$$,
  $$values ('done', '["read", "failed", "failed", "read"]'::jsonb, '# 1단원',
    pg_temp.photo(1)::text)$$,
  'its owner reads the job, each photo in order with its reading');
select is_empty(
  $$select * from public.assistant_job('00000000-0000-4000-8000-00000000000a', pg_temp.job(1))$$,
  'and no other user reads it');
reset role;

-- Cancelling.

select is(pg_temp.start(pg_temp.job(2), array[pg_temp.photo(5), pg_temp.photo(1)]), 'started',
  'a next job starts once the first is done');
create temporary table flight as select * from pg_temp.next();
set local role service_role;
select is(public.cancel_assistant_job('00000000-0000-4000-8000-00000000000a', pg_temp.job(2)),
  null, 'no other user cancels it');
select is(public.cancel_assistant_job(pg_temp.b(), pg_temp.job(2)), 'cancelled',
  'its owner cancels it');
select is(public.cancel_assistant_job(pg_temp.b(), pg_temp.job(1)), 'done',
  'a job that ended stays as it ended');
reset role;
select results_eq(
  $$select pg_temp.statuses(pg_temp.job(2)), pg_temp.queued(),
      (select status from private.assistant_jobs where id = pg_temp.job(2))$$,
  $$values (array['cancelled', 'cancelled'], 0::bigint, 'cancelled')$$,
  'its queued photos are cancelled and their messages deleted');
select results_eq($$select * from pg_temp.finish((select step_id from flight), 'ok')$$,
  $$values ('cancelled', 'cancelled')$$, 'a read in flight ends on the cancelled job');
select is(
  (select input_tokens from private.assistant_job_steps where id = (select step_id from flight)),
  1000, 'and is still charged');

-- The budget.

select is(pg_temp.start(pg_temp.job(3), array[pg_temp.photo(5)]), 'started',
  'a job starts while the budget is not spent');
insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id,
    outcome, input_tokens, output_tokens, reasoning_tokens, latency_ms)
  select pg_temp.b(), null, 1, 'free', configuration_id, 'ok', 200000, 0, 0, 1
  from private.assistant_configuration_labels where plan = 'free' and label = 'active';
select results_eq($$select outcome, pending from pg_temp.next()$$,
  $$values ('empty', 0::bigint)$$, 'a photo past the day''s budget is taken off the queue');
select results_eq(
  $$select pg_temp.statuses(pg_temp.job(3)),
      (select status from private.assistant_jobs where id = pg_temp.job(3))$$,
  $$values (array['skipped'], 'done')$$, 'skipped, unread, and its job done');
select is(pg_temp.start(pg_temp.job(4), array[pg_temp.photo(5)]), 'rate_limited',
  'and no job starts with the budget spent');

-- The purge.

update private.assistant_jobs set created_at = now() - interval '8 days'
  where id = pg_temp.job(1);
select private.purge_assistant_jobs();
select results_eq(
  $$select array_agg(id order by id), (select count(*) from private.assistant_job_steps
      where job_id is null) from private.assistant_jobs$$,
  $$values (array[pg_temp.job(2), pg_temp.job(3)], 7::bigint)$$,
  'a job begun over 7 days ago is deleted with its photos, and its steps stay with no job');

-- The revert.

select lives_ok($$select private.revert_assistant_photo_jobs()$$, 'the revert runs');
select results_eq(
  $$select (select count(*) from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname like 'assistant_job%' and c.relkind = 'r'),
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like '%assistant_job%'),
    (select count(*) from pgmq.list_queues() where queue_name = 'assistant_photo_reads'),
    (select count(*) from pg_policies where policyname like 'assistant_photos%'),
    (select count(*) from cron.job where jobname = 'purge-assistant-jobs'),
    private.assistant_tokens_today(pg_temp.b())$$,
  $$values (0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint, 0::bigint)$$,
  'the tables, functions, queue, policies and cron job are gone, and steps no longer charged');

select * from finish();
rollback;
