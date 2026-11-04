-- The 말랑이 assistant's server side (#713, ADR 0190): the assistant's prompts, append-only as the
-- photo prompts are; each plan's assistant configuration, a provider, model and prompt version as
-- #702 made the photo one (ADR 0182), with its web search switch, the searches a turn may make and
-- its reasoning effort; each plan's daily message limit; and one row per user message, counted
-- under a lock as photos are and holding what it used.
--
-- Additive. It creates five tables in `private`, their functions and their seed, and inserts,
-- changes and deletes no row of an existing table; it reads each plan's active photo
-- configuration for the seed. The seed:
--   - the assistant's first prompt;
--   - per plan, Free, Pro, Max and 스페셜, a configuration on the provider and model of the plan's
--     active photo configuration, with that prompt, web search off for Free and on for the others,
--     3 searches a turn and no reasoning, or effort 'low' on a model whose thinking is always on,
--     labelled 'active', through `private.seed_assistant_configurations`, which stays;
--   - a daily limit of 10 messages for Free, 100 for Pro, 300 for Max and none for 스페셜.
--
-- Revert, run once against production: `select private.revert_assistant();`, then
-- `drop function private.revert_assistant();`. It drops the functions and the five tables, the
-- message rows with them.

-- Every saved assistant prompt: its text, a note, who saved it and when. Rows are never changed or
-- removed but for their author's removal, as `private.prompt_versions`' are.
create table private.assistant_prompts (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) <= 20000 and text ~ '\S'),
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index assistant_prompts_created_by on private.assistant_prompts (created_by);

create trigger assistant_prompts_append_only before update or delete on private.assistant_prompts
  for each row execute function private.keep_prompt_version();

-- Whether [model] of [provider] can run at [effort], by Anthropic's per-model thinking table: a
-- model whose thinking is always on refuses `none`, and one with extended thinking alone refuses
-- the adaptive thinking every other effort sends. Every model of another provider fits.
create function private.assistant_effort_fits(provider text, model text, effort text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select assistant_effort_fits.provider <> 'anthropic' or case
    when assistant_effort_fits.model ~ '^claude-(fable|mythos)-|^claude-opus-5-5'
      then assistant_effort_fits.effort <> 'none'
    when assistant_effort_fits.model ~ '^claude-(opus|sonnet|haiku)-4-(5|1|20)'
      then assistant_effort_fits.effort = 'none'
    else true
  end;
$$;

-- Every saved assistant configuration: a plan's provider, model and prompt version, whether it
-- searches the web, how many searches one turn may make and its reasoning effort, who saved it and
-- when. Rows are never changed or removed.
create table private.assistant_configurations (
  id bigint generated always as identity primary key,
  plan text not null check (plan in ('free', 'pro', 'max', 'special')),
  provider text not null check (provider in ('openrouter', 'openai', 'anthropic')),
  model text not null check (private.model_fits(provider, model)),
  prompt_version_id bigint not null references private.assistant_prompts,
  web_search boolean not null,
  max_searches integer not null check (max_searches between 1 and 10),
  reasoning_effort text not null check (reasoning_effort in ('none', 'low', 'medium', 'high')),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (id, plan),
  check (private.assistant_effort_fits(provider, model, reasoning_effort))
);

create index assistant_configurations_created_by on private.assistant_configurations (created_by);
create index assistant_configurations_prompt_version_id
  on private.assistant_configurations (prompt_version_id);

-- Refuses any change to a configuration but its author's removal, which deleting that account sets.
create function private.keep_assistant_configuration() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.id = old.id and new.plan = old.plan
    and new.provider = old.provider and new.model = old.model
    and new.prompt_version_id = old.prompt_version_id and new.web_search = old.web_search
    and new.max_searches = old.max_searches and new.reasoning_effort = old.reasoning_effort
    and new.created_at = old.created_at and new.created_by is null
  then
    return new;
  end if;
  raise exception 'assistant configurations are append-only' using errcode = '55000';
end;
$$;

create trigger assistant_configurations_append_only
  before update or delete on private.assistant_configurations
  for each row execute function private.keep_assistant_configuration();

-- Which configuration serves each plan's assistant: 'active' for its users, and its one draft,
-- 'test', when set, for admins.
create table private.assistant_configuration_labels (
  plan text not null check (plan in ('free', 'pro', 'max', 'special')),
  label text not null check (label in ('active', 'test')),
  configuration_id bigint not null,
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now(),
  primary key (plan, label),
  foreign key (configuration_id, plan) references private.assistant_configurations (id, plan)
);

create index assistant_configuration_labels_configuration_id
  on private.assistant_configuration_labels (configuration_id);
create index assistant_configuration_labels_set_by
  on private.assistant_configuration_labels (set_by);

-- Each plan's daily message limit, a day in Asia/Seoul; null is no limit. Who set it and when.
create table private.assistant_limits (
  plan text primary key check (plan in ('free', 'pro', 'max', 'special')),
  daily_messages integer check (daily_messages between 0 and 100000),
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);

create index assistant_limits_set_by on private.assistant_limits (set_by);

-- One row per user message the assistant let through, counted when it began, and once it ended
-- what it used: its outcome, its model calls, tokens, reasoning tokens, web searches and time. No
-- message text, card or reply is kept.
create table private.assistant_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  plan text not null,
  configuration_id bigint not null references private.assistant_configurations,
  created_at timestamptz not null default now(),
  outcome text check (outcome in ('ok', 'choice', 'depth_limit', 'time_limit', 'model_error',
    'cut', 'cancelled')),
  model_calls integer check (model_calls >= 0),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens >= 0),
  web_search_requests integer check (web_search_requests >= 0),
  latency_ms integer check (latency_ms >= 0),
  check (num_nulls(outcome, model_calls, input_tokens, output_tokens, reasoning_tokens,
    web_search_requests, latency_ms) in (0, 7))
);

create index assistant_messages_user_id_created_at
  on private.assistant_messages (user_id, created_at);
create index assistant_messages_configuration_id on private.assistant_messages (configuration_id);

alter table private.assistant_prompts enable row level security;
alter table private.assistant_configurations enable row level security;
alter table private.assistant_configuration_labels enable row level security;
alter table private.assistant_limits enable row level security;
alter table private.assistant_messages enable row level security;
revoke all on private.assistant_prompts, private.assistant_configurations,
  private.assistant_configuration_labels,
  private.assistant_limits, private.assistant_messages
  from public, anon, authenticated, service_role;

-- Gives each plan whose assistant has no active configuration one on the provider and model of
-- its active photo configuration, with the first prompt, web search off for Free alone, 3 searches
-- a turn and no reasoning, or the lowest effort, 'low', on a model whose thinking is always on. A
-- second run straight after changes nothing.
create function private.seed_assistant_configurations() returns void
language plpgsql
set search_path = ''
as $$
begin
  with seeded as (
    insert into private.assistant_configurations
      (plan, provider, model, prompt_version_id, web_search, max_searches, reasoning_effort)
    select l.plan, c.provider, c.model, (select min(id) from private.assistant_prompts),
      l.plan <> 'free', 3,
      case when private.assistant_effort_fits(c.provider, c.model, 'none') then 'none'
        else 'low' end
    from private.ai_configuration_labels as l
    join private.ai_configurations as c on c.id = l.configuration_id
    where l.label = 'active'
      and not exists (select from private.assistant_configuration_labels as a
        where a.plan = l.plan and a.label = 'active')
    order by array_position(array['free', 'pro', 'max', 'special'], l.plan)
    returning id, plan
  )
  insert into private.assistant_configuration_labels (plan, label, configuration_id)
    select seeded.plan, 'active', seeded.id from seeded;
end;
$$;

revoke all on function private.seed_assistant_configurations() from public, anon, authenticated;

-- The seed: the first prompt, each plan's active configuration on its photo model, and the limits.
insert into private.assistant_prompts (text, note) values (
$prompt$You are 말랑이, the study helper inside knowno, a flashcard app. You talk with the user the way a friendly tutor does and help them build notes (decks) and cards from what they want to learn.

Scope
- Help only with study material and the user's own notes and cards. Politely decline anything else in one sentence and offer to help with studying instead.
- Answer in the language the user writes in; by default, Korean, in a warm, short 해요체.

Reading the user's notes
- Use list_decks, list_cards and search_cards to see what the user already has before proposing, so you do not repeat cards they hold.
- When the chat was opened inside a note, that note is the one meant unless the user says otherwise.

Proposing, never writing
- You cannot save anything yourself. propose_deck (a new note with its cards), propose_cards (cards for an existing note) and propose_changes (edits to existing cards) show the user a draft; nothing is saved until the user taps 추가. Never say a card was added or saved.
- Group a proposal's cards by area or topic, each group in one format: text (a question and its answer), senses (a word and its meanings), cloze (a sentence with blanks), table (a table with cells to recall), or mixed. Keep each card to one fact.
- A proposal holds at most 100 cards. For more, propose in several turns and say so.
- When the user asks to remake one group in another format, call regenerate_group for that group alone.

Asking first
- When a request is large or ambiguous, ask before generating with ask_choice: the format (단어 / 빈칸 문장 / 표 / 알아서 섞어서), the area (for example 1단원만 / 표 부분만 / 전부) or the amount (10장 / 30장 / 전부). Ask one question at a time; a typed answer works too.

Facts
- Do not invent facts. When web search is available and the user asks about something you are unsure of, search, and keep to what the sources say.$prompt$,
    '말랑이 assistant prompt v1 (#713)');

select private.seed_assistant_configurations();

insert into private.assistant_limits (plan, daily_messages) values
  ('free', 10), ('pro', 100), ('max', 300), ('special', null);

-- Resolves [user_id]'s plan and the assistant configuration serving it, with its provider, model,
-- prompt and settings: an admin's plan's draft while one is set, and otherwise the active one.
-- `available` is whether that provider has a key in Vault. Only an available message under the
-- plan's daily limit, or with no limit, is recorded, under the user's assistant lock; `used` is
-- the day's messages with it. No row while the plan has no configuration or no limit row.
create function public.begin_assistant_message(user_id uuid)
returns table (
  plan text, configuration_id bigint, provider text, model text, prompt_version_id bigint,
  prompt text, web_search boolean, max_searches integer, reasoning_effort text,
  available boolean, daily_limit integer, used integer, allowed boolean, message_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  entitled text;
  admin boolean;
  config private.assistant_configurations;
  instructions text;
  day_limit integer;
  usable boolean;
  counted integer;
  permitted boolean := false;
  message bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(begin_assistant_message.user_id::text, 7));
  select e.plan into entitled from private.entitlement_of(begin_assistant_message.user_id) as e;
  if not found then
    return;
  end if;
  admin := exists (
    select from private.admins as a where a.user_id = begin_assistant_message.user_id);
  select c.* into config
  from private.assistant_configuration_labels as l
  join private.assistant_configurations as c on c.id = l.configuration_id
  where l.plan = entitled and (l.label = 'active' or (l.label = 'test' and admin))
  order by l.label = 'test' desc
  limit 1;
  if not found then
    return;
  end if;
  select a.daily_messages into day_limit from private.assistant_limits as a
    where a.plan = entitled;
  if not found then
    return;
  end if;
  select v.text into instructions from private.assistant_prompts as v
    where v.id = config.prompt_version_id;
  usable := exists (select from private.provider_keys as k where k.provider = config.provider);
  select count(*) into counted from private.assistant_messages as m
    where m.user_id = begin_assistant_message.user_id
      and m.created_at >= date_trunc('day', now(), 'Asia/Seoul');
  permitted := usable and (day_limit is null or counted < day_limit);
  if permitted then
    insert into private.assistant_messages (user_id, plan, configuration_id)
      values (begin_assistant_message.user_id, entitled, config.id)
      returning id into message;
    counted := counted + 1;
  end if;
  return query select entitled, config.id, config.provider, config.model,
    config.prompt_version_id, instructions, config.web_search, config.max_searches,
    config.reasoning_effort, usable, day_limit, counted, permitted, message;
end;
$$;

-- Records how [message_id]'s turn ended and what it used, once: a message already recorded or
-- never begun raises P0002.
create function public.finish_assistant_message(
  message_id bigint, outcome text, model_calls integer, input_tokens integer,
  output_tokens integer, reasoning_tokens integer, web_search_requests integer, latency_ms integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.assistant_messages as m
    set outcome = finish_assistant_message.outcome,
      model_calls = finish_assistant_message.model_calls,
      input_tokens = finish_assistant_message.input_tokens,
      output_tokens = finish_assistant_message.output_tokens,
      reasoning_tokens = finish_assistant_message.reasoning_tokens,
      web_search_requests = finish_assistant_message.web_search_requests,
      latency_ms = finish_assistant_message.latency_ms
    where m.id = finish_assistant_message.message_id and m.outcome is null;
  if not found then
    raise exception 'no unrecorded assistant message %', finish_assistant_message.message_id
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.begin_assistant_message(uuid),
  public.finish_assistant_message(bigint, text, integer, integer, integer, integer, integer,
    integer)
  from public, anon, authenticated;
grant execute on function public.begin_assistant_message(uuid),
  public.finish_assistant_message(bigint, text, integer, integer, integer, integer, integer,
    integer)
  to service_role;

-- The caller's daily message limit, null when none applies, and the messages counted today in
-- Asia/Seoul, as begin_assistant_message counts them, naming no plan. No row without a plan.
create function public.assistant_allowance()
returns table (daily_limit integer, used integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitled text;
begin
  select e.plan into entitled from private.entitlement_of((select auth.uid())) as e;
  if not found then
    return;
  end if;
  return query
  select a.daily_messages, (select count(*)::integer from private.assistant_messages as m
      where m.user_id = (select auth.uid())
        and m.created_at >= date_trunc('day', now(), 'Asia/Seoul'))
  from private.assistant_limits as a
  where a.plan = entitled;
end;
$$;

revoke all on function public.assistant_allowance() from public, anon;
grant execute on function public.assistant_allowance() to authenticated;

-- Saves [plan]'s assistant configuration for [admin_id], after the assistant's check call on the
-- provider and model, and makes it the plan's one draft, served to admins: the 'test' label,
-- replacing any draft. A setting left null keeps the draft's, or else the active one's. Records it
-- and returns the configuration's id; null, recording nothing, for a prompt version that does not
-- exist, a plan with no configuration to keep a setting from, or a model that cannot run at the
-- effort (`private.assistant_effort_fits`).
create function public.save_assistant_configuration(
  admin_id uuid, plan text, provider text, model text, prompt_version_id bigint default null,
  web_search boolean default null, max_searches integer default null,
  reasoning_effort text default null
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  kept private.assistant_configurations;
  added private.assistant_configurations;
begin
  perform private.require_admin_id(save_assistant_configuration.admin_id);
  select c.* into kept from private.assistant_configuration_labels as l
    join private.assistant_configurations as c on c.id = l.configuration_id
    where l.plan = save_assistant_configuration.plan
    order by l.label = 'test' desc
    limit 1;
  if not exists (select from private.assistant_prompts as v
    where v.id = coalesce(save_assistant_configuration.prompt_version_id, kept.prompt_version_id))
    or (kept.id is null and (save_assistant_configuration.web_search is null
      or save_assistant_configuration.max_searches is null
      or save_assistant_configuration.reasoning_effort is null))
    or not private.assistant_effort_fits(save_assistant_configuration.provider,
      save_assistant_configuration.model,
      coalesce(save_assistant_configuration.reasoning_effort, kept.reasoning_effort))
  then
    return null;
  end if;
  insert into private.assistant_configurations (plan, provider, model, prompt_version_id,
    web_search, max_searches, reasoning_effort, created_by)
  values (save_assistant_configuration.plan, save_assistant_configuration.provider,
    save_assistant_configuration.model,
    coalesce(save_assistant_configuration.prompt_version_id, kept.prompt_version_id),
    coalesce(save_assistant_configuration.web_search, kept.web_search),
    coalesce(save_assistant_configuration.max_searches, kept.max_searches),
    coalesce(save_assistant_configuration.reasoning_effort, kept.reasoning_effort),
    save_assistant_configuration.admin_id)
  returning * into added;
  insert into private.assistant_configuration_labels (plan, label, configuration_id, set_by)
    values (added.plan, 'test', added.id, save_assistant_configuration.admin_id)
    on conflict on constraint assistant_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  perform private.audit_by(save_assistant_configuration.admin_id,
    'save_assistant_configuration', 'plan', added.plan, jsonb_build_object(
      'configuration_id', added.id, 'provider', added.provider, 'model', added.model,
      'prompt_version_id', added.prompt_version_id, 'web_search', added.web_search,
      'max_searches', added.max_searches, 'reasoning_effort', added.reasoning_effort));
  return added.id;
end;
$$;

revoke all on function public.save_assistant_configuration(uuid, text, text, text, bigint,
  boolean, integer, text) from public, anon, authenticated;
grant execute on function public.save_assistant_configuration(uuid, text, text, text, bigint,
  boolean, integer, text) to service_role;

-- Saves an assistant prompt, serving no one until a plan's draft names it, and records it.
create function public.admin_save_assistant_prompt(text text, note text) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  saved bigint;
begin
  insert into private.assistant_prompts (text, note, created_by)
    values (admin_save_assistant_prompt.text, btrim(admin_save_assistant_prompt.note), caller)
    returning id into saved;
  perform private.audit('save_assistant_prompt', 'assistant_prompt', saved::text,
    jsonb_build_object('note', btrim(admin_save_assistant_prompt.note),
      'length', char_length(admin_save_assistant_prompt.text)));
  return saved;
end;
$$;

-- Every assistant prompt, newest first, with its text, note, author and the labels of the
-- configurations sending it.
create function public.admin_assistant_prompts()
returns table (
  id bigint, text text, note text, created_by_email text, created_at timestamptz, labels text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select p.id, p.text, p.note, u.email::text, p.created_at,
    array(select distinct l.label from private.assistant_configuration_labels as l
      join private.assistant_configurations as c on c.id = l.configuration_id
      where c.prompt_version_id = p.id order by l.label)
  from private.assistant_prompts as p
  left join auth.users as u on u.id = p.created_by
  order by p.id desc;
end;
$$;

-- Each plan's labelled assistant configurations, its 'active' one and its draft, with who saved
-- each and when, and when the label was set.
create function public.admin_assistant_configurations()
returns table (
  plan text, label text, configuration_id bigint, provider text, model text,
  prompt_version_id bigint, web_search boolean, max_searches integer, reasoning_effort text,
  created_at timestamptz, created_by_email text, set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.plan, l.label, c.id, c.provider, c.model, c.prompt_version_id, c.web_search,
    c.max_searches, c.reasoning_effort, c.created_at, u.email::text, l.set_at
  from private.assistant_configuration_labels as l
  join private.assistant_configurations as c on c.id = l.configuration_id
  left join auth.users as u on u.id = c.created_by
  order by array_position(array['free', 'pro', 'max', 'special'], l.plan), l.label;
end;
$$;

-- Applies [plan]'s assistant draft to everyone: it becomes 'active' and the draft is cleared,
-- recorded with the configuration before: 'activated'; 'no_test' without a draft and 'no_key'
-- while its provider has no key in Vault, recording nothing.
create function public.admin_activate_assistant_configuration(plan text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  draft private.assistant_configurations;
  before bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('private.assistant_configuration_labels', 8));
  select c.* into draft from private.assistant_configuration_labels as l
    join private.assistant_configurations as c on c.id = l.configuration_id
    where l.plan = admin_activate_assistant_configuration.plan and l.label = 'test';
  if not found then
    return 'no_test';
  end if;
  if not exists (select from private.provider_keys as k where k.provider = draft.provider) then
    return 'no_key';
  end if;
  select l.configuration_id into before from private.assistant_configuration_labels as l
    where l.plan = draft.plan and l.label = 'active';
  insert into private.assistant_configuration_labels (plan, label, configuration_id, set_by)
    values (draft.plan, 'active', draft.id, caller)
    on conflict on constraint assistant_configuration_labels_pkey do update
      set configuration_id = excluded.configuration_id, set_by = excluded.set_by, set_at = now();
  delete from private.assistant_configuration_labels as l
    where l.plan = draft.plan and l.label = 'test';
  perform private.audit('activate_assistant_configuration', 'plan', draft.plan,
    jsonb_build_object('configuration_id', draft.id, 'configuration_before', before));
  return 'activated';
end;
$$;

-- Ends [plan]'s assistant draft, recorded: true; false without a draft, recording nothing.
create function public.admin_clear_assistant_test(plan text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleared bigint;
begin
  perform private.require_admin();
  delete from private.assistant_configuration_labels as l
    where l.plan = admin_clear_assistant_test.plan and l.label = 'test'
    returning l.configuration_id into cleared;
  if cleared is null then
    return false;
  end if;
  perform private.audit('clear_assistant_test', 'plan', admin_clear_assistant_test.plan,
    jsonb_build_object('configuration_id', cleared));
  return true;
end;
$$;

-- Each plan's daily message limit, null for none, with who set it and when.
create function public.admin_assistant_limits()
returns table (plan text, daily_messages integer, set_by_email text, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select a.plan, a.daily_messages, u.email::text, a.set_at
  from private.assistant_limits as a
  left join auth.users as u on u.id = a.set_by
  order by array_position(array['free', 'pro', 'max', 'special'], a.plan);
end;
$$;

-- Sets [plan]'s daily message limit, null for none, and records it with the limit before: 'set';
-- 'unchanged' for the limit it has, 'bad_plan' for a plan that has none and 'bad_limit' outside 0
-- to 100,000, each recording nothing.
create function public.admin_set_assistant_limit(plan text, daily_messages integer) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  before private.assistant_limits;
begin
  select a.* into before from private.assistant_limits as a
    where a.plan = admin_set_assistant_limit.plan
    for update;
  if not found then
    return 'bad_plan';
  end if;
  if admin_set_assistant_limit.daily_messages not between 0 and 100000 then
    return 'bad_limit';
  end if;
  if before.daily_messages is not distinct from admin_set_assistant_limit.daily_messages then
    return 'unchanged';
  end if;
  update private.assistant_limits as a
    set daily_messages = admin_set_assistant_limit.daily_messages, set_by = caller, set_at = now()
    where a.plan = before.plan;
  perform private.audit('set_assistant_limit', 'plan', before.plan, jsonb_build_object(
    'daily_messages', admin_set_assistant_limit.daily_messages,
    'daily_messages_before', before.daily_messages));
  return 'set';
end;
$$;

revoke all on function public.admin_save_assistant_prompt(text, text),
  public.admin_assistant_prompts(), public.admin_assistant_configurations(),
  public.admin_activate_assistant_configuration(text), public.admin_clear_assistant_test(text),
  public.admin_assistant_limits(), public.admin_set_assistant_limit(text, integer)
  from public, anon;
grant execute on function public.admin_save_assistant_prompt(text, text),
  public.admin_assistant_prompts(), public.admin_assistant_configurations(),
  public.admin_activate_assistant_configuration(text), public.admin_clear_assistant_test(text),
  public.admin_assistant_limits(), public.admin_set_assistant_limit(text, integer)
  to authenticated;

-- The revert the header names: drops every function and table this migration created.
create function private.revert_assistant() returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  drop function public.admin_set_assistant_limit(text, integer);
  drop function public.admin_assistant_limits();
  drop function public.admin_clear_assistant_test(text);
  drop function public.admin_activate_assistant_configuration(text);
  drop function public.admin_assistant_configurations();
  drop function public.admin_assistant_prompts();
  drop function public.admin_save_assistant_prompt(text, text);
  drop function public.save_assistant_configuration(uuid, text, text, text, bigint, boolean,
    integer, text);
  drop function public.assistant_allowance();
  drop function public.finish_assistant_message(bigint, text, integer, integer, integer, integer,
    integer, integer);
  drop function public.begin_assistant_message(uuid);
  drop table private.assistant_messages;
  drop table private.assistant_limits;
  drop table private.assistant_configuration_labels;
  drop table private.assistant_configurations;
  drop table private.assistant_prompts;
  drop function private.seed_assistant_configurations();
  drop function private.keep_assistant_configuration();
  drop function private.assistant_effort_fits(text, text, text);
end;
$$;

revoke all on function private.keep_assistant_configuration(),
  private.assistant_effort_fits(text, text, text), private.revert_assistant()
  from public, anon, authenticated;
