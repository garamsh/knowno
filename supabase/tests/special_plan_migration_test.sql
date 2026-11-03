-- The 스페셜 migration's seed and its revert (#649, ADR 0177): special served by a copy of Max's
-- active configuration; and `private.revert_special_plan()`, the header's revert, run after the
-- migration and after grants changed since, putting 무제한 grants and the plans back without a
-- conflict, and leaving nothing named special that a web from before reads.
begin;
select plan(20);

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

-- A is an admin; B held Pro and 무제한, kept on special; C held Max and 무제한, moved to Pro since;
-- D held Pro and a 무제한 that had ended; E is on Free and given special since.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'kept@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'moved@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'ended@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'new@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into private.user_plans (user_id, plan, version_id, granted_at)
  select ('00000000-0000-4000-8000-00000000000' || g.who)::uuid, g.plan,
    (private.plan_version_at(g.plan, now())).id, '2026-10-01'
  from (values ('b', 'pro'), ('c', 'max'), ('d', 'pro')) as g (who, plan);
insert into private.unlimited_grants_before_special (user_id, ends_at, granted_by, granted_at) values
  ('00000000-0000-4000-8000-00000000000b', null, '00000000-0000-4000-8000-00000000000a', '2026-10-02'),
  ('00000000-0000-4000-8000-00000000000c', null, '00000000-0000-4000-8000-00000000000a', '2026-10-03'),
  ('00000000-0000-4000-8000-00000000000d', '2026-10-05', '00000000-0000-4000-8000-00000000000a', '2026-10-04');
select private.migrate_special_plan();

-- Signs in as the user whose id ends in [who].
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
end;
$$;

select pg_temp.sign_in('a');
select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000c', 'pro'), 'granted',
  'an admin moves C from special to Pro after the migration');
select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000e', 'special',
  now() + interval '1 day'), 'granted', 'and gives E special until tomorrow');
reset role;
select results_eq(
  $$select u.email::text, p.plan from private.user_plans as p
    join auth.users as u on u.id = p.user_id order by 1$$,
  $$values ('ended@example.com', 'pro'), ('kept@example.com', 'special'),
    ('moved@example.com', 'pro'), ('new@example.com', 'special')$$,
  'before the revert: B and E on special, C moved to Pro, D on Pro');

-- A photo of B's on special, as begin_extraction records it.
with u as (
  insert into public.extraction_usage (user_id) values ('00000000-0000-4000-8000-00000000000b')
  returning id
)
insert into private.extraction_calls (usage_id, plan, provider, model, prompt_version_id)
  select u.id, 'special', 'anthropic', 'max-model', (select min(id) from private.prompt_versions)
  from u;
create temp table special_call as
  select usage_id from private.extraction_calls where plan = 'special';

select lives_ok($$select private.revert_special_plan()$$, 'the header''s revert runs');

-- The grants.

select results_eq(
  $$select u.email::text, g.ends_at, b.email::text, g.granted_at
    from private.unlimited_grants as g join auth.users as u on u.id = g.user_id
    left join auth.users as b on b.id = g.granted_by order by 1$$,
  $$values
    ('ended@example.com', '2026-10-05'::timestamptz, 'admin@example.com', '2026-10-04'::timestamptz),
    ('kept@example.com', null, 'admin@example.com', '2026-10-02'),
    ('new@example.com', now() + interval '1 day', 'admin@example.com', now())$$,
  'a 무제한 grant for each special grant standing, the migration''s and the one since, and the ended one kept; none for C, moved off special');
select results_eq(
  $$select u.email::text, p.plan from private.user_plans as p
    join auth.users as u on u.id = p.user_id order by 1$$,
  $$values ('ended@example.com', 'pro'), ('kept@example.com', 'pro'), ('moved@example.com', 'pro')$$,
  'B back on the Pro special replaced, C on the Pro set since rather than its Max before, D untouched, E on Free');
select results_eq(
  $$select p.granted_at from private.user_plans as p
    where p.user_id = '00000000-0000-4000-8000-00000000000c'$$,
  $$select now()$$, 'C''s grant is the one set since');
select results_eq(
  $$select (select private.unlimited(('00000000-0000-4000-8000-00000000000' || w)::uuid))
    from unnest(array['a', 'b', 'c', 'e']) as w$$,
  $$values (true), (true), (false), (true)$$,
  'no photo limit for the admin, B and E, and one for C');
select results_eq(
  $$select e.plan from unnest(array['a', 'b', 'e']) as w,
    private.entitlement_of(('00000000-0000-4000-8000-00000000000' || w)::uuid) as e$$,
  $$values ('free'), ('pro'), ('free')$$,
  'the admin on its own plan again, B on Pro and E on Free');

-- The functions and the schema.

select pg_temp.sign_in('a');
select results_eq(
  $$select unlimited, ends_at from public.admin_user_unlimited('00000000-0000-4000-8000-00000000000b')$$,
  $$values (true, null::timestamptz)$$, 'admin_user_unlimited reads B''s 무제한 grant');
select is(public.admin_grant_plan('00000000-0000-4000-8000-00000000000e', 'special'), 'bad_plan',
  'admin_grant_plan no longer gives special');
reset role;
select throws_ok(
  $$insert into private.plan_versions (plan, quota, amount, starts_at) values ('special', 'daily', 1, now())$$,
  '23514', null, 'no version of special can be added, even with terms that limit');
select is((select count(*) from private.plan_versions where plan = 'special'), 0::bigint,
  'and none is left');

-- Nothing a web from before reads names special.

select is(
  (select count(*) from private.ai_configuration_labels where plan = 'special'), 0::bigint,
  'special has no label, so the AI settings list no special configuration');
select results_eq(
  $$select c.plan from private.extraction_calls as c join special_call as s using (usage_id)$$,
  $$values ('max')$$, 'B''s photo on special is counted as Max''s');
select results_eq(
  $$select usage_id from private.extraction_calls_before_special_revert$$,
  $$select usage_id from special_call$$, 'and its id is kept');
select is((select count(*) from private.extraction_calls where plan = 'special'), 0::bigint,
  'no call names special');

select * from finish();
rollback;
