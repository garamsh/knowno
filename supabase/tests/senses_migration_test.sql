-- The senses migration (#228, ADR 0075) on a fixture of its cases:
-- each recognised form converts to a senses block, and a mixed card, a note, an unrecognised label,
-- a back of two blocks and a deleted card are left alone; the original back is kept in the backup;
-- no front, card key, edit time, review or card state changes, while the revision does; a second
-- run changes nothing; and the revert restores every back not edited since.
begin;
select plan(25);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'a@example.com');
insert into public.decks (id, user_id, name, created_at, updated_at)
  values ('d0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Words',
    now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at,
  updated_at, deleted_at)
select ('c0000000-0000-4000-8000-000000000' || id)::uuid, '00000000-0000-4000-8000-00000000000a',
  'd0000000-0000-4000-8000-00000000000a',
  jsonb_build_array(jsonb_build_object('type', 'text', 'payload', jsonb_build_object('text', id))),
  back::jsonb, id, 'manual', '2026-10-01 09:00:00+00', '2026-10-02 09:00:00.123+00', deleted
from (values
  ('c01', '[{"type":"text","payload":{"text":"[명] 사과\n[동] 먹다"}}]', null::timestamptz),
  ('c02', '[{"type":"text","payload":{"text":"(명) 사과"}}]', null),
  ('c03', '[{"type":"text","payload":{"text":"명. 사과"}}]', null),
  ('c04', '[{"type":"text","payload":{"text":"n. apple"}}]', null),
  ('c05', '[{"type":"text","payload":{"text":"명 사과"}}]', null),
  ('c06', '[{"type":"text","payload":{"text":"[명] 사과\n과일의 한 종류"}}]', null),
  ('c07', '[{"type":"text","payload":{"text":"빛 에너지로 포도당을 만드는 과정"}}]', null),
  ('c09', '[{"type":"text","payload":{"text":"[명] 사과"}},{"type":"text","payload":{"text":"[명] 능금"}}]', null),
  ('c10', '[{"type":"text","payload":{"text":"[명] 사과"}}]', '2026-10-03 09:00:00+00'),
  ('c11', '[{"type":"text","payload":{"text":"[명사] 사과"}}]', null),
  ('c12', '[{"type":"text","payload":{"text":"조동 can"}}]', null)
) as fixture (id, back, deleted);
insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at)
  values ('e0000000-0000-4000-8000-000000000c01', '00000000-0000-4000-8000-00000000000a',
    'c0000000-0000-4000-8000-000000000c01', 'good', now(), 4000, now());
insert into public.card_states (user_id, card_id, stability, difficulty, last_review, due,
  updated_at)
  values ('00000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-000000000c01', 3, 5,
    now(), now(), now());

create temp table cards_before as select * from public.cards;
create temp table reviews_before as select * from public.reviews;
create temp table states_before as select * from public.card_states;
create function pg_temp.card(n text) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-000000000' || n)::uuid
$$;
create function pg_temp.back(n text) returns jsonb language sql as $$
  select back from public.cards where id = pg_temp.card(n)
$$;
create function pg_temp.sense(category text, label text, meaning text) returns jsonb language sql as $$
  select jsonb_build_object('labels', jsonb_build_array(jsonb_build_object('kind', 'part_of_speech',
    'category', category, 'text', label)), 'meaning', meaning, 'examples', '[]'::jsonb)
$$;
create function pg_temp.senses(variadic senses jsonb[]) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'senses', 'payload',
    jsonb_build_object('senses', to_jsonb(senses))))
$$;

-- The line rules, which the dry run reads too.
select results_eq(
  $$ select form, label, category, meaning from private.sense_line('[명] 사과') $$,
  $$ values ('bracket', '명', 'noun', '사과') $$, 'a bracketed label is the bracket form');
select results_eq(
  $$ select form, label, category, meaning from private.sense_line('(N.) apple') $$,
  $$ values ('paren', 'N', 'noun', 'apple') $$,
  'a parenthesised label with its dot is the paren form, read whatever its case');
select results_eq(
  $$ select form, label, category from private.sense_line('조동 can') $$,
  $$ values ('bare', '조동', 'auxiliary') $$, 'the longest label is tried first');
select is_empty($$ select * from private.sense_line('[명사] 사과') $$,
  'a label not on the list is no sense line');
select is_empty($$ select * from private.sense_line('[명]   ') $$,
  'a label without a meaning is no sense line');

select is(private.migrate_senses(), 6, 'the migration converts the six cards the dry run counts');

-- Each form converts, one sense per line in order, each label as printed with its category.
select is(pg_temp.back('c01'),
  pg_temp.senses(pg_temp.sense('noun', '명', '사과'), pg_temp.sense('verb', '동', '먹다')),
  'the bracket form becomes one senses block of a sense per line');
select is(pg_temp.back('c01')::text,
  '[{"type": "senses", "payload": {"senses": [{"labels": [{"kind": "part_of_speech", "text": "명", "category": "noun"}], "meaning": "사과", "examples": []}, {"labels": [{"kind": "part_of_speech", "text": "동", "category": "verb"}], "meaning": "먹다", "examples": []}]}}]',
  'the stored text the app''s and the web''s tests of the migrated back decode');
select is(pg_temp.back('c02'), pg_temp.senses(pg_temp.sense('noun', '명', '사과')),
  'the paren form converts');
select is(pg_temp.back('c03'), pg_temp.senses(pg_temp.sense('noun', '명', '사과')),
  'the dot form converts');
select is(pg_temp.back('c04'), pg_temp.senses(pg_temp.sense('noun', 'n', 'apple')),
  'an English abbreviation converts as its part of speech');
select is(pg_temp.back('c05'), pg_temp.senses(pg_temp.sense('noun', '명', '사과')),
  'the bare form converts');
select is(pg_temp.back('c12'), pg_temp.senses(pg_temp.sense('auxiliary', '조동', 'can')),
  'a two-letter short form converts as itself');

select results_eq(
  $$ select id, back, revision from public.cards
     where id in (select pg_temp.card(n) from unnest('{c06,c07,c09,c10,c11}'::text[]) as n)
     order by id $$,
  $$ select id, back, revision from cards_before
     where id in (select pg_temp.card(n) from unnest('{c06,c07,c09,c10,c11}'::text[]) as n)
     order by id $$,
  'the mixed card, the note, the two-block back, the deleted card and the unrecognised label are untouched');

select results_eq(
  $$ select b.card_id, b.back from private.senses_migration_backup as b order by b.card_id $$,
  $$ select id, back from cards_before
     where id in (select pg_temp.card(n) from unnest('{c01,c02,c03,c04,c05,c12}'::text[]) as n)
     order by id $$,
  'each converted card''s original back is kept in the backup, and only theirs');
select results_eq(
  $$ select id, front, card_key, source, created_at, updated_at, deleted_at, deck_id, user_id
     from public.cards order by id $$,
  $$ select id, front, card_key, source, created_at, updated_at, deleted_at, deck_id, user_id
     from cards_before order by id $$,
  'no front, card key or edit time changes, so a device edit not yet pushed stays the later one');
select is((select count(*) from public.cards as c join cards_before as b using (id)
  where c.back <> b.back and c.revision > b.revision)::int, 6,
  'each converted card takes a new revision, so every device pulls it');
select results_eq($$ select * from public.reviews $$, $$ select * from reviews_before $$,
  'no review changes');
select results_eq($$ select * from public.card_states $$, $$ select * from states_before $$,
  'no card state changes');
select is(private.senses_block(pg_temp.back('c01')), null,
  'a converted back is no longer one text block, so it does not convert again');

create temp table cards_migrated as select * from public.cards;
select is(private.migrate_senses(), 0, 'a second run converts nothing');
select results_eq($$ select id, back, revision from public.cards order by id $$,
  $$ select id, back, revision from cards_migrated order by id $$,
  'a second run changes no row');

-- A device edits c02 after the migration and pushes it; the revert leaves that edit alone.
update public.cards set back = '[{"type":"text","payload":{"text":"사과 (내가 고침)"}}]',
  updated_at = now() where id = pg_temp.card('c02');
select is(private.revert_senses_migration(), 5,
  'the revert restores every converted back not edited since');
select results_eq(
  $$ select id, back from public.cards where id <> pg_temp.card('c02') order by id $$,
  $$ select id, back from cards_before where id <> pg_temp.card('c02') order by id $$,
  'the revert restores each original back');
select is(pg_temp.back('c02'), '[{"type":"text","payload":{"text":"사과 (내가 고침)"}}]'::jsonb,
  'a back edited since the migration keeps the edit');

select * from finish();
rollback;
