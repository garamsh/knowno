-- Judges a reported note once by a model (#887, ADR 0244). No model runs at publish (ADR 0240); the
-- `triage-reports` function judges a note only after two distinct users reported it, one verdict
-- per content hash, a cheap model first, within a daily spend cap, and ships judge-only: it records
-- verdicts and changes nothing until an admin switches `private.triage_settings.mode` to `acting`.
--
-- Adds, in `private`, `triage_settings` (one row), `triage_configurations` (append-only) with
-- `triage_configuration_labels`, `triage_verdicts`, `triage_actions` and `triage_appeals`; the
-- service-role-only `triage_due`, `triage_claim`, `record_triage` and `save_triage_configuration`;
-- the admin functions of the queue, the actions, the undo, the sample, the settings, agreement,
-- appeals and the configuration; the owner's `appeal_ai_hidden_note` and `my_triage_state`; a
-- trigger on `deck_reports` that asks the function to judge a severe report at once; and the
-- sweeper `private.sweep_report_triage()`, run every 5 minutes by the cron job
-- `sweep-report-triage`. Replaces no function and changes no row, so it is additive; the function
-- it ships spends money once an admin activates a configuration, which is the Gate's cost case.
--
-- The sweeper and the trigger read two Vault secrets by name and do nothing while either is
-- missing: `triage_function_url`, `https://<project ref>.supabase.co/functions/v1/triage-reports`,
-- and the existing `assistant_service_role_key`. The migration stores neither.
--
-- Revert, run once against production: `select private.revert_report_triage();`, then
-- `drop function private.revert_report_triage();`. It unschedules the cron job and drops the
-- trigger, functions and tables; a note an AI action hid stays hidden until an admin unhides it,
-- and the Vault secrets stay.

create table private.triage_settings (
  only_row boolean primary key default true check (only_row),
  mode text not null default 'judge_only' check (mode in ('judge_only', 'acting')),
  act_threshold numeric not null default 0.9 check (act_threshold between 0.5 and 1),
  daily_cap_usd numeric not null default 0.50 check (daily_cap_usd between 0 and 1000),
  batch_notes integer not null default 10 check (batch_notes between 1 and 100),
  daily_notes integer not null default 100 check (daily_notes between 0 and 10000),
  sample_percent integer not null default 10 check (sample_percent between 0 and 100),
  undo_window_hours integer not null default 168 check (undo_window_hours between 1 and 8760),
  undo_threshold numeric not null default 0.2 check (undo_threshold between 0 and 1),
  undo_min_actions integer not null default 5 check (undo_min_actions >= 1),
  paused_at timestamptz,
  paused_reason text,
  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now()
);

create index triage_settings_updated_by on private.triage_settings (updated_by);
insert into private.triage_settings default values;

-- Every saved triage configuration: the cheap and strong tier, each with its provider, model and
-- price per million tokens, the prompt, and the caps of a note's payload. A row exists only after
-- the function's check call on both tiers parsed; rows are never changed or removed.
create table private.triage_configurations (
  id bigint generated always as identity primary key,
  cheap_provider text not null check (cheap_provider in ('openrouter', 'openai', 'anthropic')),
  cheap_model text not null check (private.model_fits(cheap_provider, cheap_model)),
  strong_provider text not null check (strong_provider in ('openrouter', 'openai', 'anthropic')),
  strong_model text not null check (private.model_fits(strong_provider, strong_model)),
  prompt text not null check (char_length(prompt) between 1 and 8000),
  cheap_in_usd numeric not null check (cheap_in_usd >= 0),
  cheap_out_usd numeric not null check (cheap_out_usd >= 0),
  strong_in_usd numeric not null check (strong_in_usd >= 0),
  strong_out_usd numeric not null check (strong_out_usd >= 0),
  escalate_below numeric not null default 0.7 check (escalate_below between 0 and 1),
  payload_tokens integer not null default 3000 check (payload_tokens between 500 and 20000),
  sample_cards integer not null default 5 check (sample_cards between 0 and 50),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index triage_configurations_created_by on private.triage_configurations (created_by);

create function private.keep_triage_configuration() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.created_by is null
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
  then
    return new;
  end if;
  raise exception 'triage configurations are append-only' using errcode = '55000';
end;
$$;

create trigger triage_configurations_append_only before update or delete on private.triage_configurations
  for each row execute function private.keep_triage_configuration();

create table private.triage_configuration_labels (
  label text primary key check (label in ('active', 'test')),
  configuration_id bigint not null references private.triage_configurations,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);

create index triage_configuration_labels_configuration_id
  on private.triage_configuration_labels (configuration_id);
create index triage_configuration_labels_set_by on private.triage_configuration_labels (set_by);

-- One verdict per note content, keyed by its hash and reused until a card or the text changes.
create table private.triage_verdicts (
  content_hash text primary key check (content_hash ~ '^[0-9a-f]{64}$'),
  category text not null check (category in
    ('spam', 'ad', 'inappropriate', 'copyright', 'severe', 'other', 'ok', 'unjudged')),
  confidence numeric not null check (confidence between 0 and 1),
  passage text check (passage is null or char_length(passage) <= 500),
  field text check (field is null or char_length(field) <= 200),
  card_hash text,
  tier text not null check (tier in ('cheap', 'strong')),
  provider text not null,
  model text not null,
  configuration_id bigint not null references private.triage_configurations,
  tokens_in integer not null check (tokens_in >= 0),
  tokens_out integer not null check (tokens_out >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  escalated boolean not null,
  created_at timestamptz not null default now()
);

create index triage_verdicts_configuration_id on private.triage_verdicts (configuration_id);
create index triage_verdicts_created_at on private.triage_verdicts (created_at);

-- What the AI did to a note, to undo it and to count how often it was undone.
create table private.triage_actions (
  id bigint generated always as identity primary key,
  deck_id uuid not null references public.decks on delete cascade,
  content_hash text not null,
  action text not null check (action in ('hide', 'dismiss')),
  category text not null,
  confidence numeric not null,
  model text not null,
  reason text not null,
  archived jsonb not null default '[]' check (jsonb_typeof(archived) = 'array'),
  sampled boolean not null,
  rechecked_at timestamptz,
  rechecked_by uuid references auth.users on delete set null,
  recheck_agreed boolean,
  undone_at timestamptz,
  undone_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index triage_actions_deck_id on private.triage_actions (deck_id);
create index triage_actions_created_at on private.triage_actions (created_at);
create index triage_actions_rechecked_by on private.triage_actions (rechecked_by);
create index triage_actions_undone_by on private.triage_actions (undone_by);

-- An owner's one appeal of an AI action, decided by an admin.
create table private.triage_appeals (
  deck_id uuid primary key references public.decks on delete cascade,
  action_id bigint not null references private.triage_actions on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users on delete set null,
  restored boolean
);

create index triage_appeals_action_id on private.triage_appeals (action_id);
create index triage_appeals_owner_id on private.triage_appeals (owner_id);
create index triage_appeals_resolved_by on private.triage_appeals (resolved_by);

alter table private.triage_settings enable row level security;
alter table private.triage_configurations enable row level security;
alter table private.triage_configuration_labels enable row level security;
alter table private.triage_verdicts enable row level security;
alter table private.triage_actions enable row level security;
alter table private.triage_appeals enable row level security;
revoke all on private.triage_settings, private.triage_configurations,
  private.triage_configuration_labels, private.triage_verdicts, private.triage_actions,
  private.triage_appeals from public, anon, authenticated, service_role;

-- The start of the current UTC day, which the spend cap and the day's notes count from.
create function private.triage_day_start() returns timestamptz
language sql
stable
set search_path = ''
as $$ select date_trunc('day', now() at time zone 'utc') at time zone 'utc'; $$;

create function private.triage_spent_today() returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(v.cost_usd), 0) from private.triage_verdicts as v
  where v.created_at >= private.triage_day_start();
$$;

create function private.triage_judged_today() returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from private.triage_verdicts as v where v.created_at >= private.triage_day_start();
$$;

-- Whether a judgment may start at all: an active configuration, and neither the day's spend cap
-- nor its notes cap reached. Past either, no model is called and a person decides.
create function private.triage_open() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select from private.triage_configuration_labels as l where l.label = 'active')
    and private.triage_spent_today() < s.daily_cap_usd
    and private.triage_judged_today() < s.daily_notes
  from private.triage_settings as s;
$$;

-- Whether [deck_id] is due: a live public note (shown or held) reported by at least two distinct
-- users, with no verdict for its current content. [severe] also needs an `inappropriate` report.
create function private.triage_is_due(p_deck uuid, severe boolean) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.triage_open()
    and exists (
      select from public.decks as d
      where d.id = p_deck and d.deleted_at is null and d.visibility = 'public'
        and d.publication in ('public', 'held')
        and (select count(distinct r.reporter_id) from public.deck_reports as r
          where r.deck_id = d.id) >= 2
        and (not triage_is_due.severe or exists (select from public.deck_reports as r
          where r.deck_id = d.id and r.reason = 'inappropriate'))
        and not exists (select from private.triage_verdicts as v
          where v.content_hash = private.note_content_hash(d.id)));
$$;

-- The notes to judge now, the most recently reported first, at most [max_notes], the batch size
-- and what the day's notes cap leaves.
create function public.triage_due(max_notes integer default 10, severe_only boolean default false)
returns table (deck_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.decks as d
  where d.id in (select r.deck_id from public.deck_reports as r
      group by r.deck_id having count(distinct r.reporter_id) >= 2)
    and private.triage_is_due(d.id, triage_due.severe_only)
  order by (select max(r.created_at) from public.deck_reports as r where r.deck_id = d.id) desc, d.id
  limit greatest(least(triage_due.max_notes, (select s.batch_notes from private.triage_settings as s),
    (select s.daily_notes from private.triage_settings as s) - private.triage_judged_today()), 0);
$$;

-- Everything the function needs to judge [deck_id], read in one statement so the hash names the
-- cards it holds; null when the note is not due, so a spent day makes no call.
create function public.triage_claim(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hash', private.note_content_hash(d.id),
    'name', d.name,
    'description', d.description,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
        'hash', private.card_hash(c.front, c.back, c.template, c.template_version),
        'front', c.front, 'back', c.back) order by c.created_at, c.id)
      from public.cards as c where c.deck_id = d.id and c.deleted_at is null), '[]'::jsonb),
    'reasons', (select jsonb_agg(distinct r.reason) from public.deck_reports as r where r.deck_id = d.id),
    'reporters', (select count(distinct r.reporter_id) from public.deck_reports as r where r.deck_id = d.id),
    'findings', coalesce((select v.findings from private.screening_verdicts as v
      where v.content_hash = private.note_content_hash(d.id) and v.layer = 'rules'), '[]'::jsonb),
    'configuration', (select jsonb_build_object('id', c.id,
        'cheap_provider', c.cheap_provider, 'cheap_model', c.cheap_model,
        'strong_provider', c.strong_provider, 'strong_model', c.strong_model,
        'prompt', c.prompt, 'cheap_in_usd', c.cheap_in_usd, 'cheap_out_usd', c.cheap_out_usd,
        'strong_in_usd', c.strong_in_usd, 'strong_out_usd', c.strong_out_usd,
        'escalate_below', c.escalate_below, 'payload_tokens', c.payload_tokens,
        'sample_cards', c.sample_cards)
      from private.triage_configuration_labels as l
      join private.triage_configurations as c on c.id = l.configuration_id
      where l.label = 'active'))
  from public.decks as d
  where d.id = triage_claim.deck_id and private.triage_is_due(d.id, false);
$$;

-- Pauses the automation when, over the window, at least `undo_min_actions` actions stand and the
-- share undone passes `undo_threshold`. True while it is paused, before or after this call.
create function private.triage_check_pause() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.triage_settings;
  total bigint;
  undone bigint;
begin
  select * into s from private.triage_settings for update;
  if s.paused_at is not null then
    return true;
  end if;
  select count(*), count(a.undone_at) into total, undone from private.triage_actions as a
    where a.created_at >= now() - make_interval(hours => s.undo_window_hours);
  if total >= s.undo_min_actions and undone::numeric / total > s.undo_threshold then
    update private.triage_settings as t set paused_at = now(), paused_reason = 'undo_rate';
    insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
      values (null, 'ai', 'pause_triage', 'triage', 'settings',
        jsonb_build_object('reason', 'undo_rate', 'actions', total, 'undone', undone));
    return true;
  end if;
  return false;
end;
$$;

-- Acts on the verdict of [content_hash] when the mode allows it, and answers `hidden`,
-- `dismissed` or `paused`, null for no action. Only a note judged spam or an ad is hidden and only
-- a note judged ok has its reports dismissed, each at or above the threshold; copyright, severe,
-- inappropriate, other and unjudged are never acted on, and nothing is ever unpublished,
-- removed or suspended.
create function private.triage_apply(p_deck uuid, p_hash text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.triage_settings;
  v private.triage_verdicts;
  kind text;
  made boolean;
  archive jsonb;
  new_id bigint;
begin
  select * into s from private.triage_settings;
  if s.mode <> 'acting' or s.paused_at is not null then
    return null;
  end if;
  select * into v from private.triage_verdicts as x where x.content_hash = p_hash;
  if not found or v.confidence < s.act_threshold
    or private.note_content_hash(p_deck) is distinct from p_hash
  then
    return null;
  end if;
  if v.category in ('spam', 'ad') then
    kind := 'hide';
  elsif v.category = 'ok' then
    kind := 'dismiss';
  else
    return null;
  end if;
  if private.triage_check_pause() then
    return 'paused';
  end if;
  if kind = 'hide' then
    update public.decks as d set hidden = true, publication = 'held'
      where d.id = p_deck and d.deleted_at is null and d.visibility = 'public'
        and d.publication = 'public' and not d.hidden;
    made := found;
    if not made then
      return null;
    end if;
    insert into private.deck_screening as x (deck_id, hold) values (p_deck, 'ai')
      on conflict on constraint deck_screening_pkey do update set hold = coalesce(x.hold, 'ai');
    archive := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(jsonb_build_object('reporter_id', r.reporter_id, 'reason', r.reason,
      'created_at', r.created_at)), '[]'::jsonb) into archive
      from public.deck_reports as r where r.deck_id = p_deck;
    if jsonb_array_length(archive) = 0 then
      return null;
    end if;
    delete from public.deck_reports as r where r.deck_id = p_deck;
  end if;
  insert into private.triage_actions (deck_id, content_hash, action, category, confidence, model,
      reason, archived, sampled)
    values (p_deck, p_hash, kind, v.category, v.confidence, v.model,
      format('judged %s at confidence %s', v.category, v.confidence), archive,
      (hashtextextended(p_hash, 7) & 9223372036854775807) % 100 < s.sample_percent)
    returning id into new_id;
  insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail)
    values (null, 'ai', case kind when 'hide' then 'ai_hide_deck' else 'ai_dismiss_reports' end,
      'deck', p_deck::text, jsonb_build_object('action_id', new_id, 'model', v.model,
        'category', v.category, 'confidence', v.confidence,
        'reason', format('judged %s at confidence %s', v.category, v.confidence)));
  return case kind when 'hide' then 'hidden' else 'dismissed' end;
end;
$$;

-- Stores the verdict on [content_hash]: `changed` while the note no longer has that hash, `exists`
-- while a verdict stands, otherwise `recorded`, or what the verdict made the database do.
create function public.record_triage(
  deck_id uuid, content_hash text, category text, confidence numeric, passage text, field text,
  card_hash text, tier text, provider text, model text, configuration_id bigint, tokens_in integer,
  tokens_out integer, cost_usd numeric, escalated boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored boolean;
begin
  if private.note_content_hash(record_triage.deck_id) is distinct from record_triage.content_hash then
    return 'changed';
  end if;
  insert into private.triage_verdicts as v (content_hash, category, confidence, passage, field,
      card_hash, tier, provider, model, configuration_id, tokens_in, tokens_out, cost_usd, escalated)
    values (record_triage.content_hash, record_triage.category, record_triage.confidence,
      record_triage.passage, record_triage.field, record_triage.card_hash, record_triage.tier,
      record_triage.provider, record_triage.model, record_triage.configuration_id,
      record_triage.tokens_in, record_triage.tokens_out, record_triage.cost_usd,
      record_triage.escalated)
    on conflict on constraint triage_verdicts_pkey do nothing;
  stored := found;
  if not stored then
    return 'exists';
  end if;
  return coalesce(private.triage_apply(record_triage.deck_id, record_triage.content_hash), 'recorded');
end;
$$;

-- Appends [admin_id]'s configuration as the draft, replacing any draft, after the function's
-- check call on each tier parsed.
create function public.save_triage_configuration(
  admin_id uuid, cheap_provider text, cheap_model text, strong_provider text, strong_model text,
  prompt text, cheap_in_usd numeric, cheap_out_usd numeric, strong_in_usd numeric,
  strong_out_usd numeric, escalate_below numeric, payload_tokens integer, sample_cards integer)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  added private.triage_configurations;
begin
  perform private.require_admin_id(save_triage_configuration.admin_id);
  insert into private.triage_configurations (cheap_provider, cheap_model, strong_provider,
      strong_model, prompt, cheap_in_usd, cheap_out_usd, strong_in_usd, strong_out_usd,
      escalate_below, payload_tokens, sample_cards, created_by)
    values (save_triage_configuration.cheap_provider, save_triage_configuration.cheap_model,
      save_triage_configuration.strong_provider, save_triage_configuration.strong_model,
      save_triage_configuration.prompt, save_triage_configuration.cheap_in_usd,
      save_triage_configuration.cheap_out_usd, save_triage_configuration.strong_in_usd,
      save_triage_configuration.strong_out_usd, save_triage_configuration.escalate_below,
      save_triage_configuration.payload_tokens, save_triage_configuration.sample_cards,
      save_triage_configuration.admin_id)
    returning * into added;
  insert into private.triage_configuration_labels (label, configuration_id, set_by)
    values ('test', added.id, save_triage_configuration.admin_id)
    on conflict on constraint triage_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  perform private.audit_by(save_triage_configuration.admin_id, 'save_triage_configuration',
    'triage_configuration', added.id::text, jsonb_build_object('cheap_provider', added.cheap_provider,
      'cheap_model', added.cheap_model, 'strong_provider', added.strong_provider,
      'strong_model', added.strong_model));
  return added.id;
end;
$$;

-- The sweeper: queues a POST of the worker's route at [function_url] with [service_role_key].
create function private.request_triage_worker(function_url text, service_role_key text, severe boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  select net.http_post(
    url := request_triage_worker.function_url || '/work',
    headers := jsonb_build_object(
      'apikey', request_triage_worker.service_role_key,
      'Authorization', 'Bearer ' || request_triage_worker.service_role_key,
      'Content-Type', 'application/json'),
    body := jsonb_build_object('severe', request_triage_worker.severe),
    timeout_milliseconds := 5000);
$$;

-- Requests the worker once when a note is due. Does nothing, and raises nothing, while either
-- Vault secret is missing.
create function private.sweep_report_triage() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  select d.decrypted_secret into function_url from vault.decrypted_secrets as d
    where d.name = 'triage_function_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is null or service_role_key is null then
    return;
  end if;
  if not exists (select from public.triage_due(1, false)) then
    return;
  end if;
  perform private.request_triage_worker(function_url, service_role_key, false);
end;
$$;

-- A severe report, an `inappropriate` one among two reporters, is judged at once, not at the next
-- batch: the trigger asks the worker as it arrives, when the note is due.
create function private.triage_severe_report() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
  if not private.triage_is_due(new.deck_id, true) then
    return null;
  end if;
  select d.decrypted_secret into function_url from vault.decrypted_secrets as d
    where d.name = 'triage_function_url';
  select d.decrypted_secret into service_role_key from vault.decrypted_secrets as d
    where d.name = 'assistant_service_role_key';
  if function_url is not null and service_role_key is not null then
    perform private.request_triage_worker(function_url, service_role_key, true);
  end if;
  return null;
end;
$$;

create trigger triage_severe_report after insert on public.deck_reports
  for each row execute function private.triage_severe_report();

revoke all on function private.triage_day_start(), private.triage_spent_today(),
  private.triage_judged_today(), private.triage_open(), private.triage_is_due(uuid, boolean),
  private.triage_check_pause(), private.triage_apply(uuid, text),
  private.keep_triage_configuration(), private.request_triage_worker(text, text, boolean),
  private.sweep_report_triage(), private.triage_severe_report()
  from public, anon, authenticated;
revoke all on function public.triage_due(integer, boolean), public.triage_claim(uuid),
  public.record_triage(uuid, text, text, numeric, text, text, text, text, text, text, bigint,
    integer, integer, numeric, boolean),
  public.save_triage_configuration(uuid, text, text, text, text, text, numeric, numeric, numeric,
    numeric, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.triage_due(integer, boolean), public.triage_claim(uuid),
  public.record_triage(uuid, text, text, numeric, text, text, text, text, text, text, bigint,
    integer, integer, numeric, boolean),
  public.save_triage_configuration(uuid, text, text, text, text, text, numeric, numeric, numeric,
    numeric, numeric, integer, integer)
  to service_role;

-- Reverses an AI action: unhides a note it hid while the `ai` hold stands, or restores the reports
-- it archived. `undone`, `already` or `not_found`. The undo counts toward the undo rate.
create function private.triage_undo(p_action bigint, by uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a private.triage_actions;
  held boolean;
begin
  select * into a from private.triage_actions as x where x.id = p_action for update;
  if not found then
    return 'not_found';
  end if;
  if a.undone_at is not null then
    return 'already';
  end if;
  if a.action = 'hide' then
    update private.deck_screening as s set hold = null, decided_by = triage_undo.by, decided_at = now()
      where s.deck_id = a.deck_id and s.hold = 'ai';
    held := found;
    if held then
      update public.decks as d set hidden = false, publication = 'public'
        where d.id = a.deck_id and d.hidden and d.publication = 'held' and d.deleted_at is null;
    end if;
  else
    insert into public.deck_reports (deck_id, reporter_id, reason, created_at)
      select a.deck_id, (e ->> 'reporter_id')::uuid, e ->> 'reason', (e ->> 'created_at')::timestamptz
      from jsonb_array_elements(a.archived) as e
      where exists (select from auth.users as u where u.id = (e ->> 'reporter_id')::uuid)
      on conflict do nothing;
  end if;
  update private.triage_actions as x set undone_at = now(), undone_by = triage_undo.by
    where x.id = p_action;
  perform private.audit('undo_triage_action', 'deck', a.deck_id::text,
    jsonb_build_object('action_id', a.id, 'action', a.action, 'model', a.model));
  perform private.triage_check_pause();
  return 'undone';
end;
$$;

create function public.admin_undo_triage_action(action_id bigint) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
begin
  return private.triage_undo(admin_undo_triage_action.action_id, caller);
end;
$$;

-- The notes two or more users reported, with the model's verdict on their current text, severe
-- first and then the latest report.
create function public.admin_triage_queue()
returns table (
  deck_id uuid, name text, owner_id uuid, hidden boolean, publication text, reporters bigint,
  reasons text[], last_reported_at timestamptz, category text, confidence numeric, passage text,
  field text, tier text, model text, cost_usd numeric, judged_at timestamptz, action_id bigint,
  appealed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select d.id, d.name, d.user_id, d.hidden, d.publication, r.reporters, r.reasons, r.last_reported_at,
    v.category, v.confidence, v.passage, v.field, v.tier, v.model, v.cost_usd, v.created_at,
    (select max(a.id) from private.triage_actions as a where a.deck_id = d.id and a.undone_at is null),
    exists (select from private.triage_appeals as p where p.deck_id = d.id)
  from (
    select x.deck_id, count(distinct x.reporter_id) as reporters,
      array_agg(distinct x.reason order by x.reason) as reasons, max(x.created_at) as last_reported_at
    from public.deck_reports as x group by x.deck_id having count(distinct x.reporter_id) >= 2
  ) as r
  join public.decks as d on d.id = r.deck_id and d.deleted_at is null
  left join private.triage_verdicts as v on v.content_hash = private.note_content_hash(d.id)
  order by ('inappropriate' = any (r.reasons)) desc, r.last_reported_at desc, d.id;
end;
$$;

create function public.admin_triage_actions(days integer default 30)
returns table (
  action_id bigint, deck_id uuid, name text, action text, category text, confidence numeric,
  model text, reason text, created_at timestamptz, sampled boolean, rechecked_at timestamptz,
  recheck_agreed boolean, undone_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select a.id, a.deck_id, d.name, a.action, a.category, a.confidence, a.model, a.reason, a.created_at,
    a.sampled, a.rechecked_at, a.recheck_agreed, a.undone_at
  from private.triage_actions as a join public.decks as d on d.id = a.deck_id
  where a.created_at >= now() - make_interval(days => least(greatest(admin_triage_actions.days, 1), 365))
  order by a.created_at desc, a.id desc;
end;
$$;

-- The sampled actions no person has re-checked.
create function public.admin_triage_sample()
returns table (
  action_id bigint, deck_id uuid, name text, action text, category text, confidence numeric,
  model text, reason text, created_at timestamptz, sampled boolean, rechecked_at timestamptz,
  recheck_agreed boolean, undone_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select a.id, a.deck_id, d.name, a.action, a.category, a.confidence, a.model, a.reason, a.created_at,
    a.sampled, a.rechecked_at, a.recheck_agreed, a.undone_at
  from private.triage_actions as a join public.decks as d on d.id = a.deck_id
  where a.sampled and a.rechecked_at is null
  order by a.created_at, a.id;
end;
$$;

create function public.admin_recheck_triage_action(action_id bigint, agreed boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  a private.triage_actions;
begin
  select * into a from private.triage_actions as x where x.id = admin_recheck_triage_action.action_id
    for update;
  if not found then
    return 'not_found';
  end if;
  if not a.sampled then
    return 'not_sampled';
  end if;
  if a.rechecked_at is not null then
    return 'already';
  end if;
  update private.triage_actions as x set rechecked_at = now(), rechecked_by = caller,
      recheck_agreed = admin_recheck_triage_action.agreed
    where x.id = a.id;
  perform private.audit('recheck_triage_action', 'deck', a.deck_id::text,
    jsonb_build_object('action_id', a.id, 'agreed', admin_recheck_triage_action.agreed));
  return 'rechecked';
end;
$$;

create function public.admin_triage_settings()
returns table (
  mode text, act_threshold numeric, daily_cap_usd numeric, batch_notes integer, daily_notes integer,
  sample_percent integer, undo_window_hours integer, undo_threshold numeric,
  undo_min_actions integer, paused_at timestamptz, paused_reason text, spent_today_usd numeric,
  judged_today bigint, actions_in_window bigint, undo_rate numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select s.mode, s.act_threshold, s.daily_cap_usd, s.batch_notes, s.daily_notes, s.sample_percent,
    s.undo_window_hours, s.undo_threshold, s.undo_min_actions, s.paused_at, s.paused_reason,
    private.triage_spent_today(), private.triage_judged_today(), w.total,
    case when w.total > 0 then w.undone::numeric / w.total end
  from private.triage_settings as s,
    lateral (select count(*) as total, count(a.undone_at) as undone from private.triage_actions as a
      where a.created_at >= now() - make_interval(hours => s.undo_window_hours)) as w;
end;
$$;

-- Changes the settings given, a null leaving one as it is, and records the new values.
create function public.admin_set_triage_settings(
  mode text default null, act_threshold numeric default null, daily_cap_usd numeric default null,
  daily_notes integer default null, sample_percent integer default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
begin
  update private.triage_settings as s set
      mode = coalesce(admin_set_triage_settings.mode, s.mode),
      act_threshold = coalesce(admin_set_triage_settings.act_threshold, s.act_threshold),
      daily_cap_usd = coalesce(admin_set_triage_settings.daily_cap_usd, s.daily_cap_usd),
      daily_notes = coalesce(admin_set_triage_settings.daily_notes, s.daily_notes),
      sample_percent = coalesce(admin_set_triage_settings.sample_percent, s.sample_percent),
      updated_by = caller, updated_at = now();
  perform private.audit('set_triage_settings', 'triage', 'settings', jsonb_strip_nulls(jsonb_build_object(
    'mode', admin_set_triage_settings.mode, 'act_threshold', admin_set_triage_settings.act_threshold,
    'daily_cap_usd', admin_set_triage_settings.daily_cap_usd,
    'daily_notes', admin_set_triage_settings.daily_notes,
    'sample_percent', admin_set_triage_settings.sample_percent)));
  return true;
end;
$$;

-- Clears the pause the undo rate set; false when it was not paused.
create function public.admin_resume_triage() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
begin
  update private.triage_settings as s set paused_at = null, paused_reason = null,
      updated_by = caller, updated_at = now()
    where s.paused_at is not null;
  if not found then
    return false;
  end if;
  perform private.audit('resume_triage', 'triage', 'settings', '{}'::jsonb);
  return true;
end;
$$;

-- How often the model's verdict agreed with the first decision an admin made on the same note
-- after it: a verdict that a note is bad (spam, ad, inappropriate, copyright, severe) agrees with
-- hiding, unpublishing, removing or keeping it hidden, an `ok` with dismissing the reports,
-- allowing or unhiding it. Verdicts of other or unjudged, and the AI's own actions, are not compared.
create function public.admin_triage_agreement(days integer default 30)
returns table (category text, compared bigint, agreed bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  with decided as (
    select distinct on (d.id, v.content_hash) v.category as verdict,
      (a.action in ('hide_deck', 'unpublish_deck', 'remove_deck', 'keep_deck_hidden')) as acted
    from private.admin_audit as a
    join public.decks as d on a.target_kind = 'deck' and a.target_id = d.id::text
    join private.triage_verdicts as v on v.content_hash = private.note_content_hash(d.id)
    where a.admin_id is not null
      and a.action in ('hide_deck', 'unpublish_deck', 'remove_deck', 'keep_deck_hidden',
        'dismiss_reports', 'allow_deck', 'unhide_deck')
      and a.created_at >= v.created_at
      and v.created_at >= now() - make_interval(days => least(greatest(admin_triage_agreement.days, 1), 365))
      and v.category not in ('other', 'unjudged')
    order by d.id, v.content_hash, a.created_at, a.id)
  select x.verdict, count(*), count(*) filter (where x.acted = (x.verdict <> 'ok'))
  from decided as x group by x.verdict order by x.verdict;
end;
$$;

create function public.admin_triage_appeals()
returns table (
  deck_id uuid, name text, owner_id uuid, appealed_at timestamptz, action_id bigint, category text,
  confidence numeric, passage text, field text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.deck_id, d.name, p.owner_id, p.created_at, p.action_id, a.category, a.confidence,
    v.passage, v.field
  from private.triage_appeals as p
  join private.triage_actions as a on a.id = p.action_id
  join public.decks as d on d.id = p.deck_id
  left join private.triage_verdicts as v on v.content_hash = a.content_hash
  where p.resolved_at is null
  order by p.created_at, p.deck_id;
end;
$$;

create function public.admin_resolve_triage_appeal(deck_id uuid, restore boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  p private.triage_appeals;
begin
  select * into p from private.triage_appeals as x
    where x.deck_id = admin_resolve_triage_appeal.deck_id and x.resolved_at is null for update;
  if not found then
    return 'not_found';
  end if;
  if admin_resolve_triage_appeal.restore then
    perform private.triage_undo(p.action_id, caller);
  end if;
  update private.triage_appeals as x set resolved_at = now(), resolved_by = caller,
      restored = admin_resolve_triage_appeal.restore
    where x.deck_id = p.deck_id;
  perform private.audit('resolve_triage_appeal', 'deck', p.deck_id::text,
    jsonb_build_object('restored', admin_resolve_triage_appeal.restore));
  return case when admin_resolve_triage_appeal.restore then 'restored' else 'upheld' end;
end;
$$;

create function public.admin_triage_configurations()
returns table (
  label text, configuration_id bigint, cheap_provider text, cheap_model text, strong_provider text,
  strong_model text, prompt text, cheap_in_usd numeric, cheap_out_usd numeric, strong_in_usd numeric,
  strong_out_usd numeric, escalate_below numeric, payload_tokens integer, sample_cards integer,
  set_at timestamptz, set_by_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.label, c.id, c.cheap_provider, c.cheap_model, c.strong_provider, c.strong_model, c.prompt,
    c.cheap_in_usd, c.cheap_out_usd, c.strong_in_usd, c.strong_out_usd, c.escalate_below,
    c.payload_tokens, c.sample_cards, l.set_at, u.email::text
  from private.triage_configuration_labels as l
  join private.triage_configurations as c on c.id = l.configuration_id
  left join auth.users as u on u.id = l.set_by
  order by l.label;
end;
$$;

-- Makes the draft active: `activated`; `no_test` without a draft; `no_key` while either tier's
-- provider has no key in Vault.
create function public.admin_activate_triage_configuration() returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  draft private.triage_configurations;
  before bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.triage_configuration_labels', 7));
  select c.* into draft from private.triage_configuration_labels as l
    join private.triage_configurations as c on c.id = l.configuration_id where l.label = 'test';
  if not found then
    return 'no_test';
  end if;
  if (select count(*) from private.provider_keys as k
      where k.provider in (draft.cheap_provider, draft.strong_provider))
    < (select count(distinct p) from (values (draft.cheap_provider), (draft.strong_provider)) as t (p))
  then
    return 'no_key';
  end if;
  select l.configuration_id into before from private.triage_configuration_labels as l
    where l.label = 'active';
  insert into private.triage_configuration_labels (label, configuration_id, set_by)
    values ('active', draft.id, caller)
    on conflict on constraint triage_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  delete from private.triage_configuration_labels as l where l.label = 'test';
  perform private.audit('activate_triage_configuration', 'triage_configuration', draft.id::text,
    jsonb_build_object('cheap_model', draft.cheap_model, 'strong_model', draft.strong_model,
      'configuration_before', before));
  return 'activated';
end;
$$;

create function public.admin_clear_triage_test() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared bigint;
begin
  perform private.require_admin();
  delete from private.triage_configuration_labels as l where l.label = 'test'
    returning l.configuration_id into cleared;
  if cleared is null then
    return false;
  end if;
  perform private.audit('clear_triage_test', 'triage_configuration', cleared::text, '{}'::jsonb);
  return true;
end;
$$;

-- The owner's one appeal of an AI action that hid the note: `appealed`, `already`, or
-- `not_hidden_by_ai` for anyone but the owner and for a note no standing action hid.
create function public.appeal_ai_hidden_note(deck_id uuid) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  standing bigint;
begin
  select max(a.id) into standing from private.triage_actions as a
    join public.decks as d on d.id = a.deck_id
    join private.deck_screening as s on s.deck_id = d.id and s.hold = 'ai'
    where a.deck_id = appeal_ai_hidden_note.deck_id and a.action = 'hide' and a.undone_at is null
      and d.user_id = caller and d.hidden and d.publication = 'held';
  if standing is null then
    return 'not_hidden_by_ai';
  end if;
  insert into private.triage_appeals (deck_id, action_id, owner_id)
    values (appeal_ai_hidden_note.deck_id, standing, caller)
    on conflict on constraint triage_appeals_pkey do nothing;
  if not found then
    return 'already';
  end if;
  return 'appealed';
end;
$$;

-- The owner's view of an AI action on the note: null for anyone else.
create function public.my_triage_state(deck_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hidden_by_ai', exists (select from private.triage_actions as a
      join private.deck_screening as s on s.deck_id = a.deck_id and s.hold = 'ai'
      where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null and d.hidden),
    'appealed', exists (select from private.triage_appeals as p where p.deck_id = d.id),
    'resolved', exists (select from private.triage_appeals as p
      where p.deck_id = d.id and p.resolved_at is not null))
  from public.decks as d
  where d.id = my_triage_state.deck_id and d.user_id = (select auth.uid());
$$;

revoke all on function private.triage_undo(bigint, uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_triage_action(bigint), public.admin_triage_queue(),
  public.admin_triage_actions(integer), public.admin_triage_sample(),
  public.admin_recheck_triage_action(bigint, boolean), public.admin_triage_settings(),
  public.admin_set_triage_settings(text, numeric, numeric, integer, integer),
  public.admin_resume_triage(), public.admin_triage_agreement(integer),
  public.admin_triage_appeals(), public.admin_resolve_triage_appeal(uuid, boolean),
  public.admin_triage_configurations(), public.admin_activate_triage_configuration(),
  public.admin_clear_triage_test(), public.appeal_ai_hidden_note(uuid), public.my_triage_state(uuid)
  from public, anon;
grant execute on function public.admin_undo_triage_action(bigint), public.admin_triage_queue(),
  public.admin_triage_actions(integer), public.admin_triage_sample(),
  public.admin_recheck_triage_action(bigint, boolean), public.admin_triage_settings(),
  public.admin_set_triage_settings(text, numeric, numeric, integer, integer),
  public.admin_resume_triage(), public.admin_triage_agreement(integer),
  public.admin_triage_appeals(), public.admin_resolve_triage_appeal(uuid, boolean),
  public.admin_triage_configurations(), public.admin_activate_triage_configuration(),
  public.admin_clear_triage_test(), public.appeal_ai_hidden_note(uuid), public.my_triage_state(uuid)
  to authenticated;

select cron.schedule('sweep-report-triage', '*/5 * * * *', 'select private.sweep_report_triage()');

-- The revert in the header.
create function private.revert_report_triage() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  perform cron.unschedule('sweep-report-triage');
  drop trigger triage_severe_report on public.deck_reports;
  drop function private.triage_severe_report();
  drop function private.sweep_report_triage();
  drop function private.request_triage_worker(text, text, boolean);
  drop function public.my_triage_state(uuid);
  drop function public.appeal_ai_hidden_note(uuid);
  drop function public.admin_clear_triage_test();
  drop function public.admin_activate_triage_configuration();
  drop function public.admin_triage_configurations();
  drop function public.admin_resolve_triage_appeal(uuid, boolean);
  drop function public.admin_triage_appeals();
  drop function public.admin_triage_agreement(integer);
  drop function public.admin_resume_triage();
  drop function public.admin_set_triage_settings(text, numeric, numeric, integer, integer);
  drop function public.admin_triage_settings();
  drop function public.admin_recheck_triage_action(bigint, boolean);
  drop function public.admin_triage_sample();
  drop function public.admin_triage_actions(integer);
  drop function public.admin_triage_queue();
  drop function public.admin_undo_triage_action(bigint);
  drop function private.triage_undo(bigint, uuid);
  drop function public.save_triage_configuration(uuid, text, text, text, text, text, numeric,
    numeric, numeric, numeric, numeric, integer, integer);
  drop function public.record_triage(uuid, text, text, numeric, text, text, text, text, text, text,
    bigint, integer, integer, numeric, boolean);
  drop function public.triage_claim(uuid);
  drop function public.triage_due(integer, boolean);
  drop function private.triage_apply(uuid, text);
  drop function private.triage_check_pause();
  drop function private.triage_is_due(uuid, boolean);
  drop function private.triage_open();
  drop function private.triage_judged_today();
  drop function private.triage_spent_today();
  drop function private.triage_day_start();
  drop table private.triage_appeals, private.triage_actions, private.triage_verdicts,
    private.triage_configuration_labels, private.triage_configurations, private.triage_settings;
  drop function private.keep_triage_configuration();
end;
$revert$;

revoke all on function private.revert_report_triage() from public, anon, authenticated;
