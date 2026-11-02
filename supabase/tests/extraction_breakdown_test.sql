-- The overview's usage breakdown (ADR 0074): only an admin reads it, and it counts each UTC day's
-- photos by the plan, model and prompt version that served them, a photo without a call record
-- under none, over the days asked for.
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.prompt_versions (text, note) values ('Second.', '');

-- B's photos: two today by Free on version 1 and one by Pro on the second version, one yesterday
-- before calls were recorded, and one 40 days ago.
with usage as (
  insert into public.extraction_usage (user_id, created_at) values
    ('00000000-0000-4000-8000-00000000000b', date_trunc('day', now(), 'UTC') + interval '1 hour'),
    ('00000000-0000-4000-8000-00000000000b', date_trunc('day', now(), 'UTC') + interval '2 hours'),
    ('00000000-0000-4000-8000-00000000000b', date_trunc('day', now(), 'UTC') + interval '3 hours')
  returning id
), numbered as (select id, row_number() over (order by id) as n from usage)
insert into private.extraction_calls (usage_id, plan, provider, model, prompt_version_id)
  select id, case when n < 3 then 'free' else 'pro' end, 'openrouter',
    case when n < 3 then 'vendor/free-model' else 'vendor/pro-model' end,
    case when n < 3 then 1 else (select max(id) from private.prompt_versions) end
  from numbered;
insert into public.extraction_usage (user_id, created_at) values
  ('00000000-0000-4000-8000-00000000000b', date_trunc('day', now(), 'UTC') - interval '1 hour'),
  ('00000000-0000-4000-8000-00000000000b', now() - interval '40 days');

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

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_extraction_breakdown()$$, '42501', null,
  'a signed-in user who is not an admin is refused');
reset role;
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_extraction_breakdown()$$, '42501', null, 'and so is anon');
reset role;

select pg_temp.sign_in('a');
select results_eq(
  $$select day - (now() at time zone 'UTC')::date, plan, model, prompt_version_id = 1, photos
    from public.admin_extraction_breakdown()$$,
  $$values (-1, null, null, null, 1::bigint),
           (0, 'free', 'vendor/free-model', true, 2::bigint),
           (0, 'pro', 'vendor/pro-model', false, 1::bigint)$$,
  'an admin reads each day''s photos by plan, model and version, an unrecorded photo under none');
select results_eq($$select sum(photos) from public.admin_extraction_breakdown(1)$$,
  $$values (3::numeric)$$, 'one day reads today''s photos alone');
select results_eq($$select sum(photos) from public.admin_extraction_breakdown(30)$$,
  $$values (4::numeric)$$, 'thirty days leave out the photo of 40 days ago');
select results_eq($$select sum(photos) from public.admin_extraction_breakdown(90)$$,
  $$values (5::numeric)$$, 'control: ninety days read it');
reset role;

select * from finish();
rollback;
