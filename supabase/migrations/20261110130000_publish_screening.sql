-- Screens a note before it is public (#862, ADR 0238): a client can no longer make a deck public,
-- only `public.request_deck_publication` can, and the deck stays hidden while it is checked by the
-- `publish-note` function's rules (`private.required_screening_layers()`); an edit to a public
-- note's text hides it again until it is re-checked.
--
-- Adds `decks.publication`, `private | checking | held | refused | public`, tied by a CHECK to
-- `visibility` and `hidden`; four tables in `private` (`deck_screening`, `screening_verdicts`,
-- `screening_terms`, `screening_violations`); a guard trigger on `decks` that refuses a client
-- write making a deck public with SQLSTATE 42501 and the message `publication_requires_screening`
-- and keeps `publication` consistent for every other writer; statement triggers on `cards`; the
-- owner's `request_deck_publication` and `my_deck_screening`; the service-role-only
-- `screening_due`, `screening_claim`, `record_screening` and `apply_screening`; the admin
-- functions of the held queue, the banned-word list and the suspension candidates; the sweeper
-- `private.sweep_deck_screening()`, run every minute by the cron job `sweep-deck-screening`.
-- Replaces `private.hide_reported_deck`, `admin_set_deck_hidden`, `admin_unpublish_deck` and
-- `admin_remove_deck`, each with its signature.
--
-- Changes existing rows: the backfill below sets `publication` on every public deck and on every
-- hidden deck, and fires `set_revision`, so those decks take a new revision. The owner approves
-- this migration at the Gate before it merges. A public deck that is not hidden becomes `public`;
-- a hidden public deck becomes `held`; a hidden private deck stays private and keeps a hold, so
-- the decision to hide it still stands when it is published. A hold is `reports` for a deck with
-- a report and `admin` otherwise.
--
-- The sweeper reads two Vault secrets by name and does nothing while either is missing:
-- `screening_function_url`, the function's address
-- `https://<project ref>.supabase.co/functions/v1/publish-note`, and the existing
-- `assistant_service_role_key`. The migration stores neither.
--
-- Revert, run once against production, before the migrations that recreate the same functions are
-- reverted and after any migration made later: `select private.revert_publish_screening();`,
-- then `drop function private.revert_publish_screening();`. It unschedules the cron job, drops
-- the triggers, functions, tables and the column, and puts the four replaced functions back as
-- they were; the Vault secrets stay. Every public deck is then public as `visibility` says.

create table private.deck_screening (
  deck_id uuid primary key references public.decks on delete cascade,
  requested_at timestamptz,
  content_hash text,
  hold text check (hold in ('reports', 'admin', 'ai')),
  refusal text check (refusal in ('rules', 'ai', 'admin')),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz
);

-- One verdict of one layer on one content, reused while the layer's version holds.
create table private.screening_verdicts (
  content_hash text not null,
  layer text not null check (layer in ('rules', 'ai', 'admin')),
  version text not null,
  outcome text not null check (outcome in ('clean', 'refused', 'severe', 'unsure')),
  findings jsonb not null default '[]' check (jsonb_typeof(findings) = 'array'),
  created_at timestamptz not null default now(),
  primary key (content_hash, layer)
);

-- The banned-word list, each term as the admin typed it after NFKC; removal keeps the row.
create table private.screening_terms (
  id bigint generated always as identity primary key,
  term text not null check (char_length(term) between 1 and 100),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index screening_terms_active on private.screening_terms (term) where removed_at is null;

-- A confirmed violation of an owner: a refusal for severe content, or an admin keeping a note
-- hidden. `deck_id` has no foreign key: the count outlives a purged deck.
create table private.screening_violations (
  id bigint generated always as identity primary key,
  deck_id uuid not null,
  owner_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('kept_hidden', 'severe')),
  at timestamptz not null default now()
);

create index deck_screening_decided_by on private.deck_screening (decided_by);
create index screening_terms_created_by on private.screening_terms (created_by);
create index screening_violations_owner_id on private.screening_violations (owner_id);

alter table private.deck_screening enable row level security;
alter table private.screening_verdicts enable row level security;
alter table private.screening_terms enable row level security;
alter table private.screening_violations enable row level security;
revoke all on private.deck_screening, private.screening_verdicts, private.screening_terms,
  private.screening_violations from public, anon, authenticated;

alter table public.decks add column publication text not null default 'private'
  constraint decks_publication_values check (
    publication in ('private', 'checking', 'held', 'refused', 'public'));
grant select (publication) on public.decks to authenticated;

-- The backfill, before the CHECK that ties the columns and the guard that keeps them.
insert into private.deck_screening (deck_id, hold)
  select d.id,
    case when exists (select from public.deck_reports as r where r.deck_id = d.id)
      then 'reports' else 'admin' end
  from public.decks as d
  where d.hidden;
update public.decks set publication = 'public' where visibility = 'public' and not hidden;
update public.decks set publication = 'held' where visibility = 'public' and hidden;

alter table public.decks add constraint decks_publication_state check (
  (publication in ('private', 'refused') and visibility = 'private')
  or (publication in ('checking', 'held') and visibility = 'public' and hidden)
  or (publication = 'public' and visibility = 'public' and not hidden));

-- The hash of a card's content and of a note's: the name, the description and the live cards'
-- hashes in order of hash, so a card's id and a reorder never move it.
create function private.card_hash(front jsonb, back jsonb, template text, template_version smallint)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(
    jsonb_build_array(card_hash.front, card_hash.back, card_hash.template,
      card_hash.template_version)::text, 'UTF8')), 'hex');
$$;

create function private.note_content_hash(p_deck uuid) returns text
language sql
stable
set search_path = ''
as $$
  select encode(sha256(convert_to(jsonb_build_array(d.name, d.description,
    coalesce((select jsonb_agg(x.h order by x.h collate "C")
      from (select private.card_hash(c.front, c.back, c.template, c.template_version) as h
        from public.cards as c where c.deck_id = d.id and c.deleted_at is null) as x),
      '[]'::jsonb))::text, 'UTF8')), 'hex')
  from public.decks as d where d.id = p_deck;
$$;

-- The layers whose verdict a note needs before it is public. #863 adds `ai` here.
create function private.required_screening_layers() returns text[]
language sql
immutable
set search_path = ''
as $$ select array['rules']::text[]; $$;

-- Makes `publication` follow `visibility` and `hidden` for a write that is not a client's, and
-- refuses a client's write that makes a deck public. A client is `authenticated`, `service_role`
-- or `anon`; a function of this schema, the owner's dashboard and a test run as another role.
create function private.guard_deck_publication() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  client boolean := current_user in ('authenticated', 'service_role', 'anon');
begin
  if client and tg_op = 'INSERT' then
    if new.visibility = 'public' then
      -- An upsert whose row exists and is public is an update, which the branch below pins; the
      -- proposed row still has to satisfy the CHECK.
      if not exists (
        select from public.decks as d
        where d.id = new.id and d.user_id = new.user_id and d.visibility = 'public') then
        raise exception 'publication_requires_screening' using errcode = '42501';
      end if;
      new.publication := 'public';
      new.hidden := false;
    else
      new.publication := 'private';
      new.hidden := false;
    end if;
    return new;
  end if;
  if client then
    if new.visibility = 'public' and old.visibility <> 'public' then
      raise exception 'publication_requires_screening' using errcode = '42501';
    end if;
    if new.visibility = 'public' then
      new.published_at := old.published_at;
      new.hidden := old.hidden;
      new.publication := old.publication;
      if old.publication = 'public'
        and (new.name is distinct from old.name or new.description is distinct from old.description) then
        new.publication := 'checking';
        new.hidden := true;
      end if;
    elsif old.visibility = 'public' then
      new.publication := 'private';
      new.hidden := false;
    else
      new.publication := old.publication;
      new.hidden := old.hidden;
    end if;
    return new;
  end if;
  if new.visibility = 'public' then
    new.publication := case
      when not new.hidden then 'public'
      when new.publication in ('checking', 'held') then new.publication
      else 'held' end;
  elsif new.publication not in ('private', 'refused') then
    new.publication := 'private';
  end if;
  return new;
end;
$$;

create trigger decks_guard_publication before insert or update on public.decks
  for each row execute function private.guard_deck_publication();

-- Stamps the request of a check when a deck becomes `checking`, or a checking deck's text changes.
create function private.stamp_screening_request() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.deck_screening as s (deck_id, requested_at) values (new.id, now())
    on conflict on constraint deck_screening_pkey do update set requested_at = now();
  return null;
end;
$$;

create trigger decks_stamp_screening after update on public.decks
  for each row
  when (new.publication = 'checking' and (old.publication is distinct from 'checking'
    or new.name is distinct from old.name or new.description is distinct from old.description))
  execute function private.stamp_screening_request();

-- Hides the public notes among [p_decks] until they are re-checked, and restarts the wait of the
-- ones already being checked.
create function private.recheck_decks(p_decks uuid[]) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.decks as d set publication = 'checking', hidden = true, updated_at = now()
    where d.id = any (p_decks) and d.publication = 'public';
  insert into private.deck_screening as s (deck_id, requested_at)
    select d.id, now() from public.decks as d where d.id = any (p_decks) and d.publication = 'checking'
    on conflict on constraint deck_screening_pkey do update set requested_at = now();
end;
$$;

-- Only a client's write counts: a definer function sees the client's role in the setting `role`,
-- not in `current_user`. A write of the owner's dashboard, a migration or a test does not.
create function private.cards_inserted_recheck() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) not in ('authenticated', 'service_role', 'anon') then
    return null;
  end if;
  perform private.recheck_decks(coalesce(
    (select array_agg(distinct n.deck_id) from new_cards as n where n.deleted_at is null), '{}'));
  return null;
end;
$$;

-- A card that is live before or after the statement and whose content, template or liveness
-- changed counts for its deck before and its deck after.
create function private.cards_updated_recheck() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) not in ('authenticated', 'service_role', 'anon') then
    return null;
  end if;
  perform private.recheck_decks(coalesce(
    (select array_agg(distinct x.deck_id) from (
      select o.deck_id from old_cards as o join new_cards as n on n.id = o.id
        where (o.deleted_at is null or n.deleted_at is null)
          and (o.front is distinct from n.front or o.back is distinct from n.back
            or o.template is distinct from n.template
            or o.template_version is distinct from n.template_version
            or (o.deleted_at is null) <> (n.deleted_at is null)
            or o.deck_id <> n.deck_id)
      union
      select n.deck_id from old_cards as o join new_cards as n on n.id = o.id
        where (o.deleted_at is null or n.deleted_at is null)
          and (o.front is distinct from n.front or o.back is distinct from n.back
            or o.template is distinct from n.template
            or o.template_version is distinct from n.template_version
            or (o.deleted_at is null) <> (n.deleted_at is null)
            or o.deck_id <> n.deck_id)
    ) as x), '{}'));
  return null;
end;
$$;

create trigger cards_recheck_inserted after insert on public.cards
  referencing new table as new_cards for each statement
  execute function private.cards_inserted_recheck();
create trigger cards_recheck_updated after update on public.cards
  referencing old table as old_cards new table as new_cards for each statement
  execute function private.cards_updated_recheck();

-- The findings of [p_hash]'s verdicts as the owner and the admin read them: the card by its id
-- where a live card has the hash a finding names, never any text.
create function private.screening_findings(p_deck uuid, p_hash text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

-- The owner asks to publish [deck_id]: it becomes `checking`, or `held` while a hold stands.
-- Idempotent for a note already checking, held or public.
create function public.request_deck_publication(deck_id uuid, description text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  current_state text;
  new_state text;
  hold_kind text;
begin
  if caller is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select d.publication into current_state from public.decks as d
    where d.id = request_deck_publication.deck_id and d.user_id = caller and d.deleted_at is null
    for update;
  if not found then
    raise exception 'no such deck' using errcode = 'P0002';
  end if;
  if exists (select from private.suspensions as s where s.user_id = caller) then
    raise exception 'suspended' using errcode = '42501';
  end if;
  if exists (select from private.deck_removals as r where r.deck_id = request_deck_publication.deck_id) then
    raise exception 'removed from sharing' using errcode = '42501';
  end if;
  if current_state in ('checking', 'held', 'public') then
    return current_state;
  end if;
  select s.hold into hold_kind from private.deck_screening as s
    where s.deck_id = request_deck_publication.deck_id;
  new_state := case when hold_kind is null then 'checking' else 'held' end;
  update private.deck_screening as s set refusal = null, decided_at = null, decided_by = null,
      content_hash = null
    where s.deck_id = request_deck_publication.deck_id;
  update public.decks as d set visibility = 'public', published_at = now(), hidden = true,
      publication = new_state,
      description = coalesce(request_deck_publication.description, d.description),
      updated_at = now()
    where d.id = request_deck_publication.deck_id;
  return new_state;
end;
$$;

-- The caller's own note's state, the category of its refusal and its findings.
create function public.my_deck_screening(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('state', d.publication, 'refusal', s.refusal,
    'findings', private.screening_findings(d.id, private.note_content_hash(d.id)))
  from public.decks as d
  left join private.deck_screening as s on s.deck_id = d.id
  where d.id = my_deck_screening.deck_id and d.user_id = (select auth.uid());
$$;

-- The decks the worker screens: checking for 20 seconds, and the public ones never screened.
create function public.screening_due(max_decks integer default 20) returns table (deck_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.decks as d
  left join private.deck_screening as s on s.deck_id = d.id
  where d.deleted_at is null
    and ((d.publication = 'checking' and coalesce(s.requested_at, '-infinity') < now() - interval '20 seconds')
      or (d.publication = 'public' and s.content_hash is null))
  order by s.requested_at nulls first, d.id
  limit greatest(screening_due.max_decks, 0);
$$;

-- Everything the worker needs to screen [deck_id], read in one statement so the hash names the
-- cards it holds: the note, its cards each with its hash, the terms and the verdicts it has.
create function public.screening_claim(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hash', private.note_content_hash(d.id),
    'publication', d.publication,
    'name', d.name,
    'description', d.description,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'hash', private.card_hash(c.front, c.back, c.template, c.template_version),
        'front', c.front, 'back', c.back) order by c.created_at, c.id)
      from public.cards as c where c.deck_id = d.id and c.deleted_at is null), '[]'::jsonb),
    'terms', coalesce((select jsonb_agg(t.term order by t.id)
      from private.screening_terms as t where t.removed_at is null), '[]'::jsonb),
    'terms_version', (select count(*) || '.' || count(t.removed_at) from private.screening_terms as t),
    'verdicts', coalesce((select jsonb_agg(jsonb_build_object('layer', v.layer, 'version', v.version,
        'outcome', v.outcome))
      from private.screening_verdicts as v
      where v.content_hash = private.note_content_hash(d.id)), '[]'::jsonb))
  from public.decks as d
  where d.id = screening_claim.deck_id and d.deleted_at is null
    and d.publication in ('checking', 'public');
$$;

-- Stores a layer's verdict on [content_hash]; `changed` while the note no longer has that hash.
create function public.record_screening(
  deck_id uuid, content_hash text, layer text, version text, outcome text, findings jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.note_content_hash(record_screening.deck_id) is distinct from record_screening.content_hash then
    return 'changed';
  end if;
  insert into private.screening_verdicts as v (content_hash, layer, version, outcome, findings)
    values (record_screening.content_hash, record_screening.layer, record_screening.version,
      record_screening.outcome, record_screening.findings)
    on conflict on constraint screening_verdicts_pkey do update
      set version = excluded.version, outcome = excluded.outcome, findings = excluded.findings,
        created_at = now();
  return 'recorded';
end;
$$;

-- Decides [deck_id] from the verdicts on [content_hash]: `public`, `held`, `refused`, `pending`
-- while a required layer has no verdict, `changed` while the hash moved, `noop` otherwise.
create function public.apply_screening(deck_id uuid, content_hash text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.decks%rowtype;
  s private.deck_screening%rowtype;
  live text;
  refused_layer text;
  severe boolean;
  unsure boolean;
begin
  select * into d from public.decks as x where x.id = apply_screening.deck_id for update;
  if not found or d.deleted_at is not null or d.publication not in ('checking', 'public') then
    return 'noop';
  end if;
  live := private.note_content_hash(d.id);
  if live <> apply_screening.content_hash then
    return 'changed';
  end if;
  select * into s from private.deck_screening as x where x.deck_id = d.id;
  if d.publication = 'public' and s.content_hash = live then
    return 'noop';
  end if;
  select v.layer into refused_layer from private.screening_verdicts as v
    where v.content_hash = live and v.outcome in ('refused', 'severe')
    order by case v.layer when 'admin' then 0 when 'rules' then 1 else 2 end limit 1;
  severe := exists (select from private.screening_verdicts as v
    where v.content_hash = live and v.outcome = 'severe');
  unsure := exists (select from private.screening_verdicts as v
    where v.content_hash = live and v.outcome = 'unsure');
  if refused_layer is not null then
    update public.decks as x set visibility = 'private', publication = 'refused', hidden = false,
        updated_at = now()
      where x.id = d.id;
    insert into private.deck_screening as t (deck_id, refusal, decided_at, hold)
      values (d.id, refused_layer, now(), null)
      on conflict on constraint deck_screening_pkey do update set refusal = excluded.refusal, decided_at = now(),
        content_hash = null, hold = null;
    if severe then
      insert into private.screening_violations (deck_id, owner_id, kind) values (d.id, d.user_id, 'severe');
    end if;
    return 'refused';
  end if;
  if exists (select from unnest(private.required_screening_layers()) as l
      where not exists (select from private.screening_verdicts as v
        where v.content_hash = live and v.layer = l)) then
    return 'pending';
  end if;
  if unsure or s.hold is not null then
    update public.decks as x set publication = 'held', hidden = true, updated_at = now()
      where x.id = d.id;
    insert into private.deck_screening as t (deck_id, hold) values (d.id, 'ai')
      on conflict on constraint deck_screening_pkey do update set hold = coalesce(t.hold, 'ai');
    return 'held';
  end if;
  update public.decks as x set publication = 'public', hidden = false, updated_at = now()
    where x.id = d.id;
  insert into private.deck_screening as t (deck_id, content_hash, decided_at)
    values (d.id, live, now())
    on conflict on constraint deck_screening_pkey do update set content_hash = excluded.content_hash,
      decided_at = excluded.decided_at, refusal = null;
  return 'public';
end;
$$;

-- The held notes, with the hash an admin's decision names.
create function public.admin_screening_queue()
returns table (
  deck_id uuid,
  name text,
  owner_id uuid,
  owner_email text,
  hold text,
  content_hash text,
  reports bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select d.id, d.name, d.user_id, u.email::text, s.hold, private.note_content_hash(d.id),
    (select count(*) from public.deck_reports as r where r.deck_id = d.id), d.updated_at
  from public.decks as d
  join auth.users as u on u.id = d.user_id
  left join private.deck_screening as s on s.deck_id = d.id
  where d.publication = 'held' and d.deleted_at is null
  order by d.updated_at, d.id;
end;
$$;

-- What the verdicts found in the note at [content_hash]; `changed` while the note moved on.
create function public.admin_screening_findings(deck_id uuid, content_hash text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if private.note_content_hash(admin_screening_findings.deck_id) is distinct from
    admin_screening_findings.content_hash then
    return jsonb_build_object('changed', true, 'findings', '[]'::jsonb);
  end if;
  return jsonb_build_object('changed', false, 'findings',
    private.screening_findings(admin_screening_findings.deck_id, admin_screening_findings.content_hash));
end;
$$;

create function public.admin_allow_deck(deck_id uuid, content_hash text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  deck_name text;
  state text;
begin
  select d.name, d.publication into deck_name, state from public.decks as d
    where d.id = admin_allow_deck.deck_id for update;
  if not found or state <> 'held' then
    return 'not_held';
  end if;
  if private.note_content_hash(admin_allow_deck.deck_id) <> admin_allow_deck.content_hash then
    return 'changed';
  end if;
  update public.decks as d set publication = 'public', hidden = false, updated_at = now()
    where d.id = admin_allow_deck.deck_id;
  insert into private.deck_screening as s (deck_id, content_hash, hold, refusal, decided_by, decided_at)
    values (admin_allow_deck.deck_id, admin_allow_deck.content_hash, null, null, caller, now())
    on conflict on constraint deck_screening_pkey do update set content_hash = excluded.content_hash, hold = null,
      refusal = null, decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  perform private.audit('allow_deck', 'deck', admin_allow_deck.deck_id::text,
    jsonb_build_object('name', deck_name, 'content_hash', admin_allow_deck.content_hash));
  return 'allowed';
end;
$$;

-- Keeps the held note off: refused, and its content refused for good by an admin verdict, so the
-- same text cannot be published again.
create function public.admin_keep_deck_hidden(deck_id uuid, content_hash text, reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  deck_name text;
  state text;
  owner uuid;
begin
  select d.name, d.publication, d.user_id into deck_name, state, owner from public.decks as d
    where d.id = admin_keep_deck_hidden.deck_id for update;
  if not found or state <> 'held' then
    return 'not_held';
  end if;
  if private.note_content_hash(admin_keep_deck_hidden.deck_id) <> admin_keep_deck_hidden.content_hash then
    return 'changed';
  end if;
  update public.decks as d set visibility = 'private', publication = 'refused', hidden = false,
      updated_at = now()
    where d.id = admin_keep_deck_hidden.deck_id;
  insert into private.screening_verdicts as v (content_hash, layer, version, outcome)
    values (admin_keep_deck_hidden.content_hash, 'admin', 'admin', 'refused')
    on conflict on constraint screening_verdicts_pkey do update set outcome = 'refused', created_at = now();
  insert into private.deck_screening as s (deck_id, hold, refusal, content_hash, decided_by, decided_at)
    values (admin_keep_deck_hidden.deck_id, null, 'admin', null, caller, now())
    on conflict on constraint deck_screening_pkey do update set hold = null, refusal = 'admin', content_hash = null,
      decided_by = excluded.decided_by, decided_at = excluded.decided_at;
  insert into private.screening_violations (deck_id, owner_id, kind)
    values (admin_keep_deck_hidden.deck_id, owner, 'kept_hidden');
  perform private.audit('keep_deck_hidden', 'deck', admin_keep_deck_hidden.deck_id::text,
    jsonb_build_object('name', deck_name, 'reason', left(btrim(admin_keep_deck_hidden.reason), 500)));
  return 'kept';
end;
$$;

create function public.admin_screening_terms()
returns table (id bigint, term text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query select t.id, t.term, t.created_at from private.screening_terms as t
    where t.removed_at is null order by t.id;
end;
$$;

-- Adds a term; the audit row names the term's id, never the term.
create function public.admin_add_screening_term(term text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  caller uuid := private.require_admin();
  normalized text := normalize(btrim(admin_add_screening_term.term), nfkc);
  new_id bigint;
begin
  if char_length(normalized) not between 1 and 100 then
    raise exception 'a term has 1 to 100 characters' using errcode = '22023';
  end if;
  insert into private.screening_terms as t (term, created_by) values (normalized, caller)
    on conflict (term) where removed_at is null do nothing
    returning t.id into new_id;
  if new_id is null then
    select t.id into new_id from private.screening_terms as t
      where t.term = normalized and t.removed_at is null;
    return new_id;
  end if;
  perform private.audit('add_screening_term', 'screening_term', new_id::text, '{}'::jsonb);
  return new_id;
end;
$$;

create function public.admin_remove_screening_term(id bigint) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  update private.screening_terms as t set removed_at = now()
    where t.id = admin_remove_screening_term.id and t.removed_at is null;
  if not found then
    return false;
  end if;
  perform private.audit('remove_screening_term', 'screening_term',
    admin_remove_screening_term.id::text, '{}'::jsonb);
  return true;
end;
$$;

-- The owners with violations on 3 or more notes who are not suspended.
create function public.admin_suspension_candidates()
returns table (user_id uuid, email text, decks bigint, last_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select v.owner_id, u.email::text, count(distinct v.deck_id), max(v.at)
  from private.screening_violations as v
  join auth.users as u on u.id = v.owner_id
  where not exists (select from private.suspensions as s where s.user_id = v.owner_id)
  group by v.owner_id, u.email
  having count(distinct v.deck_id) >= 3
  order by max(v.at) desc, v.owner_id;
end;
$$;

-- The reports' third hides the deck; a public one is held, with the hold that survives a check.
create or replace function private.hide_reported_deck() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.deck_id::text, 2));
  if (select count(*) from public.deck_reports as r where r.deck_id = new.deck_id) >= 3 then
    update public.decks as d set hidden = true,
        publication = case when d.publication = 'public' then 'held' else d.publication end
      where d.id = new.deck_id and not d.hidden;
    if found then
      insert into private.deck_screening as s (deck_id, hold) values (new.deck_id, 'reports')
        on conflict on constraint deck_screening_pkey do update set hold = coalesce(s.hold, 'reports');
    end if;
  end if;
  return null;
end;
$$;

create or replace function public.admin_set_deck_hidden(deck_id uuid, hidden boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  deck_name text;
  was text;
begin
  select d.name, d.publication into deck_name, was from public.decks as d
    where d.id = admin_set_deck_hidden.deck_id and d.hidden <> admin_set_deck_hidden.hidden for update;
  -- A note being checked is not unhidden by hand: the check decides it.
  if not found or (not admin_set_deck_hidden.hidden and was = 'checking') then
    return false;
  end if;
  update public.decks as d set hidden = admin_set_deck_hidden.hidden,
      publication = case
        when admin_set_deck_hidden.hidden and d.publication in ('public', 'checking') then 'held'
        when not admin_set_deck_hidden.hidden and d.publication = 'held' then 'public'
        else d.publication end
    where d.id = admin_set_deck_hidden.deck_id;
  if admin_set_deck_hidden.hidden then
    insert into private.deck_screening as s (deck_id, hold) values (admin_set_deck_hidden.deck_id, 'admin')
      on conflict on constraint deck_screening_pkey do update set hold = coalesce(s.hold, 'admin');
  else
    insert into private.deck_screening as s (deck_id, content_hash, decided_by, decided_at)
      values (admin_set_deck_hidden.deck_id,
        case when was = 'held' then private.note_content_hash(admin_set_deck_hidden.deck_id) end,
        caller, now())
      on conflict on constraint deck_screening_pkey do update set hold = null, decided_by = excluded.decided_by,
        decided_at = excluded.decided_at,
        content_hash = coalesce(excluded.content_hash, s.content_hash);
  end if;
  perform private.audit(case when admin_set_deck_hidden.hidden then 'hide_deck' else 'unhide_deck' end,
    'deck', admin_set_deck_hidden.deck_id::text, jsonb_build_object('name', deck_name));
  return true;
end;
$$;

create or replace function public.admin_unpublish_deck(deck_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deck_name text;
begin
  perform private.require_admin();
  update public.decks as d set visibility = 'private', publication = 'private', updated_at = now()
    where d.id = admin_unpublish_deck.deck_id and d.visibility = 'public'
    returning d.name into deck_name;
  if not found then
    return false;
  end if;
  perform private.audit('unpublish_deck', 'deck', admin_unpublish_deck.deck_id::text,
    jsonb_build_object('name', deck_name));
  return true;
end;
$$;

create or replace function public.admin_remove_deck(deck_id uuid, reason text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  deck_name text;
begin
  select d.name into deck_name from public.decks as d where d.id = admin_remove_deck.deck_id;
  if not found then
    return false;
  end if;
  insert into private.deck_removals (deck_id, reason, removed_by)
    values (admin_remove_deck.deck_id, btrim(admin_remove_deck.reason), caller)
    on conflict on constraint deck_removals_pkey do nothing;
  if not found then
    return false;
  end if;
  update public.decks as d set visibility = 'private', publication = 'private', updated_at = now()
    where d.id = admin_remove_deck.deck_id and d.visibility = 'public';
  perform private.audit('remove_deck', 'deck', admin_remove_deck.deck_id::text,
    jsonb_build_object('name', deck_name, 'reason', btrim(admin_remove_deck.reason)));
  return true;
end;
$$;

revoke all on function private.card_hash(jsonb, jsonb, text, smallint), private.note_content_hash(uuid),
  private.required_screening_layers(), private.guard_deck_publication(),
  private.stamp_screening_request(), private.recheck_decks(uuid[]),
  private.cards_inserted_recheck(), private.cards_updated_recheck(),
  private.screening_findings(uuid, text)
  from public, anon, authenticated;

revoke all on function public.request_deck_publication(uuid, text), public.my_deck_screening(uuid),
  public.screening_due(integer), public.screening_claim(uuid),
  public.record_screening(uuid, text, text, text, text, jsonb), public.apply_screening(uuid, text),
  public.admin_screening_queue(), public.admin_screening_findings(uuid, text),
  public.admin_allow_deck(uuid, text), public.admin_keep_deck_hidden(uuid, text, text),
  public.admin_screening_terms(), public.admin_add_screening_term(text),
  public.admin_remove_screening_term(bigint), public.admin_suspension_candidates()
  from public, anon;
revoke all on function public.screening_due(integer), public.screening_claim(uuid),
  public.record_screening(uuid, text, text, text, text, jsonb), public.apply_screening(uuid, text)
  from authenticated;
grant execute on function public.screening_due(integer), public.screening_claim(uuid),
  public.record_screening(uuid, text, text, text, text, jsonb), public.apply_screening(uuid, text)
  to service_role;
grant execute on function public.request_deck_publication(uuid, text), public.my_deck_screening(uuid),
  public.admin_screening_queue(), public.admin_screening_findings(uuid, text),
  public.admin_allow_deck(uuid, text), public.admin_keep_deck_hidden(uuid, text, text),
  public.admin_screening_terms(), public.admin_add_screening_term(text),
  public.admin_remove_screening_term(bigint), public.admin_suspension_candidates()
  to authenticated;

-- The sweeper: queues a POST of the worker's route at [function_url] with [service_role_key].
create function private.request_screening_worker(function_url text, service_role_key text)
returns void
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := request_screening_worker.function_url || '/work',
    headers := jsonb_build_object(
      'apikey', request_screening_worker.service_role_key,
      'Authorization', 'Bearer ' || request_screening_worker.service_role_key),
    timeout_milliseconds := 5000);
$$;

-- Requests the worker once when a note is due, as `screening_due` judges it. Does nothing, and
-- raises nothing, while either Vault secret is missing.
create function private.sweep_deck_screening() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  select d.decrypted_secret into function_url from vault.decrypted_secrets as d
    where d.name = 'screening_function_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  if not exists (select from public.screening_due(1)) then
    return;
  end if;
  perform private.request_screening_worker(function_url, service_role_key);
end;
$$;

revoke all on function private.request_screening_worker(text, text), private.sweep_deck_screening()
  from public, anon, authenticated;

select cron.schedule('sweep-deck-screening', '* * * * *', 'select private.sweep_deck_screening()');

-- The revert in the header.
create function private.revert_publish_screening() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  perform cron.unschedule('sweep-deck-screening');
  drop function private.sweep_deck_screening();
  drop function private.request_screening_worker(text, text);
  drop trigger decks_guard_publication on public.decks;
  drop trigger decks_stamp_screening on public.decks;
  drop trigger cards_recheck_inserted on public.cards;
  drop trigger cards_recheck_updated on public.cards;

  create or replace function private.hide_reported_deck() returns trigger
  language plpgsql security definer set search_path = ''
  as $f$
  begin
    perform pg_advisory_xact_lock(hashtextextended(new.deck_id::text, 2));
    if (select count(*) from public.deck_reports as r where r.deck_id = new.deck_id) >= 3 then
      update public.decks set hidden = true where id = new.deck_id and not hidden;
    end if;
    return null;
  end;
  $f$;
  create or replace function public.admin_set_deck_hidden(deck_id uuid, hidden boolean)
  returns boolean language plpgsql security definer set search_path = ''
  as $f$
  declare
    deck_name text;
  begin
    perform private.require_admin();
    update public.decks as d set hidden = admin_set_deck_hidden.hidden
      where d.id = admin_set_deck_hidden.deck_id and d.hidden <> admin_set_deck_hidden.hidden
      returning d.name into deck_name;
    if not found then
      return false;
    end if;
    perform private.audit(case when admin_set_deck_hidden.hidden then 'hide_deck' else 'unhide_deck' end,
      'deck', admin_set_deck_hidden.deck_id::text, jsonb_build_object('name', deck_name));
    return true;
  end;
  $f$;
  create or replace function public.admin_unpublish_deck(deck_id uuid) returns boolean
  language plpgsql security definer set search_path = ''
  as $f$
  declare
    deck_name text;
  begin
    perform private.require_admin();
    update public.decks as d set visibility = 'private', updated_at = now()
      where d.id = admin_unpublish_deck.deck_id and d.visibility = 'public'
      returning d.name into deck_name;
    if not found then
      return false;
    end if;
    perform private.audit('unpublish_deck', 'deck', admin_unpublish_deck.deck_id::text,
      jsonb_build_object('name', deck_name));
    return true;
  end;
  $f$;
  create or replace function public.admin_remove_deck(deck_id uuid, reason text) returns boolean
  language plpgsql security definer set search_path = ''
  as $f$
  declare
    caller uuid := private.require_admin();
    deck_name text;
  begin
    select d.name into deck_name from public.decks as d where d.id = admin_remove_deck.deck_id;
    if not found then
      return false;
    end if;
    insert into private.deck_removals (deck_id, reason, removed_by)
      values (admin_remove_deck.deck_id, btrim(admin_remove_deck.reason), caller)
      on conflict on constraint deck_removals_pkey do nothing;
    if not found then
      return false;
    end if;
    update public.decks as d set visibility = 'private', updated_at = now()
      where d.id = admin_remove_deck.deck_id and d.visibility = 'public';
    perform private.audit('remove_deck', 'deck', admin_remove_deck.deck_id::text,
      jsonb_build_object('name', deck_name, 'reason', btrim(admin_remove_deck.reason)));
    return true;
  end;
  $f$;

  drop function public.request_deck_publication(uuid, text);
  drop function public.my_deck_screening(uuid);
  drop function public.screening_due(integer);
  drop function public.screening_claim(uuid);
  drop function public.record_screening(uuid, text, text, text, text, jsonb);
  drop function public.apply_screening(uuid, text);
  drop function public.admin_screening_queue();
  drop function public.admin_screening_findings(uuid, text);
  drop function public.admin_allow_deck(uuid, text);
  drop function public.admin_keep_deck_hidden(uuid, text, text);
  drop function public.admin_screening_terms();
  drop function public.admin_add_screening_term(text);
  drop function public.admin_remove_screening_term(bigint);
  drop function public.admin_suspension_candidates();
  drop function private.cards_inserted_recheck();
  drop function private.cards_updated_recheck();
  drop function private.recheck_decks(uuid[]);
  drop function private.stamp_screening_request();
  drop function private.guard_deck_publication();
  drop function private.screening_findings(uuid, text);
  drop function private.note_content_hash(uuid);
  drop function private.card_hash(jsonb, jsonb, text, smallint);
  drop function private.required_screening_layers();
  alter table public.decks drop constraint decks_publication_state;
  alter table public.decks drop column publication;
  drop table private.screening_violations, private.screening_terms, private.screening_verdicts,
    private.deck_screening;
end;
$revert$;

revoke all on function private.revert_publish_screening() from public, anon, authenticated;
