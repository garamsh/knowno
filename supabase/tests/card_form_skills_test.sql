-- The card-form skills (#751, ADR 0197): each form's seeded version active; `card_form_skills`
-- serving a signed-in user the active versions and an admin a form's test version while one is
-- set; a version saved as the form's test, applied and ended by an admin alone, each write
-- recorded; versions append-only; no client reaching the tables; the assistant's prompt v2 as each
-- 스페셜's draft beside its unchanged active configuration, and no other plan's; and the revert, which runs before the
-- assistant's and fails after it.
begin;
select plan(32);

delete from private.admin_audit;

-- A is an admin, B a signed-in user who is not.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format(
      '{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- Each form's served version id and summary, as [who] is served them.
create function pg_temp.served(who text) returns table (form text, version_id bigint, summary text)
language plpgsql as $$
begin
  perform pg_temp.sign_in(who);
  return query select s.form, s.version_id, s.summary from public.card_form_skills() as s
    order by s.form;
  perform set_config('role', 'none', true);
end;
$$;
grant execute on function pg_temp.served(text) to public;

create function pg_temp.seeded(form text) returns bigint language sql stable as $$
  select id from private.card_form_skills as s where s.form = seeded.form and s.note = 'seed (#751)';
$$;
grant execute on function pg_temp.seeded(text) to public;

-- The seed.

select results_eq(
  $$select l.form, l.label, v.note from private.card_form_skill_labels as l
    join private.card_form_skills as v on v.id = l.version_id order by l.form, l.label$$,
  $$values ('cloze', 'active', 'seed (#751)'), ('image', 'active', 'seed (#751)'),
    ('mixed', 'active', 'seed (#751)'), ('senses', 'active', 'seed (#751)'),
    ('table', 'active', 'seed (#751)'), ('text', 'active', 'seed (#751)')$$,
  'each form has one seeded version, active, and none in test');
select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('b')$$,
  $$values ('cloze', true), ('image', true), ('mixed', true), ('senses', true), ('table', true),
    ('text', true)$$,
  'a signed-in user is served every form''s active version');

-- No client reaches the tables; anon is served nothing.

select pg_temp.sign_in('b');
select throws_ok($$select * from private.card_form_skills$$, '42501', null,
  'a signed-in user reads no version row');
select throws_ok($$select * from private.card_form_skill_labels$$, '42501', null,
  'a signed-in user reads no label row');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.card_form_skills()$$, '42501', null,
  'anon is served no skill');
reset role;

-- Admin functions: refused to a user who is not an admin, against the admin.

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_card_form_skills()$$, '42501', null,
  'a user lists no version');
select throws_ok($$select public.admin_save_card_form_skill('cloze', 'S.', 'T.', '')$$, '42501',
  null, 'a user saves no version');
select throws_ok($$select public.admin_activate_card_form_skill('cloze')$$, '42501', null,
  'a user applies no version');
select throws_ok($$select public.admin_clear_card_form_skill_test('cloze')$$, '42501', null,
  'a user ends no test');
select pg_temp.sign_in('a');
select is((select count(*) from public.admin_card_form_skills()), 6::bigint,
  'control: an admin lists every version');
select is(public.admin_activate_card_form_skill('cloze'), 'no_test',
  'a form without a test version has nothing to apply');
select is(public.admin_clear_card_form_skill_test('cloze'), false,
  'and no test to end');

-- A test version.

select isnt(public.admin_save_card_form_skill('cloze', ' Blanks in a sentence. ', 'New guide.',
  ' tighter '), null, 'an admin saves a cloze version');
select results_eq(
  $$select form, summary, text, note, created_by_email, labels
    from public.admin_card_form_skills() limit 1$$,
  $$values ('cloze', 'Blanks in a sentence.', 'New guide.', 'tighter', 'admin@example.com',
    '{test}'::text[])$$,
  'it lists first, trimmed, as the form''s test version');
reset role;
select results_eq(
  $$select form, summary from pg_temp.served('a') where form in ('cloze', 'table')$$,
  $$values ('cloze', 'Blanks in a sentence.'),
    ('table', (select summary from private.card_form_skills where id = pg_temp.seeded('table')))$$,
  'an admin is served the test version, and the active one of a form without a test');
select is((select version_id from pg_temp.served('b') where form = 'cloze'),
  pg_temp.seeded('cloze'), 'a user is still served the active version');
select pg_temp.sign_in('a');
select throws_ok($$select public.admin_save_card_form_skill('flip', 'S.', 'T.', '')$$, '23514',
  null, 'a form that is none is refused');
select throws_ok($$select public.admin_save_card_form_skill('cloze', E'Two\nlines.', 'T.', '')$$,
  '23514', null, 'a summary of more than one line is refused');
select is(public.admin_activate_card_form_skill('cloze'), 'activated',
  'an admin applies the test version');
reset role;
select results_eq(
  $$select l.label, v.text from private.card_form_skill_labels as l
    join private.card_form_skills as v on v.id = l.version_id where l.form = 'cloze'$$,
  $$values ('active', 'New guide.')$$, 'it is active and the test label is cleared');
select is((select summary from pg_temp.served('b') where form = 'cloze'), 'Blanks in a sentence.',
  'a user is served it');
select pg_temp.sign_in('a');
select isnt(public.admin_save_card_form_skill('table', 'Tables.', 'Draft.', ''), null,
  'control: an admin saves a table version');
select is(public.admin_clear_card_form_skill_test('table'), true, 'and ends its test');
reset role;
select results_eq(
  $$select action, target_id, detail ? 'version_id' from private.admin_audit order by id$$,
  $$values ('save_card_form_skill', 'cloze', true), ('activate_card_form_skill', 'cloze', true),
    ('save_card_form_skill', 'table', true), ('clear_card_form_skill_test', 'table', true)$$,
  'each write is recorded once, and no refused one');

-- Append-only.

select throws_ok($$update private.card_form_skills set text = 'x' where id = pg_temp.seeded('text')$$,
  '55000', null, 'a version is never changed');
select lives_ok($$update private.card_form_skills set created_by = null
    where created_by = '00000000-0000-4000-8000-00000000000a'$$,
  'control: its author''s removal is let through');

-- The assistant's prompt v2, 스페셜's draft beside its active configuration.

select results_eq(
  $$select l.plan, t.provider = c.provider and t.model = c.model and t.web_search = c.web_search
      and t.max_searches = c.max_searches and t.reasoning_effort = c.reasoning_effort,
      pa.note, pt.note
    from private.assistant_configuration_labels as l
    join private.assistant_configurations as c on c.id = l.configuration_id
    join private.assistant_prompts as pa on pa.id = c.prompt_version_id
    join private.assistant_configuration_labels as tl on tl.plan = l.plan and tl.label = 'test'
    join private.assistant_configurations as t on t.id = tl.configuration_id
    join private.assistant_prompts as pt on pt.id = t.prompt_version_id
    where l.label = 'active'
    order by array_position(array['free', 'pro', 'max', 'special'], l.plan)$$,
  $$values ('special', true, '말랑이 assistant prompt v1 (#713)',
      '말랑이 assistant prompt v2, its working order and card forms (#751)')$$,
  '스페셜 keeps its active configuration on prompt v1 and drafts the same settings on v2, and no other plan has a draft');
select ok((select text ~ 'Understand the material' and text ~ 'Restate'
    and text ~ 'Ask only what is still unclear' and text ~ 'Build: read the guide'
    and text ~ 'Revise on request' and text ~ 'read_card_form'
  from private.assistant_prompts
  where note = '말랑이 assistant prompt v2, its working order and card forms (#751)'),
  'prompt v2 holds the working order and names read_card_form');

-- The revert.

select throws_ok($q$do $do$ begin
    perform private.revert_assistant_tokens();
    perform private.revert_assistant();
    perform private.revert_card_form_skills();
  end $do$$q$, '42P01', null,
  'the revert fails after the assistant''s, whose table it deletes from');
select lives_ok($$select private.revert_card_form_skills()$$, 'the revert runs before it');
select results_eq(
  $$select (select count(*) from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname like 'card_form_skill%' and c.relkind = 'r'),
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like '%card_form_skill%'
        and p.proname <> 'revert_card_form_skills'),
    (select count(*) from private.assistant_configuration_labels where label = 'test')$$,
  $$values (0::bigint, 0::bigint, 0::bigint)$$,
  'the tables, the functions and the drafts on prompt v2 are gone, the revert alone left');
select lives_ok($q$do $do$ begin
    perform private.revert_assistant_tokens();
    perform private.revert_assistant();
  end $do$$q$, 'and the assistant''s reverts run after it');

select * from finish();
rollback;
