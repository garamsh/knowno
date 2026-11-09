-- Whether the card markup switch (#763, ADR 0216) was ever set, apart from who set it (#810):
-- `set_by` is set null when the setter's account is deleted, so a null `set_by_email` no longer
-- tells a switch no one has changed from one an admin changed and was deleted since.
--
-- Additive. It adds `private.server_switches.ever_set`; `admin_card_markup()` answers it as a
-- fourth column, `ever_set`, so it is dropped and created again with its grants (a function's result
-- columns cannot change through `create or replace`); and `admin_set_card_markup` sets it on a
-- 'set' and on neither 'unchanged' nor 'bad_value'. No other row changes but the one switch row's
-- `ever_set`.
--
-- The row is brought right on upgrade, wherever production's switch stands: `ever_set` is true when
-- the audit log holds a `set_card_markup` entry, which `admin_set_card_markup` records with each
-- 'set' and `private.admin_audit` keeps when the admin's account is deleted (`admin_id` is set null,
-- the row stays). A switch never changed has none and stays false.
--
-- Deploy. The web admin's reader of `admin_card_markup` (#809) follows this migration; the one
-- deployed before it ignores the new column.
--
-- Revert, run once against production before `private.revert_card_markup_switch()` if that is run
-- too: `select private.revert_card_markup_ever_set();`, then
-- `drop function private.revert_card_markup_ever_set();`. It puts `admin_card_markup` and
-- `admin_set_card_markup` back as `20261109150000_card_markup_switch.sql` made them, with their
-- grants, and drops the column. After `revert_card_markup_switch()` there is nothing to run: it
-- drops the table and both functions.

alter table private.server_switches add column ever_set boolean not null default false;

update private.server_switches as s set ever_set = true
  where s.name = 'card_markup' and exists (
    select from private.admin_audit as a
    where a.action = 'set_card_markup' and a.target_kind = 'switch'
      and a.target_id = 'card_markup');

drop function public.admin_card_markup();

-- The switch as it stands, with who set it and when; `ever_set` is whether anyone ever changed it,
-- true after a deleted setter's account too, when `set_by_email` is null.
create function public.admin_card_markup()
returns table (enabled boolean, set_by_email text, set_at timestamptz, ever_set boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select s.enabled, u.email::text, s.set_at, s.ever_set
  from private.server_switches as s
  left join auth.users as u on u.id = s.set_by
  where s.name = 'card_markup';
end;
$$;

revoke all on function public.admin_card_markup() from public, anon;
grant execute on function public.admin_card_markup() to authenticated;

-- Turns the switch on or off, recorded with its value before: 'set'; 'unchanged' for the value it
-- has and 'bad_value' for null, each recording nothing.
create or replace function public.admin_set_card_markup(enabled boolean) returns text
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
    set enabled = admin_set_card_markup.enabled, set_by = caller, set_at = now(), ever_set = true
    where s.name = 'card_markup';
  perform private.audit('set_card_markup', 'switch', 'card_markup', jsonb_build_object(
    'enabled', admin_set_card_markup.enabled, 'enabled_before', before));
  return 'set';
end;
$$;

-- The revert the header names.
create function private.revert_card_markup_ever_set() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  drop function public.admin_card_markup();
  create function public.admin_card_markup()
  returns table (enabled boolean, set_by_email text, set_at timestamptz)
  language plpgsql
  stable
  security definer
  set search_path = ''
  as $body$
  begin
    perform private.require_admin();
    return query
    select s.enabled, u.email::text, s.set_at
    from private.server_switches as s
    left join auth.users as u on u.id = s.set_by
    where s.name = 'card_markup';
  end;
  $body$;
  revoke all on function public.admin_card_markup() from public, anon;
  grant execute on function public.admin_card_markup() to authenticated;
  create or replace function public.admin_set_card_markup(enabled boolean) returns text
  language plpgsql
  security definer
  set search_path = ''
  as $body$
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
  $body$;
  alter table private.server_switches drop column ever_set;
end;
$$;

revoke all on function private.revert_card_markup_ever_set() from public, anon, authenticated;
