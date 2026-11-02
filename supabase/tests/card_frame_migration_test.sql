-- The migration to the 칸 frame (#549, ADR 0137 as amended by ADR 0140) on the shared fixtures,
-- supabase/fixtures/card-frame/conversion.json, which scripts/test-db.sh hands this test as the
-- database setting `knowno.card_frame_fixtures`: each placement converts as its expected list,
-- what it leaves stays, the backup holds every changed row and no client reads it, a second run
-- changes nothing, the revert restores an untouched row exactly and projects an edited one with
-- nothing lost, and the whole runs at production's volume inside what a writer waits for.
--
-- Each fixture is two cards: card A is left as the migration writes it, card B is edited after.
begin;

create temp table fixtures as
select each.number::int as n, each.fixture->>'name' as name, each.fixture->'front' as front,
  each.fixture->'back' as back, nullif(each.fixture->'cells', 'null') as cells
from jsonb_array_elements(current_setting('knowno.card_frame_fixtures')::jsonb)
  with ordinality as each (fixture, number);

select plan(54 + (select count(*)::int from fixtures));

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com');
insert into public.decks (id, user_id, name, created_at, updated_at)
  values ('d0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Cards',
    now(), now());

create function pg_temp.card(letter text, n int) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-' || letter || lpad(n::text, 11, '0'))::uuid
$$;
create function pg_temp.add(id uuid, front jsonb, back jsonb, template text, version int,
  deleted timestamptz default null) returns void language sql as $$
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, template,
    template_version, created_at, updated_at, deleted_at)
  values (id, '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a',
    front, back, 'key ' || id, 'manual', template, version, '2026-10-01 09:00:00+00',
    '2026-10-02 09:00:00.123+00', deleted)
$$;
create function pg_temp.text(value text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('type', 'text', 'v', 1, 'payload',
    jsonb_build_object('text', value)))
$$;
-- Every non-empty string a block list holds but the names a frame gives a block's sides.
create function pg_temp.strings(blocks jsonb) returns setof text language sql as $$
  select value #>> '{}' from jsonb_path_query(blocks, '$.**') as value
  where jsonb_typeof(value) = 'string' and value #>> '{}' not in ('', 'front', 'back', 'term', 'meaning')
$$;

select pg_temp.add(pg_temp.card('a', n), front, back, 'free', 1) from fixtures;
select pg_temp.add(pg_temp.card('b', n), front, back, 'free', 1) from fixtures;

-- What a card's template decides, on one shape that converts.
select pg_temp.add(pg_temp.card('e', 1), pg_temp.text('x'), pg_temp.text('y'), null, null);
select pg_temp.add(pg_temp.card('e', 2), pg_temp.text('x'), pg_temp.text('y'), 'flip', 1);
select pg_temp.add(pg_temp.card('e', 3), pg_temp.text('x'), pg_temp.text('y'), 'cloze', 1);
select pg_temp.add(pg_temp.card('e', 4), pg_temp.text('x'), pg_temp.text('y'), 'table', 1);
select pg_temp.add(pg_temp.card('f', 1), pg_temp.text('x'), pg_temp.text('y'), 'mindmap', 1);
select pg_temp.add(pg_temp.card('f', 2), pg_temp.text('x'), pg_temp.text('y'), 'flip', 2);
select pg_temp.add(pg_temp.card('f', 3), pg_temp.text('x'), pg_temp.text('y'), 'free', 3);
select pg_temp.add(pg_temp.card('f', 4), pg_temp.text('x'), pg_temp.text('y'), 'free', null);
select pg_temp.add(pg_temp.card('f', 5), pg_temp.text('x'), pg_temp.text('y'), 'free', 1, now());

-- Shapes the conversion cannot write or read, which stay whole: a back of no text with no 글 to
-- join, a box answer of no text, and blocks that break their shape.
select pg_temp.add(pg_temp.card('f', 6),
  '[{"type":"cloze","payload":{"text":"___","answers":["x"]}}]', pg_temp.text(''), 'free', 1);
select pg_temp.add(pg_temp.card('f', 7),
  '[{"type":"cloze","payload":{"text":"___","answers":["x"]}}]', pg_temp.text(E' 　\n'), 'free', 1);
select pg_temp.add(pg_temp.card('f', 8),
  '[{"type":"cloze","payload":{"text":"___","answers":["x"]}}]',
  '[{"type":"image","payload":{"media":"m","width":1,"height":1,"boxes":[{"id":"x","x":0,"y":0,"w":1,"h":1,"answer":""}]}}]',
  'free', 1);
select pg_temp.add(pg_temp.card('f', 9), '[{"type":"text","payload":{}}]', '[]', 'free', 1);
select pg_temp.add(pg_temp.card('f', 10), '["a scalar"]', '[]', 'free', 1);
select pg_temp.add(pg_temp.card('f', 13), '[{"type":"text","v":"one","payload":{"text":"a"}}]', '[]', 'free', 1);
select pg_temp.add(pg_temp.card('f', 11), '[{"type":"table","payload":{"columns":"a","rows":3}}]',
  '[]', 'free', 1);
select pg_temp.add(pg_temp.card('f', 12),
  '[{"type":"cloze","payload":{"text":"___","answers":["x","y"]}}]', '[]', 'free', 1);

-- A back of no text beside a front 글 joins it, so nothing is left. Its control holds a back's text
-- in the same place.
select pg_temp.add(pg_temp.card('e', 5), pg_temp.text('x'), pg_temp.text(''), 'free', 1);
select pg_temp.add(pg_temp.card('e', 6), pg_temp.text('x'), pg_temp.text('y'), 'free', 1);

-- Cards in the frame already, as #559 and #560 write them, one with a back no build writes.
select pg_temp.add(pg_temp.card('d', 1),
  '[{"type":"text","v":2,"id":"t","payload":{"front":"bonjour","back":"hello"}}]', '[]', 'free', 2);
select pg_temp.add(pg_temp.card('d', 2),
  '[{"type":"text","v":2,"payload":{"front":"a","back":""}}]', pg_temp.text('kept'), 'free', 2);

insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at)
select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-4000-8000-00000000000a', pg_temp.card('a', n), 'good', now(), 4000, now()
from fixtures;
insert into public.card_states (user_id, card_id, stability, difficulty, last_review, due,
  updated_at)
select '00000000-0000-4000-8000-00000000000a', pg_temp.card('a', n), 3, 5, now(), now(), now()
from fixtures;

create temp table cards_before as select * from public.cards;
create temp table reviews_before as select * from public.reviews;
create temp table states_before as select * from public.card_states;

-- Each placement, through the one function.
select is(private.card_frame(front, back), cells, name) from fixtures order by n;

select cmp_ok((select count(*) from fixtures), '>=', 23::bigint, 'the shared fixtures are read');
select is(private.card_frame('[]', '[]'), '[]'::jsonb, 'a card of no block is an empty list');

select is(private.migrate_card_frame(),
  (select count(*)::int * 2 from fixtures where cells is not null) + 6,
  'the migration converts each fixture that converts, the templates and the two 글');

select is(
  (select count(*) from pg_locks where relation = 'public.cards'::regclass
    and pid = pg_backend_pid() and mode = 'ShareRowExclusiveLock' and granted),
  1::bigint, 'the migration holds the table against writers, which reads pass');

select is_empty($$
  select f.name from fixtures as f join public.cards as c on c.id = pg_temp.card('a', f.n)
  where f.cells is not null
    and (c.front, c.back, c.template, c.template_version)
      is distinct from (f.cells, '[]'::jsonb, 'free'::text, 2::smallint)
$$, 'every fixture card holds its 칸 in front, nothing in back, at free v2');
select is(
  (select c.front->1->'payload'->>'back' from public.cards as c
    join fixtures as f on c.id = pg_temp.card('a', f.n)
    where f.name like 'placement 1: a copy''s cloze%'),
  'Paris, on the Seine.', 'a back that differs from the filled text is a 글''s back');
select is(
  (select jsonb_array_length(c.front) from public.cards as c
    join fixtures as f on c.id = pg_temp.card('a', f.n)
    where f.name like 'placement 1: an import''s cloze%'),
  1, 'a back equal to the filled text drops');
select is_empty($$
  select id from public.cards where id in (select pg_temp.card('e', n) from generate_series(1, 4) n)
    and (template, template_version) is distinct from ('free'::text, 2::smallint)
$$, 'no template and each earlier template at version 1 convert');

select is_empty($$
  select b.id from cards_before as b join public.cards as c using (id)
  where b.id in (
    select pg_temp.card('f', n) from generate_series(1, 13) n
    union all select pg_temp.card('a', n) from fixtures where cells is null
    union all select pg_temp.card('d', n) from generate_series(1, 2) n)
  and (c.front, c.back, c.template, c.template_version, c.revision)
    is distinct from (b.front, b.back, b.template, b.template_version, b.revision)
$$, 'a tombstone, an unknown template, version or block, a broken block, a 글 of no text and a card already in the frame are untouched, revision included');
select is(
  (select count(*) from public.cards where id = pg_temp.card('f', 5) and deleted_at is not null),
  1::bigint, 'the fixture holds its tombstone');
select is((select front->0->'payload'->>'back' from public.cards where id = pg_temp.card('e', 6)),
  'y', 'control: a back text joins a front 글');
select is((select front->0->'payload'->>'back' from public.cards where id = pg_temp.card('e', 5)),
  '', 'a back of no text joins a front 글 too, and the card converts');

select is_empty($$
  select b.id from cards_before as b join public.cards as c using (id)
  where (b.user_id, b.deck_id, b.card_key, b.source, b.origin_deck_id, b.created_at, b.updated_at,
      b.deleted_at)
    is distinct from (c.user_id, c.deck_id, c.card_key, c.source, c.origin_deck_id, c.created_at,
      c.updated_at, c.deleted_at)
$$, 'no card changes its key, edit time, deck, source or tombstone');
select is_empty($$
  select b.id from cards_before as b join public.cards as c using (id)
  join private.card_frame_backup as k on k.card_id = c.id
  where c.revision <= b.revision
$$, 'every converted card takes a new revision');
select results_eq('select * from public.reviews order by id',
  'select * from reviews_before order by id', 'no review changes');
select results_eq('select * from public.card_states order by card_id',
  'select * from states_before order by card_id', 'no card state changes');

select is((select count(*) from private.card_frame_backup),
  (select count(*) from public.cards as c join cards_before as b using (id)
    where c.revision <> b.revision),
  'the backup holds one row for each changed card');
select is_empty($$
  select b.id from cards_before as b
  join private.card_frame_backup as k on k.card_id = b.id
  join public.cards as c on c.id = b.id
  where (k.user_id, k.front, k.back, k.template, k.template_version, k.written)
    is distinct from (b.user_id, b.front, b.back, b.template, b.template_version, c.front)
$$, 'the backup holds each row whole: user, front, back, template, version and the front written');
select is(
  (select k.back->0->'payload'->>'text' from private.card_frame_backup as k
    join fixtures as f on k.card_id = pg_temp.card('a', f.n)
    where f.name like 'placement 1: an import''s cloze%'),
  'The capital is Paris.', 'a dropped back stays in the backup');
select ok(
  (select k.template is null and k.template_version is null from private.card_frame_backup as k
    where k.card_id = pg_temp.card('e', 1)),
  'the backup keeps a card of no template as none');

create temp table cards_converted as select * from public.cards;
select is(private.migrate_card_frame(), 0, 'a second run converts nothing');
select is_empty('select * from public.cards except select * from cards_converted',
  'a second run changes no row, no revision either');

-- No client reaches the backup or the functions.
select is(
  (select relrowsecurity from pg_class where oid = 'private.card_frame_backup'::regclass), true,
  'the backup has row-level security');
select cmp_ok((select count(*) from private.card_frame_backup), '>', 0::bigint,
  'control: the backup holds rows its owner reads');
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select cmp_ok((select count(*) from public.cards), '>', 0::bigint,
  'control: the card owner reads the cards as authenticated');
select throws_ok('select * from private.card_frame_backup', '42501', null,
  'the card owner cannot read the backup');
select throws_ok('select private.revert_card_frame()', '42501', null,
  'the card owner cannot run the revert');
select throws_ok('select private.card_frame(''[]'', ''[]'')', '42501', null,
  'the card owner cannot run the conversion');
reset role;
set local role anon;
select throws_ok('select * from private.card_frame_backup', '42501', null,
  'anon cannot read the backup');
reset role;
select is(has_table_privilege('authenticated', 'private.card_frame_backup', 'select'), false,
  'authenticated holds no select on the backup');
select is(has_function_privilege('authenticated', 'private.revert_card_frame()', 'execute'), false,
  'authenticated holds no execute on the revert');
select is(has_table_privilege('anon', 'private.card_frame_backup', 'select'), false,
  'anon holds no select on the backup');

-- Card B of each fixture is edited in the frame after the migration; one card is written back at
-- v1 by an older build, and one is deleted.
update public.cards as c
set front = c.front
    || '[{"type":"text","v":2,"id":"edit","payload":{"front":"edited","back":"later"}}]',
  updated_at = c.updated_at + interval '1 hour'
from fixtures as f
where c.id = pg_temp.card('b', f.n) and f.cells is not null;
update public.cards set front = pg_temp.text('older build'), back = pg_temp.text('edit'),
  template = 'free', template_version = 1 where id = pg_temp.card('e', 1);
update public.cards set deleted_at = now(), updated_at = now() where id = pg_temp.card('e', 2);
create temp table cards_edited as select * from public.cards;

select cmp_ok(private.revert_card_frame(), '>', 0, 'the revert changes cards');

select is_empty($$
  select to_jsonb(b) - 'revision' from cards_before as b
  join fixtures as f on b.id = pg_temp.card('a', f.n)
  except
  select to_jsonb(c) - 'revision' from public.cards as c
$$, 'each fixture card restores whole, byte for byte but its revision');
select is_empty($$
  select to_jsonb(b) - 'revision' from cards_before as b
  where b.id in (select pg_temp.card('e', n) from generate_series(3, 6) n)
  except
  select to_jsonb(c) - 'revision' from public.cards as c
$$, 'a card of an earlier template takes that template back');
select is_empty($$
  select c.id from public.cards as c join cards_edited as e using (id)
  where e.template_version = 2 and e.template = 'free' and e.deleted_at is null
    and c.revision <= e.revision
$$, 'every reverted card takes a new revision');
select is_empty($$
  select c.id from public.cards as c join cards_edited as e using (id)
  where e.template_version = 2 and e.template = 'free' and e.deleted_at is null
    and (c.updated_at, c.card_key) is distinct from (e.updated_at, e.card_key)
$$, 'no reverted card changes its key or edit time');
select is_empty($$
  select f.name from fixtures as f join public.cards as c on c.id = pg_temp.card('b', f.n)
  where f.cells is not null
    and (c.template, c.template_version) is distinct from ('free'::text, 1::smallint)
$$, 'a card edited since is free v1');
select is_empty($$
  select f.name, s from fixtures as f
  join cards_edited as e on e.id = pg_temp.card('b', f.n)
  cross join lateral pg_temp.strings(e.front) as s
  where f.cells is not null
  except
  select f.name, s from fixtures as f
  join public.cards as c on c.id = pg_temp.card('b', f.n)
  cross join lateral pg_temp.strings(c.front || c.back) as s
$$, 'every string of a card edited since survives its projection, the edit included');
select is(
  (select jsonb_build_array(c.front, c.back) from public.cards as c
    join fixtures as f on c.id = pg_temp.card('b', f.n)
    where f.name like 'no blank: photo and sound%'),
  '[[{"type":"image","v":1,"payload":{"media":"m1","width":9,"height":9,"boxes":[]}},
     {"type":"text","v":1,"id":"edit","payload":{"text":"edited"}}],
    [{"type":"audio","v":1,"payload":{"media":"m2","duration_ms":9}},
     {"type":"text","v":1,"payload":{"text":"later"}}]]'::jsonb,
  'a 사진, a 소리 and a 글 project to the sides they sit on');
select is(
  (select jsonb_build_array(c.front, c.back) from public.cards as c
    join fixtures as f on c.id = pg_temp.card('b', f.n)
    where f.name like 'no blank: a word with its senses%'),
  '[[{"type":"text","v":1,"payload":{"text":"apple"}},
     {"type":"text","v":1,"id":"edit","payload":{"text":"edited"}}],
    [{"type":"senses","v":1,"payload":{"senses":[{"labels":[],"meaning":"사과","examples":[]}]}},
     {"type":"text","v":1,"payload":{"text":"fruit"}},
     {"type":"text","v":1,"payload":{"text":"later"}}]]'::jsonb,
  'a 단어 asking its word projects the word to the front and the meanings to the back');
select is(
  (select jsonb_build_array(c.front, c.back) from public.cards as c
    join fixtures as f on c.id = pg_temp.card('b', f.n)
    where f.name like 'no blank: front senses with a back word%'),
  '[[{"type":"senses","v":1,"payload":{"senses":[{"labels":[],"meaning":"사과","examples":[]}]}},
     {"type":"text","v":1,"id":"edit","payload":{"text":"edited"}}],
    [{"type":"text","v":1,"payload":{"text":"apple"}},
     {"type":"text","v":1,"payload":{"text":"later"}}]]'::jsonb,
  'a 단어 asking its meaning projects the meanings to the front and the word to the back');
select is((select jsonb_build_array(front, back) from public.cards where id = pg_temp.card('d', 1)),
  '[[{"type":"text","v":1,"id":"t","payload":{"text":"bonjour"}}],
    [{"type":"text","v":1,"payload":{"text":"hello"}}]]'::jsonb,
  'a card written in the frame before the migration is projected too');
select is((select back from public.cards where id = pg_temp.card('d', 2)), pg_temp.text('kept'),
  'a back a frame card held stays');
select is((select jsonb_build_array(front, back) from public.cards where id = pg_temp.card('e', 1)),
  jsonb_build_array(pg_temp.text('older build'), pg_temp.text('edit')),
  'a card an older build wrote back at v1 stays as it wrote it');
select is(
  (select to_jsonb(c) from public.cards as c where id = pg_temp.card('e', 2)),
  (select to_jsonb(e) from cards_edited as e where id = pg_temp.card('e', 2)),
  'a card deleted since stays a tombstone');

create temp table cards_reverted as select * from public.cards;
select is(private.revert_card_frame(), 0, 'a second revert changes nothing');
select is_empty('select * from public.cards except select * from cards_reverted',
  'a second revert changes no row');

-- Production's volume, 4,038 live cards on #488, and more, inside the 8 s a writer waiting on the
-- table lock has before `authenticated`'s statement timeout ends it.
insert into public.decks (id, user_id, name, created_at, updated_at)
  values ('d0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b', 'Volume',
    now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, template,
  template_version, created_at, updated_at)
select gen_random_uuid(), '00000000-0000-4000-8000-00000000000b',
  'd0000000-0000-4000-8000-00000000000b',
  case when n % 50 = 0
    then '[{"type":"cloze","v":1,"payload":{"text":"___ is red.","answers":["Rose"]}}]'::jsonb
    else pg_temp.text('front ' || n) end,
  case when n % 50 = 0 then pg_temp.text('Rose is red.')
    when n % 3 = 0
      then '[{"type":"senses","v":1,"payload":{"senses":[{"labels":[],"meaning":"사과","examples":[]}]}}]'::jsonb
    else pg_temp.text(repeat('뒷면 ', 40)) end,
  'volume ' || n, 'import', 'free', 1, now(), now()
from generate_series(1, 5000) as n;

create function pg_temp.seconds(call text) returns double precision language plpgsql as $$
declare
  started timestamptz := clock_timestamp();
begin
  execute call;
  return extract(epoch from clock_timestamp() - started);
end;
$$;
select pg_temp.seconds('select private.migrate_card_frame()') as migrate_seconds \gset
select diag('migrating 5,000 cards took ' || :'migrate_seconds' || ' s');
select is((select count(*) from public.cards
    where user_id = '00000000-0000-4000-8000-00000000000b' and template_version = 2),
  5000::bigint, 'all 5,000 volume cards convert');
select cmp_ok(:'migrate_seconds'::double precision, '<', 8::double precision,
  'the migration at volume ends inside a writer''s statement timeout');
select is(
  (select setting from pg_roles, unnest(rolconfig) as setting where rolname = 'authenticated'
    and setting like 'statement_timeout=%'),
  'statement_timeout=8s', 'authenticated''s statement timeout is the 8 s above');
select pg_temp.seconds('select private.revert_card_frame()') as revert_seconds \gset
select diag('reverting 5,000 cards took ' || :'revert_seconds' || ' s');
select cmp_ok(:'revert_seconds'::double precision, '<', 8::double precision,
  'the revert at volume ends inside a writer''s statement timeout');

-- The backup goes with its card, and so with its account.
select is((select count(*) from private.card_frame_backup
    where user_id = '00000000-0000-4000-8000-00000000000b'), 5000::bigint,
  'control: the account''s backup rows exist before it is deleted');
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select is((select count(*) from private.card_frame_backup
    where user_id = '00000000-0000-4000-8000-00000000000b'), 0::bigint,
  'deleting an account removes its backup rows');

select * from finish();
rollback;
