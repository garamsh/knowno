-- The prompt store (ADR 0073): append-only versions only an admin saves and labels, each write
-- recorded; extract-cards serves admins the test version when one is set and everyone else the
-- active one, and records the plan, model and version of each photo it lets through.
begin;
select plan(48);

-- An OpenRouter key in Vault, so the plans' OpenRouter configurations can be served (ADR 0162).
insert into private.provider_keys (provider, secret_id, last_four)
  values ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000');

-- A is an admin, B a signed-in user who is not, C an admin whose account is deleted.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'gone@example.com');
insert into private.admins (user_id) values
  ('00000000-0000-4000-8000-00000000000a'), ('00000000-0000-4000-8000-00000000000c');

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- Every admin prompt function, called with arguments that change nothing.
create function pg_temp.calls() returns setof text language sql as $$
  values
    ($q$select * from public.admin_prompt_versions()$q$),
    ($q$select * from public.admin_prompt_version(0)$q$),
    ($q$select public.admin_save_prompt('', '')$q$),
    ($q$select public.admin_set_prompt_label('none', 1)$q$),
    ($q$select public.admin_clear_test_prompt()$q$)
$$;
grant execute on function pg_temp.calls() to public;

-- The calls [who] is refused with insufficient_privilege. A call that fails otherwise, as some of
-- these do for an admin past the role, is the role check passing. Each call is undone, its locks
-- with it, so a later check of the labels lock sees only what came after.
create function pg_temp.refused_as(who text) returns setof text language plpgsql as $$
declare
  call text;
begin
  for call in select * from pg_temp.calls() loop
    -- A refusal rolls the block back, the sign-in with it.
    begin
      perform pg_temp.sign_in(who);
      execute call;
      raise exception 'undo' using errcode = 'P0001';
    exception
      when insufficient_privilege then
        return next call;
      when others then
        null;
    end;
  end loop;
end;
$$;

-- What extract-cards gets for one photo of the user whose id ends in [who].
create function pg_temp.begin(who text)
returns table (plan text, model text, allowed boolean, prompt_version_id bigint, prompt text)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.model, b.allowed, b.prompt_version_id, b.prompt
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- Whether this transaction holds the advisory lock label changes take.
create function pg_temp.holds_labels_lock() returns boolean language sql as $$
  select exists (
    select from pg_locks
    where locktype = 'advisory' and pid = pg_backend_pid() and granted
      and classid::bigint = (hashtextextended('private.prompt_labels', 4) >> 32) & 4294967295
      and objid::bigint = hashtextextended('private.prompt_labels', 4) & 4294967295
      and objsubid = 1
  )
$$;
grant execute on function pg_temp.holds_labels_lock() to public;

-- The ids versions are saved under; a refused insert takes an id too, so tests name them.
create temp table saved (name text primary key, id bigint not null);
grant all on saved to public;
create function pg_temp.id(name text) returns bigint language sql as $$
  select s.id from saved as s where s.name = id.name
$$;
grant execute on function pg_temp.id(text) to public;

-- The seed and the role.

select results_eq($$select id, note, created_by from private.prompt_versions where id = 1$$,
  $$values (1::bigint, 'prompt v8', null::uuid)$$,
  'the migration seeds version 1, prompt v8, saved by no one');

-- The store as the seed left it: version 1 active, no test version and an empty log. A later
-- migration activated prompt v9 (20261019230003_activate_prompt_v9.sql), which
-- prompt_v9_activation_test.sql covers.
update private.prompt_labels set version_id = 1, set_by = null where label = 'active';
delete from private.admin_audit;
select results_eq($$select label, version_id from private.prompt_labels$$,
  $$values ('active', 1::bigint)$$, 'version 1 is active again, with no test version');

select results_eq($$select count(*) from pg_temp.refused_as('b')$$, $$values (5::bigint)$$,
  'a signed-in user who is not an admin is refused by every admin prompt function');
reset role;
select results_eq($$select count(*) from pg_temp.refused_as(null)$$, $$values (5::bigint)$$,
  'anon is refused by every admin prompt function');
reset role;
select is_empty($$select * from pg_temp.refused_as('a')$$, 'control: an admin is refused by none');
reset role;

select pg_temp.sign_in('b');
select throws_ok($$select * from public.begin_extraction('00000000-0000-4000-8000-00000000000b')$$,
  '42501', null, 'a signed-in user cannot begin an extraction itself');
select throws_ok($$select * from public.prompt_version(1)$$, '42501', null, 'nor read a version for the eval');
select throws_ok($$select * from private.prompt_versions$$, '42501', null, 'nor read the versions');
select throws_ok($$select * from private.prompt_labels$$, '42501', null, 'nor the labels');
select throws_ok($$select * from private.extraction_calls$$, '42501', null, 'nor the calls');
reset role;

-- Saving.

select pg_temp.sign_in('a');
insert into saved values ('second', public.admin_save_prompt('Second prompt.', '  shorter  '));
reset role;
select cmp_ok(pg_temp.id('second'), '>', 1::bigint, 'an admin saves a new version, under a new id');
select results_eq($$select text, note, created_by from private.prompt_versions where id = pg_temp.id('second')$$,
  $$values ('Second prompt.', 'shorter', '00000000-0000-4000-8000-00000000000a'::uuid)$$,
  'with its text as given, its note trimmed, and its author');
select results_eq($$select label, version_id from private.prompt_labels$$,
  $$values ('active', 1::bigint)$$, 'saving labels nothing');
select results_eq(
  $$select action, target_kind, target_id, detail from private.admin_audit$$,
  $$values ('save_prompt', 'prompt', pg_temp.id('second')::text, '{"note": "shorter", "length": 14}'::jsonb)$$,
  'saving is recorded with the note and the length, not the text');

select pg_temp.sign_in('a');
select throws_ok($$select public.admin_save_prompt('', 'x')$$, '23514', null, 'an empty text is refused');
select throws_ok($$select public.admin_save_prompt(E' \n ', 'x')$$, '23514', null, 'and a blank one');
select throws_ok($$select public.admin_save_prompt(repeat('a', 20001), 'x')$$, '23514', null,
  'and one over 20,000 characters');
insert into saved values ('longest', public.admin_save_prompt(repeat('가', 20000), 'longest'));
select is((select char_length(text) from public.admin_prompt_version(pg_temp.id('longest'))), 20000,
  'control: one of 20,000 characters, counted as characters, is saved');
select throws_ok($$select public.admin_save_prompt('ok', repeat('n', 201))$$, '23514', null,
  'a note over 200 characters is refused');
reset role;

-- Append-only.

select throws_ok($$update private.prompt_versions set text = 'changed' where id = 1$$, '55000', null,
  'a version''s text cannot be changed, even by the owner of the table');
select throws_ok($$update private.prompt_versions set note = 'changed' where id = 1$$, '55000', null,
  'nor its note');
select throws_ok($$delete from private.prompt_versions where id = 1$$, '55000', null,
  'and no version can be removed');
with inserted as (
  insert into private.prompt_versions (text, note, created_by)
    values ('By C.', '', '00000000-0000-4000-8000-00000000000c') returning id
) insert into saved select 'by_c', id from inserted;
delete from auth.users where id = '00000000-0000-4000-8000-00000000000c';
select results_eq($$select text, created_by from private.prompt_versions where id = pg_temp.id('by_c')$$,
  $$values ('By C.', null::uuid)$$,
  'control: deleting an author''s account keeps the version, with no author');

-- Serving.

insert into private.plan_versions (plan, quota, amount, starts_at, applies_to_all) values
  ('free', 'daily', 3, now(), true);
-- The admin is on 스페셜 (ADR 0177), so it is served 스페셜's configuration.
with c as (
  insert into private.ai_configurations (plan, provider, model) values ('free', 'openrouter', 'vendor/free-model'),
    ('special', 'openrouter', 'vendor/special-model')
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;
select results_eq($$select plan, model, allowed, prompt_version_id from pg_temp.begin('b')$$,
  $$values ('free', 'vendor/free-model', true, 1::bigint)$$, 'a user is served the active version');
reset role;
select results_eq($$select prompt_version_id from pg_temp.begin('a')$$, $$values (1::bigint)$$,
  'and so is an admin while no test version is set');
reset role;
select results_eq($$select prompt from pg_temp.begin('b')$$,
  $$select text from private.prompt_versions where id = 1$$, 'with the version''s text');
reset role;

select ok(not pg_temp.holds_labels_lock(), 'control: nothing has held the labels lock before');
select pg_temp.sign_in('a');
select ok(public.admin_set_prompt_label('test', pg_temp.id('second')), 'an admin makes version 2 the test version');
select ok(pg_temp.holds_labels_lock(), 'under the labels lock');
reset role;
select results_eq($$select prompt_version_id, prompt from pg_temp.begin('a')$$,
  $$values (pg_temp.id('second'), 'Second prompt.')$$, 'an admin is then served the test version');
reset role;
select results_eq($$select prompt_version_id, allowed from pg_temp.begin('b')$$,
  $$values (1::bigint, true)$$, 'control: a user who is not an admin is still served the active one');
reset role;
select results_eq($$select allowed from pg_temp.begin('b')$$, $$values (false)$$,
  'a photo over the plan''s limit is not allowed');
reset role;
select results_eq(
  $$select u.user_id, c.plan, c.model, c.prompt_version_id
    from private.extraction_calls as c join public.extraction_usage as u on u.id = c.usage_id
    order by u.id$$,
  $$values ('00000000-0000-4000-8000-00000000000b'::uuid, 'free', 'vendor/free-model', 1::bigint),
           ('00000000-0000-4000-8000-00000000000a'::uuid, 'special', 'vendor/special-model', 1::bigint),
           ('00000000-0000-4000-8000-00000000000b'::uuid, 'free', 'vendor/free-model', 1::bigint),
           ('00000000-0000-4000-8000-00000000000a'::uuid, 'special', 'vendor/special-model', pg_temp.id('second')),
           ('00000000-0000-4000-8000-00000000000b'::uuid, 'free', 'vendor/free-model', 1::bigint)$$,
  'each allowed photo records its plan, model and version, and the refused one nothing');
select results_eq(
  $$select count(*) from public.extraction_usage$$,
  $$select count(*) from private.extraction_calls$$, 'one call record per counted photo');

-- Labels.

select pg_temp.sign_in('a');
select is(public.admin_set_prompt_label('test', pg_temp.id('second')), false, 'labelling the version a label names changes nothing');
select ok(public.admin_set_prompt_label('active', pg_temp.id('second')), 'activating the test version makes it active');
reset role;
select results_eq($$select label, version_id from private.prompt_labels$$,
  $$values ('active', pg_temp.id('second'))$$, 'and clears the test label, so admins follow the active one');
select pg_temp.sign_in('a');
select ok(public.admin_set_prompt_label('active', 1), 'activating an earlier version rolls back to it');
select is(public.admin_clear_test_prompt(), false, 'clearing no test version changes nothing');
select ok(public.admin_set_prompt_label('test', pg_temp.id('longest')), 'version 3 becomes the test version');
select ok(public.admin_clear_test_prompt(), 'and the test label is cleared');
select throws_ok($$select public.admin_set_prompt_label('canary', 1)$$, '22023', null,
  'a label other than active or test is refused');
select throws_ok($$select public.admin_set_prompt_label('active', -1)$$, '23503', null,
  'and a version that does not exist');
reset role;
select results_eq(
  $$select action, target_id, detail from private.admin_audit where action <> 'save_prompt' order by id$$,
  $$values ('test_prompt', pg_temp.id('second')::text, '{"previous": null, "test_cleared": false}'::jsonb),
           ('activate_prompt', pg_temp.id('second')::text, '{"previous": 1, "test_cleared": true}'::jsonb),
           ('activate_prompt', '1', jsonb_build_object('previous', pg_temp.id('second'), 'test_cleared', false)),
           ('test_prompt', pg_temp.id('longest')::text, '{"previous": null, "test_cleared": false}'::jsonb),
           ('clear_test_prompt', pg_temp.id('longest')::text, '{}'::jsonb)$$,
  'each label change is recorded once with the version before, and a no-op not at all');

-- Reads.

select pg_temp.sign_in('a');
select results_eq(
  $$select id, note, labels from public.admin_prompt_versions()$$,
  $$values (pg_temp.id('by_c'), '', '{}'::text[]), (pg_temp.id('longest'), 'longest', '{}'::text[]),
           (pg_temp.id('second'), 'shorter', '{}'::text[]),
           (2::bigint, 'prompt v9 (#261, #266), PM eval 2026-10-19: dense 89.3/90.5', '{}'::text[]),
           (1::bigint, 'prompt v8', '{active}'::text[])$$,
  'the versions list newest first, each with the labels naming it');
select results_eq(
  $$select id, text, created_by_email, active_id, active_text = (select v.text from public.admin_prompt_version(1) as v)
    from public.admin_prompt_version(pg_temp.id('second'))$$,
  $$values (pg_temp.id('second'), 'Second prompt.', 'admin@example.com', 1::bigint, true)$$,
  'a version reads with its text and author, and the active version''s text for the diff');
reset role;
select set_config('role', 'service_role', true);
select results_eq($$select text, note from public.prompt_version(pg_temp.id('second'))$$,
  $$values ('Second prompt.', 'shorter')$$, 'the eval reads a version by its id with the service role');
reset role;

-- Deletion.

delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select results_eq(
  $$select count(*) from private.extraction_calls as c
    left join public.extraction_usage as u on u.id = c.usage_id where u.id is null$$,
  $$values (0::bigint)$$, 'a deleted user''s call records go with its usage rows');

select * from finish();
rollback;
