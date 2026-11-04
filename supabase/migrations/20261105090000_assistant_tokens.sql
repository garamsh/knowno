-- The assistant metered by tokens (#748, ADR 0195): each plan's daily token budget replaces its
-- daily message limit. A message starts only while the day's tokens charged are under the budget
-- and no other message of the user is running; it is charged its input and output tokens, the
-- output including reasoning, when it ends, under the user's assistant lock.
--
-- Changes no row of an existing table. It creates `private.assistant_token_budgets`, seeded with
-- the budgets the owner approved on 2026-11-05: 200,000 tokens a day for Free, 2,000,000 for Pro,
-- 6,000,000 for Max and none for 스페셜. It replaces `begin_assistant_message`,
-- `finish_assistant_message` and `assistant_allowance`, and replaces the admin functions of the
-- message limit, `admin_assistant_limits` and `admin_set_assistant_limit`, with those of the
-- budget. `private.assistant_limits` stays, read by nothing but the revert. It also lets
-- `service_role` ask `public.assistant_effort_fits` whether a model runs at an effort.
--
-- Revert, run once against production before `private.revert_assistant()` if that is run too:
-- `select private.revert_assistant_tokens();`, then `drop function private.revert_assistant_tokens();`.
-- It puts the five functions back as `20261104150000_assistant.sql` made them and drops the budget
-- table and its functions; the message rows and the limits are untouched.

-- Each plan's daily token budget, a day in Asia/Seoul; null is no budget. Who set it and when.
create table private.assistant_token_budgets (
  plan text primary key check (plan in ('free', 'pro', 'max', 'special')),
  daily_tokens bigint check (daily_tokens between 0 and 1000000000),
  set_by uuid references auth.users on delete set null,
  set_at timestamptz not null default now()
);

create index assistant_token_budgets_set_by on private.assistant_token_budgets (set_by);

alter table private.assistant_token_budgets enable row level security;
revoke all on private.assistant_token_budgets from public, anon, authenticated, service_role;

insert into private.assistant_token_budgets (plan, daily_tokens) values
  ('free', 200000), ('pro', 2000000), ('max', 6000000), ('special', null);

-- The tokens charged to [user_id] today in Asia/Seoul: each recorded message's input and output
-- tokens, the output including reasoning. A message not yet recorded is charged nothing.
create function private.assistant_tokens_today(user_id uuid) returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.input_tokens::bigint + m.output_tokens), 0)::bigint
  from private.assistant_messages as m
  where m.user_id = assistant_tokens_today.user_id
    and m.created_at >= date_trunc('day', now(), 'Asia/Seoul');
$$;

revoke all on function private.assistant_tokens_today(uuid) from public, anon, authenticated;

drop function public.begin_assistant_message(uuid);

-- Resolves [user_id]'s plan and the assistant configuration serving it, with its provider, model,
-- prompt and settings: an admin's plan's draft while one is set, and otherwise the active one.
-- `available` is whether that provider has a key in Vault; `tokens_used` the tokens charged today;
-- `busy` whether another message of the user, begun within 150 s, is not recorded yet. Only an
-- available message under the plan's budget, or with none, and not busy, is recorded, under the
-- user's assistant lock. No row while the plan has no configuration or no budget row.
create function public.begin_assistant_message(user_id uuid)
returns table (
  plan text, configuration_id bigint, provider text, model text, prompt_version_id bigint,
  prompt text, web_search boolean, max_searches integer, reasoning_effort text,
  available boolean, token_budget bigint, tokens_used bigint, busy boolean, allowed boolean,
  message_id bigint
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
  budget bigint;
  usable boolean;
  charged bigint;
  running boolean;
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
  select b.daily_tokens into budget from private.assistant_token_budgets as b
    where b.plan = entitled;
  if not found then
    return;
  end if;
  select v.text into instructions from private.assistant_prompts as v
    where v.id = config.prompt_version_id;
  usable := exists (select from private.provider_keys as k where k.provider = config.provider);
  charged := private.assistant_tokens_today(begin_assistant_message.user_id);
  -- 150 s is past the turn's 120 s and its record: a message older than that and not recorded
  -- ended without one, and holds no one back.
  running := exists (select from private.assistant_messages as m
    where m.user_id = begin_assistant_message.user_id and m.outcome is null
      and m.created_at > now() - interval '150 seconds');
  permitted := usable and (budget is null or charged < budget) and not running;
  if permitted then
    insert into private.assistant_messages (user_id, plan, configuration_id)
      values (begin_assistant_message.user_id, entitled, config.id)
      returning id into message;
  end if;
  return query select entitled, config.id, config.provider, config.model,
    config.prompt_version_id, instructions, config.web_search, config.max_searches,
    config.reasoning_effort, usable, budget, charged, running, permitted, message;
end;
$$;

-- Records how [message_id]'s turn ended and what it used, once, under its user's assistant lock,
-- which charges it: a message already recorded or never begun raises P0002.
create or replace function public.finish_assistant_message(
  message_id bigint, outcome text, model_calls integer, input_tokens integer,
  output_tokens integer, reasoning_tokens integer, web_search_requests integer, latency_ms integer
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select m.user_id into owner from private.assistant_messages as m
    where m.id = finish_assistant_message.message_id;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(owner::text, 7));
  end if;
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

revoke all on function public.begin_assistant_message(uuid) from public, anon, authenticated;
grant execute on function public.begin_assistant_message(uuid) to service_role;

drop function public.assistant_allowance();

-- The caller's daily token budget, null when none applies, the tokens charged today in
-- Asia/Seoul, as begin_assistant_message counts them, and those left, null without a budget,
-- naming no plan. No row without a plan.
create function public.assistant_allowance()
returns table (token_budget bigint, tokens_used bigint, tokens_left bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitled text;
  charged bigint;
begin
  select e.plan into entitled from private.entitlement_of((select auth.uid())) as e;
  if not found then
    return;
  end if;
  charged := private.assistant_tokens_today((select auth.uid()));
  return query
  select b.daily_tokens, charged, b.daily_tokens - least(charged, b.daily_tokens)
  from private.assistant_token_budgets as b
  where b.plan = entitled;
end;
$$;

revoke all on function public.assistant_allowance() from public, anon;
grant execute on function public.assistant_allowance() to authenticated;

drop function public.admin_set_assistant_limit(text, integer);
drop function public.admin_assistant_limits();

-- Each plan's daily token budget, null for none, with who set it and when.
create function public.admin_assistant_token_budgets()
returns table (plan text, daily_tokens bigint, set_by_email text, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select b.plan, b.daily_tokens, u.email::text, b.set_at
  from private.assistant_token_budgets as b
  left join auth.users as u on u.id = b.set_by
  order by array_position(array['free', 'pro', 'max', 'special'], b.plan);
end;
$$;

-- Sets [plan]'s daily token budget, null for none, and records it with the budget before: 'set';
-- 'unchanged' for the budget it has, 'bad_plan' for a plan that has none and 'bad_budget' outside
-- 0 to 1,000,000,000, each recording nothing.
create function public.admin_set_assistant_token_budget(plan text, daily_tokens bigint)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := private.require_admin();
  before private.assistant_token_budgets;
begin
  select b.* into before from private.assistant_token_budgets as b
    where b.plan = admin_set_assistant_token_budget.plan
    for update;
  if not found then
    return 'bad_plan';
  end if;
  if admin_set_assistant_token_budget.daily_tokens not between 0 and 1000000000 then
    return 'bad_budget';
  end if;
  if before.daily_tokens is not distinct from admin_set_assistant_token_budget.daily_tokens then
    return 'unchanged';
  end if;
  update private.assistant_token_budgets as b
    set daily_tokens = admin_set_assistant_token_budget.daily_tokens, set_by = caller,
      set_at = now()
    where b.plan = before.plan;
  perform private.audit('set_assistant_token_budget', 'plan', before.plan, jsonb_build_object(
    'daily_tokens', admin_set_assistant_token_budget.daily_tokens,
    'daily_tokens_before', before.daily_tokens));
  return 'set';
end;
$$;

revoke all on function public.admin_assistant_token_budgets(),
  public.admin_set_assistant_token_budget(text, bigint)
  from public, anon;
grant execute on function public.admin_assistant_token_budgets(),
  public.admin_set_assistant_token_budget(text, bigint)
  to authenticated;

-- Whether [model] of [provider] can run at [effort], as `private.assistant_effort_fits` holds a
-- configuration to it: the assistant function asks it before a draft's check call, to name the
-- refusal.
create function public.assistant_effort_fits(provider text, model text, effort text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.assistant_effort_fits(assistant_effort_fits.provider, assistant_effort_fits.model,
    assistant_effort_fits.effort);
$$;

revoke all on function public.assistant_effort_fits(text, text, text)
  from public, anon, authenticated;
grant execute on function public.assistant_effort_fits(text, text, text) to service_role;

-- The revert the header names: puts the message limit's functions back as
-- `20261104150000_assistant.sql` made them, and drops what this migration made.
create function private.revert_assistant_tokens() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  drop function public.assistant_effort_fits(text, text, text);
  drop function public.admin_set_assistant_token_budget(text, bigint);
  drop function public.admin_assistant_token_budgets();
  drop function public.assistant_allowance();
  drop function public.begin_assistant_message(uuid);

  execute $sql$
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

    create or replace function public.finish_assistant_message(
      message_id bigint, outcome text, model_calls integer, input_tokens integer,
      output_tokens integer, reasoning_tokens integer, web_search_requests integer,
      latency_ms integer
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

    revoke all on function public.begin_assistant_message(uuid) from public, anon, authenticated;
    grant execute on function public.begin_assistant_message(uuid) to service_role;

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

    create function public.admin_set_assistant_limit(plan text, daily_messages integer)
    returns text
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
        set daily_messages = admin_set_assistant_limit.daily_messages, set_by = caller,
          set_at = now()
        where a.plan = before.plan;
      perform private.audit('set_assistant_limit', 'plan', before.plan, jsonb_build_object(
        'daily_messages', admin_set_assistant_limit.daily_messages,
        'daily_messages_before', before.daily_messages));
      return 'set';
    end;
    $$;

    revoke all on function public.admin_assistant_limits(),
      public.admin_set_assistant_limit(text, integer) from public, anon;
    grant execute on function public.admin_assistant_limits(),
      public.admin_set_assistant_limit(text, integer) to authenticated;
  $sql$;

  drop function private.assistant_tokens_today(uuid);
  drop table private.assistant_token_budgets;
end;
$revert$;

revoke all on function private.revert_assistant_tokens() from public, anon, authenticated;
