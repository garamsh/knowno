-- Judges a reported note once by a model (#887, ADR 0244). No model runs at publish (ADR 0240); the
-- `triage-reports` function judges a note only after two distinct users reported it, one verdict
-- per content hash, a cheap model first, within a daily spend cap, and ships judge-only: it records
-- verdicts and changes nothing until an admin switches `private.triage_settings.mode` to `acting`.
--
-- Adds, in `private`, `triage_settings` (one row), `triage_configurations` (append-only) with
-- `triage_configuration_labels`, `triage_verdicts`, `triage_spend` (every provider call's cost),
-- `triage_attempts` (a note's lease and its failures), `triage_actions`, `triage_appeals` and
-- `report_log` (every report ever made, for the reporter's daily cap and weight); the
-- service-role-only `triage_due`, `triage_claim`, `triage_release`, `record_triage_spend`,
-- `record_triage` and `save_triage_configuration`; the admin functions of the queue, the actions,
-- the undo, the sample, the settings, agreement, appeals and the configuration; the owner's
-- `appeal_ai_hidden_note` and `my_triage_state`; triggers on `deck_reports` that cap a reporter's
-- day, keep the log, and ask the function to judge a severe report (reason `sexual`) at once; and
-- the sweeper `private.sweep_report_triage()`, run every 5 minutes by the cron job
-- `sweep-report-triage`. It adds the report reason `sexual` to `deck_reports.reason`'s check and
-- replaces `admin_remove_provider_key` and `admin_provider_keys`, which now count the triage
-- configuration's providers as in use; no row changes. The function it ships spends money once an
-- admin activates a configuration, which is the Gate's cost case.
--
-- The sweeper and the trigger read two Vault secrets by name and do nothing while either is
-- missing: `triage_function_url`, `https://<project ref>.supabase.co/functions/v1/triage-reports`,
-- and the existing `assistant_service_role_key`. The migration stores neither.
--
-- Revert, run once against production: `select private.revert_report_triage();`, then
-- `drop function private.revert_report_triage();`. It unschedules the cron job, drops the
-- triggers, functions and tables, restores the two replaced functions and the four-reason check
-- (a `sexual` report becomes `inappropriate`); a note an AI action hid stays hidden until an admin
-- unhides it, and the Vault secrets stay.

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
  resumed_at timestamptz,
  reporter_daily_cap integer not null default 20 check (reporter_daily_cap between 1 and 1000),
  lease_minutes integer not null default 10 check (lease_minutes between 1 and 120),
  max_failures integer not null default 3 check (max_failures between 1 and 20),
  retry_minutes integer not null default 15 check (retry_minutes between 1 and 1440),
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

-- An owner's one appeal of each AI action, decided by an admin. `undo_outcome` is what the undo
-- answered when the admin restored; `restored` is whether the note is restored.
create table private.triage_appeals (
  action_id bigint primary key references private.triage_actions on delete cascade,
  deck_id uuid not null references public.decks on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users on delete set null,
  restored boolean,
  undo_outcome text
);

create index triage_appeals_deck_id on private.triage_appeals (deck_id);
create index triage_appeals_owner_id on private.triage_appeals (owner_id);
create index triage_appeals_resolved_by on private.triage_appeals (resolved_by);

-- Every provider call's cost, whatever became of the verdict: the daily spend reads this ledger.
-- `estimated` marks a call charged at its ceiling because the provider reported no usage or the
-- call may have run without an answer.
create table private.triage_spend (
  id bigint generated always as identity primary key,
  deck_id uuid references public.decks on delete set null,
  content_hash text not null,
  tier text not null check (tier in ('cheap', 'strong')),
  provider text not null,
  model text not null,
  tokens_in integer not null check (tokens_in >= 0),
  tokens_out integer not null check (tokens_out >= 0),
  cost_usd numeric not null check (cost_usd >= 0),
  estimated boolean not null,
  created_at timestamptz not null default now()
);

create index triage_spend_created_at on private.triage_spend (created_at);
create index triage_spend_deck_id on private.triage_spend (deck_id);

-- A note in one worker's hands: `claimed_at` is the lease, and a note whose judging failed waits
-- until `next_attempt_at`, then is left to people after `max_failures`. Bound to one content hash.
create table private.triage_attempts (
  deck_id uuid primary key references public.decks on delete cascade,
  content_hash text not null,
  claimed_at timestamptz,
  failures integer not null default 0 check (failures >= 0),
  next_attempt_at timestamptz
);

-- Every report ever made, kept after the report is dismissed: a reporter's reports of the day for
-- the daily cap, and the share of them dismissed for the reporter's weight. No foreign key to the
-- deck, so a deleted note's reports still count.
create table private.report_log (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users on delete cascade,
  deck_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now(),
  dismissed_at timestamptz
);

create index report_log_reporter_id on private.report_log (reporter_id, created_at);
insert into private.report_log (reporter_id, deck_id, reason, created_at)
  select r.reporter_id, r.deck_id, r.reason, r.created_at from public.deck_reports as r;

alter table private.triage_settings enable row level security;
alter table private.triage_configurations enable row level security;
alter table private.triage_configuration_labels enable row level security;
alter table private.triage_verdicts enable row level security;
alter table private.triage_actions enable row level security;
alter table private.triage_appeals enable row level security;
alter table private.triage_spend enable row level security;
alter table private.triage_attempts enable row level security;
alter table private.report_log enable row level security;
revoke all on private.triage_settings, private.triage_configurations,
  private.triage_configuration_labels, private.triage_verdicts, private.triage_actions,
  private.triage_appeals, private.triage_spend, private.triage_attempts, private.report_log
  from public, anon, authenticated, service_role;

-- The reason `sexual`, with minors, is the severe category judged at once; the report screens
-- keep sending the four others.
alter table public.deck_reports drop constraint deck_reports_reason_check;
alter table public.deck_reports add constraint deck_reports_reason_check
  check (reason in ('inappropriate', 'sexual', 'spam', 'copyright', 'other'));

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
  select coalesce(sum(x.cost_usd), 0) from private.triage_spend as x
  where x.created_at >= private.triage_day_start();
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

-- A reporter's weight: 1, or half once the reporter has made five reports in 90 days and more than
-- half of them were dismissed.
create function private.reporter_weight(p_reporter uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when count(*) >= 5 and count(l.dismissed_at)::numeric / count(*) > 0.5 then 0.5 else 1 end
  from private.report_log as l
  where l.reporter_id = p_reporter and l.created_at >= now() - interval '90 days';
$$;

-- The weight of the reporters of [p_deck]: a note is judged from a weight of 2, which two reporters
-- of full weight make.
create function private.note_report_weight(p_deck uuid) returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(private.reporter_weight(r.reporter_id)), 0) from public.deck_reports as r
  where r.deck_id = p_deck;
$$;

-- Whether [deck_id] is due: a live public note (shown or held) whose reporters weigh 2, with no
-- verdict for its current content, not waiting out a failed judging and not given up on after
-- `max_failures`. [severe] also needs a `sexual` report.
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
        and private.note_report_weight(d.id) >= 2
        and (not triage_is_due.severe or exists (select from public.deck_reports as r
          where r.deck_id = d.id and r.reason = 'sexual'))
        and not exists (select from private.triage_verdicts as v
          where v.content_hash = private.note_content_hash(d.id))
        and not exists (select from private.triage_attempts as a, private.triage_settings as s
          where a.deck_id = d.id and a.content_hash = private.note_content_hash(d.id)
            and (a.failures >= s.max_failures or a.next_attempt_at > now())));
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

-- Everything the function needs to judge [deck_id], and a lease on the note for `lease_minutes`
-- so one worker holds it at a time; null when the note is not due, so a spent day makes no call,
-- and while another worker's lease stands. The lease ends at `record_triage` or `triage_release`.
create function public.triage_claim(deck_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.triage_is_due(triage_claim.deck_id, false) then
    return null;
  end if;
  insert into private.triage_attempts as t (deck_id, content_hash, claimed_at)
    values (triage_claim.deck_id, private.note_content_hash(triage_claim.deck_id), now())
    on conflict on constraint triage_attempts_pkey do update
      set content_hash = excluded.content_hash, claimed_at = now(),
        failures = case when t.content_hash = excluded.content_hash then t.failures else 0 end,
        next_attempt_at = case when t.content_hash = excluded.content_hash then t.next_attempt_at end
      where t.claimed_at is null
        or t.claimed_at <= now() - make_interval(mins => (select s.lease_minutes
          from private.triage_settings as s));
  if not found then
    return null;
  end if;
  return (
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
  where d.id = triage_claim.deck_id);
end;
$$;

-- Ends the lease on [deck_id]. A [failed] judging counts a failure and sets the note's next attempt
-- to `retry_minutes` doubled for each earlier failure; the failures so far, null for no lease.
create function public.triage_release(deck_id uuid, failed boolean) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.triage_settings;
  total integer;
begin
  select * into s from private.triage_settings;
  update private.triage_attempts as t set claimed_at = null,
      failures = t.failures + case when triage_release.failed then 1 else 0 end,
      next_attempt_at = case when triage_release.failed
        then now() + make_interval(mins => s.retry_minutes * (2 ^ least(t.failures, 10))::integer)
        else t.next_attempt_at end
    where t.deck_id = triage_release.deck_id
    returning t.failures into total;
  return total;
end;
$$;

-- Records one provider call's cost in the ledger, whatever becomes of the verdict, and answers
-- whether the day's spend cap is still open.
create function public.record_triage_spend(
  deck_id uuid, content_hash text, tier text, provider text, model text, tokens_in integer,
  tokens_out integer, cost_usd numeric, estimated boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.triage_spend (deck_id, content_hash, tier, provider, model, tokens_in,
      tokens_out, cost_usd, estimated)
    values (record_triage_spend.deck_id, record_triage_spend.content_hash, record_triage_spend.tier,
      record_triage_spend.provider, record_triage_spend.model, record_triage_spend.tokens_in,
      record_triage_spend.tokens_out, record_triage_spend.cost_usd, record_triage_spend.estimated);
  return private.triage_spent_today() < (select s.daily_cap_usd from private.triage_settings as s);
end;
$$;

-- The start of the undo-rate window: `undo_window_hours` back, never before the last resume, so a
-- resumed automation is judged on what it does after it.
create function private.triage_window_start() returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(now() - make_interval(hours => s.undo_window_hours),
    coalesce(s.resumed_at, '-infinity'::timestamptz))
  from private.triage_settings as s;
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
    where a.created_at >= private.triage_window_start();
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
-- `dismissed` or `paused`, null for no action. Only a note judged spam or an ad, and holding no
-- hold, is hidden; only a note judged ok has its reports dismissed, and never while a `copyright`
-- or `sexual` report stands; each at or above the threshold. Copyright, severe, inappropriate,
-- other and unjudged are never acted on, and nothing is ever unpublished, removed or suspended.
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
  if kind = 'dismiss' and exists (select from public.deck_reports as r
    where r.deck_id = p_deck and r.reason in ('copyright', 'sexual'))
  then
    return null;
  end if;
  if private.triage_check_pause() then
    return 'paused';
  end if;
  if kind = 'hide' then
    perform 1 from private.deck_screening as x where x.deck_id = p_deck and x.hold is not null for update;
    if found then
      return null;
    end if;
    update public.decks as d set hidden = true, publication = 'held'
      where d.id = p_deck and d.deleted_at is null and d.visibility = 'public'
        and d.publication = 'public' and not d.hidden;
    made := found;
    if not made then
      return null;
    end if;
    insert into private.deck_screening as x (deck_id, hold) values (p_deck, 'ai')
      on conflict on constraint deck_screening_pkey do update set hold = 'ai';
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

-- Stores the verdict on [content_hash] and ends the note's lease: `changed` while the note no
-- longer has that hash, `exists` while a verdict stands, otherwise `recorded`, or what the verdict
-- made the database do. The verdict's cost is the note's display; the ledger holds the spend.
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
  delete from private.triage_attempts as t
    where t.deck_id = record_triage.deck_id and t.content_hash = record_triage.content_hash;
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

-- A severe report, a `sexual` one among two reporters, is judged at once, not at the next batch:
-- the trigger asks the worker as it arrives, when the note is due. A Vault or pg_net error never
-- fails the reporter's insert.
create function private.triage_severe_report() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  function_url text;
  service_role_key text;
begin
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
  exception when others then
    return null;
  end;
  return null;
end;
$$;

-- A reporter's day is capped: `reporter_daily_cap` reports per UTC day, then the insert is refused.
-- Every report is logged, and a restoring undo (`knowno.restoring_reports`) is neither capped nor
-- logged again. The lock makes one reporter's concurrent reports count one after another.
create function private.log_report() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('knowno.restoring_reports', true), '') = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.reporter_id::text, 9));
  if (select count(*) from private.report_log as l
      where l.reporter_id = new.reporter_id and l.created_at >= private.triage_day_start())
    >= (select s.reporter_daily_cap from private.triage_settings as s)
  then
    raise exception 'the reporter has reached the daily report limit' using errcode = '53400';
  end if;
  insert into private.report_log (reporter_id, deck_id, reason) values (new.reporter_id, new.deck_id, new.reason);
  return new;
end;
$$;

-- A report deleted while its note stands is a dismissal, kept in the log for the reporter's weight;
-- one removed with its note or its reporter is not.
create function private.log_report_dismissed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select from public.decks as d where d.id = old.deck_id) then
    update private.report_log as l set dismissed_at = now()
      where l.id = (select max(x.id) from private.report_log as x
        where x.reporter_id = old.reporter_id and x.deck_id = old.deck_id and x.dismissed_at is null);
  end if;
  return null;
end;
$$;

create trigger triage_severe_report after insert on public.deck_reports
  for each row execute function private.triage_severe_report();
create trigger deck_reports_log before insert on public.deck_reports
  for each row execute function private.log_report();
create trigger deck_reports_dismissed after delete on public.deck_reports
  for each row execute function private.log_report_dismissed();

revoke all on function private.triage_day_start(), private.triage_spent_today(),
  private.triage_judged_today(), private.triage_open(), private.triage_is_due(uuid, boolean),
  private.reporter_weight(uuid), private.note_report_weight(uuid), private.triage_window_start(),
  private.triage_check_pause(), private.triage_apply(uuid, text),
  private.keep_triage_configuration(), private.request_triage_worker(text, text, boolean),
  private.sweep_report_triage(), private.triage_severe_report(), private.log_report(),
  private.log_report_dismissed()
  from public, anon, authenticated;
revoke all on function public.triage_due(integer, boolean), public.triage_claim(uuid),
  public.triage_release(uuid, boolean),
  public.record_triage_spend(uuid, text, text, text, text, integer, integer, numeric, boolean),
  public.record_triage(uuid, text, text, numeric, text, text, text, text, text, text, bigint,
    integer, integer, numeric, boolean),
  public.save_triage_configuration(uuid, text, text, text, text, text, numeric, numeric, numeric,
    numeric, numeric, integer, integer)
  from public, anon, authenticated;
grant execute on function public.triage_due(integer, boolean), public.triage_claim(uuid),
  public.triage_release(uuid, boolean),
  public.record_triage_spend(uuid, text, text, text, text, integer, integer, numeric, boolean),
  public.record_triage(uuid, text, text, numeric, text, text, text, text, text, text, bigint,
    integer, integer, numeric, boolean),
  public.save_triage_configuration(uuid, text, text, text, text, text, numeric, numeric, numeric,
    numeric, numeric, integer, integer)
  to service_role;

-- Reverses an AI action: unhides a note it hid while the `ai` hold stands, or restores the reports
-- it archived. `undone`, `already`, `not_found`, or `superseded` for a hide whose `ai` hold no
-- longer stands, which changes and records nothing. Only `undone` counts toward the undo rate.
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
    if not held then
      return 'superseded';
    end if;
    update public.decks as d set hidden = false, publication = 'public'
      where d.id = a.deck_id and d.hidden and d.publication = 'held' and d.deleted_at is null;
  else
    perform set_config('knowno.restoring_reports', 'on', true);
    with restored as (
      insert into public.deck_reports (deck_id, reporter_id, reason, created_at)
        select a.deck_id, (e ->> 'reporter_id')::uuid, e ->> 'reason', (e ->> 'created_at')::timestamptz
        from jsonb_array_elements(a.archived) as e
        where exists (select from auth.users as u where u.id = (e ->> 'reporter_id')::uuid)
        on conflict do nothing
        returning reporter_id)
    update private.report_log as l set dismissed_at = null
      where l.id in (select max(x.id) from private.report_log as x
        join restored as r on r.reporter_id = x.reporter_id
        where x.deck_id = a.deck_id and x.dismissed_at is not null group by x.reporter_id);
    perform set_config('knowno.restoring_reports', 'off', true);
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
-- first and then the latest report. `failures` counts the failed judgings of the current text, which
-- are left to people from `max_failures`.
create function public.admin_triage_queue()
returns table (
  deck_id uuid, name text, owner_id uuid, hidden boolean, publication text, reporters bigint,
  reasons text[], last_reported_at timestamptz, category text, confidence numeric, passage text,
  field text, tier text, model text, cost_usd numeric, judged_at timestamptz, action_id bigint,
  appealed boolean, failures integer)
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
    exists (select from private.triage_appeals as p where p.deck_id = d.id
      and p.action_id = (select max(a.id) from private.triage_actions as a
        where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)),
    (select t.failures from private.triage_attempts as t
      where t.deck_id = d.id and t.content_hash = private.note_content_hash(d.id))
  from (
    select x.deck_id, count(distinct x.reporter_id) as reporters,
      array_agg(distinct x.reason order by x.reason) as reasons, max(x.created_at) as last_reported_at
    from public.deck_reports as x group by x.deck_id having count(distinct x.reporter_id) >= 2
  ) as r
  join public.decks as d on d.id = r.deck_id and d.deleted_at is null
  left join private.triage_verdicts as v on v.content_hash = private.note_content_hash(d.id)
  order by ('sexual' = any (r.reasons)) desc, r.last_reported_at desc, d.id;
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
  judged_today bigint, actions_in_window bigint, undo_rate numeric, reporter_daily_cap integer)
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
    case when w.total > 0 then w.undone::numeric / w.total end, s.reporter_daily_cap
  from private.triage_settings as s,
    lateral (select count(*) as total, count(a.undone_at) as undone from private.triage_actions as a
      where a.created_at >= private.triage_window_start()) as w;
end;
$$;

-- Changes the settings given, a null leaving one as it is, and records the new values.
create function public.admin_set_triage_settings(
  mode text default null, act_threshold numeric default null, daily_cap_usd numeric default null,
  daily_notes integer default null, sample_percent integer default null,
  reporter_daily_cap integer default null)
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
      reporter_daily_cap = coalesce(admin_set_triage_settings.reporter_daily_cap, s.reporter_daily_cap),
      updated_by = caller, updated_at = now();
  perform private.audit('set_triage_settings', 'triage', 'settings', jsonb_strip_nulls(jsonb_build_object(
    'mode', admin_set_triage_settings.mode, 'act_threshold', admin_set_triage_settings.act_threshold,
    'daily_cap_usd', admin_set_triage_settings.daily_cap_usd,
    'daily_notes', admin_set_triage_settings.daily_notes,
    'sample_percent', admin_set_triage_settings.sample_percent,
    'reporter_daily_cap', admin_set_triage_settings.reporter_daily_cap)));
  return true;
end;
$$;

-- Clears the pause the undo rate set and starts the undo-rate window afresh, so only the actions
-- after it are counted; false when it was not paused.
create function public.admin_resume_triage() returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
begin
  update private.triage_settings as s set paused_at = null, paused_reason = null, resumed_at = now(),
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
  order by p.created_at, p.action_id;
end;
$$;

-- Decides the open appeal on [deck_id]: `upheld`; `restored` when the undo restored the note or it
-- already was; `not_restored` when the undo answered otherwise, which the appeal records as
-- `undo_outcome`; `not_found` without an open appeal.
create function public.admin_resolve_triage_appeal(deck_id uuid, restore boolean) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  p private.triage_appeals;
  outcome text;
  done boolean := false;
begin
  select * into p from private.triage_appeals as x
    where x.deck_id = admin_resolve_triage_appeal.deck_id and x.resolved_at is null
    order by x.created_at, x.action_id limit 1 for update;
  if not found then
    return 'not_found';
  end if;
  if admin_resolve_triage_appeal.restore then
    outcome := private.triage_undo(p.action_id, caller);
    done := outcome in ('undone', 'already');
  end if;
  update private.triage_appeals as x set resolved_at = now(), resolved_by = caller,
      restored = done, undo_outcome = outcome
    where x.action_id = p.action_id;
  perform private.audit('resolve_triage_appeal', 'deck', p.deck_id::text,
    jsonb_build_object('restored', done, 'undo_outcome', outcome));
  return case when done then 'restored' when admin_resolve_triage_appeal.restore then 'not_restored'
    else 'upheld' end;
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

-- The owner's one appeal of each AI action that hid the note: `appealed`, `already`, or
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
  insert into private.triage_appeals (action_id, deck_id, owner_id)
    values (standing, appeal_ai_hidden_note.deck_id, caller)
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
    'appealed', exists (select from private.triage_appeals as p where p.deck_id = d.id
      and p.action_id = (select max(a.id) from private.triage_actions as a
        where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)),
    'resolved', exists (select from private.triage_appeals as p
      where p.deck_id = d.id and p.resolved_at is not null
        and p.action_id = (select max(a.id) from private.triage_actions as a
          where a.deck_id = d.id and a.action = 'hide' and a.undone_at is null)))
  from public.decks as d
  where d.id = my_triage_state.deck_id and d.user_id = (select auth.uid());
$$;

-- Replaced from `20261102183518_ai_providers.sql`: a provider the active triage configuration names
-- is in use too, so its key cannot be removed from under the function.
create or replace function public.admin_provider_keys()
returns table (
  provider text, last_four text, set_at timestamptz, set_by_email text, in_use boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.provider, k.last_four, k.set_at, u.email::text,
    exists (select from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.label = 'active' and c.provider = p.provider)
    or exists (select from private.triage_configuration_labels as l
      join private.triage_configurations as c on c.id = l.configuration_id
      where l.label = 'active' and p.provider in (c.cheap_provider, c.strong_provider))
  from (values ('openrouter'), ('openai'), ('anthropic')) as p (provider)
  left join private.provider_keys as k on k.provider = p.provider
  left join auth.users as u on u.id = k.set_by
  order by array_position(array['openrouter', 'openai', 'anthropic'], p.provider);
end;
$$;

create or replace function public.admin_remove_provider_key(provider text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed private.provider_keys;
begin
  perform private.require_admin();
  if not private.signed_in_recently() then
    return 'reauth';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('private.ai_configuration_labels', 6));
  if exists (select from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and c.provider = admin_remove_provider_key.provider)
  then
    return 'in_use';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('private.triage_configuration_labels', 7));
  if exists (select from private.triage_configuration_labels as l
    join private.triage_configurations as c on c.id = l.configuration_id
    where l.label = 'active'
      and admin_remove_provider_key.provider in (c.cheap_provider, c.strong_provider))
  then
    return 'in_use';
  end if;
  delete from private.provider_keys as k where k.provider = admin_remove_provider_key.provider
    returning * into removed;
  if not found then
    return 'none';
  end if;
  delete from vault.secrets as s where s.id = removed.secret_id;
  perform private.audit('remove_provider_key', 'provider', removed.provider, '{}'::jsonb);
  return 'removed';
end;
$$;

revoke all on function private.triage_undo(bigint, uuid) from public, anon, authenticated;
revoke all on function public.admin_undo_triage_action(bigint), public.admin_triage_queue(),
  public.admin_triage_actions(integer), public.admin_triage_sample(),
  public.admin_recheck_triage_action(bigint, boolean), public.admin_triage_settings(),
  public.admin_set_triage_settings(text, numeric, numeric, integer, integer, integer),
  public.admin_resume_triage(), public.admin_triage_agreement(integer),
  public.admin_triage_appeals(), public.admin_resolve_triage_appeal(uuid, boolean),
  public.admin_triage_configurations(), public.admin_activate_triage_configuration(),
  public.admin_clear_triage_test(), public.appeal_ai_hidden_note(uuid), public.my_triage_state(uuid)
  from public, anon;
grant execute on function public.admin_undo_triage_action(bigint), public.admin_triage_queue(),
  public.admin_triage_actions(integer), public.admin_triage_sample(),
  public.admin_recheck_triage_action(bigint, boolean), public.admin_triage_settings(),
  public.admin_set_triage_settings(text, numeric, numeric, integer, integer, integer),
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
  drop trigger deck_reports_dismissed on public.deck_reports;
  drop trigger deck_reports_log on public.deck_reports;
  drop function private.log_report_dismissed();
  drop function private.log_report();
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
  drop function public.admin_set_triage_settings(text, numeric, numeric, integer, integer, integer);
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
  drop function private.note_report_weight(uuid);
  drop function private.reporter_weight(uuid);
  drop function public.record_triage_spend(uuid, text, text, text, text, integer, integer, numeric,
    boolean);
  drop function public.triage_release(uuid, boolean);
  drop function private.triage_window_start();
  drop table private.report_log, private.triage_spend, private.triage_attempts;
  drop table private.triage_appeals, private.triage_actions, private.triage_verdicts,
    private.triage_configuration_labels, private.triage_configurations, private.triage_settings;
  drop function private.keep_triage_configuration();
  alter table public.deck_reports drop constraint deck_reports_reason_check;
  update public.deck_reports set reason = 'inappropriate' where reason = 'sexual';
  alter table public.deck_reports add constraint deck_reports_reason_check
    check (reason in ('inappropriate', 'spam', 'copyright', 'other'));
  execute $q$create or replace function public.admin_provider_keys()
returns table (
  provider text, last_four text, set_at timestamptz, set_by_email text, in_use boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.provider, k.last_four, k.set_at, u.email::text,
    exists (select from private.ai_configuration_labels as l
      join private.ai_configurations as c on c.id = l.configuration_id
      where l.label = 'active' and c.provider = p.provider)
  from (values ('openrouter'), ('openai'), ('anthropic')) as p (provider)
  left join private.provider_keys as k on k.provider = p.provider
  left join auth.users as u on u.id = k.set_by
  order by array_position(array['openrouter', 'openai', 'anthropic'], p.provider);
end;
$$
  $q$;
  execute $q$create or replace function public.admin_remove_provider_key(provider text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed private.provider_keys;
begin
  perform private.require_admin();
  if not private.signed_in_recently() then
    return 'reauth';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('private.ai_configuration_labels', 6));
  if exists (select from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active' and c.provider = admin_remove_provider_key.provider)
  then
    return 'in_use';
  end if;
  delete from private.provider_keys as k where k.provider = admin_remove_provider_key.provider
    returning * into removed;
  if not found then
    return 'none';
  end if;
  delete from vault.secrets as s where s.id = removed.secret_id;
  perform private.audit('remove_provider_key', 'provider', removed.provider, '{}'::jsonb);
  return 'removed';
end;
$$
  $q$;
end;
$revert$;

revoke all on function private.revert_report_triage() from public, anon, authenticated;
