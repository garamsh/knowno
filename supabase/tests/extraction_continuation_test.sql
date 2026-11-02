-- Reading a photo to the end of its page (ADR 0138): finish_extraction keeps the cursor it is given,
-- resume_extraction takes it once, for its own user and before it expires, without counting the photo
-- again, record_resumed_extraction adds the request to the record up to 500 cards, and no client may
-- call either.
begin;
select plan(14);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'c@example.com');

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

-- Takes [cursor] for [user_id] as extract-cards does, answering what resume_extraction returns.
create function pg_temp.resume(user_id uuid, cursor uuid)
returns table (usage_id bigint, model text, prompt_version_id bigint, prompt text, cards_read integer,
  continuations integer)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select r.usage_id, r.model, r.prompt_version_id, r.prompt, r.cards_read,
    r.continuations
  from public.resume_extraction(resume.user_id, resume.cursor) as r;
  perform set_config('role', 'none', true);
end;
$$;

create temp table photos (n integer primary key, usage_id bigint not null);
grant all on photos to public;
insert into photos select n, pg_temp.begin_b() from generate_series(1, 3) as n;

set local role service_role;
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 1), 'ok', 1, 98000, 170, 0,
    '{}', true, 1, '00000000-0000-4000-8000-0000000000c1')$$,
  'a photo read in part is finished with its continuing calls and a cursor');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 2), 'ok', 1, 98000, 170, 0,
    '{}', true, 1, '00000000-0000-4000-8000-0000000000c2')$$,
  'a second photo is finished with a cursor of its own');
select lives_ok(
  $$select public.finish_extraction((select usage_id from photos where n = 3), 'ok', 1, 4000, 3, 0,
    '{}', false, 0)$$,
  'a photo read whole is finished with no cursor');
reset role;

select is(
  (select count(*) from private.extraction_cursors),
  2::bigint,
  'only the photos read in part hold a cursor');

create temp table used as
  select count(*) as photos from public.extraction_usage
  where user_id = '00000000-0000-4000-8000-00000000000b';
grant all on used to public;

set local role service_role;
select is_empty(
  $$select * from public.resume_extraction('00000000-0000-4000-8000-00000000000c',
    '00000000-0000-4000-8000-0000000000c1')$$,
  'another user cannot take the cursor');
reset role;
select results_eq(
  $$select r.usage_id, r.model, r.prompt_version_id, r.cards_read, r.continuations,
    r.prompt = v.text
  from pg_temp.resume('00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000c1') as r
  join private.extraction_calls as c using (usage_id)
  join private.prompt_versions as v on v.id = c.prompt_version_id$$,
  $$select p.usage_id, c.model, c.prompt_version_id, 170, 1, true
  from photos as p join private.extraction_calls as c using (usage_id) where p.n = 1$$,
  'its own user takes it, after the other was refused, with the first read''s model, prompt and counts');
set local role service_role;
select is_empty(
  $$select * from public.resume_extraction('00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000c1')$$,
  'a cursor taken once cannot be taken again');
reset role;

update private.extraction_cursors set expires_at = now() - interval '1 second'
  where token = '00000000-0000-4000-8000-0000000000c2';
set local role service_role;
select is_empty(
  $$select * from public.resume_extraction('00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000c2')$$,
  'an expired cursor cannot be taken');
select lives_ok(
  $$select public.record_resumed_extraction((select usage_id from photos where n = 1), 2, 30, false)$$,
  'a request that went on to the page''s end is recorded with no cursor');
select throws_ok(
  $$select public.record_resumed_extraction((select usage_id from photos where n = 2), 1, 331, true)$$,
  '23514', null,
  'a photo cannot pass 500 cards');
select lives_ok(
  $$select public.record_resumed_extraction((select usage_id from photos where n = 2), 1, 330, true,
    '00000000-0000-4000-8000-0000000000c3')$$,
  'control: the same request at 500 cards is recorded, with its next cursor');
reset role;

select results_eq(
  $$select c.cards_returned, c.continuations, c.resumes, c.truncated
  from photos as p join private.extraction_calls as c using (usage_id) order by p.n$$,
  $$values (200, 3, 1, false), (500, 2, 1, true), (3, 0, null::integer, false)$$,
  'each record adds its resumed requests to the first read');
select is(
  (select count(*) from public.extraction_usage
    where user_id = '00000000-0000-4000-8000-00000000000b'),
  (select photos from used),
  'going on with a cursor counts no photo again');

set local role authenticated;
select throws_ok(
  $$select * from public.resume_extraction('00000000-0000-4000-8000-00000000000b',
    '00000000-0000-4000-8000-0000000000c3')$$,
  '42501', null,
  'a signed-in client cannot take a cursor');
reset role;

select * from finish();
rollback;
