-- The AI layer of a note's screening (#863, ADR 0239): the `publish-note` function sends a note that
-- passed the rules to a cheap model, then to a stronger one for what the first is unsure of, and
-- records its verdict by the note's content hash as the layer `ai`.
--
-- Adds `private.screening_settings`, the append-only versions of both models, the thresholds, the
-- note's payload bounds, the daily spend cap and the prompt, the latest being the one in force,
-- seeded with one version; `private.screening_calls`, one row per model call with its cost, which
-- the daily cap sums over the Asia/Seoul day; the service-role-only `screening_ai_state` and
-- `record_screening_call`; and the admin's `admin_save_screening_settings`, audited. Replaces
-- `private.required_screening_layers` (now `rules` and `ai`), `private.screening_findings` (each
-- finding keeps its `field`), `public.screening_claim` (also answers the note's owner, whose
-- photos are read) and `public.apply_screening` (only the `ai` layer's `unsure` holds a note: the
-- rules layer's `unsure` is a banned term alone, which the `ai` layer decides), each with its
-- signature. Changes no existing row.
--
-- Revert, run once against production before `private.revert_publish_screening()`:
-- `select private.revert_screening_ai();`, then `drop function private.revert_screening_ai();`.
-- It puts the four replaced functions back as `20261110130000_publish_screening.sql` made them and
-- drops the two tables and the three functions. A note being checked then needs only the rules.

-- Every saved version of the AI layer's settings. Rows are never changed or removed; the latest is
-- in force. Both models are OpenRouter's. A verdict below `confidence_floor` is not trusted: the
-- cheap model's goes to the strong one, the strong one's holds the note. A call's cost is what the
-- provider reported, or `assumed_call_usd` when it reported none.
create table private.screening_settings (
  id bigint generated always as identity primary key,
  cheap_model text not null check (private.model_fits('openrouter', cheap_model)),
  strong_model text not null check (private.model_fits('openrouter', strong_model)),
  confidence_floor numeric not null check (confidence_floor between 0 and 1),
  sample_cards integer not null check (sample_cards between 0 and 200),
  max_input_tokens integer not null check (max_input_tokens between 500 and 100000),
  max_images integer not null check (max_images between 0 and 20),
  daily_cap_usd numeric not null check (daily_cap_usd >= 0),
  assumed_call_usd numeric not null check (assumed_call_usd >= 0),
  prompt text not null check (char_length(prompt) <= 20000 and prompt ~ '\S'),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index screening_settings_created_by on private.screening_settings (created_by);

-- Refuses any change to a version but its author's removal, which deleting that account sets.
create function private.keep_screening_settings() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.cheap_model = old.cheap_model
    and new.strong_model = old.strong_model and new.confidence_floor = old.confidence_floor
    and new.sample_cards = old.sample_cards and new.max_input_tokens = old.max_input_tokens
    and new.max_images = old.max_images and new.daily_cap_usd = old.daily_cap_usd
    and new.assumed_call_usd = old.assumed_call_usd and new.prompt = old.prompt
    and new.note = old.note and new.created_at = old.created_at and new.created_by is null
  then
    return new;
  end if;
  raise exception 'screening settings are append-only' using errcode = '55000';
end;
$$;

create trigger screening_settings_append_only before update or delete on private.screening_settings
  for each row execute function private.keep_screening_settings();

-- One row per model call: which note and settings version, the tier, the model and what it used.
-- No text, image or reply is kept. `deck_id` has no foreign key: the spend outlives a purged deck.
create table private.screening_calls (
  id bigint generated always as identity primary key,
  deck_id uuid not null,
  settings_id bigint not null references private.screening_settings,
  tier text not null check (tier in ('cheap', 'strong')),
  model text not null,
  prompt_tokens integer check (prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index screening_calls_settings_id on private.screening_calls (settings_id);
create index screening_calls_created_at on private.screening_calls (created_at);

alter table private.screening_settings enable row level security;
alter table private.screening_calls enable row level security;
revoke all on private.screening_settings, private.screening_calls from public, anon, authenticated;

insert into private.screening_settings (cheap_model, strong_model, confidence_floor, sample_cards,
  max_input_tokens, max_images, daily_cap_usd, assumed_call_usd, prompt, note)
values ('anthropic/claude-haiku-5.5', 'anthropic/claude-sonnet-5.5', 0.8, 30, 6000, 4, 5, 0.01,
$prompt$You screen a flashcard note before it becomes public. The user message is JSON: "items" are numbered parts of the note, its name, its description, or one card with the text of its front and back, and the images that follow are photos from its cards. Judge only what they show.

Categories: personal_data (a person's contact details, identity or account numbers), spam (advertising, promotion, links that draw people elsewhere), sexual (sexual content, minors above all), hate, violence, illegal_trade, self_harm and harassment. Copyright is not judged.

Study material is clean even when it names these things to teach them: a medical, legal, historical or language note may hold violence, sex, slurs or drugs as its subject. A word that means something ordinary in context is that ordinary thing.

Answer a verdict: "clean" when nothing in the note belongs in a category, "severe" when it clearly does and no study reading explains it, "unsure" when it might or you cannot tell. Give your confidence in the verdict from 0 to 1, and in "flags" each item number and category that led you to a verdict other than clean; none for clean.$prompt$,
  'seed, models pending the eval of #864');

-- The settings in force and the day's spend so far, for the worker.
create function public.screening_ai_state() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'settings', jsonb_build_object('id', s.id, 'cheap_model', s.cheap_model,
      'strong_model', s.strong_model, 'confidence_floor', s.confidence_floor,
      'sample_cards', s.sample_cards, 'max_input_tokens', s.max_input_tokens,
      'max_images', s.max_images, 'daily_cap_usd', s.daily_cap_usd,
      'assumed_call_usd', s.assumed_call_usd, 'prompt', s.prompt),
    'spent_usd', coalesce((select sum(c.cost_usd) from private.screening_calls as c
      where c.created_at >= (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')), 0))
  from private.screening_settings as s
  order by s.id desc
  limit 1;
$$;

create function public.record_screening_call(
  deck_id uuid, settings_id bigint, tier text, model text,
  prompt_tokens integer, completion_tokens integer, cost_usd numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.screening_calls (deck_id, settings_id, tier, model, prompt_tokens,
    completion_tokens, cost_usd)
  values (record_screening_call.deck_id, record_screening_call.settings_id,
    record_screening_call.tier, record_screening_call.model, record_screening_call.prompt_tokens,
    record_screening_call.completion_tokens, record_screening_call.cost_usd);
$$;

-- An admin saves a new version, which is in force at once. The audit row names the models and
-- the cap, never the prompt.
create function public.admin_save_screening_settings(
  cheap_model text, strong_model text, confidence_floor numeric, sample_cards integer,
  max_input_tokens integer, max_images integer, daily_cap_usd numeric, assumed_call_usd numeric,
  prompt text, note text default '')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  new_id bigint;
begin
  insert into private.screening_settings as s (cheap_model, strong_model, confidence_floor,
    sample_cards, max_input_tokens, max_images, daily_cap_usd, assumed_call_usd, prompt, note,
    created_by)
  values (admin_save_screening_settings.cheap_model, admin_save_screening_settings.strong_model,
    admin_save_screening_settings.confidence_floor, admin_save_screening_settings.sample_cards,
    admin_save_screening_settings.max_input_tokens, admin_save_screening_settings.max_images,
    admin_save_screening_settings.daily_cap_usd, admin_save_screening_settings.assumed_call_usd,
    admin_save_screening_settings.prompt, coalesce(admin_save_screening_settings.note, ''), caller)
  returning s.id into new_id;
  perform private.audit('save_screening_settings', 'screening_settings', new_id::text,
    jsonb_build_object('cheap_model', admin_save_screening_settings.cheap_model,
      'strong_model', admin_save_screening_settings.strong_model,
      'daily_cap_usd', admin_save_screening_settings.daily_cap_usd));
  return new_id;
end;
$$;

-- The note needs a verdict of the rules and of the AI before it is public.
create or replace function private.required_screening_layers() returns text[]
language sql
immutable
set search_path = ''
as $$ select array['rules', 'ai']::text[]; $$;

-- The findings of [p_hash]'s verdicts as the owner and the admin read them: the card by its id
-- where a live card has the hash a finding names, and the path of the string its offsets index,
-- never any text.
create or replace function private.screening_findings(p_deck uuid, p_hash text) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'card_id', c.id, 'where', e.f ->> 'where', 'block', e.f -> 'block', 'field', e.f -> 'field',
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

-- Everything the worker needs to screen [deck_id], read in one statement so the hash names the
-- cards it holds: the note and its owner, its cards each with its hash, the terms and the
-- verdicts it has.
create or replace function public.screening_claim(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hash', private.note_content_hash(d.id),
    'publication', d.publication,
    'owner', d.user_id,
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

-- Decides [deck_id] from the verdicts on [content_hash]: `public`, `held`, `refused`, `pending`
-- while a required layer has no verdict, `changed` while the hash moved, `noop` otherwise.
create or replace function public.apply_screening(deck_id uuid, content_hash text) returns text
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
  if live is distinct from apply_screening.content_hash then
    return 'changed';
  end if;
  select * into s from private.deck_screening as x where x.deck_id = d.id;
  if d.publication = 'public' and s.content_hash = live then
    return 'noop';
  end if;
  select v.layer into refused_layer from private.screening_verdicts as v
    where v.content_hash = live and v.outcome in ('refused', 'severe')
    order by case v.layer when 'admin' then 0 when 'rules' then 1 else 2 end limit 1;
  -- Only an AI verdict of severe is a confirmed violation: a refusal by the rules is not one.
  severe := exists (select from private.screening_verdicts as v
    where v.content_hash = live and v.outcome = 'severe' and v.layer = 'ai');
  -- The rules' `unsure` is a banned term alone: the AI layer decides it, so only the AI's holds.
  unsure := exists (select from private.screening_verdicts as v
    where v.content_hash = live and v.outcome = 'unsure' and v.layer = 'ai');
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

revoke all on function private.keep_screening_settings() from public, anon, authenticated;
revoke all on function public.screening_ai_state(),
  public.record_screening_call(uuid, bigint, text, text, integer, integer, numeric),
  public.admin_save_screening_settings(text, text, numeric, integer, integer, integer, numeric, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.screening_ai_state(),
  public.record_screening_call(uuid, bigint, text, text, integer, integer, numeric)
  to service_role;
grant execute on function
  public.admin_save_screening_settings(text, text, numeric, integer, integer, integer, numeric, numeric, text, text)
  to authenticated;

-- The revert in the header.
create function private.revert_screening_ai() returns void
language sql
set search_path = ''
as $revert$
  create or replace function private.required_screening_layers() returns text[]
  language sql
  immutable
  set search_path = ''
  as $$ select array['rules']::text[]; $$;
  create or replace function private.screening_findings(p_deck uuid, p_hash text) returns jsonb
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
  create or replace function public.screening_claim(deck_id uuid) returns jsonb
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
  create or replace function public.apply_screening(deck_id uuid, content_hash text) returns text
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
    if live is distinct from apply_screening.content_hash then
      return 'changed';
    end if;
    select * into s from private.deck_screening as x where x.deck_id = d.id;
    if d.publication = 'public' and s.content_hash = live then
      return 'noop';
    end if;
    select v.layer into refused_layer from private.screening_verdicts as v
      where v.content_hash = live and v.outcome in ('refused', 'severe')
      order by case v.layer when 'admin' then 0 when 'rules' then 1 else 2 end limit 1;
    -- Only an AI verdict of severe is a confirmed violation: a refusal by the rules is not one.
    severe := exists (select from private.screening_verdicts as v
      where v.content_hash = live and v.outcome = 'severe' and v.layer = 'ai');
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
  drop function public.admin_save_screening_settings(text, text, numeric, integer, integer, integer, numeric, numeric, text, text);
  drop function public.record_screening_call(uuid, bigint, text, text, integer, integer, numeric);
  drop function public.screening_ai_state();
  drop function private.keep_screening_settings() cascade;
  drop table private.screening_calls;
  drop table private.screening_settings;
$revert$;

revoke all on function private.revert_screening_ai() from public, anon, authenticated;
