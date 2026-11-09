-- The card text markup's switch (#763, ADR 0216): whether the server writes `text` version 3 and
-- `cloze` version 2, and the card-form skills that teach them. The server always accepts both; while
-- the switch is off it writes the forms the released phone builds read, `text` version 2 and `cloze`
-- version 1, where a form that reads the same exists. It starts off. An admin turns it on through
-- `admin_set_card_markup`, recorded in the audit log, with no deploy.
--
-- Additive. It creates `private.server_switches` with one row, `card_markup`, off; the three
-- functions `card_markup_enabled`, `admin_card_markup` and `admin_set_card_markup`; and the revert.
-- It also changes, and changes no row of:
--   - `private.card_form_skill_labels`: its label check also allows 'markup', a version served in
--     place of the 'active' one while the switch is on, and under an admin's 'test' version;
--   - `public.card_form_skills()`, which serves that label;
--   - `public.admin_activate_card_form_skill`, which also
--     ends the form's 'markup' label: an admin who applies a version of a form's skill replaces the
--     text that followed the switch, whichever way the switch stands.
-- And it appends a version of the `text` skill and of the `cloze` skill, which teach the markup and
-- Anki's cloze syntax, the texts of supabase/functions/_shared/card_forms_seed.ts's `SEED_MARKUP`,
-- which card_forms_seed_test.ts compares with these, labelled 'markup'. Nothing is labelled 'active'
-- by it: while the switch is off every form is served as before.
--
-- Deploy. The `assistant` and `mcp` bundles of this change read `card_markup_enabled`, so this
-- migration applies before they deploy; the bundles deployed before it read nothing here.
--
-- Revert, run once against production: `select private.revert_card_markup_switch();`, then
-- `drop function private.revert_card_markup_switch();`. It ends every 'markup' label, puts the
-- label check, `card_form_skills()` and `admin_activate_card_form_skill` back as
-- `20261105150000_card_form_skills.sql` made them and drops the switch table and its functions. The
-- two appended versions stay, unlabelled, since versions are append-only. The `assistant` and `mcp`
-- bundles go back with it, to those of the commit before this change: the bundles of this change
-- read `card_markup_enabled`, and without it refuse every add_cards and update_cards call. A card
-- already written as `text` version 3 or `cloze` version 2 is not rewritten: turn the switch off and
-- wait for no more such cards before reverting, or those cards show as unsupported on a build that
-- predates the markup.

-- Each switch the server reads, with who set it and when. Rows are never added by a client.
create table private.server_switches (
  name text primary key check (name in ('card_markup')),
  enabled boolean not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);

create index server_switches_set_by on private.server_switches (set_by);

alter table private.server_switches enable row level security;
revoke all on private.server_switches from public, anon, authenticated, service_role;

insert into private.server_switches (name, enabled) values ('card_markup', false);

-- Whether the server writes the markup's forms. The card tools ask it as the caller.
create function public.card_markup_enabled() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enabled from private.server_switches as s
    where s.name = 'card_markup'), false);
$$;

revoke all on function public.card_markup_enabled() from public, anon;
grant execute on function public.card_markup_enabled() to authenticated;

-- The switch as it stands, with who set it and when; no row set by anyone before the first change.
create function public.admin_card_markup()
returns table (enabled boolean, set_by_email text, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select s.enabled, u.email::text, s.set_at
  from private.server_switches as s
  left join auth.users as u on u.id = s.set_by
  where s.name = 'card_markup';
end;
$$;

-- Turns the switch on or off, recorded with its value before: 'set'; 'unchanged' for the value it
-- has and 'bad_value' for null, each recording nothing.
create function public.admin_set_card_markup(enabled boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  before boolean;
begin
  if admin_set_card_markup.enabled is null then
    return 'bad_value';
  end if;
  select s.enabled into before from private.server_switches as s
    where s.name = 'card_markup' for update;
  if before = admin_set_card_markup.enabled then
    return 'unchanged';
  end if;
  update private.server_switches as s
    set enabled = admin_set_card_markup.enabled, set_by = caller, set_at = now()
    where s.name = 'card_markup';
  perform private.audit('set_card_markup', 'switch', 'card_markup', jsonb_build_object(
    'enabled', admin_set_card_markup.enabled, 'enabled_before', before));
  return 'set';
end;
$$;

revoke all on function public.admin_card_markup(), public.admin_set_card_markup(boolean)
  from public, anon;
grant execute on function public.admin_card_markup(), public.admin_set_card_markup(boolean)
  to authenticated;

-- A form's served version may now be labelled 'markup' too.
alter table private.card_form_skill_labels drop constraint card_form_skill_labels_label_check;
alter table private.card_form_skill_labels add constraint card_form_skill_labels_label_check
  check (label in ('active', 'test', 'markup'));

-- The versions that teach the markup: the `text` and `cloze` skills of card_forms_seed.ts's
-- SEED_MARKUP, served while the switch is on.
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
  'markup (#763)'),
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
- The older form, text with one ___ for each of "answers", is still accepted; give the {{c1::…}} form.

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
  'markup (#763)');

insert into private.card_form_skill_labels (form, label, version_id)
  select s.form, 'markup', s.id from private.card_form_skills as s where s.note = 'markup (#763)';

-- For the caller, each form's version as `card_form_skills` serves it: an admin's 'test' version
-- while one is set, then, while the switch is on, the form's 'markup' version, and otherwise the
-- 'active' one.
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
  markup_on boolean := coalesce((select s.enabled from private.server_switches as s
    where s.name = 'card_markup'), false);
begin
  return query
  select distinct on (l.form) l.form, v.id, v.summary, v.text
  from private.card_form_skill_labels as l
  join private.card_form_skills as v on v.id = l.version_id
  where l.label = 'active' or (l.label = 'test' and admin)
    or (l.label = 'markup' and markup_on)
  order by l.form, case l.label when 'test' then 0 when 'markup' then 1 else 2 end;
end;
$$;

-- Applies [form]'s 'test' version to everyone: it becomes 'active', the test label is cleared and
-- so is the 'markup' label, which the applied version replaces; recorded with the version before:
-- 'activated'; 'no_test' without one, recording nothing.
create or replace function public.admin_activate_card_form_skill(form text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  tested bigint;
  before bigint;
  ended bigint;
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
  delete from private.card_form_skill_labels as l
    where l.form = admin_activate_card_form_skill.form and l.label = 'markup'
    returning l.version_id into ended;
  perform private.audit('activate_card_form_skill', 'card_form',
    admin_activate_card_form_skill.form,
    jsonb_build_object('version_id', tested, 'version_before', before)
      || case when ended is null then '{}'::jsonb
        else jsonb_build_object('markup_version_ended', ended) end);
  return 'activated';
end;
$$;

-- The revert the header names.
create function private.revert_card_markup_switch() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.card_form_skill_labels as l where l.label = 'markup';
  alter table private.card_form_skill_labels drop constraint card_form_skill_labels_label_check;
  alter table private.card_form_skill_labels add constraint card_form_skill_labels_label_check
    check (label in ('active', 'test'));
  create or replace function public.card_form_skills()
  returns table (form text, version_id bigint, summary text, text text)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $body$
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
  $body$;
  create or replace function public.admin_activate_card_form_skill(form text) returns text
  language plpgsql
  security definer
  set search_path = ''
  as $body$
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
  $body$;
  drop function public.admin_set_card_markup(boolean);
  drop function public.admin_card_markup();
  drop function public.card_markup_enabled();
  drop table private.server_switches;
end;
$$;

revoke all on function private.revert_card_markup_switch() from public, anon, authenticated;
