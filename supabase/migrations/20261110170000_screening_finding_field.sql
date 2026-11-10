-- A note's findings carry `field`, the path of the string their offsets index, as the rules
-- verdict stores it (#875, ADR 0238, ADR 0240). `private.screening_findings` dropped it, so
-- `my_deck_screening` and `admin_screening_findings` could not place a finding in a block that
-- holds several strings. The function keeps its signature, owner and privileges.
--
-- Revert, run once against production: `select private.revert_finding_field();`, then
-- `drop function private.revert_finding_field();`. It puts `private.screening_findings`
-- back as `20261110130000_publish_screening.sql` made it. It changes no row.

create or replace function private.screening_findings(p_deck uuid, p_hash text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'card_id', c.id, 'where', e.f ->> 'where', 'block', e.f -> 'block',
      'field', e.f -> 'field',
      'category', e.f ->> 'category', 'start', e.f -> 'start', 'end', e.f -> 'end')
    order by v.layer, c.created_at, c.id, e.n), '[]'::jsonb)
  from private.screening_verdicts as v
  cross join lateral jsonb_array_elements(v.findings) with ordinality as e (f, n)
  left join public.cards as c
    on c.deck_id = p_deck and c.deleted_at is null and e.f ->> 'card' is not null
      and private.card_hash(c.front, c.back, c.template, c.template_version) = e.f ->> 'card'
  where v.content_hash = p_hash and v.outcome <> 'clean'
    and (e.f ->> 'card' is null or c.id is not null);
$$;

-- The revert in the header.
create function private.revert_finding_field() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  drop function private.screening_findings(uuid, text);
  execute $sql$
    create function private.screening_findings(p_deck uuid, p_hash text) returns jsonb
    language sql
    stable
    security definer
    set search_path = ''
    as $body$
      select coalesce(jsonb_agg(jsonb_build_object(
          'card_id', c.id, 'where', e.f ->> 'where', 'block', e.f -> 'block',
          'category', e.f ->> 'category', 'start', e.f -> 'start', 'end', e.f -> 'end')
        order by v.layer, c.created_at, c.id, e.n), '[]'::jsonb)
      from private.screening_verdicts as v
      cross join lateral jsonb_array_elements(v.findings) with ordinality as e (f, n)
      left join public.cards as c
        on c.deck_id = p_deck and c.deleted_at is null and e.f ->> 'card' is not null
          and private.card_hash(c.front, c.back, c.template, c.template_version) = e.f ->> 'card'
      where v.content_hash = p_hash and v.outcome <> 'clean'
        and (e.f ->> 'card' is null or c.id is not null);
    $body$;
  $sql$;
  revoke all on function private.screening_findings(uuid, text) from public, anon, authenticated;
end;
$revert$;

revoke all on function private.revert_finding_field() from public, anon, authenticated;
