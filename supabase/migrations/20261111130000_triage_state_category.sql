-- `my_triage_state` also answers `category`, the category (`spam` or `ad`) of the AI hide action in
-- force on the caller's own note, or null when none is (#900, ADR 0244), so the owner's deck screen
-- can say what the AI hid the note for. The three keys it answered stay as they were. The function
-- keeps its signature, owner and privileges.
--
-- Revert, run once against production before `private.revert_report_triage()`, which drops
-- `public.my_triage_state(uuid)` and so leaves this revert nothing to drop:
-- `select private.revert_state_category();`, then
-- `drop function private.revert_state_category();`. It puts the function back as
-- `20261111000000_report_triage.sql` made it. It changes no row.

create or replace function public.my_triage_state(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hidden_by_ai', exists (select from private.triage_actions as a
      join private.deck_screening as s on s.deck_id = a.deck_id and s.hold = 'ai'
      where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null and d.hidden),
    'appealed', exists (select from private.triage_appeals as p where p.deck_id = d.id
      and p.action_id = (select max(a.id) from private.triage_actions as a
        where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)),
    'resolved', exists (select from private.triage_appeals as p
      where p.deck_id = d.id and p.resolved_at is not null
        and p.action_id = (select max(a.id) from private.triage_actions as a
          where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)),
    'category', (select a.category from private.triage_actions as a
      join private.deck_screening as s on s.deck_id = a.deck_id and s.hold = 'ai'
      where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null and d.hidden
      order by a.id desc limit 1))
  from public.decks as d
  where d.id = my_triage_state.deck_id and d.user_id = (select auth.uid());
$$;

-- The revert in the header.
create function private.revert_state_category() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  execute $sql$
    create or replace function public.my_triage_state(deck_id uuid) returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $fn$
      select jsonb_build_object(
        'hidden_by_ai', exists (select from private.triage_actions as a
          join private.deck_screening as s on s.deck_id = a.deck_id and s.hold = 'ai'
          where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null and d.hidden),
        'appealed', exists (select from private.triage_appeals as p where p.deck_id = d.id
          and p.action_id = (select max(a.id) from private.triage_actions as a
            where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)),
        'resolved', exists (select from private.triage_appeals as p
          where p.deck_id = d.id and p.resolved_at is not null
            and p.action_id = (select max(a.id) from private.triage_actions as a
              where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)))
      from public.decks as d
      where d.id = my_triage_state.deck_id and d.user_id = (select auth.uid());
    $fn$
  $sql$;
end;
$revert$;

revoke all on function private.revert_state_category() from public, anon, authenticated;
