-- The reads the admin area's five sections need beyond the existing ones (#589, ADR 0155): the notes
-- in three views, a week's activity against the week before, when each prompt label was set, and
-- one prompt version's recorded calls. Additive: it creates four functions, each checking the role
-- as private.require_admin does for every admin read, and changes no row or existing object.

-- The public live notes of [view], each with its owner, live cards, copies and reports, whose name
-- or owner's email holds [search] ignoring case:
-- - 'reported': those others can still see, not hidden, with a report, the oldest first report first;
-- - 'public': every one, newest published first;
-- - 'hidden': those hidden, the most reported first.
-- Any other view raises invalid_parameter_value.
create function public.admin_note_list(view text, search text default '')
returns table (
  deck_id uuid,
  name text,
  owner_id uuid,
  owner_email text,
  owner_name text,
  hidden boolean,
  cards bigint,
  copy_count integer,
  reports bigint,
  reasons text[],
  first_reported_at timestamptz,
  published_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  if admin_note_list.view is null or admin_note_list.view not in ('reported', 'public', 'hidden') then
    raise exception 'admin_note_list: unknown view %', admin_note_list.view
      using errcode = 'invalid_parameter_value';
  end if;
  return query
  select d.id, d.name, d.user_id, u.email::text, p.display_name, d.hidden,
    (select count(*) from public.cards as c
      where c.user_id = d.user_id and c.deck_id = d.id and c.deleted_at is null),
    d.copy_count, r.total, coalesce(r.given, '{}'::text[]), r.first_at, d.published_at
  from public.decks as d
  join auth.users as u on u.id = d.user_id
  left join public.profiles as p on p.user_id = d.user_id
  cross join lateral (
    select count(*) as total, array_agg(distinct x.reason order by x.reason) as given,
      min(x.created_at) as first_at
    from public.deck_reports as x
    where x.deck_id = d.id
  ) as r
  where d.visibility = 'public' and d.deleted_at is null
    and case admin_note_list.view
      when 'reported' then not d.hidden and r.total > 0
      when 'hidden' then d.hidden
      else true
    end
    and (coalesce(admin_note_list.search, '') = ''
      or strpos(lower(d.name), lower(admin_note_list.search)) > 0
      or strpos(lower(u.email::text), lower(admin_note_list.search)) > 0)
  order by
    case when admin_note_list.view = 'reported' then r.first_at end,
    case when admin_note_list.view = 'hidden' then r.total end desc,
    d.published_at desc, d.id;
end;
$$;

revoke all on function public.admin_note_list(text, text) from public, anon;
grant execute on function public.admin_note_list(text, text) to authenticated;

-- The last 7 study days, today's included, and the 7 before, each study day from
-- study_day_start_hour() in [time_zone]: the users who signed up in each, and the users who
-- answered a card on each study day, summed over the 7 (a user counted once a day). An unknown
-- zone raises.
create function public.admin_week_activity(time_zone text)
returns table (
  new_users_this bigint,
  new_users_last bigint,
  studied_this bigint,
  studied_last bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  shift interval;
  today date;
  this_start timestamptz;
  last_start timestamptz;
begin
  perform private.require_admin();
  shift := make_interval(hours => public.study_day_start_hour());
  today := ((now() at time zone admin_week_activity.time_zone) - shift)::date;
  this_start := ((today - 6)::timestamp + shift) at time zone admin_week_activity.time_zone;
  last_start := ((today - 13)::timestamp + shift) at time zone admin_week_activity.time_zone;
  return query
  select
    (select count(*) from auth.users as u
      where not u.is_anonymous and u.created_at >= this_start),
    (select count(*) from auth.users as u
      where not u.is_anonymous and u.created_at >= last_start and u.created_at < this_start),
    (select count(*) from (
      select distinct r.user_id,
        ((r.reviewed_at at time zone admin_week_activity.time_zone) - shift)::date as study_day
      from public.reviews as r
      where r.reviewed_at >= this_start
    ) as days),
    (select count(*) from (
      select distinct r.user_id,
        ((r.reviewed_at at time zone admin_week_activity.time_zone) - shift)::date as study_day
      from public.reviews as r
      where r.reviewed_at >= last_start and r.reviewed_at < this_start
    ) as days);
end;
$$;

revoke all on function public.admin_week_activity(text) from public, anon;
grant execute on function public.admin_week_activity(text) to authenticated;

-- Each prompt label that is set, with its version and when it was set (ADR 0073).
create function public.admin_prompt_labels()
returns table (label text, version_id bigint, set_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select l.label, l.version_id, l.set_at from private.prompt_labels as l order by l.label;
end;
$$;

revoke all on function public.admin_prompt_labels() from public, anon;
grant execute on function public.admin_prompt_labels() to authenticated;

-- The recorded calls prompt version [version_id] served, newest first, a page of [page_size] (1 to
-- 500) before the usage id [before], as admin_extraction_calls reads every version's, without the
-- user each served.
create function public.admin_version_calls(
  version_id bigint, before bigint default null, page_size integer default 50
)
returns table (
  usage_id bigint,
  created_at timestamptz,
  plan text,
  model text,
  outcome text,
  attempts smallint,
  latency_ms integer,
  cards_returned integer,
  cards_dropped integer,
  failures text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_admin();
  return query
  select c.usage_id, u.created_at, c.plan, c.model, c.outcome, c.attempts, c.latency_ms,
    c.cards_returned, c.cards_dropped, c.failures
  from private.extraction_calls as c
  join public.extraction_usage as u on u.id = c.usage_id
  where c.prompt_version_id = admin_version_calls.version_id
    and (admin_version_calls.before is null or c.usage_id < admin_version_calls.before)
  order by c.usage_id desc
  limit least(greatest(admin_version_calls.page_size, 1), 500);
end;
$$;

revoke all on function public.admin_version_calls(bigint, bigint, integer) from public, anon;
grant execute on function public.admin_version_calls(bigint, bigint, integer) to authenticated;
