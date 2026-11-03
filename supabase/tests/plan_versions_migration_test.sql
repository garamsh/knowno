-- The plan versions migration (20261026005136_plan_versions.sql, ADR 0097), as it stands after
-- 20261102183518_ai_providers.sql moved each version's model into a backup (ADR 0162): on this
-- database's seed, what it made, each model kept in the backup; its records; no client reaching the
-- versions, the backups or its functions; and the revert putting every plan back on its settings.
-- Its run on production's settings and grants, through `private.migrate_plan_versions`, was tested
-- here until that one-time function, which writes the model the versions no longer hold, was dropped.
begin;
select plan(8);

-- What extract-cards gets for one photo of the user whose id ends in [who].
create function pg_temp.start(who text)
returns table (plan text, model text, photo_limit integer, period text)
language plpgsql as $$
begin
  perform set_config('role', 'service_role', true);
  return query select b.plan, b.model, b.photo_limit, b.period
    from public.begin_extraction(('00000000-0000-4000-8000-00000000000' || who)::uuid) as b;
  perform set_config('role', 'none', true);
end;
$$;

-- What the migration made of the seed: three plans on Haiku 5.5 at 30 a day.

select results_eq(
  $$select v.plan, v.quota, v.amount, m.model, v.applies_to_all, v.starts_at = b.updated_at
    from private.plan_versions as v
    join private.plans_before_versions as b on b.id = case v.plan when 'max' then 'special' else v.plan end
    join private.plan_versions_models_before_ai as m on m.version_id = v.id
    order by array_position(array['free', 'pro', 'max'], v.plan), v.id$$,
  $$values
    ('free', 'daily', 30, 'anthropic/claude-haiku-5.5', false, true),
    ('free', 'monthly', 10, 'anthropic/claude-haiku-5.5', false, false),
    ('pro', 'daily', 30, 'anthropic/claude-haiku-5.5', false, true),
    ('pro', 'daily', 100, 'anthropic/claude-haiku-5.5', true, false),
    ('max', 'daily', 30, 'anthropic/claude-haiku-5.5', false, true),
    ('max', 'unlimited', 1000, 'anthropic/claude-haiku-5.5', true, false)$$,
  'on the seed: each plan''s settings as its first version from when they were set, then the owner''s terms on the same model, for all where they are in the users'' favour');
select results_eq(
  $$select id, model, daily_limit from private.plans_before_versions order by id$$,
  $$values ('free', 'anthropic/claude-haiku-5.5', 30), ('pro', 'anthropic/claude-haiku-5.5', 30),
           ('special', 'anthropic/claude-haiku-5.5', 30)$$,
  'the settings before are kept verbatim');
select results_eq(
  $$select admin_id, admin_email, action, target_kind, target_id, detail->>'quota'
    from private.admin_audit where action = 'create_plan_version' order by id$$,
  $$values
    (null::uuid, 'migration (owner delegated to PM, 2026-10-26)', 'create_plan_version', 'plan', 'free', 'monthly'),
    (null::uuid, 'migration (owner delegated to PM, 2026-10-26)', 'create_plan_version', 'plan', 'pro', 'daily'),
    (null::uuid, 'migration (owner delegated to PM, 2026-10-26)', 'create_plan_version', 'plan', 'max', 'unlimited')$$,
  'each version of the owner''s terms is recorded, by the migration');

-- No client reaches the backups or the migration's functions.

select results_eq(
  $$select count(*) from unnest(array['private.plans_before_versions', 'private.user_plans_before_versions',
      'private.extraction_calls_before_versions', 'private.plan_versions',
      'private.plan_versions_models_before_ai']) as t
    cross join unnest(array['anon', 'authenticated']) as r
    where has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert')$$,
  $$values (0::bigint)$$, 'no client role reads or writes the versions or the backups');
select results_eq(
  $$select count(*) from unnest(array['private.revert_plan_versions()', 'private.entitlement_of(uuid)']) as f
    cross join unnest(array['anon', 'authenticated', 'service_role']) as r
    where has_function_privilege(r, f, 'execute')$$,
  $$values (0::bigint)$$, 'and none runs the migration''s functions');
select ok(has_function_privilege('service_role', 'public.begin_extraction(uuid, bigint)', 'execute'),
  'control: service_role runs begin_extraction, which calls them as its owner');

-- The revert, on the seed's settings: 30 a day for each plan.

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000002', 'new@example.com');
select is(private.revert_plan_versions(), 3, 'the revert adds a version for each plan');
select results_eq(
  $$select plan, photo_limit, period from pg_temp.start('2')$$,
  $$values ('free', 30, 'day')$$,
  'putting a new user back on its plan''s settings before');

select * from finish();
rollback;
