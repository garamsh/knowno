-- `private.adopt_project_url()` makes the one Vault secret `project_url` from the address of a
-- per-function URL secret and removes the per-function secrets (#906, ADR 0245). The callers it
-- serves are tested with their migrations.
begin;
select plan(12);

create function pg_temp.names() returns text language sql as $$
  select coalesce(string_agg(name, ',' order by name), '') from vault.secrets
  where name in ('project_url', 'assistant_function_url', 'screening_function_url', 'triage_function_url');
$$;
create function pg_temp.project_url() returns text language sql as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'project_url';
$$;

select is(pg_temp.names(), '', 'the setup: none of the four secrets exists');
select lives_ok($$select private.adopt_project_url()$$, 'with none present it runs');
select is(pg_temp.names(), '', 'and creates none');

select vault.create_secret('https://aaa.supabase.co/functions/v1/assistant', 'assistant_function_url');
select vault.create_secret('https://bbb.supabase.co/functions/v1/publish-note', 'screening_function_url');
select vault.create_secret('https://ccc.supabase.co/functions/v1/triage-reports', 'triage_function_url');
select private.adopt_project_url();
select is(pg_temp.project_url(), 'https://aaa.supabase.co', 'project_url is the address of the assistant secret first');
select is(pg_temp.names(), 'project_url', 'and the three per-function secrets are removed');

select vault.create_secret('https://ddd.supabase.co/functions/v1/triage-reports', 'triage_function_url');
select private.adopt_project_url();
select is(pg_temp.project_url(), 'https://aaa.supabase.co', 'a project_url already set is kept');
select is(pg_temp.names(), 'project_url', 'and a per-function secret is still removed');

delete from vault.secrets where name = 'project_url';
select vault.create_secret('https://eee.supabase.co/functions/v1/triage-reports', 'triage_function_url');
select vault.create_secret('https://fff.supabase.co/functions/v1/publish-note', 'screening_function_url');
select private.adopt_project_url();
select is(pg_temp.project_url(), 'https://fff.supabase.co', 'with no assistant secret the screening one is read before the triage one');

delete from vault.secrets where name = 'project_url';
select vault.create_secret('not a url', 'triage_function_url');
select private.adopt_project_url();
select is(pg_temp.names(), 'triage_function_url', 'a per-function secret with no address is neither read nor removed');
select is(pg_temp.project_url(), null, 'and no project_url is made from it');

delete from vault.secrets where name = 'triage_function_url';
select vault.create_secret('https://ggg.supabase.co', 'project_url');
select private.adopt_project_url();
select is(pg_temp.names(), 'project_url', 'with only project_url present nothing changes');
select is(pg_temp.project_url(), 'https://ggg.supabase.co', 'and its value stands');

select * from finish();
rollback;
