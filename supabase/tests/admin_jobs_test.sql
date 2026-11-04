-- The admin area's reads for its five sections (#589, ADR 0155): each refuses a signed-in user who
-- is not an admin and anon, with an admin as control, and reads what it says.
begin;
select plan(21);

-- A is an admin, B a signed-in user who is not; C and F own notes; D and E report. C signed up 2
-- days ago, F 9 days ago and D 20 days ago.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.com', now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000000000d', 'd@example.com', now() - interval '20 days'),
  ('00000000-0000-4000-8000-00000000000e', 'e@example.com', now() - interval '40 days'),
  ('00000000-0000-4000-8000-00000000000f', 'frank@example.com', now() - interval '9 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- C's public French, reported twice, the first 3 days ago; C's public Spanish, reported once 1 day
-- ago; F's public Latin, hidden and reported once; F's public German, unreported; C's private
-- Diary, reported; C's deleted public Old, reported.
insert into public.decks
  (id, user_id, name, visibility, hidden, published_at, created_at, updated_at, deleted_at) values
  ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'French', 'public', false, now() - interval '4 days', now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'Spanish', 'public', false, now() - interval '3 days', now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000f', 'Latin', 'public', true, now() - interval '2 days', now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-00000000000f', 'German', 'public', false, now() - interval '1 day', now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-00000000000c', 'Diary', 'private', false, null, now(), now(), null),
  ('d0000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-00000000000c', 'Old', 'public', false, now() - interval '5 days', now(), now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at, deleted_at) values
  ('c0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c1',
    '[{"type":"text","payload":{"text":"chat"}}]', '[]', 'chat', 'manual', now(), now(), null),
  ('c0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c1',
    '[]', '[]', 'gone', 'manual', now(), now(), now()),
  ('c0000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c2',
    '[{"type":"text","payload":{"text":"gato"}}]', '[]', 'gato', 'manual', now(), now(), null);
insert into public.deck_reports (deck_id, reporter_id, reason, created_at) values
  ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000d', 'spam', now() - interval '3 days'),
  ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000e', 'copyright', now() - interval '1 hour'),
  ('d0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000d', 'other', now() - interval '1 day'),
  ('d0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000d', 'spam', now() - interval '6 days'),
  ('d0000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-00000000000d', 'spam', now() - interval '7 days'),
  ('d0000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-00000000000d', 'spam', now() - interval '8 days');

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

-- Each new function, called with harmless arguments.
create function pg_temp.calls() returns setof text language sql as $$
  values
    ($q$select * from public.admin_note_list('public')$q$),
    ($q$select * from public.admin_week_activity('UTC')$q$),
    ($q$select * from public.admin_version_calls(1)$q$)
$$;
grant execute on function pg_temp.calls() to public;

-- Runs each call as [who] and returns those it refused with insufficient_privilege, or the error
-- of one that failed otherwise.
create function pg_temp.refused_as(who text) returns setof text language plpgsql as $$
declare
  call text;
begin
  for call in select * from pg_temp.calls() loop
    begin
      perform pg_temp.sign_in(who);
      execute call;
      perform set_config('role', 'none', true);
    exception
      when insufficient_privilege then
        return next call;
      when others then
        return next 'failed: ' || call || ': ' || sqlerrm;
    end;
  end loop;
end;
$$;

-- The role.

select results_eq(
  $$select count(*) from pg_temp.refused_as('b') as r (call) where call not like 'failed: %'$$,
  $$values (3::bigint)$$,
  'a signed-in user who is not an admin is refused by each new function');
reset role;
select results_eq(
  $$select count(*) from pg_temp.refused_as(null) as r (call) where call not like 'failed: %'$$,
  $$values (3::bigint)$$,
  'anon is refused by each new function');
reset role;
select is_empty($$select * from pg_temp.refused_as('a')$$,
  'control: an admin is refused by none, and none fails');
reset role;
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc as p
    where p.pronamespace = 'public'::regnamespace and p.proname in
      ('admin_note_list', 'admin_week_activity', 'admin_version_calls')
      and p.prosecdef and p.proconfig = array['search_path=""']),
  array['admin_note_list', 'admin_version_calls', 'admin_week_activity'],
  'each runs as its owner with an empty search_path');

-- The notes.

select pg_temp.sign_in('a');
select results_eq(
  $$select name, owner_email, owner_name, hidden, cards, reports, reasons,
      extract(day from now() - first_reported_at)::integer
    from public.admin_note_list('reported')$$,
  $$values ('French', 'carol@example.com', null::text, false, 1::bigint, 2::bigint,
      array['copyright', 'spam'], 3),
    ('Spanish', 'carol@example.com', null::text, false, 1::bigint, 1::bigint, array['other'], 1)$$,
  'the reported view holds the public notes others still see with a report, the oldest first report first, each with its live cards and reasons');
select is_empty(
  $$select * from public.admin_note_list('reported')
    where name in ('Latin', 'Diary', 'Old', 'German')$$,
  'it leaves out a hidden, a private, a deleted and an unreported note');
select results_eq(
  $$select name, reports from public.admin_note_list('public')$$,
  $$values ('German', 0::bigint), ('Latin', 1::bigint), ('Spanish', 1::bigint),
    ('French', 2::bigint)$$,
  'the public view holds every public live note, newest published first, hidden ones too');
select results_eq(
  $$select name, reasons from public.admin_note_list('public') where name = 'German'$$,
  $$values ('German', '{}'::text[])$$,
  'an unreported note has no reasons, not a null');
select results_eq(
  $$select name, hidden, reports from public.admin_note_list('hidden')$$,
  $$values ('Latin', true, 1::bigint)$$,
  'the hidden view holds the hidden public notes');
select results_eq(
  $$select name from public.admin_note_list('public', 'SPAN')$$,
  $$values ('Spanish')$$,
  'the search matches a note''s name, ignoring case');
select results_eq(
  $$select name from public.admin_note_list('public', 'Frank@')$$,
  $$values ('German'), ('Latin')$$,
  'and its owner''s email');
select results_eq(
  $$select name from public.admin_note_list('reported', 'carol')$$,
  $$values ('French'), ('Spanish')$$,
  'in every view');
select throws_ok($$select * from public.admin_note_list('deleted')$$, '22023', null,
  'an unknown view raises');
select lives_ok($$select * from public.admin_note_list('hidden')$$,
  'control: a known view does not');
reset role;

-- A week's activity: C answers twice at one moment today and once 2 days ago, F once 3 days ago and
-- once 10 days ago, B once 9 days ago and once 20 days ago, each on a card of their own.
insert into public.decks (id, user_id, name, visibility, created_at, updated_at) values
  ('d0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'Notes', 'private', now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at) values
  ('c0000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000000f', 'd0000000-0000-4000-8000-0000000000f2',
    '[{"type":"text","payload":{"text":"Hund"}}]', '[]', 'hund', 'manual', now(), now()),
  ('c0000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-00000000000b', 'd0000000-0000-4000-8000-0000000000b1',
    '[{"type":"text","payload":{"text":"note"}}]', '[]', 'note', 'manual', now(), now());
insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at) values
  ('e0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-0000000000c1', 'good', now() - interval '1 minute', 1000, now()),
  ('e0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-0000000000c3', 'good', now() - interval '1 minute', 1000, now()),
  ('e0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-00000000000c', 'c0000000-0000-4000-8000-0000000000c1', 'good', now() - interval '2 days', 1000, now()),
  ('e0000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-00000000000f', 'c0000000-0000-4000-8000-0000000000f1', 'good', now() - interval '3 days', 1000, now()),
  ('e0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-00000000000f', 'c0000000-0000-4000-8000-0000000000f1', 'good', now() - interval '10 days', 1000, now()),
  ('e0000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-0000000000b1', 'good', now() - interval '9 days', 1000, now()),
  ('e0000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-0000000000b1', 'good', now() - interval '20 days', 1000, now());
select results_eq(
  $$select count(*) from public.reviews$$, $$values (7::bigint)$$,
  'setup: the seven answers are stored');

select pg_temp.sign_in('a');
select results_eq(
  $$select new_users_this, new_users_last, studied_this, studied_last
    from public.admin_week_activity('UTC')$$,
  $$values (1::bigint, 1::bigint, 3::bigint, 2::bigint)$$,
  'the last 7 study days count C''s sign-up and the 7 before F''s, while D''s of 20 days ago is in neither; C''s two answers today count one user-day, beside C''s and F''s earlier, and the week before B''s and F''s');
select throws_ok($$select * from public.admin_week_activity('Nowhere/Zone')$$, '22023', null,
  'an unknown zone raises');
reset role;

-- A second version, which one of B's photos below was served.
insert into private.prompt_versions (text, note) values ('Second.', '');
create temp table second (id bigint primary key);
insert into second select max(id) from private.prompt_versions;
grant select on second to public;

-- One version's calls: B's four photos, numbered newest first, the second on the second version
-- and the rest on version 1, the newest with an outcome.
create temp table calls (n integer primary key, usage_id bigint not null);
grant select on calls to public;
with usage as (
  insert into public.extraction_usage (user_id, created_at)
    select '00000000-0000-4000-8000-00000000000b', now() - make_interval(mins => 5 - n)
    from generate_series(1, 4) as n
  returning id
), numbered as (
  select id, row_number() over (order by id desc) as n from usage
), recorded as (
  insert into private.extraction_calls (usage_id, plan, provider, model, prompt_version_id)
    select id, 'free', 'openrouter', 'vendor/model', case when n = 2 then (select id from second) else 1 end
    from numbered
  returning usage_id
)
insert into calls select n, id from numbered;
update private.extraction_calls set outcome = 'ok', attempts = 1, latency_ms = 900,
    cards_returned = 3, cards_dropped = 0, failures = '{}'
  where usage_id = (select usage_id from calls where n = 1);
select results_eq(
  $$select count(*) from private.extraction_calls where prompt_version_id = 1$$,
  $$values (3::bigint)$$, 'setup: version 1 served three of the calls');

select pg_temp.sign_in('a');
select results_eq(
  $$select usage_id, outcome, cards_returned from public.admin_version_calls(1)$$,
  $$values ((select usage_id from calls where n = 1), 'ok', 3),
    ((select usage_id from calls where n = 3), null, null),
    ((select usage_id from calls where n = 4), null, null)$$,
  'a version''s calls are its own, newest first, each with its outcome or none');
select results_eq(
  $$select usage_id from public.admin_version_calls((select id from second))$$,
  $$select usage_id from calls where n = 2$$,
  'control: the other version''s call is read under it');
select results_eq(
  $$select usage_id from public.admin_version_calls(1, (select usage_id from calls where n = 1), 1)$$,
  $$select usage_id from calls where n = 3$$,
  'a page of one before a call reads the call before it');
reset role;

select * from finish();
rollback;
