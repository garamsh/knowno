-- One AI configuration per plan (#650, ADR 0182): a configuration holds the provider, model and
-- prompt version; the move from the global prompt labels serves everyone what it served before; a
-- plan has one draft, saved with or without a prompt, tried by id, applied and ended as a unit;
-- the results read per configuration; the extract-cards bundle from before the change still works;
-- and the revert puts the global labels back.
begin;
select plan(52);

delete from private.admin_audit;

-- A is an admin, so on 스페셜 (ADR 0177); B a Free user. Both from long ago.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.provider_keys (provider, secret_id, last_four) values
  ('openrouter', vault.create_secret('sk-or-test-key-0000'), '0000'),
  ('anthropic', vault.create_secret('sk-ant-test-key-1111'), '1111');

-- Two prompt versions beside the seeds: the one every user is served, and one under test.
create temp table prompts (name text primary key, id bigint not null);
grant select on prompts to public;
with saved as (
  insert into private.prompt_versions (text, note) values ('Active prompt.', 'active'), ('Test prompt.', 'test')
  returning id, note
) insert into prompts select note, id from saved;
create function pg_temp.prompt(name text) returns bigint language sql stable as $$
  select p.id from prompts as p where p.name = prompt.name
$$;
grant execute on function pg_temp.prompt(text) to public;

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

-- What extract-cards gets for one photo of the user whose id ends in [who], naming [configuration].
create function pg_temp.start(who text, configuration bigint default null)
returns table (plan text, provider text, model text, prompt_version_id bigint, prompt text, allowed boolean)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.provider, b.model, b.prompt_version_id, b.prompt, b.allowed
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid,
      configuration) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- Runs [query] as service_role, as extract-cards does.
create function pg_temp.as_service(query text) returns text language plpgsql as $$
declare
  answer text;
begin
  perform set_config('role', 'service_role', true);
  execute query into answer;
  perform set_config('role', 'none', true);
  return answer;
end;
$$;

-- [plan]'s [label]led configuration: its id, provider, model and prompt version.
create function pg_temp.labelled(plan text, label text)
returns table (id bigint, provider text, model text, prompt_version_id bigint)
language sql stable as $$
  select c.id, c.provider, c.model, c.prompt_version_id from private.ai_configuration_labels as l
  join private.ai_configurations as c on c.id = l.configuration_id
  where l.plan = labelled.plan and l.label = labelled.label;
$$;

-- The move as the migration applied it to this database's seeded configurations.

select results_eq(
  $$select b.plan, c.prompt_version_id is null from private.ai_configuration_labels_before_prompts as b
    join private.ai_configurations as c on c.id = b.configuration_id order by b.plan$$,
  $$values ('free', true), ('max', true), ('pro', true), ('special', true)$$,
  'the backup keeps each label as it was, on a configuration with no prompt');
select results_eq(
  $$select l.plan, n.provider = o.provider and n.model = o.model,
      n.prompt_version_id = (select version_id from private.prompt_labels_before_configurations where label = 'active')
    from private.ai_configuration_labels as l
    join private.ai_configurations as n on n.id = l.configuration_id
    join private.ai_configuration_labels_before_prompts as b on b.plan = l.plan and b.label = l.label
    join private.ai_configurations as o on o.id = b.configuration_id
    order by l.plan$$,
  $$values ('free', true, true), ('max', true, true), ('pro', true, true), ('special', true, true)$$,
  'each plan''s active label names its provider and model with the active prompt version');
select hasnt_table('private', 'prompt_labels', 'the global labels are gone');
select hasnt_function('public', 'admin_set_prompt_label', array['text', 'bigint'],
  'and so are the functions that set them');

-- The move, on the state before it: [test] the version under test or none, and 스페셜 with a draft
-- on Anthropic or none. Every label names a configuration with no prompt, as before the change.
create function pg_temp.before_move(test bigint, special_draft boolean) returns void
language plpgsql as $$
declare
  label record;
  added bigint;
begin
  delete from private.ai_configuration_labels where ai_configuration_labels.label = 'test';
  for label in select l.plan, c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id loop
    insert into private.ai_configurations (plan, provider, model)
      values (label.plan, label.provider, label.model) returning id into added;
    update private.ai_configuration_labels as l set configuration_id = added where l.plan = label.plan;
  end loop;
  if special_draft then
    insert into private.ai_configurations (plan, provider, model)
      values ('special', 'anthropic', 'claude-draft') returning id into added;
    insert into private.ai_configuration_labels (plan, label, configuration_id, set_by, set_at)
      values ('special', 'test', added, '00000000-0000-4000-8000-00000000000a', '2026-11-01 00:00Z');
  end if;
  delete from private.prompt_labels_before_configurations;
  insert into private.prompt_labels_before_configurations (label, version_id)
    values ('active', pg_temp.prompt('active'));
  if test is not null then
    insert into private.prompt_labels_before_configurations (label, version_id, set_at)
      values ('test', test, '2026-11-02 00:00Z');
  end if;
end;
$$;

select pg_temp.before_move(null, true);
select results_eq($$select label, prompt_version_id is null from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id where l.plan = 'special' order by label$$,
  $$values ('active', true), ('test', true)$$, 'setup: 스페셜''s labels name configurations with no prompt');
select private.migrate_configuration_prompts();
select results_eq($$select provider, prompt_version_id, prompt from pg_temp.start('b')$$,
  $$values ('openrouter', pg_temp.prompt('active'), 'Active prompt.')$$,
  'with no version under test, a user is served the active version, as before');
select results_eq($$select provider, model, prompt_version_id from pg_temp.start('a')$$,
  $$values ('anthropic', 'claude-draft', pg_temp.prompt('active'))$$,
  'and an admin the draft''s provider and model with the active version, as before');
select is((select count(*) from pg_temp.labelled('free', 'test')), 0::bigint,
  'a plan with no draft gets none');
select results_eq($$select set_by, set_at from private.ai_configuration_labels where plan = 'special' and label = 'test'$$,
  $$values ('00000000-0000-4000-8000-00000000000a'::uuid, '2026-11-01 00:00Z'::timestamptz)$$,
  'a moved label keeps who set it and when');
create temp table configurations_after as select count(*) as n from private.ai_configurations;
select private.migrate_configuration_prompts();
select is((select count(*) from private.ai_configurations), (select n from configurations_after),
  'a second run appends nothing');

select pg_temp.before_move(pg_temp.prompt('test'), true);
select private.migrate_configuration_prompts();
select results_eq($$select provider, model, prompt_version_id, prompt from pg_temp.start('a')$$,
  $$values ('anthropic', 'claude-draft', pg_temp.prompt('test'), 'Test prompt.')$$,
  'with a version under test, a plan''s draft holds it beside the draft''s provider and model');
select results_eq($$select prompt_version_id from pg_temp.start('b')$$,
  $$values (pg_temp.prompt('active'))$$, 'control: a user is still served the active version');
select results_eq($$select provider, prompt_version_id from pg_temp.labelled('free', 'test')$$,
  $$values ('openrouter', pg_temp.prompt('test'))$$,
  'a plan with no draft gets one on its active provider and model with the version under test');
select results_eq($$select set_at from private.ai_configuration_labels where plan = 'free' and label = 'test'$$,
  $$values ('2026-11-02 00:00Z'::timestamptz)$$, 'set when the version was put under test');

select pg_temp.before_move(null, false);
delete from private.prompt_labels_before_configurations;
select throws_ok($$select private.migrate_configuration_prompts()$$, '55000', null,
  'with no active version the move refuses to run');
insert into private.prompt_labels_before_configurations (label, version_id)
  values ('active', pg_temp.prompt('active'));
select lives_ok($$select private.migrate_configuration_prompts()$$,
  'control: with one it runs');

-- One draft per plan, saved through extract-cards after its check call.

create temp table first_draft as
  select pg_temp.as_service(format($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'special', 'openrouter', 'vendor/model', %s)$q$, pg_temp.prompt('test')))::bigint as id;
select results_eq($$select id, provider, prompt_version_id from pg_temp.labelled('special', 'test')$$,
  $$select id, 'openrouter', pg_temp.prompt('test') from first_draft$$,
  'an admin saves 스페셜''s draft with a version');
select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'special', 'anthropic', 'claude-later')$q$);
select results_eq($$select provider, model, prompt_version_id from pg_temp.labelled('special', 'test')$$,
  $$values ('anthropic', 'claude-later', pg_temp.prompt('test'))$$,
  'a later draft replaces it, keeping the draft''s version when it names none');
select is((select count(*) from private.ai_configuration_labels where plan = 'special' and label = 'test'), 1::bigint,
  'and the plan holds one draft');
select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'pro', 'openrouter', 'vendor/pro-model')$q$);
select results_eq($$select prompt_version_id from pg_temp.labelled('pro', 'test')$$,
  $$values (pg_temp.prompt('active'))$$, 'a plan with no draft takes its active version');
create temp table configurations_before as select count(*) as n from private.ai_configurations;
select ok(pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'pro', 'openrouter', 'vendor/pro-model', 999999)$q$)
  is null, 'a version that does not exist is refused');
select results_eq(
  $$select (select count(*) from private.ai_configurations) = (select n from configurations_before),
      (select count(*) from private.admin_audit where action = 'save_ai_configuration' and detail ->> 'prompt_version_id' = '999999')$$,
  $$values (true, 0::bigint)$$, 'appending and recording nothing');
select ok(pg_temp.as_service(format($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'pro', 'openrouter', 'vendor/pro-model', %s)$q$, pg_temp.prompt('test')))
  is not null, 'control: the same draft with a version that exists is saved');
select results_eq(
  $$select detail from private.admin_audit where action = 'save_ai_configuration' order by id desc limit 1$$,
  $$select jsonb_build_object('configuration_id', id, 'provider', 'openrouter', 'model', 'vendor/pro-model',
      'prompt_version_id', pg_temp.prompt('test')) from pg_temp.labelled('pro', 'test')$$,
  'saving records the provider, model and version');

-- The extract-cards bundle deployed before this change.

select is(
  (select pg_get_function_result('public.begin_extraction(uuid, bigint)'::regprocedure)),
  'TABLE(plan text, provider text, model text, available boolean, photo_limit integer, period text, allowed boolean, prompt_version_id bigint, prompt text, usage_id bigint)',
  'begin_extraction answers the columns the earlier bundle reads');
select pg_temp.as_service($q$select public.save_ai_configuration(admin_id => '00000000-0000-4000-8000-00000000000a', plan => 'max', provider => 'openrouter', model => 'vendor/max-model')$q$);
select results_eq($$select model, prompt_version_id from pg_temp.labelled('max', 'test')$$,
  $$select 'vendor/max-model', prompt_version_id from pg_temp.labelled('max', 'active')$$,
  'its call naming the provider and model alone saves a draft on the plan''s active version');

-- The trial names a configuration, its prompt with it.

select results_eq(
  $$select provider, model, prompt from pg_temp.start('a', (select id from pg_temp.labelled('special', 'test')))$$,
  $$values ('anthropic', 'claude-later', 'Test prompt.')$$,
  'the trial''s draft side is served the draft''s provider, model and version');
select results_eq(
  $$select provider, prompt from pg_temp.start('a', (select id from pg_temp.labelled('special', 'active')))$$,
  $$values ('openrouter', 'Active prompt.')$$,
  'and its active side the active configuration''s, whatever the admin''s draft');
select is((select count(*) from pg_temp.start('b', (select id from pg_temp.labelled('free', 'active')))),
  0::bigint, 'a user who is not an admin naming a configuration is served nothing');

-- A configuration with no prompt version, as one saved before the change, serves nothing.

insert into private.ai_configurations (plan, provider, model)
  values ('max', 'openrouter', 'vendor/no-prompt');
update private.ai_configuration_labels as l set configuration_id = (
    select c.id from private.ai_configurations as c where c.model = 'vendor/no-prompt')
  where l.plan = 'max' and l.label = 'test';
select results_eq($$select model, prompt_version_id is null from pg_temp.labelled('max', 'test')$$,
  $$values ('vendor/no-prompt', true)$$,
  'setup: Max''s draft names a configuration with no prompt version');
select results_eq(
  $$select (select count(*) from pg_temp.start('a', (select id from pg_temp.labelled('max', 'test')))),
      (select count(*) from pg_temp.start('a', (select id from pg_temp.labelled('max', 'active'))))$$,
  $$values (0::bigint, 1::bigint)$$,
  'a configuration with no prompt version answers no row, where the plan''s active one with a version answers one');

-- Applying and ending a draft.

select pg_temp.sign_in('a');
select is(public.admin_clear_ai_test('special'), true, '테스트 끝내기 ends 스페셜''s draft');
reset role;
select results_eq($$select provider, prompt_version_id from pg_temp.start('a')$$,
  $$values ('openrouter', pg_temp.prompt('active'))$$,
  'so an admin is served the active provider and version again');
select pg_temp.as_service(format($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'free', 'anthropic', 'claude-free', %s)$q$, pg_temp.prompt('test')));
select results_eq($$select provider, prompt_version_id from pg_temp.start('b')$$,
  $$values ('openrouter', pg_temp.prompt('active'))$$, 'a draft serves no user');
select pg_temp.sign_in('a');
select is(public.admin_activate_ai_configuration('free'), 'activated', '모두에게 적용');
reset role;
select results_eq($$select provider, model, prompt_version_id, prompt from pg_temp.start('b')$$,
  $$values ('anthropic', 'claude-free', pg_temp.prompt('test'), 'Test prompt.')$$,
  'every user of the plan is then served its provider, model and version together');
select is((select count(*) from pg_temp.labelled('free', 'test')), 0::bigint, 'and the draft is gone');
select results_eq(
  $$select detail ->> 'prompt_version_id' from private.admin_audit where action = 'activate_ai_configuration'$$,
  $$values (pg_temp.prompt('test')::text)$$, 'applying records the version');

-- The reads.

select pg_temp.sign_in('a');
select results_eq(
  $$select label, provider, prompt_version_id from public.admin_ai_configurations() where plan = 'free'$$,
  $$values ('active', 'anthropic', pg_temp.prompt('test'))$$,
  'each labelled configuration reads with its version');
select results_eq(
  $$select provider, model, prompt_version_id, calls, unrecorded from public.admin_configuration_results(30)
    where model in ('claude-free', 'claude-later') order by model$$,
  $$values ('anthropic', 'claude-free', pg_temp.prompt('test'), 0::bigint, 1::bigint),
           ('anthropic', 'claude-later', pg_temp.prompt('test'), 0::bigint, 1::bigint)$$,
  'the results read per provider, model and version, a call without an outcome unrecorded');
reset role;
select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_configuration_results()$$, '42501', null,
  'a user who is not an admin cannot read the results');
select pg_temp.sign_in(null);
select throws_ok($$select * from public.admin_configuration_results()$$, '42501', null, 'nor can anon');
select pg_temp.sign_in('a');
select lives_ok($$select * from public.admin_configuration_results()$$, 'control: an admin can');
reset role;

-- The revert.

select private.revert_configuration_prompts();
select results_eq($$select label, version_id from private.prompt_labels order by label$$,
  $$values ('active', pg_temp.prompt('active'))$$, 'the revert puts the global labels back as they were');
select results_eq($$select provider, model, prompt_version_id from pg_temp.start('b')$$,
  $$values ('anthropic', 'claude-free', pg_temp.prompt('active'))$$,
  'a user is served the labels'' version again, on the configuration''s provider and model');
select pg_temp.sign_in('a');
select ok(public.admin_set_prompt_label('test', pg_temp.prompt('test')), 'an admin labels a version again');
reset role;
select results_eq($$select prompt_version_id from pg_temp.start('a')$$,
  $$values (pg_temp.prompt('test'))$$, 'and an admin is served the test label''s version');
select pg_temp.sign_in('a');
select results_eq($$select label, version_id from public.admin_prompt_labels()$$,
  $$values ('active', pg_temp.prompt('active')), ('test', pg_temp.prompt('test'))$$,
  'the restored admin_prompt_labels reads both labels');
select results_eq(
  $$select labels from public.admin_prompt_versions() where id in (pg_temp.prompt('active'), pg_temp.prompt('test')) order by id$$,
  $$values (array['active']), (array['test'])$$,
  'the restored admin_prompt_versions reads each version''s label from them');
select results_eq(
  $$select labels, active_id, active_text from public.admin_prompt_version(pg_temp.prompt('test'))$$,
  $$values (array['test'], pg_temp.prompt('active'), 'Active prompt.')$$,
  'the restored admin_prompt_version reads its labels and the active version''s text');
select is(public.admin_clear_test_prompt(), true, 'the restored admin_clear_test_prompt ends the test label');
reset role;
select results_eq($$select prompt_version_id from pg_temp.start('a')$$,
  $$values (pg_temp.prompt('active'))$$, 'so an admin is served the active label''s version again');

select * from finish();
rollback;
