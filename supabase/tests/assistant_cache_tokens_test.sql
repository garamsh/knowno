-- The cache tokens 말랑이's record keeps (#1028): a message's and a photo read's input tokens read
-- from and written to the provider's prompt cache, recorded with the rest by the two finish
-- functions; 0 where a caller sends none; refused below 0; no more charge than before, for they are
-- parts of the input tokens; no client reaching either function; and the revert.
begin;
select plan(15);

insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days');

create function pg_temp.b() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000000b'::uuid;
$$;

-- One message and one read step of B's, begun and not recorded.
insert into private.assistant_messages (user_id, plan, configuration_id)
  select pg_temp.b(), 'free', configuration_id
  from private.assistant_configuration_labels where plan = 'free' and label = 'active';
insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id)
  select pg_temp.b(), null, 1, 'free', configuration_id
  from private.assistant_configuration_labels where plan = 'free' and label = 'active';

select results_eq(
  $$select cache_read_tokens, cache_write_tokens from private.assistant_messages
    union all select cache_read_tokens, cache_write_tokens from private.assistant_job_steps$$,
  $$values (0, 0), (0, 0)$$,
  'a row begun and not recorded holds 0 cache tokens');

-- Records the message as service_role does, with [cache_read] and [cache_write] sent or not.
create function pg_temp.finish_message(cache_read integer, cache_write integer)
returns void language plpgsql as $$
declare
  id bigint := (select max(m.id) from private.assistant_messages as m);
begin
  perform set_config('role', 'service_role', true);
  if cache_read is null then
    perform public.finish_assistant_message(id, 'ok', 2, 3000, 400, 50, 1, 4200);
  else
    perform public.finish_assistant_message(id, 'ok', 2, 3000, 400, 50, 1, 4200,
      cache_read, cache_write);
  end if;
  perform set_config('role', 'none', true);
end;
$$;

select throws_ok($$select pg_temp.finish_message(-1, 0)$$, '23514', null,
  'a message is not recorded with fewer than 0 cache tokens read');
select throws_ok($$select pg_temp.finish_message(0, -1)$$, '23514', null,
  'nor with fewer than 0 written');
select lives_ok($$select pg_temp.finish_message(2500, 300)$$,
  'service_role records a message with the cache tokens it read and wrote');
select results_eq(
  $$select outcome, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    from private.assistant_messages$$,
  $$values ('ok', 3000, 400, 2500, 300)$$,
  'they are kept beside the rest of what it used');
select is(private.assistant_tokens_today(pg_temp.b()), 3400::bigint,
  'and the day is charged its input and output tokens alone, the cache tokens being parts of the input');

insert into private.assistant_messages (user_id, plan, configuration_id)
  select pg_temp.b(), 'free', configuration_id
  from private.assistant_configuration_labels where plan = 'free' and label = 'active';
select lives_ok($$select pg_temp.finish_message(null, null)$$,
  'a caller that sends no cache tokens records the message as before');
select results_eq(
  $$select cache_read_tokens, cache_write_tokens from private.assistant_messages
    order by id desc limit 1$$,
  $$values (0, 0)$$, 'with 0 of each');

-- Records the read step as service_role does, the photo of no job.
create function pg_temp.finish_step(cache_read integer, cache_write integer)
returns void language plpgsql as $$
declare
  id bigint := (select max(s.id) from private.assistant_job_steps as s);
begin
  perform set_config('role', 'service_role', true);
  if cache_read is null then
    perform public.finish_assistant_job_step(id, 'model_error', 4784, 10, 0, 3000, null);
  else
    perform public.finish_assistant_job_step(id, 'model_error', 4784, 10, 0, 3000, null,
      null, cache_read, cache_write);
  end if;
  perform set_config('role', 'none', true);
end;
$$;

select throws_ok($$select pg_temp.finish_step(-1, 0)$$, '23514', null,
  'a read is not recorded with fewer than 0 cache tokens read');
select lives_ok($$select pg_temp.finish_step(4000, 700)$$,
  'service_role records a read with the cache tokens it read and wrote');
select results_eq(
  $$select outcome, input_tokens, cache_read_tokens, cache_write_tokens
    from private.assistant_job_steps$$,
  $$values ('model_error', 4784, 4000, 700)$$,
  'they are kept beside the rest of what it used');

set local role anon;
select throws_ok($$select public.finish_assistant_message(1, 'ok', 1, 1, 1, 0, 0, 1, 0, 0)$$,
  '42501', null, 'no client records a message');
select throws_ok(
  $$select public.finish_assistant_job_step(1, 'ok', 1, 1, 0, 1, null, null, 0, 0)$$,
  '42501', null, 'or a read');
reset role;

-- The revert puts both functions back with their eight and eight arguments, and drops the columns.
select lives_ok($$select private.revert_assistant_cache_tokens()$$, 'the revert runs');
select results_eq(
  $$select (select count(*) from information_schema.columns
      where table_schema = 'private' and column_name like 'cache\_%\_tokens'
        and table_name in ('assistant_messages', 'assistant_job_steps')),
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('finish_assistant_message', 'finish_assistant_job_step')),
    (select p.pronargs from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finish_assistant_message'),
    (select p.pronargs from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'finish_assistant_job_step'),
    private.assistant_tokens_today(pg_temp.b())$$,
  $$values (0::bigint, 2::bigint, 8::smallint, 8::smallint, 3400::bigint + 4794 + 3400)$$,
  'the columns are gone, each function is back with its earlier arguments, and the charge is the same');

select * from finish();
rollback;
