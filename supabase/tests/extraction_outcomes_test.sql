-- Each extraction's outcome (ADR 0130): begin_extraction names the usage row it recorded,
-- finish_extraction records the outcome on its call once and only when its parts agree, no client
-- reads or writes the records, and only an admin reads the recent calls and each day's failures.
begin;
select plan(24);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

-- A is an admin, B a signed-in user who is not.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- Begins one photo of B as extract-cards does, answering the usage row begin_extraction names.
create function pg_temp.begin_b() returns bigint language plpgsql as $$
declare
  usage bigint;
begin
  perform set_config('role', 'service_role', true);
  select b.usage_id into usage
    from public.begin_extraction('00000000-0000-4000-8000-00000000000b') as b;
  perform set_config('role', 'none', true);
  return usage;
end;
$$;
grant execute on function pg_temp.begin_b() to public;

create temp table photos (n integer primary key, usage_id bigint not null);
grant all on photos to public;
insert into photos select n, pg_temp.begin_b() from generate_series(1, 5) as n;

select results_eq(
  $$select p.usage_id from photos as p join public.extraction_usage as u on u.id = p.usage_id
    join private.extraction_calls as c on c.usage_id = p.usage_id order by p.n$$,
  $$select id from public.extraction_usage
    where user_id = '00000000-0000-4000-8000-00000000000b' order by id$$,
  'begin_extraction names the usage row and the call it recorded for each photo');
select is(
  (select count(*) from private.extraction_calls where outcome is null), 5::bigint,
  'a begun call has no outcome yet');

-- The finishes extract-cards sends: a first call answered, a retry answered, a photo with no cards,
-- one failed twice, and one timed out past the retry limit.
set local role service_role;
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 1), 'ok', 1, 4200, 12, 1, '{}')$$,
  'service_role records an answered call');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 2), 'ok', 2, 30500, 8, 0,
    '{invalid_output}')$$,
  'and one a retry answered');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 3), 'no_cards', 1, 3000, 0, 0, '{}')$$,
  'and a photo with no cards');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 4), 'invalid_output', 2, 41000, 0, 3,
    '{model_error,invalid_output}')$$,
  'and one that failed twice');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 1), 'ok', 1, 1, 1, 0, '{}')$$,
  'P0002', null, 'a call is recorded once');
select throws_ok(
  $$select public.finish_extraction(-1, 'ok', 1, 1, 1, 0, '{}')$$,
  'P0002', null, 'and only when begin_extraction recorded it');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 5), 'ok', 2, 1, 1, 0, '{}')$$,
  '23514', null, 'a retried call that names no failure is refused');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 5), 'model_error', 1, 1, 0, 0,
    '{rate_limit}')$$,
  '23514', null, 'and so is an unknown failure');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 5), 'model_error', 1, 1, 2, 0,
    '{timeout}')$$,
  '23514', null, 'and a failure that returned cards');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 5), 'model_error', 1, 75000, 0, 0,
    '{timeout}')$$,
  'control: the same call with agreeing parts is recorded');
select throws_ok(
  $$update private.extraction_calls set outcome = 'ok'$$,
  '42501', null, 'service_role writes no outcome but through finish_extraction');
reset role;

select results_eq(
  $$select p.n, c.outcome, c.attempts, c.latency_ms, c.cards_returned, c.cards_dropped, c.failures
    from photos as p join private.extraction_calls as c using (usage_id) order by p.n$$,
  $$values (1, 'ok', 1::smallint, 4200, 12, 1, '{}'::text[]),
           (2, 'ok', 2::smallint, 30500, 8, 0, '{invalid_output}'::text[]),
           (3, 'no_cards', 1::smallint, 3000, 0, 0, '{}'::text[]),
           (4, 'invalid_output', 2::smallint, 41000, 0, 3, '{model_error,invalid_output}'::text[]),
           (5, 'model_error', 1::smallint, 75000, 0, 0, '{timeout}'::text[])$$,
  'each call holds the outcome recorded for it');

-- No client reads or writes the records, or records an outcome.
select pg_temp.sign_in('b');
select throws_ok('select * from private.extraction_calls', '42501', null,
  'a signed-in user reads no call record');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 1), 'ok', 1, 1, 1, 0, '{}')$$,
  '42501', null, 'nor records an outcome');
select throws_ok($$select * from public.admin_extraction_calls()$$, '42501', null,
  'a signed-in user who is not an admin reads no recent calls');
select throws_ok($$select * from public.admin_extraction_failures()$$, '42501', null,
  'nor the failures by day');
reset role;
select pg_temp.sign_in(null);
select throws_ok('select * from private.extraction_calls', '42501', null, 'anon reads no call record');
select throws_ok($$select * from public.admin_extraction_calls()$$, '42501', null,
  'nor the recent calls');
select throws_ok($$select * from public.admin_extraction_failures()$$, '42501', null,
  'nor the failures');
reset role;

-- An admin reads them: the recent calls newest first, paged, and today's failures by version.
select pg_temp.sign_in('a');
select results_eq(
  $$select usage_id, user_id, outcome, attempts, failures from public.admin_extraction_calls(null, 2)$$,
  $$select usage_id, '00000000-0000-4000-8000-00000000000b'::uuid, outcome, attempts, failures
    from photos
    join (values (5, 'model_error', 1::smallint, '{timeout}'::text[]),
                 (4, 'invalid_output', 2::smallint, '{model_error,invalid_output}'::text[]))
      as recorded (n, outcome, attempts, failures) using (n)
    order by usage_id desc$$,
  'an admin reads the newest calls first, a page at a time');
select results_eq(
  $$select usage_id from public.admin_extraction_calls((select usage_id from photos where n = 4), 2)$$,
  $$select usage_id from photos where n in (3, 2) order by usage_id desc$$,
  'and the page before a call');
select results_eq(
  $$select day = (now() at time zone 'UTC')::date, calls, ok, no_cards, invalid_output, model_error,
      retried, recovered, failure_rate, unrecorded
    from public.admin_extraction_failures(1)$$,
  $$values (true, 5::bigint, 2::bigint, 1::bigint, 1::bigint, 1::bigint, 2::bigint, 1::bigint,
    0.4000::numeric, 0::bigint)$$,
  'and today''s calls by outcome, the retried and recovered ones, and the share failed');
reset role;

select * from finish();
rollback;
