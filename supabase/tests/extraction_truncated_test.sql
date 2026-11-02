-- Whether an extraction's last reply was cut at the output cap (ADR 0135): finish_extraction records
-- it, a call finished without it keeps null, a cut reply is recorded only on cards kept or invalid
-- output, and no client may call finish_extraction.
begin;
select plan(8);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');

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
insert into photos select n, pg_temp.begin_b() from generate_series(1, 4) as n;

set local role service_role;
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 1), 'ok', 1, 51000, 95, 0,
    '{}', true)$$,
  'a reply cut at the cap with cards kept is recorded truncated');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 2), 'ok', 1, 4200, 12, 0,
    '{}')$$,
  'a finish without the argument, as a function deployed before it sends, is still recorded');
select throws_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 3), 'model_error', 1, 60000,
    0, 0, '{timeout}', true)$$,
  '23514', null,
  'a call that failed is never recorded truncated');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 3), 'model_error', 1, 60000,
    0, 0, '{timeout}', false)$$,
  'control: the same failure recorded as not truncated is accepted');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 4), 'invalid_output', 2,
    110000, 0, 0, '{invalid_output,invalid_output}', true)$$,
  'a cut reply that completed no card is recorded truncated invalid output');
reset role;

select results_eq(
  $$select c.truncated from photos as p join private.extraction_calls as c using (usage_id) order by p.n$$,
  $$values (true), (null::boolean), (false), (true)$$,
  'each call keeps what its finish said, null where it said nothing');
select is(
  (select count(*) from private.extraction_calls where truncated is not null and outcome is null),
  0::bigint,
  'no call without an outcome is marked');

set local role authenticated;
select throws_ok(
  $$select public.finish_extraction(1, 'ok', 1, 1, 1, 0, '{}', true)$$,
  '42501', null,
  'a signed-in client cannot record an outcome');
reset role;

select * from finish();
rollback;
