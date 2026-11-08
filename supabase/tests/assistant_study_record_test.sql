-- The assistant's study record (#761, `assistant.md` §Tools): a deck's cards by progress label, the interval
-- 21 days exactly mastered and a second less learning, a card without a state new; its cards due
-- when they fall due before the study day ends, 04:00 in the zone, at 03:59 against 04:00; its
-- answers and share "good" within the period and none outside it; the cards most often answered
-- "again", at most 50; a deleted card or deck, and another user's record, never read, with the
-- owner's as control; no client role short of authenticated reaching it; and the revert.
begin;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com');

create function pg_temp.id(kind text, n int) returns uuid language sql immutable as $$
  select (kind || '0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

create function pg_temp.a() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000000a'::uuid
$$;

create function pg_temp.b() returns uuid language sql immutable as $$
  select '00000000-0000-4000-8000-00000000000b'::uuid
$$;

-- A deck of [who], deleted when [gone].
create function pg_temp.deck(who uuid, n int, gone boolean default false) returns void
language sql as $$
  insert into public.decks (id, user_id, name, created_at, updated_at, deleted_at, revision)
  values (pg_temp.id('d', n), who, 'deck ' || n, now() - make_interval(mins => 100 - n), now(),
    case when gone then now() end, 0)
$$;

-- A card of [who] in deck [deck], deleted when [gone], with a state when [due_in] is not null:
-- last reviewed at [reviewed] and due [interval_days] after it.
create function pg_temp.card(
  who uuid, n int, deck int, gone boolean default false, reviewed timestamptz default null,
  span interval default null
) returns void language plpgsql as $$
begin
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at,
    updated_at, deleted_at, revision)
  values (pg_temp.id('c', n), who, pg_temp.id('d', deck),
    jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'front ' || n)), '[]',
    'key ' || n, 'manual', now(), now(), case when gone then now() end, 0);
  if reviewed is not null then
    insert into public.card_states (user_id, card_id, stability, difficulty, last_review, due,
      updated_at, revision)
    values (who, pg_temp.id('c', n), 1, 5, reviewed, reviewed + span, now(), 0);
  end if;
end;
$$;

-- An answer of [who] to card [card] at [at].
create function pg_temp.answer(who uuid, card int, rating text, at timestamptz) returns void
language sql as $$
  insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at,
    revision)
  values (gen_random_uuid(), who, pg_temp.id('c', card), rating, at, 5000, at, 0)
$$;

-- The record [who], signed in, reads, as json.
create function pg_temp.record(
  who uuid, deck int default null, days int default 30,
  at timestamptz default '2026-11-08 12:00Z', time_zone text default 'Asia/Seoul'
) returns jsonb language plpgsql as $$
declare
  result jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', who, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.assistant_study_record(
    case when deck is null then null else pg_temp.id('d', deck) end, days, time_zone, at)
    into result;
  reset role;
  return result;
end;
$$;

-- A's deck 1: a new card (1), a card at 21 days exactly (2, mastered), one at 21 days less a second
-- (3, learning), one due 03:59 Seoul on the 9th (4), one due 04:00 on the 9th (5), and a deleted
-- card (6) that would be mastered. Deck 2 is deleted, holding one card (7).
select pg_temp.deck(pg_temp.a(), 1);
select pg_temp.deck(pg_temp.a(), 2, true);
select pg_temp.card(pg_temp.a(), 1, 1);
select pg_temp.card(pg_temp.a(), 2, 1, false, '2026-10-01 00:00Z', interval '21 days');
select pg_temp.card(pg_temp.a(), 3, 1, false, '2026-10-01 00:00Z', interval '20 days 23:59:59');
select pg_temp.card(pg_temp.a(), 4, 1, false, '2026-11-08 18:00Z', interval '59 minutes');
select pg_temp.card(pg_temp.a(), 5, 1, false, '2026-11-08 18:00Z', interval '1 hour');
select pg_temp.card(pg_temp.a(), 6, 1, true, '2026-10-01 00:00Z', interval '30 days');
select pg_temp.card(pg_temp.a(), 7, 2);

-- The answers: card 1 good at the period's first instant and a second before it; card 2 good at the
-- 7-day period's first instant, again twice, and good long before; card 3 again once; the deleted
-- card and the deleted deck's card answered again.
select pg_temp.answer(pg_temp.a(), 1, 'good', '2026-10-09 12:00Z');
select pg_temp.answer(pg_temp.a(), 1, 'good', '2026-10-09 11:59:59Z');
select pg_temp.answer(pg_temp.a(), 2, 'good', '2026-11-01 12:00Z');
select pg_temp.answer(pg_temp.a(), 2, 'again', '2026-11-05 12:00Z');
select pg_temp.answer(pg_temp.a(), 2, 'again', '2026-11-06 12:00Z');
select pg_temp.answer(pg_temp.a(), 2, 'good', '2026-09-01 12:00Z');
select pg_temp.answer(pg_temp.a(), 3, 'again', '2026-11-07 12:00Z');
select pg_temp.answer(pg_temp.a(), 6, 'again', '2026-11-07 12:00Z');
select pg_temp.answer(pg_temp.a(), 7, 'again', '2026-11-07 12:00Z');

select is(
  (select count(*) from public.cards where deleted_at is not null)
    + (select count(*) from public.decks where deleted_at is not null),
  2::bigint, 'the setup stored a deleted card and a deleted deck');

select is(pg_temp.record(pg_temp.a()) -> 'decks' -> 0,
  jsonb_build_object('id', pg_temp.id('d', 1), 'name', 'deck 1', 'new', 1, 'learning', 3,
    'mastered', 1, 'due', 3, 'answers', 5, 'known', 2),
  'one new card, 21 days mastered and a second less learning, three due and five answers, two good, the deleted card and deck left out');
select is(jsonb_array_length(pg_temp.record(pg_temp.a()) -> 'decks'), 1,
  'the deleted deck is not listed');

-- The study day's end: 04:00 on the 9th, so the card due then is due from 04:00, not before.
select is(pg_temp.record(pg_temp.a(), null, 30, '2026-11-08 18:59:59Z') -> 'decks' -> 0 -> 'due',
  '3'::jsonb, 'at 03:59:59 the card due at 04:00 is not due, the study day not ended');
select is(pg_temp.record(pg_temp.a(), null, 30, '2026-11-08 19:00:00Z') -> 'decks' -> 0 -> 'due',
  '4'::jsonb, 'at 04:00 the next study day holds it, and the same card is due');

-- The period's first instant counts and the second before it does not.
select is(pg_temp.record(pg_temp.a(), null, 7) -> 'decks' -> 0 -> 'answers',
  '4'::jsonb, 'a 7-day period counts the answer at its first instant and none before');
select is(pg_temp.record(pg_temp.a(), null, 30) -> 'decks' -> 0 -> 'answers',
  '5'::jsonb, 'with the 30-day period, as control, the answers of the days before come in');

select is(pg_temp.record(pg_temp.a()) -> 'missed',
  jsonb_build_array(
    jsonb_build_object('id', pg_temp.id('c', 2), 'deck_id', pg_temp.id('d', 1), 'misses', 2,
      'answers', 3, 'front', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'front 2')),
      'back', '[]'::jsonb, 'template', null, 'template_version', null),
    jsonb_build_object('id', pg_temp.id('c', 3), 'deck_id', pg_temp.id('d', 1), 'misses', 1,
      'answers', 1, 'front', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'front 3')),
      'back', '[]'::jsonb, 'template', null, 'template_version', null)),
  'the cards answered again, most often first, with their columns, the deleted card and the deleted deck''s card left out');

-- Another user's record: B's deck 3 is public, which row-level security lets A read.
select pg_temp.deck(pg_temp.b(), 3);
update public.decks set visibility = 'public', published_at = now() where id = pg_temp.id('d', 3);
select pg_temp.card(pg_temp.b(), 8, 3);
select pg_temp.answer(pg_temp.b(), 8, 'again', '2026-11-07 12:00Z');
select results_eq(
  $$select count(*) from public.decks where id = pg_temp.id('d', 3)$$,
  $$values (1::bigint)$$, 'the setup: A is allowed to read B''s public deck');
select is(pg_temp.record(pg_temp.b()) -> 'decks' -> 0 -> 'new', '1'::jsonb,
  'control: B reads its own deck and its card');
select is(pg_temp.record(pg_temp.a(), 3), jsonb_build_object('decks', '[]'::jsonb,
  'missed', '[]'::jsonb), 'A asking for B''s public deck reads none of its record');
select is(
  (select array_agg(d ->> 'id' order by d ->> 'id')
    from jsonb_array_elements(pg_temp.record(pg_temp.a()) -> 'decks') as d),
  array[pg_temp.id('d', 1)::text], 'A''s record holds none of B''s decks');

-- The most missed cards, at most 50 of 52: card 100 answered again three times, the rest once.
select pg_temp.deck(pg_temp.a(), 4);
select pg_temp.card(pg_temp.a(), n, 4) from generate_series(100, 151) as n;
select pg_temp.answer(pg_temp.a(), n, 'again', '2026-11-07 12:00Z') from generate_series(100, 151) as n;
select pg_temp.answer(pg_temp.a(), 100, 'again', '2026-11-07 13:00Z');
select pg_temp.answer(pg_temp.a(), 100, 'again', '2026-11-07 14:00Z');
select is((select count(distinct card_id) from public.reviews
    where user_id = pg_temp.a() and rating = 'again' and card_id >= pg_temp.id('c', 100)),
  52::bigint, 'the setup: 52 cards of the deck answered again');
select is(
  (select array[jsonb_array_length(r -> 'missed'), (r -> 'missed' -> 0 ->> 'misses')::int,
      (r -> 'missed' -> 0 ->> 'id' = pg_temp.id('c', 100)::text)::int]
    from (select pg_temp.record(pg_temp.a(), 4) as r) as q),
  array[50, 3, 1], 'at most 50 cards missed, the most often first, of the 52');

-- The zone the study day is counted in: a card due 03:00 on the 9th in Los Angeles (11:00Z, PST) is
-- due before the day holding 04:00 on the 8th there ends, and not before Seoul's day ends at 19:00Z.
select pg_temp.deck(pg_temp.a(), 5);
select pg_temp.card(pg_temp.a(), 200, 5, false, '2026-11-09 10:00Z', interval '1 hour');
select is(pg_temp.record(pg_temp.a(), 5, 30, '2026-11-08 12:00Z', 'America/Los_Angeles')
    -> 'decks' -> 0 -> 'due',
  '1'::jsonb, 'in Los Angeles at 04:00 on the 8th the card due at 03:00 on the 9th is due, the day ending at 04:00');
select is(pg_temp.record(pg_temp.a(), 5, 30, '2026-11-08 12:00Z', 'Asia/Seoul') -> 'decks' -> 0 -> 'due',
  '0'::jsonb, 'control: at the same instant in Seoul it is 21:00, the day ends at 04:00 on the 9th there, and the card is not due');

select is(public.mastered_interval(), interval '21 days', 'the mastered interval is 21 days');
select results_eq($$select has_function_privilege('anon', 'public.assistant_study_record(uuid, integer, text, timestamptz)', 'execute'),
    has_function_privilege('authenticated', 'public.assistant_study_record(uuid, integer, text, timestamptz)', 'execute')$$,
  $$values (false, true)$$, 'authenticated executes the record, anon does not');

select lives_ok($$select private.revert_assistant_study_record()$$, 'the revert runs');
select is((select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('assistant_study_record', 'mastered_interval')),
  0::bigint, 'the functions are gone');

select * from finish();
rollback;
