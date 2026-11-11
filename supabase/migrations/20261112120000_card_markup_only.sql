-- The card text markup becomes the only card format the server writes (#955, ADR 0254, which
-- supersedes ADR 0216): every stored `text` block below version 3 and `cloze` block below version 2
-- is converted, the switch that kept the older forms is removed, and the `text` and `cloze` skills
-- that teach the markup are the ones served.
--
-- Cards. `private.migrate_card_markup()` rewrites each row of `public.cards`, live or a tombstone,
-- whose `front` or `back` holds such a block, once, at the end of this migration:
--   - a `text` block holding `{front, back}` (version 2, or earlier without a version) becomes
--     version 3, each string written through the ADR 0208 escape (`private.markup_escape`) so that
--     the markup reads back as exactly the literal text it replaced, newlines normalised;
--   - a `text` block holding `{text}` (version 1) is the side block of a template a build no longer
--     writes. Only a tombstone's is converted, to version 3 with the text as `front` on the front
--     and as `back` on the back; a live card's is left and counted by a notice, since the template
--     that reads it reads that shape;
--   - a `cloze` block below version 2 becomes version 2 with its `text` and `answers` written as
--     Anki syntax, as `cloze_from_v1` of the engine does (`private.cloze_from_v1`, held to
--     engine/tests/fixtures/markup/ by supabase/tests/card_markup_only_test.sql). A cloze whose
--     blanks and answers differ in number, or with an empty answer, is not converted and is
--     counted by the notice, as the engine refuses it.
-- Card ids, `card_key`, notes, reviews and card states are unchanged. Each converted row takes a new
-- revision from `set_revision`, so every device pulls it, and its `updated_at` moves to now, or one
-- millisecond past its own when a device wrote it later. The screening triggers ignore this
-- migration's writes, which run as no client role; `private.note_content_hash` of a deck changes
-- with its converted cards, so a public deck's content hash is new.
--
-- Backups. `private.card_markup_backup` keeps every row changed, with the `front`, `back` and
-- `updated_at` it had and the `front` and `back` it was given; readable by no client, gone with its
-- card, so with its account too. A later migration drops it once the owner closes the window.
--
-- Skills. `text` and `cloze` each have a version labelled 'markup' (`20261109150000`), whose text
-- still calls the older cloze form accepted, and the `mixed` guide's example is a cloze of that form.
-- Each of the three gets a new version without it, labelled 'active' in place of the version served,
-- and the 'markup' labels are removed; versions are append-only, so the older ones stay, unserved.
-- The label check, `card_form_skills()` and `admin_activate_card_form_skill` are as
-- `20261105150000` made them. An admin's 'test' label is left.
--
-- The switch. `private.server_switches`, `card_markup_enabled`, `admin_card_markup` and
-- `admin_set_card_markup` are dropped, with the revert functions of the two migrations that made
-- them (`private.revert_card_markup_switch`, `private.revert_card_markup_ever_set`), which cannot
-- run without them. The audit log keeps its `set_card_markup` entries.
--
-- How it reaches devices. A device pulls each converted card by its new revision and reads it as
-- `text` version 3 or `cloze` version 2, which the app and the web read (ADR 0254).
--
-- Deploy. This migration and the `assistant`, `mcp` and `extract-cards` bundles of this change
-- deploy on merge together; the bundles deployed before it read `card_markup_enabled`, which is gone
-- once it applies, so for the moments between, the card tools of the old bundles refuse a write.
--
-- Revert, run once against production: `select private.revert_card_markup_only();`, then
-- `drop function private.revert_card_markup_only();`. A card still as this migration wrote it takes
-- back its `front`, `back` and `updated_at`, with a new revision; a card edited since, and a card
-- with no backup, stays. The `assistant`, `mcp` and `extract-cards` bundles go back with it. The
-- switch and the skills' labels are not reverted, on purpose: the switch was off and never set when
-- this was written (production, 2026-11-12), so removing it changes no behaviour to put back, and
-- the skill versions are append-only, so an admin returns to an earlier one through the 'test'
-- label and `admin_activate_card_form_skill`. A card written as version 3 or 2 after this migration
-- reads as unsupported on a build that predates the markup.

-- [text] written as markup that reads back as exactly that text, newlines normalised (`escape` of
-- supabase/functions/_shared/markup.ts and of engine/src/markup.rs): a backslash before each of
-- \ * _ ` { } : and, at a line start, before a `-` or digits and a point that would open a list.
-- [line_start] says whether the first character of [text] begins a line.
create function private.markup_escape(text text, line_start boolean) returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(
    case when (each.number > 1 or markup_escape.line_start)
      and (each.line ~ '^-' or each.line ~ '^[0-9]+\.') then '\' else '' end
    || regexp_replace(each.line, '([\\*_`{}:])', '\\\1', 'g'),
    E'\n' order by each.number), '')
  from regexp_split_to_table(
    replace(replace(markup_escape.text, E'\r\n', E'\n'), E'\r', E'\n'), E'\n')
    with ordinality as each (line, number);
$$;

-- A version 1 cloze, [text] with a `___` for each of [answers], as a text of Anki's syntax: blank k
-- becomes `{{ck::answer_k}}`. Null when the blanks and answers differ in number, an answer is not a
-- string, empty, or has a line of only whitespace (Unicode White_Space), as `cloze_from_v1` does.
create function private.cloze_from_v1(text text, answers jsonb) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[] := regexp_split_to_array(
    replace(replace(cloze_from_v1.text, E'\r\n', E'\n'), E'\r', E'\n'), '___');
  blanks integer;
  source text := '';
  answer text;
  index integer;
begin
  if jsonb_typeof(cloze_from_v1.answers) is distinct from 'array' then
    return null;
  end if;
  blanks := jsonb_array_length(cloze_from_v1.answers);
  if cardinality(parts) <> blanks + 1 then
    return null;
  end if;
  for index in 1..cardinality(parts) loop
    source := source || private.markup_escape(parts[index], index = 1);
    if index <= blanks then
      if jsonb_typeof(cloze_from_v1.answers -> (index - 1)) is distinct from 'string' then
        return null;
      end if;
      answer := replace(replace(cloze_from_v1.answers ->> (index - 1), E'\r\n', E'\n'),
        E'\r', E'\n');
      if exists (
        select from regexp_split_to_table(answer, E'\n') as each (line)
        where each.line ~ E'^[\\s\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]*$'
      ) then
        return null;
      end if;
      source := source || '{{c' || index || '::' || private.markup_escape(answer, false) || '}}';
    end if;
  end loop;
  return source;
end;
$$;

-- [block] as the markup's form: `text` version 3, `cloze` version 2, or [block] as it is when it is
-- one already, is of another type, or is of a shape this conversion leaves (see the header).
-- [side] is the array it sits in, 'front' or 'back'; [tombstone] whether its card is deleted.
create function private.card_markup_block(block jsonb, side text, tombstone boolean) returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  payload jsonb := block -> 'payload';
  version numeric;
  source text;
begin
  if jsonb_typeof(block) is distinct from 'object' or jsonb_typeof(payload) is distinct from 'object'
  then
    return block;
  end if;
  version := case when jsonb_typeof(block -> 'v') = 'number' then (block ->> 'v')::numeric else 0 end;

  if block ->> 'type' = 'text' and version < 3 then
    if jsonb_typeof(payload -> 'front') = 'string' and jsonb_typeof(payload -> 'back') = 'string'
    then
      return block || jsonb_build_object('v', 3, 'payload', payload || jsonb_build_object(
        'front', private.markup_escape(payload ->> 'front', true),
        'back', private.markup_escape(payload ->> 'back', true)));
    end if;
    if tombstone and jsonb_typeof(payload -> 'text') = 'string' then
      source := private.markup_escape(payload ->> 'text', true);
      return block || jsonb_build_object('v', 3, 'payload', (payload - 'text')
        || jsonb_build_object('front', case when side = 'front' then source else '' end,
          'back', case when side = 'back' then source else '' end));
    end if;
    return block;
  end if;

  if block ->> 'type' = 'cloze' and version < 2 and jsonb_typeof(payload -> 'text') = 'string' then
    source := private.cloze_from_v1(payload ->> 'text',
      coalesce(payload -> 'answers', '[]'::jsonb));
    if source is null then
      return block;
    end if;
    return block || jsonb_build_object('v', 2,
      'payload', (payload - 'answers') || jsonb_build_object('text', source));
  end if;
  return block;
end;
$$;

-- Each block of [blocks], an array, through `card_markup_block`, in order.
create function private.card_markup_blocks(blocks jsonb, side text, tombstone boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.card_markup_block(each.block, card_markup_blocks.side,
    card_markup_blocks.tombstone) order by each.number), '[]'::jsonb)
  from jsonb_array_elements(card_markup_blocks.blocks) with ordinality as each (block, number);
$$;

-- Whether [blocks] holds a `text` block below version 3 or a `cloze` block below version 2.
create function private.card_markup_below(blocks jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select from jsonb_array_elements(card_markup_below.blocks) as each (block)
    where jsonb_typeof(each.block) = 'object'
      and ((each.block ->> 'type' = 'text'
          and (case when jsonb_typeof(each.block -> 'v') = 'number'
            then (each.block ->> 'v')::numeric else 0 end) < 3)
        or (each.block ->> 'type' = 'cloze'
          and (case when jsonb_typeof(each.block -> 'v') = 'number'
            then (each.block ->> 'v')::numeric else 0 end) < 2)));
$$;

-- Each row the migration changed, with what it had and what it was given.
create table private.card_markup_backup (
  card_id uuid primary key references public.cards (id) on delete cascade,
  user_id uuid not null,
  front jsonb not null,
  back jsonb not null,
  updated_at timestamptz not null,
  written_front jsonb not null,
  written_back jsonb not null,
  migrated_at timestamptz not null default now()
);

alter table private.card_markup_backup enable row level security;
revoke all on private.card_markup_backup from public, anon, authenticated, service_role;

-- Converts every card the header names, keeping each row in the backup first, and returns how many
-- it converted. A second run converts none. A live card with a block below the markup's version
-- after it is named by a notice's count.
create function private.migrate_card_markup() returns integer
language plpgsql
set search_path = ''
as $$
declare
  converted integer;
  remaining integer;
begin
  -- Held before any row is read, so the row kept is the row replaced. Reads go on.
  lock table public.cards in share row exclusive mode;

  with written as (
    select c.id, c.user_id, c.front, c.back, c.updated_at,
      private.card_markup_blocks(c.front, 'front', c.deleted_at is not null) as new_front,
      private.card_markup_blocks(c.back, 'back', c.deleted_at is not null) as new_back
    from public.cards as c
    where private.card_markup_below(c.front) or private.card_markup_below(c.back)
  ),
  changed as (
    select * from written where new_front <> front or new_back <> back
  ),
  kept as (
    insert into private.card_markup_backup
      (card_id, user_id, front, back, updated_at, written_front, written_back)
    select id, user_id, front, back, updated_at, new_front, new_back from changed
    on conflict (card_id) do update
      set written_front = excluded.written_front, written_back = excluded.written_back
  )
  update public.cards as c
  set front = changed.new_front, back = changed.new_back,
    updated_at = greatest(now(), c.updated_at + interval '1 millisecond')
  from changed
  where c.id = changed.id;
  get diagnostics converted = row_count;

  select count(*) into remaining
  from public.cards as c
  where c.deleted_at is null
    and (private.card_markup_below(c.front) or private.card_markup_below(c.back));
  raise notice 'card markup: % cards converted, % live cards left as they are',
    converted, remaining;
  return converted;
end;
$$;

-- The skills. Three versions are appended, the texts of card_forms_seed.ts's `text`, `cloze` and
-- `mixed` (card_forms_seed_test.ts compares them with these): the `text` and `cloze` versions
-- labelled 'markup' with the one line that called the older cloze form "still accepted" taken out,
-- and the `mixed` version with its example cloze in Anki's syntax, since the server now refuses the
-- older form. They take the 'active' label of their form, and the 'markup' labels end.
insert into private.card_form_skills (form, summary, text, note) values
  ('text',
$summary$A question and its answer, or a name and what it means: one fact a card.$summary$,
$skill$# text: a question and its answer

Use it for a fact recalled from a prompt: a question and its answer, a concept and its definition, a rule and what it says.

Rules
- {"blocks":[{"type":"text","front":"…","back":"…"}]}: front is shown first and back at the reveal, each at most 2000 characters. The plain {"front":"…","back":"…"} is the same card.
- One fact a card. The front names what is asked, short enough to read at once, so the card is understood alone: "광합성", "Capital of France?". The back answers it and nothing more.
- Front and back are markup: **bold**, *italic* or _italic_, `code`, a list of lines starting "- " or "1. " (a sub-item indented by two spaces, one level), and each line break as typed. Headings, links, images and tables are not markup and stay as typed.
- Use a mark only where it teaches: bold on the one word that decides the answer, code for a formula or a command, a list for steps in order. Never to decorate.
- A backslash before \ * _ ` { } or : makes that character literal: write \* for a * that is not a mark, and \- at the start of a line that is not a list. list_cards shows a stored text with the backslashes it needs, and a text sent back as shown keeps its meaning.

Good
{"blocks":[{"type":"text","front":"광합성","back":"빛 에너지로 **이산화탄소**와 물에서 포도당을 만드는 과정"}]}
{"blocks":[{"type":"text","front":"Steps of mitosis","back":"1. prophase\n2. metaphase\n3. anaphase\n4. telophase"}]}

Bad
{"blocks":[{"type":"text","front":"광합성에 대해 설명하시오","back":"빛 에너지로 포도당을 만드는 과정. 엽록체에서 일어나며 명반응과 암반응으로 나뉜다."}]} — three facts on one back cannot be graded at once; make a card for each.
{"blocks":[{"type":"text","front":"**광합성**","back":"**빛** **에너지**로 **포도당**을 **만든다**"}]} — with everything bold nothing stands out.

Edge cases
- A word and its meanings is senses, not text.
- A sentence to recall word for word is cloze, and so is a line listing a group's members.
- An answer that would list more than five items is split into several cards, or made a table or a cloze.
- A * or _ that is plain text, as in 2*3*4 or snake_case, is written \* or \_ when it could be read as a mark.
$skill$,
  'markup only (#955)'),
  ('cloze',
$summary$A sentence or a line to recall in context, its key words hidden: {{c1::answer}} for each.$summary$,
$skill$# cloze: a sentence with blanks

Use it when the words matter in their place: a definition to recall word for word, a line listing a group's members, a formula, a sentence of a text.

Rules
- {"blocks":[{"type":"cloze","text":"…"}]}: text is the sentence with each hidden part written {{c1::answer}}, or {{c1::answer::hint}} to show a hint in the blank. The number after c starts at 1.
- Hidden parts with the same number are hidden together and graded as one blank; each number is its own blank. Give each part of a card its own number unless they are one fact, as a word and its repeat.
- An answer is not blank and holds no other {{c…::…}}. A text with no {{c1::…}} is refused.
- The text is markup as in the text guide: **bold**, *italic*, lists, line breaks, and a backslash before \ * _ ` { } or : for a literal one. A mark may sit inside an answer.
- Blank the words worth recalling, at most five numbers a card, and keep enough of the sentence that each blank has one answer.
- A line naming a group and its members keeps the group's name and blanks the members.

Good
{"blocks":[{"type":"cloze","text":"3인칭 재귀칭: {{c1::자기}}, {{c2::자신}}, {{c3::저}}, {{c4::저희}}"}]}
{"blocks":[{"type":"cloze","text":"광합성은 {{c1::엽록체::세포 소기관}}에서 일어난다."}]}

Bad
{"blocks":[{"type":"cloze","text":"{{c1::Paris}} is the {{c2::capital}} of {{c3::France}}."}]} — with almost every word hidden, nothing is left to recall them from.
{"blocks":[{"type":"cloze","text":"The capital is {{c1::}}."}]} — an answer cannot be empty.

Edge cases
- A line of more than five members becomes several cloze cards, each keeping the group's name.
- A blank whose answer has several right forms takes the material's.
- A blank that asks what another card already answers is left out: one fact, one card.
- A { or : of plain text, as in a formula, is written after a backslash so that it is not read as part of a {{c1::…}}.
$skill$,
  'markup only (#955)'),
  ('mixed',
$summary$Two or more of senses, cloze, table and image on one card, only when one fact needs them together.$summary$,
$skill$# mixed: forms combined on one card

A card's form is the one block type it holds besides text; text may accompany any form, as a name before a table or a back for a picture. A card holding two or more of senses, cloze, table and image is mixed.

Use it rarely: when one fact needs two forms at once, such as a picture whose label is recalled with a sentence about it.

Rules
- The blocks are shown in their order. The card needs something shown first and something added at the reveal; a cloze, a table or a picture with boxes counts for both.
- Every card of a mixed group is mixed; cards of one form go in a group of that form.

Good
{"blocks":[{"type":"image","url":"https://example.com/cell.png","boxes":[{"x":0.3,"y":0.4,"w":0.2,"h":0.1,"answer":"nucleus"}]},{"type":"cloze","text":"The {{c1::nucleus}} holds the cell's DNA."}]}

Bad
A mixed group of a senses card for each word and a cloze card for each sentence — those are two groups, senses and cloze.

Edge cases
- A text block beside a senses, cloze, table or image block is that block's form, not mixed.
- Two cards of one form each are better than one mixed card when the facts can be recalled apart.
$skill$,
  'markup only (#955)');

insert into private.card_form_skill_labels (form, label, version_id)
  select s.form, 'active', s.id from private.card_form_skills as s where s.note = 'markup only (#955)'
  on conflict on constraint card_form_skill_labels_pkey do update
    set version_id = excluded.version_id, set_by = null, set_at = now();

delete from private.card_form_skill_labels where label = 'markup';

alter table private.card_form_skill_labels drop constraint card_form_skill_labels_label_check;
alter table private.card_form_skill_labels add constraint card_form_skill_labels_label_check
  check (label in ('active', 'test'));

create or replace function public.card_form_skills()
returns table (form text, version_id bigint, summary text, text text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  admin boolean := exists (
    select from private.admins as a where a.user_id = (select auth.uid()));
begin
  return query
  select distinct on (l.form) l.form, v.id, v.summary, v.text
  from private.card_form_skill_labels as l
  join private.card_form_skills as v on v.id = l.version_id
  where l.label = 'active' or (l.label = 'test' and admin)
  order by l.form, l.label = 'test' desc;
end;
$$;

create or replace function public.admin_activate_card_form_skill(form text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  tested bigint;
  before bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.card_form_skill_labels', 9));
  select l.version_id into tested from private.card_form_skill_labels as l
    where l.form = admin_activate_card_form_skill.form and l.label = 'test';
  if not found then
    return 'no_test';
  end if;
  select l.version_id into before from private.card_form_skill_labels as l
    where l.form = admin_activate_card_form_skill.form and l.label = 'active';
  insert into private.card_form_skill_labels (form, label, version_id, set_by)
    values (admin_activate_card_form_skill.form, 'active', tested, caller)
    on conflict on constraint card_form_skill_labels_pkey do update
      set version_id = excluded.version_id, set_by = excluded.set_by, set_at = now();
  delete from private.card_form_skill_labels as l
    where l.form = admin_activate_card_form_skill.form and l.label = 'test';
  perform private.audit('activate_card_form_skill', 'card_form',
    admin_activate_card_form_skill.form,
    jsonb_build_object('version_id', tested, 'version_before', before));
  return 'activated';
end;
$$;

-- The switch.
drop function if exists private.revert_card_markup_ever_set();
drop function if exists private.revert_card_markup_switch();
drop function public.admin_set_card_markup(boolean);
drop function public.admin_card_markup();
drop function public.card_markup_enabled();
drop table private.server_switches;

-- Rolls the conversion back, and returns how many cards it restored; see the header.
create function private.revert_card_markup_only() returns integer
language plpgsql
set search_path = ''
as $$
declare
  restored integer;
begin
  lock table public.cards in share row exclusive mode;

  update public.cards as c
  set front = b.front, back = b.back,
    updated_at = greatest(now(), c.updated_at + interval '1 millisecond')
  from private.card_markup_backup as b
  where c.id = b.card_id and c.front = b.written_front and c.back = b.written_back;
  get diagnostics restored = row_count;
  return restored;
end;
$$;

revoke all on function private.markup_escape(text, boolean), private.cloze_from_v1(text, jsonb),
  private.card_markup_block(jsonb, text, boolean), private.card_markup_blocks(jsonb, text, boolean),
  private.card_markup_below(jsonb), private.migrate_card_markup(),
  private.revert_card_markup_only()
  from public, anon, authenticated;

select private.migrate_card_markup();
