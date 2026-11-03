-- The AI provider per plan (#598, ADR 0162): the migration's seed and backup; provider keys in
-- Vault, readable decrypted by service_role alone and never recorded; a configuration saved as a
-- draft served to admins only, tried by id, and applied to everyone; a key in use kept; a recent
-- sign-in required to remove a key; every write recorded; and no client reaching any of it.
begin;
select plan(56);

delete from private.admin_audit;

-- A is an admin, B a Free user; both from long ago.
insert into auth.users (id, email, created_at) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', now() - interval '90 days'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', now() - interval '90 days');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');

-- Signs in as the user whose id ends in [who], [minutes] after its sign-in, or as anon for null.
create function pg_temp.sign_in(who text, minutes integer default 1) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', format(
      '{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated","amr":[{"method":"oauth","timestamp":%s}]}',
      who, floor(extract(epoch from now()) - minutes * 60)::bigint), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text, integer) to public;

-- What extract-cards gets for one photo of the user whose id ends in [who], naming [configuration].
create function pg_temp.start(who text, configuration bigint default null)
returns table (provider text, model text, available boolean, allowed boolean, usage_id bigint)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.provider, b.model, b.available, b.allowed, b.usage_id
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

create function pg_temp.config(plan text, label text) returns bigint language sql stable as $$
  select configuration_id from private.ai_configuration_labels as l
  where l.plan = config.plan and l.label = config.label;
$$;

-- The seed and the backup.

select results_eq(
  $$select l.plan, c.provider, c.model = m.model
    from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    join private.plan_versions_models_before_ai as m
      on m.version_id = (private.plan_version_at(l.plan, now())).id
    where l.label = 'active' order by array_position(array['free', 'pro', 'max'], l.plan)$$,
  $$values ('free', 'openrouter', true), ('pro', 'openrouter', true), ('max', 'openrouter', true)$$,
  'each plan is served on OpenRouter by its current version''s model, as before the change');
select is(
  (select count(*) from private.plan_versions_models_before_ai),
  (select count(*) from private.plan_versions),
  'every version''s model is kept in the backup');
select is((select count(*) from private.ai_configuration_labels where label = 'test'), 0::bigint,
  'no plan has a draft');
select hasnt_column('private', 'plan_versions', 'model', 'the versions hold no model');

-- No client reaches the tables or the service functions.

select results_eq(
  $$select count(*) from unnest(array['private.ai_configurations', 'private.ai_configuration_labels',
      'private.provider_keys', 'private.plan_versions_models_before_ai']) as t
    cross join unnest(array['anon', 'authenticated', 'service_role']) as r
    where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')$$,
  $$values (0::bigint)$$, 'no role reads or writes the tables directly');
select results_eq(
  $$select count(*) from unnest(array['public.provider_key(text)',
      'public.save_provider_key(uuid, text, text)', 'public.save_ai_configuration(uuid, text, text, text)',
      'public.begin_extraction(uuid, bigint, text[])']) as f
    cross join unnest(array['anon', 'authenticated']) as r
    where has_function_privilege(r, f, 'execute')$$,
  $$values (0::bigint)$$, 'no client reads a key, saves one, saves a configuration or begins an extraction');
select ok(has_function_privilege('service_role', 'public.provider_key(text)', 'execute'),
  'control: service_role reads a key');
select results_eq(
  $$select p.proname::text collate "default", p.prosecdef and p.proconfig = array['search_path=""']
    from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('provider_key', 'save_provider_key',
      'save_ai_configuration', 'admin_ai_session', 'admin_provider_keys', 'admin_ai_configurations',
      'admin_activate_ai_configuration', 'admin_clear_ai_test', 'admin_remove_provider_key')
    order by 1$$,
  $$select name, true from unnest(array['admin_activate_ai_configuration',
      'admin_ai_configurations', 'admin_ai_session', 'admin_clear_ai_test', 'admin_provider_keys',
      'admin_remove_provider_key', 'provider_key', 'save_ai_configuration', 'save_provider_key']) as name$$,
  'each runs as its owner with an empty search_path');

-- Every admin function refuses a user who is not an admin, and anon.

create function pg_temp.admin_calls() returns setof text language sql as $$
  values ($q$select public.admin_ai_session()::text$q$),
    ($q$select count(*)::text from public.admin_provider_keys()$q$),
    ($q$select count(*)::text from public.admin_ai_configurations()$q$),
    ($q$select public.admin_activate_ai_configuration('pro')$q$),
    ($q$select public.admin_clear_ai_test('pro')::text$q$),
    ($q$select public.admin_remove_provider_key('openai')$q$)
$$;
grant execute on function pg_temp.admin_calls() to public;
create function pg_temp.refusals(who text) returns bigint language plpgsql as $$
declare
  call text;
  refused bigint := 0;
begin
  for call in select * from pg_temp.admin_calls() loop
    perform pg_temp.sign_in(who);
    begin
      execute call;
    exception when insufficient_privilege then
      refused := refused + 1;
    end;
  end loop;
  perform set_config('role', 'none', true);
  return refused;
end;
$$;
select is(pg_temp.refusals('b'), 6::bigint, 'a user who is not an admin is refused by every one');
select is(pg_temp.refusals(null), 6::bigint, 'and so is anon');
select is(pg_temp.refusals('a'), 0::bigint, 'control: an admin is refused by none');

-- A recent sign-in.

select pg_temp.sign_in('a', 1);
select is(public.admin_ai_session(), true, 'an admin who signed in a minute ago signed in recently');
select pg_temp.sign_in('a', 11);
select is(public.admin_ai_session(), false, 'one who signed in 11 minutes ago did not');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select is(public.admin_ai_session(), false, 'nor one whose session names no sign-in time');
reset role;

-- A key in Vault.

select throws_ok(
  $$select pg_temp.as_service($q$select public.save_provider_key('00000000-0000-4000-8000-00000000000b', 'anthropic', 'sk-ant-user-key-1111')$q$)$$,
  '42501', null, 'a key is saved only for an admin');
select is(
  pg_temp.as_service($q$select public.save_provider_key('00000000-0000-4000-8000-00000000000a', 'anthropic', 'sk-ant-first-key-2222')$q$),
  'saved', 'an admin''s key is saved');
select is(pg_temp.as_service($q$select public.provider_key('anthropic')$q$), 'sk-ant-first-key-2222',
  'service_role reads it decrypted');
select ok(
  (select s.secret <> 'sk-ant-first-key-2222' from vault.secrets as s
    join private.provider_keys as k on k.secret_id = s.id where k.provider = 'anthropic'),
  'Vault holds it encrypted');
select results_eq(
  $$select provider, last_four, set_by from private.provider_keys$$,
  $$values ('anthropic', '2222', '00000000-0000-4000-8000-00000000000a'::uuid)$$,
  'its last four characters and who set it are kept beside it');
select is(
  pg_temp.as_service($q$select public.save_provider_key('00000000-0000-4000-8000-00000000000a', 'anthropic', 'sk-ant-second-key-3333')$q$),
  'saved', 'a key is replaced');
select results_eq(
  $$select (select count(*) from private.provider_keys), (select count(*) from vault.secrets
      where name = 'knowno_provider_key_anthropic'), (select last_four from private.provider_keys)$$,
  $$values (1::bigint, 1::bigint, '3333')$$, 'in place, one secret per provider');
select is(pg_temp.as_service($q$select public.provider_key('anthropic')$q$), 'sk-ant-second-key-3333',
  'and the new key is read');
select results_eq(
  $$select pg_temp.as_service(format($q$select public.save_provider_key('00000000-0000-4000-8000-00000000000a', %L, %L)$q$, p, k))
    from (values ('anthropic', 'short'), ('anthropic', 'sk-with a-space-1'), ('gemini', 'sk-gemini-key-1234')) as t (p, k)$$,
  $$values ('bad_key'), ('bad_key'), ('bad_key')$$,
  'a short key, a key with a space and an unknown provider are refused');
select is(pg_temp.as_service($q$select public.provider_key('openai')$q$), null, 'a provider without a key reads none');

-- A draft, served to admins alone, tried by id and applied to everyone.


select throws_ok(
  $$select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000b', 'free', 'anthropic', 'claude-model')$q$)$$,
  '42501', null, 'a configuration is saved only for an admin');
select throws_ok(
  $$select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'free', 'anthropic', 'vendor/claude')$q$)$$,
  '23514', null, 'nor with a model id of another provider''s form');
create temp table saved_openai as
  select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'free', 'openai', 'gpt-model')$q$)::bigint as id;
select results_eq(
  $$select l.configuration_id, c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.plan = 'free' and l.label = 'test'$$,
  $$select id, 'openai', 'gpt-model' from saved_openai$$,
  'an admin saves a draft for Free, on OpenAI, which has no key');
select results_eq($$select provider, available, allowed, usage_id is null from pg_temp.start('a')$$,
  $$values ('openai', false, false, true)$$,
  'the admin is served the draft, unavailable without a key, and nothing is counted');
select results_eq($$select provider, available, allowed from pg_temp.start('b')$$,
  $$values ('openrouter', false, false)$$,
  'a user is served the active configuration, which needs OpenRouter''s key or the transition secret');
select results_eq(
  $$select provider, available, allowed from public.begin_extraction('00000000-0000-4000-8000-00000000000b',
      secret_providers => array['openrouter'])$$,
  $$values ('openrouter', true, true)$$,
  'control: with the transition secret the user is served and counted');
reset role;
create temp table saved_anthropic as
  select pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'free', 'anthropic', 'claude-model')$q$)::bigint as id;
select results_eq(
  $$select l.configuration_id, c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.plan = 'free' and l.label = 'test'$$,
  $$select id, 'anthropic', 'claude-model' from saved_anthropic$$,
  'a later draft replaces the earlier one');
select results_eq($$select provider, model, available, allowed, usage_id is not null from pg_temp.start('a')$$,
  $$values ('anthropic', 'claude-model', true, true, true)$$,
  'the admin is served the new draft, whose provider has a key, and the photo is counted');
select results_eq(
  $$select c.provider, c.model from private.extraction_calls as c
    join public.extraction_usage as u on u.id = c.usage_id
    where u.user_id = '00000000-0000-4000-8000-00000000000a'$$,
  $$values ('anthropic', 'claude-model')$$, 'and recorded with the provider and model that served it');
select results_eq(
  $$select provider from pg_temp.start('a', pg_temp.config('free', 'active'))$$,
  $$values ('openrouter')$$, 'the admin''s trial names the active configuration to compare with');
select is((select count(*) from pg_temp.start('b', pg_temp.config('free', 'test'))), 0::bigint,
  'a user who is not an admin naming a configuration is served nothing');
select is((select count(*) from pg_temp.start('a', 999999)), 0::bigint,
  'nor is an admin naming a configuration no label holds');

select pg_temp.sign_in('a');
select is(public.admin_activate_ai_configuration('free'), 'activated', '모두에게 적용');
select is(public.admin_activate_ai_configuration('free'), 'no_test', 'with no draft left, nothing more');
reset role;
select results_eq($$select provider, model from pg_temp.start('b')$$,
  $$values ('anthropic', 'claude-model')$$, 'every user of the plan is now served it');
select ok(
  pg_temp.as_service($q$select public.save_ai_configuration('00000000-0000-4000-8000-00000000000a', 'pro', 'openai', 'gpt-model')$q$)::bigint > 0,
  'a draft for Pro on OpenAI, which has no key');
select pg_temp.sign_in('a');
select is(public.admin_activate_ai_configuration('pro'), 'no_key', 'is not applied while its provider has no key');
select is(public.admin_clear_ai_test('pro'), true, 'it is ended');
select is(public.admin_clear_ai_test('pro'), false, 'once');
select results_eq(
  $$select plan, label, provider, model, created_by_email from public.admin_ai_configurations()
    where plan in ('free', 'pro')$$,
  $$values ('free', 'active', 'anthropic', 'claude-model', 'admin@example.com'),
           ('pro', 'active', 'openrouter', 'anthropic/claude-haiku-5.5', null::text)$$,
  'each plan''s labelled configurations');

-- A key in use is kept; removing one needs a recent sign-in.

select results_eq(
  $$select provider, last_four, set_by_email, in_use from public.admin_provider_keys()$$,
  $$values ('openrouter', null, null, true), ('openai', null, null, false),
           ('anthropic', '3333', 'admin@example.com', true)$$,
  'each provider''s key state, its last four characters and whether an active configuration uses it');
select is(public.admin_remove_provider_key('anthropic'), 'in_use', 'a key in use is not removed');
reset role;
select is(
  pg_temp.as_service($q$select public.save_provider_key('00000000-0000-4000-8000-00000000000a', 'openai', 'sk-openai-key-4444')$q$),
  'saved', 'an OpenAI key, used by no active configuration');
select pg_temp.sign_in('a', 11);
select is(public.admin_remove_provider_key('openai'), 'reauth', 'removing it needs a recent sign-in');
select pg_temp.sign_in('a', 1);
select is(public.admin_remove_provider_key('openai'), 'removed', 'which then removes it');
reset role;
select results_eq(
  $$select (select count(*) from vault.secrets where name = 'knowno_provider_key_openai'),
      pg_temp.as_service($q$select public.provider_key('openai')$q$)$$,
  $$values (0::bigint, null::text)$$, 'from Vault');
select pg_temp.sign_in('a', 1);
select is(public.admin_remove_provider_key('openai'), 'none', 'removing it again does nothing');
reset role;

-- The records, and never a key.

select results_eq(
  $$select admin_email, action, target_kind, target_id from private.admin_audit order by id$$,
  $$values
    ('admin@example.com', 'set_provider_key', 'provider', 'anthropic'),
    ('admin@example.com', 'set_provider_key', 'provider', 'anthropic'),
    ('admin@example.com', 'save_ai_configuration', 'plan', 'free'),
    ('admin@example.com', 'save_ai_configuration', 'plan', 'free'),
    ('admin@example.com', 'activate_ai_configuration', 'plan', 'free'),
    ('admin@example.com', 'save_ai_configuration', 'plan', 'pro'),
    ('admin@example.com', 'clear_ai_test', 'plan', 'pro'),
    ('admin@example.com', 'set_provider_key', 'provider', 'openai'),
    ('admin@example.com', 'remove_provider_key', 'provider', 'openai')$$,
  'every write is recorded once, with its admin, and the refusals and no-ops not at all');
select is(
  (select count(*) from private.admin_audit as a
    where a::text ~ 'sk-ant-first-key|sk-ant-second-key|sk-openai-key|2222|3333|4444'),
  0::bigint, 'no record holds a key or its last four characters');
select ok((select count(*) from private.admin_audit as a where a::text ~ 'anthropic') > 0,
  'control: the search finds what the records do hold');

-- Configurations are append-only.

select throws_ok($$update private.ai_configurations set model = 'other' where plan = 'free'$$, '55000', null,
  'a configuration is never changed');
select throws_ok($$delete from private.ai_configurations where plan = 'pro'$$, '55000', null,
  'nor removed');

select * from finish();
rollback;
