-- The dry run of the 칸 frame's migration (ADR 0137, #488), supabase/card-frame-dry-run.sql, on a
-- fixture of each placement: run in a read-only transaction, it reports the fixture's count and
-- first five ids for every placement and every case of O2 and O3, adds its placements up to the
-- live cards, and returns no card content. A fixture id's first digit is its placement: 1 to 7,
-- 8 for no blank, 9 for a card the migration leaves, 0 for a tombstone.
--
-- `supabase test db` mounts this directory alone, so scripts/test-db.sh hands this test the
-- query's file as the database setting `knowno.card_frame_dry_run`.
begin;
select plan(35);

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000a', 'a@example.com');
insert into public.decks (id, user_id, name, created_at, updated_at)
  values ('d0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Cards',
    now(), now());

create function pg_temp.card(n text) returns text language sql as $$
  select 'c0000000-0000-4000-8000-000000000' || n
$$;
create function pg_temp.ids(variadic n text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(pg_temp.card(each) order by each), '[]') from unnest(n) as each
$$;
create function pg_temp.dry_run() returns jsonb language plpgsql as $$
declare
  report jsonb;
begin
  execute current_setting('knowno.card_frame_dry_run') into report;
  return report;
end;
$$;

insert into public.cards (id, user_id, deck_id, front, back, card_key, source, origin_deck_id,
  template, template_version, created_at, updated_at, deleted_at)
select pg_temp.card(n)::uuid, '00000000-0000-4000-8000-00000000000a',
  'd0000000-0000-4000-8000-00000000000a', front::jsonb, back::jsonb, n, source,
  case when source = 'copy' then 'd0000000-0000-4000-8000-00000000000a'::uuid end,
  template, version, now(), now(), deleted
from (
  with block (name, json) as (
    values
      ('text', '{"type":"text","v":1,"payload":{"text":"MARK"}}'),
      ('filled', '{"type":"text","payload":{"text":"MARK Paris and Rome"}}'),
      ('cloze', '{"type":"cloze","v":1,"payload":{"text":"MARK ___ and ___","answers":["Paris","Rome"]}}'),
      ('table', '{"type":"table","v":2,"payload":{"columns":["A","B"],"rows":[["a","MARK"],["c","d"]],"blanks":[{"row":0,"column":1}],"spans":[]}}'),
      ('table_filled', '{"type":"text","payload":{"text":"MARK\nA | B\na | MARK\nc | d"}}'),
      ('table_scalar', '{"type":"table","payload":{"columns":"MARK","rows":3}}'),
      ('senses', '{"type":"senses","payload":{"senses":[{"labels":[],"meaning":"MARK","examples":[]}]}}'),
      ('boxed', '{"type":"image","payload":{"media":"m","width":9,"height":9,"boxes":[{"id":"b","x":0,"y":0,"w":1,"h":1}]}}'),
      ('photo', '{"type":"image","payload":{"media":"m","width":9,"height":9,"boxes":[]}}'),
      ('sound', '{"type":"audio","payload":{"media":"m","duration_ms":9}}'),
      ('literal', '{"type":"text","payload":{"text":"MARK ___"}}'),
      ('future_type', '{"type":"chart","payload":{}}'),
      ('future_version', '{"type":"cloze","v":2,"payload":{"text":"MARK ___","answers":["x"]}}'),
      ('bad_version', '{"type":"text","v":"one","payload":{"text":"MARK"}}')
  )
  select fixture.*, (
    select '[' || coalesce(string_agg(block.json, ',' order by each.number), '') || ']'
    from unnest(fixture.fronts) with ordinality as each (name, number)
    join block on block.name = each.name
  ) as front, (
    select '[' || coalesce(string_agg(block.json, ',' order by each.number), '') || ']'
    from unnest(fixture.backs) with ordinality as each (name, number)
    join block on block.name = each.name
  ) as back
  from (values
    -- 1: an import or a copy of a cloze, its back the filled text or not.
    ('101', '{cloze}'::text[], '{filled}'::text[], 'import', null, null::smallint, null::timestamptz),
    ('102', '{cloze}', '{text}', 'copy', 'free', 1, null),
    -- 2: an import or a copy of a named table.
    ('201', '{text,table}', '{table_filled}', 'import', 'free', 1, null),
    -- 3: the former 빈칸 form, an import with no back among them.
    ('301', '{cloze}', '{}', 'manual', 'cloze', 1, null),
    ('302', '{cloze}', '{filled}', 'manual', 'free', 1, null),
    ('303', '{cloze}', '{text}', 'manual', 'free', 1, null),
    ('304', '{cloze}', '{}', 'import', 'free', 1, null),
    -- 4: any other front blank.
    ('401', '{text,cloze}', '{senses}', 'manual', 'free', 1, null),
    ('402', '{table}', '{}', 'manual', 'table', 1, null),
    ('403', '{text,cloze}', '{table}', 'manual', 'free', 1, null),
    ('404', '{text,cloze}', '{text}', 'import', 'free', 1, null),
    ('405', '{text,table}', '{table_filled}', 'manual', 'free', 1, null),
    ('406', '{table_scalar}', '{}', 'manual', 'free', 1, null),
    ('407', '{senses,cloze}', '{text}', 'manual', 'free', 1, null),
    ('408', '{text,cloze}', '{table,text}', 'manual', 'free', 1, null),
    -- 5: a blank on the back alone.
    ('501', '{text}', '{cloze}', 'manual', 'free', 1, null),
    ('502', '{text}', '{cloze,text}', 'manual', 'free', 1, null),
    -- 6: a photo with boxes, on either side.
    ('601', '{boxed}', '{}', 'manual', 'free', 1, null),
    ('602', '{text}', '{boxed,text}', 'manual', 'free', 1, null),
    ('603', '{boxed,text}', '{text}', 'manual', 'free', 1, null),
    -- 7: a literal ___ in a text block, on either side, and no blank.
    ('701', '{literal}', '{text}', 'manual', 'flip', 1, null),
    ('702', '{text}', '{literal}', 'manual', 'free', 1, null),
    -- No blank: six, so the samples stop at five.
    ('801', '{text}', '{text}', 'manual', 'flip', 1, null),
    ('802', '{text}', '{senses}', 'import', 'free', 1, null),
    ('803', '{photo}', '{sound}', 'manual', 'free', 1, null),
    ('804', '{senses}', '{text}', 'import', 'free', 1, null),
    ('805', '{sound}', '{}', 'manual', 'free', 1, null),
    ('806', '{text}', '{text}', 'manual', 'free', 1, null),
    -- Left: a template or a version no build wrote, or a block of either; a blank among them.
    ('901', '{cloze}', '{filled}', 'import', 'future', 1, null),
    ('902', '{text}', '{text}', 'manual', 'free', 2, null),
    ('903', '{text,future_type}', '{cloze}', 'manual', 'free', 1, null),
    ('904', '{future_version}', '{text}', 'manual', 'free', 1, null),
    ('905', '{text}', '{bad_version}', 'manual', 'free', 1, null),
    -- A tombstone, of a shape that would count.
    ('001', '{cloze}', '{filled}', 'import', 'free', 1, now())
  ) as fixture (n, fronts, backs, source, template, version, deleted)
) as cards;

-- Read-only from here to the rollback: a query that writes stops the test.
savepoint read_only;
set local transaction_read_only = on;
select pg_temp.dry_run() as report \gset
rollback to savepoint read_only;
create temp table dry_run as select :'report'::jsonb as report;

select is((select report->'live_cards' from dry_run), '33', 'every live card is read, no tombstone');
select is(
  (select sum((value->>'cards')::int) from dry_run, jsonb_each(report)
    where key like 'placement\__' or key in ('no_blank', 'left')),
  33::bigint, 'each live card is in one placement');

select is((select report->'placement_1'->'cards' from dry_run), '2', 'placement 1 counts');
select is((select report->'placement_1'->'samples' from dry_run), pg_temp.ids('101', '102'),
  'placement 1 names its cards');
select is((select report->'placement_2'->'cards' from dry_run), '1', 'placement 2 counts');
select is((select report->'placement_2'->'samples' from dry_run), pg_temp.ids('201'),
  'placement 2 names its cards');
select is((select report->'placement_3'->'cards' from dry_run), '4', 'placement 3 counts');
select is((select report->'placement_3'->'samples' from dry_run),
  pg_temp.ids('301', '302', '303', '304'), 'placement 3 names its cards');
select is((select report->'placement_4'->'cards' from dry_run), '8', 'placement 4 counts');
select is((select report->'placement_4'->'samples' from dry_run),
  pg_temp.ids('401', '402', '403', '404', '405'), 'placement 4 names its first five cards');
select is((select report->'placement_5'->'cards' from dry_run), '2', 'placement 5 counts');
select is((select report->'placement_5'->'samples' from dry_run), pg_temp.ids('501', '502'),
  'placement 5 names its cards');
select is((select report->'placement_6'->'cards' from dry_run), '3', 'placement 6 counts');
select is((select report->'placement_6'->'samples' from dry_run),
  pg_temp.ids('601', '602', '603'), 'placement 6 names its cards');
select is((select report->'placement_7'->'cards' from dry_run), '2', 'placement 7 counts');
select is((select report->'placement_7'->'samples' from dry_run), pg_temp.ids('701', '702'),
  'placement 7 names its cards');
select is((select report->'no_blank'->'cards' from dry_run), '6', 'no blank counts');
select is((select report->'no_blank'->'samples' from dry_run),
  pg_temp.ids('801', '802', '803', '804', '805'), 'no blank names its first five cards');
select is((select report->'left'->'cards' from dry_run), '5', 'the cards left count');
select is((select report->'left'->'samples' from dry_run),
  pg_temp.ids('901', '902', '903', '904', '905'), 'the cards left are named');

select is((select report->'derived_filled_text'->'cards' from dry_run), '4',
  'the backs equal to the filled text count');
select is((select report->'derived_filled_text'->'samples' from dry_run),
  pg_temp.ids('101', '201', '302', '405'), 'the backs equal to the filled text are named');
select is((select report->'derived_source'->'cards' from dry_run), '2',
  'the other backs of an import or a copy count');
select is((select report->'derived_source'->'samples' from dry_run), pg_temp.ids('102', '404'),
  'the other backs of an import or a copy are named');
select is((select report->'o2'->'cards' from dry_run), '6', 'O2 counts');
select is((select report->'o2'->'samples' from dry_run),
  pg_temp.ids('303', '401', '403', '407', '408'), 'O2 names its first five cards');
select is((select report->'o2_back_blank'->'cards' from dry_run), '2',
  'the O2 cards with a back blank count');
select is((select report->'o2_back_blank'->'samples' from dry_run), pg_temp.ids('403', '408'),
  'the O2 cards with a back blank are named');
select is((select report->'o3'->'cards' from dry_run), '2', 'O3 counts');
select is((select report->'o3'->'samples' from dry_run), pg_temp.ids('502', '602'),
  'O3 names its cards');

select is((select count(*) from dry_run, jsonb_each(report) where key <> 'live_cards'), 14::bigint,
  'the report holds fourteen tallies');
select is(
  (select count(*) from dry_run, jsonb_each(report)
    where key <> 'live_cards' and (select array_agg(k order by k) from jsonb_object_keys(value) as k)
      = '{cards,samples}'),
  14::bigint, 'each tally holds its count and its ids alone');
select cmp_ok((select count(*) from public.cards where (front || back)::text like '%MARK%'), '>',
  0::bigint, 'the fixture holds the marked content');
select unalike((select report::text from dry_run), '%MARK%', 'the report holds no card content');
select unalike((select report::text from dry_run), '%Paris%', 'the report holds no filled answer');

select * from finish();
rollback;
