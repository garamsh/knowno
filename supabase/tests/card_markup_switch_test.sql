-- The card text markup's switch (#763, ADR 0216): off at the start; read by a signed-in user and
-- set by an admin alone, each change recorded; and the card-form skills following it: the `text`
-- and `cloze` versions that teach the markup served while it is on, an admin's test version over
-- them, an applied version replacing them, and every other form unchanged. And the revert.
begin;
select plan(52);

delete from private.admin_audit;

-- A and C are admins, B a signed-in user who is not.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'admin2@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000c');

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

create function pg_temp.markup(form text) returns bigint language sql stable as $$
  select id from private.card_form_skills as s where s.form = markup.form and s.note = 'markup (#763)';
$$;
grant execute on function pg_temp.markup(text) to public;

-- The start: off, set by no one.

select results_eq($$select name, enabled, set_by from private.server_switches$$,
  $$values ('card_markup', false, null::uuid)$$, 'the switch is one row, off, set by no one');
select pg_temp.sign_in('b');
select is(public.card_markup_enabled(), false, 'a signed-in user reads it off');
select throws_ok($$select * from private.server_switches$$, '42501', null,
  'and reads no row of the table');
select pg_temp.sign_in(null);
select throws_ok($$select public.card_markup_enabled()$$, '42501', null, 'anon reads nothing');
reset role;

-- Only an admin sets it.

select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_card_markup()$$, '42501', null,
  'a user reads no admin state');
select throws_ok($$select public.admin_set_card_markup(true)$$, '42501', null,
  'a user sets nothing');
reset role;
select is(public.card_markup_enabled(), false, 'control: the refused call left it off');
select pg_temp.sign_in('a');
select results_eq($$select enabled, set_by_email, ever_set from public.admin_card_markup()$$,
  $$values (false, null::text, false)$$, 'an admin reads it off, set by no one, never set');
select is(public.admin_set_card_markup(null), 'bad_value', 'a null value is refused');
select is(public.admin_set_card_markup(false), 'unchanged', 'the value it has changes nothing');
select is((select ever_set from public.admin_card_markup()), false,
  'and neither marks it set');
reset role;
select is((select count(*) from private.admin_audit), 0::bigint,
  'and neither records anything');

-- The skills while it is off: every form's active version, an admin's the same.

select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('b')$$,
  $$values ('cloze', true), ('image', true), ('mixed', true), ('senses', true), ('table', true),
    ('text', true)$$,
  'a user is served every form''s active version while it is off');
select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('a')$$,
  $$values ('cloze', true), ('image', true), ('mixed', true), ('senses', true), ('table', true),
    ('text', true)$$,
  'an admin is served them too');
select results_eq(
  $$select l.form, l.label, v.note from private.card_form_skill_labels as l
    join private.card_form_skills as v on v.id = l.version_id
    where l.label = 'markup' order by l.form$$,
  $$values ('cloze', 'markup', 'markup (#763)'), ('text', 'markup', 'markup (#763)')$$,
  'the versions that teach the markup are labelled markup, text and cloze alone');
select is((select count(*) from private.card_form_skill_labels where label = 'active'), 6::bigint,
  'and no active label moved');
select ok((select bool_and(text ~ '\{\{c1::' or form <> 'cloze')
    and bool_and(text ~ '\*\*bold\*\*' or form <> 'text')
  from private.card_form_skills where note = 'markup (#763)'),
  'the cloze version teaches Anki''s syntax and the text version the marks');
select ok((select bool_and(text !~ '\{\{c1::') from private.card_form_skills
    where note = 'seed (#751)' and form = 'cloze'),
  'control: the version served while off teaches no Anki syntax');

-- Turning it on.

select pg_temp.sign_in('a');
select is(public.admin_set_card_markup(true), 'set', 'an admin turns it on');
select results_eq($$select enabled, set_by_email, ever_set from public.admin_card_markup()$$,
  $$values (true, 'admin@example.com', true)$$, 'it reads on, set by the admin, set');
reset role;
select results_eq(
  $$select action, target_kind, target_id, detail from private.admin_audit order by id$$,
  $$values ('set_card_markup', 'switch', 'card_markup',
    '{"enabled": true, "enabled_before": false}'::jsonb)$$,
  'the change is recorded with its value before');
select pg_temp.sign_in('b');
select is(public.card_markup_enabled(), true, 'a signed-in user reads it on');
reset role;
select results_eq(
  $$select form, version_id = pg_temp.markup(form) from pg_temp.served('b')
    where form in ('text', 'cloze')$$,
  $$values ('cloze', true), ('text', true)$$,
  'a user is served the versions that teach the markup while it is on');
select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('b')
    where form not in ('text', 'cloze')$$,
  $$values ('image', true), ('mixed', true), ('senses', true), ('table', true)$$,
  'and the other forms'' active ones');
select pg_temp.sign_in('a');
select is(public.admin_set_card_markup(true), 'unchanged', 'turning it on again changes nothing');
reset role;
select is((select count(*) from private.admin_audit), 1::bigint, 'and records nothing');

-- An admin's test version outranks it, and an applied one replaces it.

select pg_temp.sign_in('a');
select isnt(public.admin_save_card_form_skill('cloze', 'Draft.', 'Draft guide.', ''), null,
  'an admin saves a cloze version');
reset role;
select is((select version_id from pg_temp.served('a') where form = 'cloze'),
  (select id from private.card_form_skills where summary = 'Draft.'),
  'an admin is served the test version over the markup one');
select is((select version_id from pg_temp.served('b') where form = 'cloze'), pg_temp.markup('cloze'),
  'a user is still served the markup one');
select pg_temp.sign_in('a');
select is(public.admin_activate_card_form_skill('cloze'), 'activated', 'the admin applies it');
reset role;
select results_eq(
  $$select l.label from private.card_form_skill_labels as l where l.form = 'cloze'
    order by l.label$$,
  $$values ('active')$$, 'the markup label of the form is ended with it');
select is((select summary from pg_temp.served('b') where form = 'cloze'), 'Draft.',
  'a user is served the applied version while it is on');
select is((select detail ->> 'markup_version_ended' from private.admin_audit
    where action = 'activate_card_form_skill'), pg_temp.markup('cloze')::text,
  'the activation records the markup version it ended');
select is((select version_id from pg_temp.served('b') where form = 'text'), pg_temp.markup('text'),
  'control: the other form still follows the switch');

-- Turning it off.

select pg_temp.sign_in('a');
select is(public.admin_set_card_markup(false), 'set', 'an admin turns it off');
reset role;
select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('b')
    where form in ('text', 'senses')$$,
  $$values ('senses', true), ('text', true)$$,
  'the form it still followed is served as before');
select is((select summary from pg_temp.served('b') where form = 'cloze'), 'Draft.',
  'the applied version stays served, as an admin''s edit does');
select results_eq(
  $$select detail from private.admin_audit where action = 'set_card_markup' order by id$$,
  $$values ('{"enabled": true, "enabled_before": false}'::jsonb),
    ('{"enabled": false, "enabled_before": true}'::jsonb)$$,
  'each change was recorded once');

-- The label check.

select throws_ok($$insert into private.card_form_skill_labels (form, label, version_id)
    values ('table', 'draft', pg_temp.seeded('table'))$$, '23514', null,
  'a label other than active, test and markup is refused');
select lives_ok($$insert into private.card_form_skill_labels (form, label, version_id)
    values ('table', 'markup', pg_temp.seeded('table'))$$,
  'control: markup is one');

-- The deleted setter: ever_set holds when set_by is gone, a second admin reading it.

delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is((select set_by from private.server_switches), null::uuid,
  'the setter''s account is deleted and set_by is null');
select pg_temp.sign_in('c');
select results_eq($$select enabled, set_by_email, ever_set from public.admin_card_markup()$$,
  $$values (false, null::text, true)$$, 'it still reads set, by no account that remains');
reset role;
update private.server_switches set ever_set = false;
select pg_temp.sign_in('c');
select is((select ever_set from public.admin_card_markup()), false,
  'control: the same row with ever_set false reads never set');
reset role;
update private.server_switches set ever_set = true;

-- The revert of ever_set.

select lives_ok($$select private.revert_card_markup_ever_set()$$, 'the ever_set revert runs');
select pg_temp.sign_in('c');
select results_eq($$select enabled, set_by_email from public.admin_card_markup()$$,
  $$values (false, null::text)$$, 'admin_card_markup answers its three columns again');
select is(public.admin_set_card_markup(true), 'set', 'and admin_set_card_markup still sets');
reset role;
select is((select count(*) from information_schema.columns where table_schema = 'private'
    and table_name = 'server_switches' and column_name = 'ever_set'), 0::bigint,
  'the column is gone');

-- The revert.

select lives_ok($$select private.revert_card_markup_switch()$$, 'the revert runs');
select results_eq(
  $$select (select count(*) from pg_class as c join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'private' and c.relname = 'server_switches'),
    (select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname like '%card_markup%'
        and p.proname not like 'revert_card_markup%'),
    (select count(*) from private.card_form_skill_labels where label = 'markup')$$,
  $$values (0::bigint, 0::bigint, 0::bigint)$$,
  'the table, the functions and the labels are gone, the revert alone left');
select throws_ok($$insert into private.card_form_skill_labels (form, label, version_id)
    values ('table', 'markup', pg_temp.seeded('table'))$$, '23514', null,
  'the label check is the earlier one');
select results_eq(
  $$select form, version_id = pg_temp.seeded(form) from pg_temp.served('b')
    where form in ('text', 'senses')$$,
  $$values ('senses', true), ('text', true)$$,
  'every form is served by its active label again');
select is((select count(*) from private.card_form_skills where note = 'markup (#763)'), 2::bigint,
  'the two appended versions stay, since versions are append-only');

select * from finish();
rollback;
