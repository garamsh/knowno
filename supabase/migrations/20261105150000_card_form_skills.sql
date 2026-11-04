-- The card-form skills (#751, ADR 0197): for each form a card takes, a one-line summary of when it
-- fits and a guide to making it, saved as append-only versions as the prompts are; each form's
-- 'active' version serves everyone and its 'test' version, while one is set, admins, as the
-- assistant's and MCP's `card_form_skills` read them. Admins save, apply and end a test version.
-- And the assistant's prompt v2, which records its working order, as 스페셜's draft.
--
-- Not additive alone. It creates two tables in `private`, their functions and their seed, each
-- form's first version, labelled 'active'. It also appends to existing tables, changing and
-- deleting no row of them:
--   - `private.assistant_prompts`: prompt v2;
--   - `private.assistant_configurations`: while 스페셜, the admins' plan, has no assistant draft,
--     its active configuration with prompt v2;
--   - `private.assistant_configuration_labels`: that configuration as 스페셜's 'test' label, so
--     admins are served it. A draft 스페셜 already has is kept. Another plan takes v2 by a draft an
--     admin saves in 말랑이; no other plan gets one here, since 말랑이 opens on the first plan with
--     a draft.
-- What a user who is not an admin is served by the assistant stays the active configuration's.
--
-- Deploy. The assistant and mcp bundles of this change read `card_form_skills`, so this migration
-- applies before they deploy; the bundles deployed before it read nothing here.
--
-- Revert, run once against production: `select private.revert_card_form_skills();`, then
-- `drop function private.revert_card_form_skills();`. It drops the two tables, their versions with
-- them, and the functions, and ends each plan's draft that sends prompt v2. A plan whose active
-- configuration sends prompt v2 by then keeps it; an admin points it back with a draft.
--   - It runs before `private.revert_assistant()` and `private.revert_assistant_tokens()`: it
--     deletes from `private.assistant_configuration_labels`, which the assistant's revert drops.
--   - The assistant and mcp bundles go back with it, to those of the commit before this change:
--     the bundles of this change read `card_form_skills`, and without it answer every message 503
--     and every resource read -32603.

-- Every saved skill version: its form, when the form fits in one line, the guide, a note, who saved
-- it and when. Rows are never changed or removed but for their author's removal.
create table private.card_form_skills (
  id bigint generated always as identity primary key,
  form text not null check (form in ('text', 'senses', 'cloze', 'table', 'image', 'mixed')),
  summary text not null check (char_length(summary) <= 300 and summary ~ '\S'
    and summary !~ '[\n\r]'),
  text text not null check (char_length(text) <= 20000 and text ~ '\S'),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (id, form)
);

create index card_form_skills_created_by on private.card_form_skills (created_by);

-- Refuses any change to a version but its author's removal, which deleting that account sets.
create function private.keep_card_form_skill() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.form = old.form
    and new.summary = old.summary and new.text = old.text and new.note = old.note
    and new.created_at = old.created_at and new.created_by is null
  then
    return new;
  end if;
  raise exception 'card form skills are append-only' using errcode = '55000';
end;
$$;

create trigger card_form_skills_append_only before update or delete on private.card_form_skills
  for each row execute function private.keep_card_form_skill();

-- Which version serves each form: 'active' for everyone, and 'test', when set, for admins.
create table private.card_form_skill_labels (
  form text not null,
  label text not null check (label in ('active', 'test')),
  version_id bigint not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now(),
  primary key (form, label),
  foreign key (version_id, form) references private.card_form_skills (id, form)
);

create index card_form_skill_labels_version_id
  on private.card_form_skill_labels (version_id, form);
create index card_form_skill_labels_set_by on private.card_form_skill_labels (set_by);

alter table private.card_form_skills enable row level security;
alter table private.card_form_skill_labels enable row level security;
revoke all on private.card_form_skills, private.card_form_skill_labels
  from public, anon, authenticated, service_role;

-- The seed: each form's first version, the texts of supabase/functions/_shared/card_forms_seed.ts,
-- which card_forms_seed_test.ts compares with these, labelled 'active'.
insert into private.card_form_skills (form, summary, text, note) values
  ('text',
$summary$A question and its answer, or a name and what it means: one fact a card.$summary$,
$skill$# text: a question and its answer

Use it for a fact recalled from a prompt: a question and its answer, a concept and its definition, a rule and what it says.

Rules
- {"blocks":[{"type":"text","front":"…","back":"…"}]}: front is shown first and back at the reveal, each at most 2000 characters. The plain {"front":"…","back":"…"} is the same card.
- One fact a card. The front names what is asked, short enough to read at once, so the card is understood alone: "광합성", "Capital of France?". The back answers it and nothing more.

Good
{"blocks":[{"type":"text","front":"광합성","back":"빛 에너지로 이산화탄소와 물에서 포도당을 만드는 과정"}]}

Bad
{"blocks":[{"type":"text","front":"광합성에 대해 설명하시오","back":"빛 에너지로 포도당을 만드는 과정. 엽록체에서 일어나며 명반응과 암반응으로 나뉜다."}]} — three facts on one back cannot be graded at once; make a card of each.

Edge cases
- A word and its meanings is senses, not text.
- A sentence to recall word for word is cloze, and so is a line listing a group's members.
- An answer that would list more than five items is split into several cards, or made a table or a cloze.
$skill$,
  'seed (#751)'),
  ('senses',
$summary$A word or expression and its meanings, as a word list or glossary holds them: one card a word.$summary$,
$skill$# senses: a word and its meanings

Use it for vocabulary: a word, an idiom or a term learned with its meanings, as a word list, a glossary or a dictionary page holds them.

Rules
- {"blocks":[{"type":"senses","term":"…","ask":"term","senses":[{"labels":[…],"meaning":"…","examples":[…]}]}]}: each sense a meaning with at most 10 labels and 10 examples, at most 20 senses a word.
- ask names what is shown first: term to recall the meaning, or meaning to recall the word. Give a whole group one ask unless the user asks otherwise.
- A meaning is the translation or the definition as the material gives it. A label is a part of speech or a tag the material prints, such as 명 or 동; add none it does not print.
- Examples are sentences the material prints for that meaning; never make one up.
- A word with several meanings is one card with several senses, never a card a meaning.

Good
{"blocks":[{"type":"senses","term":"run","ask":"term","senses":[{"labels":["동"],"meaning":"달리다","examples":["She runs every morning."]},{"labels":["명"],"meaning":"달리기","examples":[]}]}]}

Bad
{"blocks":[{"type":"text","front":"run (동)","back":"달리다; 명: 달리기"}]} — a word list made text cards loses its senses and labels, and two meanings share one back.

Edge cases
- An idiom or a set phrase is a term too: "give up" with the meaning "포기하다".
- A word the material gives no meaning for is not a card: ask the user, or leave it out.
- The same word twice in the material with different meanings is one card holding both senses.
- The term is the word being learned, in the material's direction, whichever language it is.
$skill$,
  'seed (#751)'),
  ('cloze',
$summary$A sentence or a line to recall in context, its key words blanked: one ___ for each answer.$summary$,
$skill$# cloze: a sentence with blanks

Use it when the words matter in their place: a definition to recall word for word, a line listing a group's members, a formula, a sentence of a text.

Rules
- {"blocks":[{"type":"cloze","text":"…","answers":["…"]}]}: text holds one ___ for each answer, in order, and each answer holds text.
- Blank the words worth recalling, at most five a card, and keep enough of the sentence that each blank has one answer.
- A line naming a group and its members keeps the group's name and blanks the members.

Good
{"blocks":[{"type":"cloze","text":"3인칭 재귀칭: ___, ___, ___, ___","answers":["자기","자신","저","저희"]}]}

Bad
{"blocks":[{"type":"cloze","text":"___ is the ___ of ___.","answers":["Paris","capital","France"]}]} — with almost every word blanked, nothing is left to recall them from.

Edge cases
- A line of more than five members becomes several cloze cards, each keeping the group's name.
- A blank whose answer has several right forms takes the material's.
- A blank that asks what another card already answers is left out: one fact, one card.
$skill$,
  'seed (#751)'),
  ('table',
$summary$A comparison or classification laid out in rows and columns: the whole table on one card, the cells to recall as blanks.$summary$,
$skill$# table: a table with cells to recall

Use it for material laid out in rows and columns: a classification, a comparison, a conjugation, a timeline.

Rules
- {"blocks":[{"type":"table","columns":[…],"rows":[[…],…],"blanks":[{"row":0,"column":1}]}]}: columns are the headers, left to right; each row has as many cells as there are columns; blanks are the cells to recall, counted from 0 among the rows, the headers not counted.
- Each blank is a distinct cell holding text. To recall part of a cell, use spans: {"row":0,"column":1,"start":0,"end":5}, its run in UTF-16 code units, overlapping no other span and in no blank cell.
- The whole table is one card, never a card a row or a cell. A text block before it names it when the headers alone do not.
- Keep the material's headers; a row's first cell is usually its header and not a blank.

Good
{"blocks":[{"type":"text","front":"인칭 대명사"},{"type":"table","columns":["구분","높임","낮춤"],"rows":[["1인칭","저","나"],["2인칭","당신","너"]],"blanks":[{"row":0,"column":1},{"row":0,"column":2},{"row":1,"column":1},{"row":1,"column":2}]}]}

Bad
Two text cards, "1인칭 높임?" with "저" and "1인칭 낮춤?" with "나" — the grid is lost, and each cell is recalled apart from the row and column that place it.

Edge cases
- A table of more than 8 columns or 20 rows is split by its rows into several tables, each keeping the headers.
- An empty cell is "" and is never a blank.
- A table with nothing to recall is not a card.
$skill$,
  'seed (#751)'),
  ('image',
$summary$A diagram, map or picture whose parts are learned: its labels hidden under boxes, or a text back saying what it shows.$summary$,
$skill$# image: a picture

Use it when the picture is what is learned: a labelled diagram, a map, a structure, a painting to name.

Rules
- {"type":"image","url":"https://…"}: url is a public https address of a JPEG, PNG or WebP file of at most 10 MiB, stored as it is; at most 10 photos are fetched a call.
- With boxes, the picture is the whole card: {"type":"image","url":"…","boxes":[{"x":0.1,"y":0.2,"w":0.3,"h":0.1,"answer":"aorta"}]}. A box hides a label; x, y, w and h are fractions from 0 to 1 of the picture.
- Without boxes, give side, front or back, and a text block for the other side: the picture on the front and what it shows on the back, or a question on the front and the picture as its answer.
- side is given exactly when there are no boxes.

Good
{"blocks":[{"type":"image","url":"https://example.com/heart.png","boxes":[{"x":0.42,"y":0.18,"w":0.16,"h":0.06,"answer":"aorta"},{"x":0.2,"y":0.55,"w":0.18,"h":0.06,"answer":"right ventricle"}]}]}

Bad
{"blocks":[{"type":"image","url":"https://example.com/heart.png","side":"front"}]} — a picture alone adds nothing at the reveal; give it boxes or a text back.

Edge cases
- A picture with no public https address cannot be a card: ask the user for one, or put what it teaches in another form.
- A photo of a page is material to read, not a picture to learn: make its words the forms they are.
- A box needs the label's place in the picture; when you cannot see it, use a text back.
$skill$,
  'seed (#751)'),
  ('mixed',
$summary$Two or more of senses, cloze, table and image on one card, only when one fact needs them together.$summary$,
$skill$# mixed: forms combined on one card

A card's form is the one block type it holds besides text; text may accompany any form, as a name before a table or a back for a picture. A card holding two or more of senses, cloze, table and image is mixed.

Use it rarely: when one fact needs two forms at once, such as a picture whose label is recalled with a sentence about it.

Rules
- The blocks are shown in their order. The card needs something shown first and something added at the reveal; a cloze, a table or a picture with boxes counts for both.
- Every card of a mixed group is mixed; cards of one form go in a group of that form.

Good
{"blocks":[{"type":"image","url":"https://example.com/cell.png","boxes":[{"x":0.3,"y":0.4,"w":0.2,"h":0.1,"answer":"nucleus"}]},{"type":"cloze","text":"The ___ holds the cell's DNA.","answers":["nucleus"]}]}

Bad
A mixed group of a senses card for each word and a cloze card for each sentence — those are two groups, senses and cloze.

Edge cases
- A text block beside a senses, cloze, table or image block is that block's form, not mixed.
- Two cards of one form each are better than one mixed card when the facts can be recalled apart.
$skill$,
  'seed (#751)');

insert into private.card_form_skill_labels (form, label, version_id)
  select s.form, 'active', s.id from private.card_form_skills as s;

-- For the caller, each form's version as `card_form_skills` serves it: an admin's 'test' version
-- while one is set, and otherwise the 'active' one.
create function public.card_form_skills()
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

revoke all on function public.card_form_skills() from public, anon;
grant execute on function public.card_form_skills() to authenticated;

-- Every version, newest first, with its form, summary, text, note, author and labels.
create function public.admin_card_form_skills()
returns table (
  id bigint, form text, summary text, text text, note text, created_by_email text,
  created_at timestamptz, labels text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select v.id, v.form, v.summary, v.text, v.note, u.email::text, v.created_at,
    array(select l.label from private.card_form_skill_labels as l
      where l.version_id = v.id order by l.label)
  from private.card_form_skills as v
  left join auth.users as u on u.id = v.created_by
  order by v.id desc;
end;
$$;

-- Saves a version of [form]'s skill and makes it the form's 'test' version, served to admins and
-- replacing any before, and records it; returns the version's id.
create function public.admin_save_card_form_skill(form text, summary text, text text, note text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  saved bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.card_form_skill_labels', 9));
  insert into private.card_form_skills (form, summary, text, note, created_by)
    values (admin_save_card_form_skill.form, btrim(admin_save_card_form_skill.summary),
      admin_save_card_form_skill.text, btrim(admin_save_card_form_skill.note), caller)
    returning id into saved;
  insert into private.card_form_skill_labels (form, label, version_id, set_by)
    values (admin_save_card_form_skill.form, 'test', saved, caller)
    on conflict on constraint card_form_skill_labels_pkey do update
      set version_id = excluded.version_id, set_by = excluded.set_by, set_at = now();
  perform private.audit('save_card_form_skill', 'card_form', admin_save_card_form_skill.form,
    jsonb_build_object('version_id', saved, 'note', btrim(admin_save_card_form_skill.note),
      'length', char_length(admin_save_card_form_skill.text)));
  return saved;
end;
$$;

-- Applies [form]'s 'test' version to everyone: it becomes 'active' and the test label is cleared,
-- recorded with the version before: 'activated'; 'no_test' without one, recording nothing.
create function public.admin_activate_card_form_skill(form text) returns text
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

-- Ends [form]'s 'test' version, recorded: true; false without one, recording nothing.
create function public.admin_clear_card_form_skill_test(form text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared bigint;
begin
  perform private.require_admin();
  perform pg_advisory_xact_lock(hashtextextended('private.card_form_skill_labels', 9));
  delete from private.card_form_skill_labels as l
    where l.form = admin_clear_card_form_skill_test.form and l.label = 'test'
    returning l.version_id into cleared;
  if cleared is null then
    return false;
  end if;
  perform private.audit('clear_card_form_skill_test', 'card_form',
    admin_clear_card_form_skill_test.form, jsonb_build_object('version_id', cleared));
  return true;
end;
$$;

revoke all on function public.admin_card_form_skills(),
  public.admin_save_card_form_skill(text, text, text, text),
  public.admin_activate_card_form_skill(text), public.admin_clear_card_form_skill_test(text)
  from public, anon;
grant execute on function public.admin_card_form_skills(),
  public.admin_save_card_form_skill(text, text, text, text),
  public.admin_activate_card_form_skill(text), public.admin_clear_card_form_skill_test(text)
  to authenticated;

-- The assistant's prompt v2: v1 with its working order (ADR 0197), the card forms, which the
-- function adds after it as their index, and propose_changes' groups.
insert into private.assistant_prompts (text, note) values (
$prompt$You are 말랑이, the study helper inside knowno, a flashcard app. You talk with the user the way a friendly tutor does and help them build notes (decks) and cards from what they want to learn.

Scope
- Help only with study material and the user's own notes and cards. Politely decline anything else in one sentence and offer to help with studying instead.
- Answer in the language the user writes in; by default, Korean, in a warm, short 해요체.

How you work, in this order
1. Understand the material: read what the user gave or named, and what they already have with list_decks, list_cards and search_cards, so you do not repeat cards they hold. Build what the user asks for from the material, not a copy of it.
2. Restate, in a sentence or two, what the user asked for and your plan: the note, its groups by area or topic, each group's card form, and about how many cards.
3. Ask only what is still unclear, with ask_choice, one question at a time. When the request and the material settle it, do not ask.
4. Build: read the guide of each form you will use with read_card_form, then propose.
5. Revise on request: when the user asks to change one group, remake that group alone with regenerate_group and keep the others as they are.

Reading the user's notes
- When the chat was opened inside a note, that note is the one meant unless the user says otherwise.

Proposing, never writing
- You cannot save anything yourself. propose_deck (a new note with its cards), propose_cards (cards for an existing note) and propose_changes (edits to existing cards) show the user a draft; nothing is saved until the user taps 추가. Never say a card was added or saved.
- Group a proposal's cards by area or topic, each group in one card form of the index below; a group never mixes forms. Use the form the material calls for: a word list as senses, a table as table, a sentence to recall as cloze. Keep each card to one fact.
- A proposal holds at most 100 cards. For more, propose in several turns and say so.

Asking
- What is worth asking about a large or ambiguous request: the form (단어 / 빈칸 문장 / 표 / 알아서), the area (for example 1단원만 / 표 부분만 / 전부) or the amount (10장 / 30장 / 전부). A typed answer works too.

Facts
- Do not invent facts. When web search is available and the user asks about something you are unsure of, search, and keep to what the sources say.$prompt$,
    '말랑이 assistant prompt v2, its working order and card forms (#751)');

-- 스페셜 without an assistant draft gets one: its active configuration with prompt v2, served to
-- admins until an admin applies it.
with drafted as (
  insert into private.assistant_configurations
    (plan, provider, model, prompt_version_id, web_search, max_searches, reasoning_effort)
  select c.plan, c.provider, c.model,
    (select p.id from private.assistant_prompts as p
      where p.note = '말랑이 assistant prompt v2, its working order and card forms (#751)'),
    c.web_search, c.max_searches, c.reasoning_effort
  from private.assistant_configuration_labels as l
  join private.assistant_configurations as c on c.id = l.configuration_id
  where l.plan = 'special' and l.label = 'active'
    and not exists (select from private.assistant_configuration_labels as t
      where t.plan = l.plan and t.label = 'test')
  returning id, plan
)
insert into private.assistant_configuration_labels (plan, label, configuration_id)
  select drafted.plan, 'test', drafted.id from drafted;

-- The revert the header names.
create function private.revert_card_form_skills() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.assistant_configuration_labels as l
    using private.assistant_configurations as c, private.assistant_prompts as p
    where c.id = l.configuration_id and p.id = c.prompt_version_id and l.label = 'test'
      and p.note = '말랑이 assistant prompt v2, its working order and card forms (#751)';
  drop function public.admin_clear_card_form_skill_test(text);
  drop function public.admin_activate_card_form_skill(text);
  drop function public.admin_save_card_form_skill(text, text, text, text);
  drop function public.admin_card_form_skills();
  drop function public.card_form_skills();
  drop table private.card_form_skill_labels;
  drop table private.card_form_skills;
  drop function private.keep_card_form_skill();
end;
$$;

revoke all on function private.keep_card_form_skill(), private.revert_card_form_skills()
  from public, anon, authenticated;
