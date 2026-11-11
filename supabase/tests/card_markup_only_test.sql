-- The conversion to the card text markup (#955, ADR 0254): `private.markup_escape` and
-- `private.cloze_from_v1` on the engine's fixtures, the escape and the version 1 cloze, each case as
-- its expected text or refused; `private.migrate_card_markup` on cards of each stored shape,
-- live and tombstoned, converted to `text` version 3 and `cloze` version 2 with ids, keys and notes
-- unchanged and `updated_at` moved; what it leaves, the backup, a second run and the revert; and
-- what the migration removed: the switch, its functions and the 'markup' label.
--
-- The two fixture lists below are copies of engine/tests/fixtures/markup/escape.json and v1.json
-- (scripts/test-db.ts hands a test no file of its own); markup_only_fixtures_test.ts of
-- supabase/functions/_shared/ fails when either differs from its file.
begin;

create temp table escapes as
select each.number::int as n, each.fixture ->> 'name' as name, each.fixture ->> 'text' as text,
  each.fixture ->> 'escaped' as escaped
from jsonb_array_elements($escape$
[
 {
  "escaped": "",
  "name": "empty text",
  "text": ""
 },
 {
  "escaped": "plain 가 #a [b](c)",
  "name": "plain text is unchanged",
  "text": "plain 가 #a [b](c)"
 },
 {
  "escaped": "a\\\\b",
  "name": "a backslash",
  "text": "a\\b"
 },
 {
  "escaped": "a\\\\",
  "name": "a trailing backslash",
  "text": "a\\"
 },
 {
  "escaped": "\\*a\\* \\*\\*b\\*\\*",
  "name": "asterisks",
  "text": "*a* **b**"
 },
 {
  "escaped": "\\_a\\_ snake\\_case",
  "name": "underscores",
  "text": "_a_ snake_case"
 },
 {
  "escaped": "\\`a\\`",
  "name": "backticks",
  "text": "`a`"
 },
 {
  "escaped": "\\{a\\}",
  "name": "braces",
  "text": "{a}"
 },
 {
  "escaped": "a\\:b\\:\\:c",
  "name": "colons",
  "text": "a:b::c"
 },
 {
  "escaped": "\\{\\{c1\\:\\:x\\:\\:y\\}\\}",
  "name": "a cloze",
  "text": "{{c1::x::y}}"
 },
 {
  "escaped": "\\- a",
  "name": "a dash at the start",
  "text": "- a"
 },
 {
  "escaped": "\\-",
  "name": "a lone dash",
  "text": "-"
 },
 {
  "escaped": "a\n\\- b",
  "name": "a dash at a later line start",
  "text": "a\n- b"
 },
 {
  "escaped": "a - b",
  "name": "a dash inside a line",
  "text": "a - b"
 },
 {
  "escaped": "\\1. a",
  "name": "a number and a point at the start",
  "text": "1. a"
 },
 {
  "escaped": "\\12.5",
  "name": "a longer number and a point",
  "text": "12.5"
 },
 {
  "escaped": "1 a",
  "name": "a number without a point",
  "text": "1 a"
 },
 {
  "escaped": "a 1. b",
  "name": "a number inside a line",
  "text": "a 1. b"
 },
 {
  "escaped": "  - a",
  "name": "an indented dash",
  "text": "  - a"
 },
 {
  "escaped": "a\n\n\nb",
  "name": "blank lines are kept",
  "text": "a\n\n\nb"
 },
 {
  "escaped": "\n",
  "name": "a lone newline",
  "text": "\n"
 },
 {
  "escaped": "a\n  \nb",
  "name": "a line of spaces",
  "text": "a\n  \nb"
 },
 {
  "escaped": "a\nb\nc",
  "name": "crlf and a lone carriage return are newlines",
  "text": "a\r\nb\rc"
 },
 {
  "escaped": "\\\\- a",
  "name": "a backslash then a dash at a line start",
  "text": "\\- a"
 }
]
$escape$::jsonb) with ordinality as each (fixture, number);

create temp table clozes as
select each.number::int as n, each.fixture ->> 'name' as name, each.fixture ->> 'text' as text,
  each.fixture -> 'answers' as answers, each.fixture ->> 'source' as source
from jsonb_array_elements($v1$
[
 {
  "answers": [
   "Paris"
  ],
  "name": "one blank",
  "source": "The capital is {{c1::Paris}}.",
  "text": "The capital is ___."
 },
 {
  "answers": [
   "Paris",
   "France"
  ],
  "name": "two blanks",
  "source": "{{c1::Paris}} is the capital of {{c2::France}}",
  "text": "___ is the capital of ___"
 },
 {
  "answers": [
   "a",
   "b"
  ],
  "name": "a blank at each end",
  "source": "{{c1::a}} middle {{c2::b}}",
  "text": "___ middle ___"
 },
 {
  "answers": [
   "a",
   "b"
  ],
  "name": "adjacent blanks",
  "source": "{{c1::a}}{{c2::b}}",
  "text": "______"
 },
 {
  "answers": [
   "a"
  ],
  "name": "four underscores are a blank and an underscore",
  "source": "{{c1::a}}\\_",
  "text": "____"
 },
 {
  "answers": [],
  "name": "no blank and no answer",
  "source": "plain",
  "text": "plain"
 },
 {
  "answers": [
   "한국"
  ],
  "name": "korean",
  "source": "서울은 {{c1::한국}}의 수도다",
  "text": "서울은 ___의 수도다"
 },
 {
  "answers": [
   "x y"
  ],
  "name": "an answer with spaces",
  "source": "a {{c1::x y}} b",
  "text": "a ___ b"
 },
 {
  "answers": [
   "c"
  ],
  "name": "a line break in the text",
  "source": "a\n{{c1::c}}\nb",
  "text": "a\n___\nb"
 },
 {
  "answers": [
   "std::vec"
  ],
  "name": "an answer holding colons is escaped",
  "source": "a {{c1::std\\:\\:vec}}",
  "text": "a ___"
 },
 {
  "answers": [
   "x}}y"
  ],
  "name": "an answer holding closing braces is escaped",
  "source": "a {{c1::x\\}\\}y}}",
  "text": "a ___"
 },
 {
  "answers": [
   "**b**"
  ],
  "name": "an answer holding a mark is escaped",
  "source": "a {{c1::\\*\\*b\\*\\*}}",
  "text": "a ___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "a mark in the text is escaped",
  "source": "\\*a\\* {{c1::b}}",
  "text": "*a* ___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "a literal cloze in the text is escaped",
  "source": "\\{\\{c2\\:\\:x\\}\\} {{c1::b}}",
  "text": "{{c2::x}} ___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "a list marker in the text is escaped",
  "source": "\\- a {{c1::b}}",
  "text": "- a ___"
 },
 {
  "answers": [
   " "
  ],
  "name": "an answer of spaces is refused",
  "source": null,
  "text": "a ___"
 },
 {
  "answers": [
   "a"
  ],
  "name": "fewer answers than blanks is refused",
  "source": null,
  "text": "___ ___"
 },
 {
  "answers": [
   "a",
   "b"
  ],
  "name": "more answers than blanks is refused",
  "source": null,
  "text": "___"
 },
 {
  "answers": [
   "a"
  ],
  "name": "a numbered marker in the text is escaped",
  "source": "\\1. {{c1::a}}",
  "text": "1. ___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "a dash at a later line start is escaped",
  "source": "a\n\\- {{c1::b}}",
  "text": "a\n- ___"
 },
 {
  "answers": [
   "c"
  ],
  "name": "a backslash in the text is escaped",
  "source": "a\\\\b {{c1::c}}",
  "text": "a\\b ___"
 },
 {
  "answers": [
   "x\\"
  ],
  "name": "an answer ending in a backslash is escaped",
  "source": "a {{c1::x\\\\}}",
  "text": "a ___"
 },
 {
  "answers": [
   "x:"
  ],
  "name": "an answer ending in a colon is escaped",
  "source": "a {{c1::x\\:}}",
  "text": "a ___"
 },
 {
  "answers": [
   "x}"
  ],
  "name": "an answer ending in a brace is escaped",
  "source": "a {{c1::x\\}}}",
  "text": "a ___"
 },
 {
  "answers": [
   "x\ny"
  ],
  "name": "an answer of two lines keeps its line break",
  "source": "a {{c1::x\ny}}",
  "text": "a ___"
 },
 {
  "answers": [
   "x\n- y"
  ],
  "name": "a dash at a later line of an answer is escaped",
  "source": "a {{c1::x\n\\- y}}",
  "text": "a ___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "crlf in the text reads as a newline",
  "source": "a\n{{c1::b}}",
  "text": "a\r\n___"
 },
 {
  "answers": [
   "b"
  ],
  "name": "blank lines in the text are kept",
  "source": "a\n\n\n{{c1::b}}",
  "text": "a\n\n\n___"
 },
 {
  "answers": [
   ""
  ],
  "name": "an empty answer is refused",
  "source": null,
  "text": "a ___"
 },
 {
  "answers": [
   "x\n \ny"
  ],
  "name": "an answer holding a line of spaces is refused",
  "source": null,
  "text": "a ___"
 }
]
$v1$::jsonb) with ordinality as each (fixture, number);

select plan(24 + (select count(*)::int from escapes) + (select count(*)::int from clozes));

-- The escape and the version 1 cloze on the engine's fixtures.

select is(private.markup_escape(text, true), escaped, 'escape: ' || name)
from escapes order by n;
select is(private.cloze_from_v1(text, answers), source, 'cloze: ' || name)
from clozes order by n;

-- Cards of each stored shape. A is the user; each card is written at one `updated_at`.

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com');
insert into public.decks (id, user_id, name, created_at, updated_at)
  values ('d0000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a', 'Cards',
    now(), now());

create function pg_temp.card(n int) returns uuid language sql as $$
  select ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.add(n int, front jsonb, back jsonb, template text, version int,
  deleted timestamptz default null) returns void language sql as $$
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, template,
    template_version, created_at, updated_at, deleted_at)
  values (pg_temp.card(n), '00000000-0000-4000-8000-00000000000a',
    'd0000000-0000-4000-8000-00000000000a', front, back, 'key ' || n, 'manual', template, version,
    '2026-10-01 09:00:00+00', '2026-10-02 09:00:00.123+00', deleted)
$$;
create function pg_temp.cell(type text, v int, payload jsonb) returns jsonb language sql as $$
  select jsonb_build_object('type', type, 'v', v, 'id', 'cell-' || type, 'payload', payload)
$$;

-- 1: a text v2 cell read as literal; 9: the same beside a cell it leaves, in order.
select pg_temp.add(1, jsonb_build_array(pg_temp.cell('text', 2,
  '{"front":"*a* snake_case","back":"1. step"}')), '[]', 'free', 2);
select pg_temp.add(9, jsonb_build_array(
  pg_temp.cell('senses', 2, '{"term":"x","ask":"term","senses":[]}'),
  pg_temp.cell('text', 2, '{"front":"- b","back":""}'),
  pg_temp.cell('image', 2, '{"side":"front"}')), '[]', 'free', 2);
-- 2: a cloze v1 of two blanks; 3: a cloze with no version.
select pg_temp.add(2, jsonb_build_array(pg_temp.cell('cloze', 1,
  '{"text":"___ is the capital of ___","answers":["Paris","France"]}')), '[]', 'free', 2);
select pg_temp.add(3, jsonb_build_array(jsonb_build_object('type', 'cloze', 'payload',
  '{"text":"a: ___","answers":["b"]}'::jsonb)), '[]', 'free', 2);
-- 4: a tombstone of the side blocks, text v1 in each; 5: a tombstone holding text with no
-- version and a cloze v1.
select pg_temp.add(4, jsonb_build_array(pg_temp.cell('text', 1, '{"text":"*q*"}')),
  jsonb_build_array(pg_temp.cell('text', 1, '{"text":"- a"}')), null, null, now());
select pg_temp.add(5, jsonb_build_array(jsonb_build_object('type', 'text', 'payload',
    '{"front":"f_1","back":"b"}'::jsonb)),
  jsonb_build_array(pg_temp.cell('cloze', 1, '{"text":"x ___","answers":["y"]}')),
  'free', 2, now());
-- 6: a live text v1; 7: a live cloze v1 whose answers do not match its blanks. Both are left.
select pg_temp.add(6, jsonb_build_array(pg_temp.cell('text', 1, '{"text":"*q*"}')), '[]',
  null, null);
select pg_temp.add(7, jsonb_build_array(pg_temp.cell('cloze', 1,
  '{"text":"___ ___","answers":["a"]}')), '[]', 'free', 2);
-- 8: already the markup's forms.
select pg_temp.add(8, jsonb_build_array(pg_temp.cell('text', 3, '{"front":"*a*","back":"b"}'),
  pg_temp.cell('cloze', 2, '{"text":"{{c1::a}}"}')), '[]', 'free', 2);

create temp table prior as
select c.id, c.front, c.back, c.card_key, c.deck_id, c.created_at, c.updated_at, c.revision,
  c.template, c.template_version, c.deleted_at
from public.cards as c;

select is(private.migrate_card_markup(), 6, 'it converts the six cards that held an older form');

select is((select front from public.cards where id = pg_temp.card(1)),
  jsonb_build_array(pg_temp.cell('text', 3,
    '{"front":"\\*a\\* snake\\_case","back":"\\1. step"}')),
  'a text v2 becomes v3, its strings escaped, its id kept');
select is((select front from public.cards where id = pg_temp.card(9)),
  jsonb_build_array(
    pg_temp.cell('senses', 2, '{"term":"x","ask":"term","senses":[]}'),
    pg_temp.cell('text', 3, '{"front":"\\- b","back":""}'),
    pg_temp.cell('image', 2, '{"side":"front"}')),
  'the cells beside it stay as they were, in order');
select is((select front from public.cards where id = pg_temp.card(2)),
  jsonb_build_array(pg_temp.cell('cloze', 2,
    '{"text":"{{c1::Paris}} is the capital of {{c2::France}}"}')),
  'a cloze v1 becomes v2 in Anki syntax, its answers gone');
select is((select front from public.cards where id = pg_temp.card(3)),
  jsonb_build_array(jsonb_build_object('type', 'cloze', 'v', 2, 'payload',
    '{"text":"a\\: {{c1::b}}"}'::jsonb)),
  'a cloze with no version becomes v2, its text escaped');
select is((select front || back from public.cards where id = pg_temp.card(4)),
  jsonb_build_array(
    pg_temp.cell('text', 3, '{"front":"\\*q\\*","back":""}'),
    pg_temp.cell('text', 3, '{"front":"","back":"\\- a"}')),
  'a tombstone''s text v1 becomes v3 on the side it sat on');
select is((select front || back from public.cards where id = pg_temp.card(5)),
  jsonb_build_array(
    jsonb_build_object('type', 'text', 'v', 3, 'payload', '{"front":"f\\_1","back":"b"}'::jsonb),
    pg_temp.cell('cloze', 2, '{"text":"x {{c1::y}}"}')),
  'a tombstone''s text with no version and cloze v1 become v3 and v2');

select is((select count(*) from public.cards as c join prior as b using (id)
    where c.id in (select id from public.cards where id in (
        pg_temp.card(1), pg_temp.card(2), pg_temp.card(3), pg_temp.card(4), pg_temp.card(5),
        pg_temp.card(9)))
      and c.card_key = b.card_key and c.deck_id = b.deck_id and c.created_at = b.created_at
      and c.template is not distinct from b.template
      and c.template_version is not distinct from b.template_version
      and c.deleted_at is not distinct from b.deleted_at),
  6::bigint, 'ids, keys, decks, templates and tombstones are unchanged');
select is((select count(*) from public.cards as c join prior as b using (id)
    where c.updated_at > b.updated_at and c.revision > b.revision),
  6::bigint, 'each converted row''s updated_at and revision moved');

select is((select count(*) from public.cards as c join prior as b using (id)
    where c.id in (pg_temp.card(6), pg_temp.card(7), pg_temp.card(8))
      and c.front = b.front and c.back = b.back and c.updated_at = b.updated_at
      and c.revision = b.revision),
  3::bigint, 'a live text v1, a cloze it cannot convert and a card already converted are untouched');

select results_eq($$select card_id, front = (select b.front from prior as b where b.id = card_id),
    written_front = (select c.front from public.cards as c where c.id = card_id)
    from private.card_markup_backup order by card_id$$,
  $$select pg_temp.card(n), true, true from generate_series(1, 5) as n
    union all select pg_temp.card(9), true, true order by 1$$,
  'the backup holds each changed row as it was and what it was given, and no other');

select is(private.migrate_card_markup(), 0, 'a second run converts none');

-- No client reads the backup or the functions.

set local role authenticated;
select throws_ok($$select * from private.card_markup_backup$$, '42501', null,
  'a signed-in user reads no backup');
select throws_ok($$select private.migrate_card_markup()$$, '42501', null,
  'and runs no conversion');
reset role;

-- The revert restores a row as it was, and leaves one edited since.

update public.cards set front = '[]' where id = pg_temp.card(2);
select is(private.revert_card_markup_only(), 5, 'the revert restores the five rows still as written');
select is((select front from public.cards where id = pg_temp.card(1)),
  (select front from prior where id = pg_temp.card(1)), 'a card takes back its older form');
select is((select front from public.cards where id = pg_temp.card(4)),
  (select front from prior where id = pg_temp.card(4)), 'a tombstone too');
select is((select front from public.cards where id = pg_temp.card(2)), '[]'::jsonb,
  'a card edited since stays');
select is((select c.updated_at > b.updated_at from public.cards as c join prior as b using (id)
    where c.id = pg_temp.card(1)), true, 'a restored row''s updated_at moves again');

-- What the migration removed.

select is((select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where p.proname in ('card_markup_enabled', 'admin_card_markup', 'admin_set_card_markup',
      'revert_card_markup_switch', 'revert_card_markup_ever_set')), 0::bigint,
  'the switch''s functions and their reverts are gone');
select is(to_regclass('private.server_switches'), null, 'and its table');
select is((select count(*) from private.card_form_skill_labels where label = 'markup'), 0::bigint,
  'no version is labelled markup');
select throws_ok($$insert into private.card_form_skill_labels (form, label, version_id)
    values ('image', 'markup', (select id from private.card_form_skills limit 1))$$,
  '23514', null, 'and none can be');
select is((select count(*) from private.card_form_skills as v
    join private.card_form_skill_labels as l on l.version_id = v.id and l.label = 'active'
    where v.form in ('text', 'cloze', 'mixed') and v.note = 'markup only (#955)'), 3::bigint,
  'the markup''s text, cloze and mixed versions are the active ones');

select * from finish();
rollback;
