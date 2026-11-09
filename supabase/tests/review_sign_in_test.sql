-- The App Review sign-in's database half (#835, ADR 0226): the two Vault secrets read only through
-- `review_sign_in_begin`, null while unset; an attempt recorded by the address's hash; the limit of
-- 5 attempts an address and 20 in all over 10 minutes, after which no secret is read, counting
-- every address alike; old attempts forgotten; no client reaching any of it; and the revert.
begin;
select plan(18);

-- Runs [query] as service_role, as the function does, and answers its text.
create function pg_temp.as_service(query text) returns text language plpgsql as $$
declare
  answer text;
begin
  perform set_config('role', 'service_role', true);
  execute query into answer;
  perform set_config('role', 'none', true);
  return answer;
end;
$$;

-- An attempt by [who], as the verdict and the secrets it was given.
create function pg_temp.attempt(who text) returns text language sql as $$
  select pg_temp.as_service(format(
    $q$select b.allowed || '/' || coalesce(b.email, '-') || '/' || coalesce(b.code, '-')
       from public.review_sign_in_begin(%L) as b$q$, who));
$$;

delete from vault.secrets where name in ('review_sign_in_email', 'review_sign_in_code');
delete from private.review_sign_in_attempts;

select is(pg_temp.attempt('k1'), 'true/-/-', 'with no secret created, an attempt may go on and holds none');

select vault.create_secret('review@example.com', 'review_sign_in_email');
select is(pg_temp.attempt('k1'), 'true/review@example.com/-', 'with the code missing, it is given the address and no code');
select vault.create_secret('a-long-fixed-code', 'review_sign_in_code');
select is(pg_temp.attempt('k1'), 'true/review@example.com/a-long-fixed-code',
  'with both created, an attempt is given both, decrypted');

-- k1 has made three attempts; two more are allowed, the sixth is not.
select is(pg_temp.attempt('k1'), 'true/review@example.com/a-long-fixed-code', 'the fourth attempt of an address');
select is(pg_temp.attempt('k1'), 'true/review@example.com/a-long-fixed-code', 'the fifth attempt of an address');
select is(pg_temp.attempt('k1'), 'false/-/-', 'the sixth attempt of an address is refused with no secret');
select is(pg_temp.attempt('k2'), 'true/review@example.com/a-long-fixed-code',
  'another address is not limited by it (control)');

-- Attempts older than the window do not count.
update private.review_sign_in_attempts set at = now() - interval '11 minutes' where address_key = 'k1';
select is(pg_temp.attempt('k1'), 'true/review@example.com/a-long-fixed-code',
  'an address whose attempts are over 10 minutes old may try again');

-- The limit in all: k2 and k1 have 1 attempt each in the window; 20 in all is allowed, the 21st is not.
select pg_temp.attempt('x' || n) from generate_series(1, 18) as n;
select is((select count(*) from private.review_sign_in_attempts where at > now() - interval '10 minutes'),
  20::bigint, 'twenty attempts are inside the window');
select is(pg_temp.attempt('fresh'), 'false/-/-', 'the twenty-first attempt of any address is refused');

-- An attempt older than a day is deleted by the next one.
insert into private.review_sign_in_attempts (address_key, at) values
  ('old', now() - interval '2 days'), ('yesterday', now() - interval '23 hours');
select pg_temp.attempt('fresh');
select is((select count(*) from private.review_sign_in_attempts where address_key = 'old'), 0::bigint,
  'an attempt of two days ago is forgotten');
select is((select count(*) from private.review_sign_in_attempts where address_key = 'yesterday'), 1::bigint,
  'one of 23 hours ago is kept');

-- No client reaches the table or the function.
select results_eq(
  $$select count(*) from unnest(array['anon', 'authenticated', 'service_role']) as r
    where has_table_privilege(r, 'private.review_sign_in_attempts', 'select')
      or has_table_privilege(r, 'private.review_sign_in_attempts', 'insert')$$,
  $$values (0::bigint)$$, 'no role reads or writes the attempts directly');
select results_eq(
  $$select r, has_function_privilege(r, 'public.review_sign_in_begin(text)', 'execute')
    from unnest(array['anon', 'authenticated', 'service_role']) as r order by r$$,
  $$values ('anon'::text, false), ('authenticated', false), ('service_role', true)$$,
  'only service_role executes the function');
select is((select p.prosecdef from pg_proc as p where p.oid = 'public.review_sign_in_begin(text)'::regprocedure),
  true, 'the function runs as its owner');
select is((select p.proconfig from pg_proc as p where p.oid = 'public.review_sign_in_begin(text)'::regprocedure),
  array['search_path=""'], 'with an empty search_path');
select is((select count(*) from private.review_sign_in_attempts where address_key like '%@%'), 0::bigint,
  'no attempt holds an address');

-- The revert.
select private.revert_review_sign_in();
select is((select to_regclass('private.review_sign_in_attempts') is null
    and to_regprocedure('public.review_sign_in_begin(text)') is null),
  true, 'the revert drops the function and the table');

select * from finish();
rollback;
