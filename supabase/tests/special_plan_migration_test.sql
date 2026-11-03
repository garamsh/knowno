-- The 스페셜 migration's seed (#649, ADR 0177): special served by a copy of Max's active
-- configuration.
begin;
select plan(3);

delete from private.admin_audit;

-- The seed on the migrated state, then on Max and Free configured apart.

select results_eq(
  $$select c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and l.plan = 'special'$$,
  $$select c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and l.plan = 'max'$$,
  'on the migrated state special is served the provider and model Max is');

with c as (
  insert into private.ai_configurations (plan, provider, model) values
    ('free', 'openrouter', 'vendor/free-model'), ('max', 'anthropic', 'max-model')
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id)
  select c.plan, 'active', c.id from c
  on conflict (plan, label) do update set configuration_id = excluded.configuration_id;
delete from private.ai_configuration_labels where plan = 'special';
select private.migrate_special_plan();
select private.migrate_special_plan();
select results_eq(
  $$select l.plan, c.provider, c.model from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and l.plan in ('free', 'max', 'special') order by l.plan$$,
  $$values ('free', 'openrouter', 'vendor/free-model'), ('max', 'anthropic', 'max-model'),
    ('special', 'anthropic', 'max-model')$$,
  'special is given a copy of Max''s active configuration, not Free''s');
select is(
  (select count(*) from private.ai_configurations where plan = 'special' and model = 'max-model'),
  1::bigint, 'once, however often the migration runs');

select * from finish();
rollback;
