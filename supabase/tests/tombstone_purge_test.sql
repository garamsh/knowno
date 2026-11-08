-- The tombstone purge: a run takes a mark and trims cron's run details, and purges only below the
-- latest mark taken 90 days or more earlier, which becomes the horizon; studied card tombstones
-- are stripped with their reviews kept, unstudied ones deleted; the daily job; and the migration's
-- guard.
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'owner@example.com');

-- A card of [deck] named by its last digits, with [deleted] making it a tombstone.
create function pg_temp.card(n int, deck int, deleted boolean) returns void language sql as $$
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at,
    updated_at, deleted_at)
  values (('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
    '00000000-0000-4000-8000-0000000000a1',
    ('d0000000-0000-4000-8000-' || lpad(deck::text, 12, '0'))::uuid,
    '[{"type": "text", "text": "front"}]', '[{"type": "text", "text": "back"}]', 'key ' || n,
    'manual', now(), now(), case when deleted then now() end)
$$;

create function pg_temp.id(kind text, n int) returns uuid language sql as $$
  select (kind || '0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- A mark taken [days] ago at the sequence's current last value.
create function pg_temp.mark(days int) returns void language sql as $$
  insert into private.revision_marks (taken_at, revision)
    select now() - make_interval(days => days), last_value from private.revision
$$;

-- Deck 1 is live; deck 2 is a tombstone holding only an unstudied card tombstone; deck 3 is a
-- public tombstone holding a studied one.
insert into public.decks (id, user_id, name, description, visibility, published_at, created_at,
  updated_at, deleted_at)
values
  (pg_temp.id('d', 1), '00000000-0000-4000-8000-0000000000a1', 'Live', 'kept', 'private', null,
    now(), now(), null),
  (pg_temp.id('d', 2), '00000000-0000-4000-8000-0000000000a1', 'Gone', null, 'private', null,
    now(), now(), now()),
  (pg_temp.id('d', 3), '00000000-0000-4000-8000-0000000000a1', 'Studied', 'shared once',
    'public', now(), now(), now(), now());

-- Card 1 is a studied tombstone with a state, card 2 an unstudied one, card 3 live without a
-- state, card 7 live with a state; card 5 in deck 2, card 6 studied in deck 3.
select pg_temp.card(1, 1, true), pg_temp.card(2, 1, true), pg_temp.card(3, 1, false),
  pg_temp.card(7, 1, false), pg_temp.card(5, 2, true), pg_temp.card(6, 3, true);
insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at)
select pg_temp.id('e', n), '00000000-0000-4000-8000-0000000000a1', pg_temp.id('c', n), 'good',
  now(), 4000, now()
from (values (1), (6)) as v (n);
insert into public.card_states (user_id, card_id, stability, difficulty, last_review, due,
  updated_at)
select '00000000-0000-4000-8000-0000000000a1', pg_temp.id('c', n), 3, 5, now(), now(), now()
from (values (1), (7)) as v (n);

-- Run details of another job, past and within 30 days; the run ids are above any real run's, which
-- the every-minute `sweep-assistant-jobs` takes from 1 while the stack is up.
insert into cron.job_run_details (jobid, runid, status, start_time, end_time) values
  (999, 900001, 'succeeded', now() - interval '40 days', now() - interval '40 days'),
  (999, 900002, 'succeeded', now() - interval '10 days', now() - interval '10 days');

create temp table tombstones_before as
  select (select count(*) from public.decks where deleted_at is not null)
    + (select count(*) from public.cards where deleted_at is not null) as n;
select is((select n from tombstones_before), 6::bigint, 'the setup stored six tombstones');

-- The first run: no mark is 90 days old.
select private.purge_tombstones();

select is(
  (select count(*) from public.decks where deleted_at is not null)
    + (select count(*) from public.cards where deleted_at is not null),
  (select n from tombstones_before),
  'a run with no mark 90 days old purges no tombstone');
select is((select revision from private.sync_horizon), 0::bigint,
  'a run with no mark 90 days old leaves the horizon at 0');
select is((select count(*) from private.revision_marks), 1::bigint, 'a run takes a mark');
select is(
  (select array_agg(runid order by runid) from cron.job_run_details where jobid = 999),
  array[900002::bigint],
  'a run deletes the run details past 30 days, with those within 30 days kept as control');
select ok(
  not exists (select from pg_locks where pid = pg_backend_pid() and mode = 'ShareRowExclusiveLock'
    and relation in ('public.cards'::regclass, 'public.reviews'::regclass)),
  'control: a run that purges nothing locks neither cards nor reviews');

-- Marks 120 and 91 days old, a tombstone written after them, then a mark 89 days old above it.
select pg_temp.mark(120);
update private.revision_marks set revision = 1 where taken_at = now() - interval '120 days';
select pg_temp.mark(91);
select pg_temp.card(4, 1, true);
select pg_temp.mark(89);
create temp table horizon_mark as
  select revision from private.revision_marks where taken_at = now() - interval '91 days';
select cmp_ok(
  (select revision from public.cards where id = pg_temp.id('c', 4)), '>',
  (select revision from horizon_mark),
  'card 4''s tombstone is above the 91-day mark');

select private.purge_tombstones();

select is((select revision from private.sync_horizon), (select revision from horizon_mark),
  'the horizon rises to the latest mark 90 days old, not the 89-day one');
select results_eq(
  $$select front, back, card_key from public.cards where id = pg_temp.id('c', 1)$$,
  $$values ('[]'::jsonb, '[]'::jsonb, '')$$,
  'a studied card''s tombstone is kept, stripped of its sides and key');
select ok(exists (select from public.reviews where id = pg_temp.id('e', 1)),
  'the stripped card''s review is kept');
select cmp_ok(
  (select revision from public.cards where id = pg_temp.id('c', 1)), '>',
  (select revision from horizon_mark),
  'the strip draws a revision above the horizon, so devices pull it');
select ok(not exists (select from public.cards where id = pg_temp.id('c', 2)),
  'an unstudied card''s tombstone is deleted');
select ok(exists (select from public.card_states where card_id = pg_temp.id('c', 1)),
  'the stripped card''s state is kept');
select is((select count(*) from public.card_states), 2::bigint,
  'the purge deletes no card state');
select results_eq(
  $$select c.card_key, c.deleted_at is null
    from public.cards as c join public.card_states as s on s.card_id = c.id
    where c.id in (pg_temp.id('c', 3), pg_temp.id('c', 7)) order by c.card_key$$,
  $$values ('key 7', true)$$,
  'control: live cards and their states stay; card 3 has no state');
select is(
  (select card_key from public.cards where id = pg_temp.id('c', 4)), 'key 4',
  'control: a tombstone above the horizon keeps its row and content');
select ok(not exists (select from public.decks where id = pg_temp.id('d', 2)),
  'a deck tombstone no card references any longer is deleted');
select results_eq(
  $$select d.name, d.description, d.visibility, c.card_key
    from public.decks as d join public.cards as c on c.deck_id = d.id
    where d.id = pg_temp.id('d', 3)$$,
  $$values ('', null::text, 'private', '')$$,
  'a deck tombstone holding a stripped card is kept, stripped and private');
select results_eq(
  $$select name, description, visibility from public.decks where id = pg_temp.id('d', 1)$$,
  $$values ('Live', 'kept'::text, 'private')$$,
  'control: a live deck is untouched');
select is(
  (select count(*) from private.revision_marks where taken_at < now() - interval '91 days'),
  0::bigint,
  'marks older than the horizon''s are deleted');
select ok(
  (select count(*) from pg_locks where pid = pg_backend_pid() and mode = 'ShareRowExclusiveLock'
    and relation in ('public.cards'::regclass, 'public.reviews'::regclass)) = 2,
  'a run that purges locks cards and reviews against writes until it commits');

select results_eq(
  $$select schedule, command from cron.job where jobname = 'purge-tombstones'$$,
  $$values ('0 18 * * *'::text, 'select private.purge_tombstones()'::text)$$,
  'the job runs the purge daily at 18:00 GMT');
select results_eq(
  $$select prosecdef, proconfig = array['search_path=""'],
      has_function_privilege('authenticated', oid, 'EXECUTE'),
      has_function_privilege('anon', oid, 'EXECUTE')
    from pg_proc where oid = 'private.purge_tombstones()'::regprocedure$$,
  $$values (true, true, false, false)$$,
  'the purge runs as its owner with an empty search_path, and no client may call it');

-- The migration's guard, against the state it requires: the job absent and the horizon at 0.
select cron.unschedule('purge-tombstones');
update private.sync_horizon set revision = 0;
select lives_ok('select private.check_purge_start()',
  'control: the guard passes with the horizon at 0 and no purge job');
update private.sync_horizon set revision = 1;
select throws_like('select private.check_purge_start()',
  '%sync_horizon to hold its one row at 0%holds 1%',
  'the guard refuses a horizon a purge has stored');
delete from private.sync_horizon;
select throws_like('select private.check_purge_start()',
  '%sync_horizon to hold its one row at 0%holds no row%',
  'the guard refuses a missing horizon row');
insert into private.sync_horizon (revision) values (0);
select cron.schedule('purge-tombstones', '0 18 * * *', 'select 1');
select throws_like('select private.check_purge_start()',
  '%cron job named purge-tombstones already exists%',
  'the guard refuses when a purge job exists');

select * from finish();
rollback;
