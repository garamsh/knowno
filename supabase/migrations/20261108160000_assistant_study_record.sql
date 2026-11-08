-- 말랑이 reads the user's study record (#761, `assistant.md` §Tools): `public.assistant_study_record` answers,
-- from the caller's reviews and card states, each deck's cards by progress label, its cards due
-- and its answers and share answered "good" in a period, and the cards most often answered "again"
-- in it, with the columns the card tools read cards by.
--
-- Additive: it creates `public.mastered_interval()`, `public.assistant_study_record(...)` and the
-- revert, and changes no row and no existing object. The progress label's interval is held once
-- here, as `study_day_start_hour()` holds the study day's hour; `masteredInterval` in
-- `app/lib/study/src/overview.dart` and `masteredIntervalDays` in
-- `web/src/features/study/overview.ts` are its clients' copies.
--
-- Revert, run once against production before `private.revert_assistant()` if that is run too:
-- `select private.revert_assistant_study_record();`, then
-- `drop function private.revert_assistant_study_record();`.

-- The interval from which a reviewed card counts as mastered (익힘), as `masteredInterval` and
-- `masteredIntervalDays` declare it in the clients.
create function public.mastered_interval() returns interval
language sql
immutable
security invoker
set search_path = ''
as $$
  select interval '21 days'
$$;

-- The caller's study record over the last [period_days] days before [at], as one json object:
-- `decks`, the caller's live decks, oldest first, or the one [deck_id] names, each with its live
-- cards by progress (`new` without a card state, `learning` and `mastered` by the interval of its
-- state, its due time less its last review, against mastered_interval(), as the clients'
-- progressOf), `due`, the reviewed cards whose state falls due before the study day holding [at]
-- ends (the day running from study_day_start_hour() to the next in [time_zone], as the queue's
-- due rule), and `answers` and `known`, its cards' answers and those "good" in the period; and
-- `missed`, up to 50 live cards of those decks answered "again" in the period, most often first,
-- with the stored columns a card is read by. It reads the caller's rows alone and runs as the
-- caller, so row-level security decides what it reads, and a zone Postgres does not know raises.
create function public.assistant_study_record(
  deck_id uuid default null,
  period_days integer default 30,
  time_zone text default 'Asia/Seoul',
  at timestamptz default now()
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with bounds as (
    select assistant_study_record.at - make_interval(days => assistant_study_record.period_days)
        as since,
      ((date_trunc('day', (assistant_study_record.at at time zone
          assistant_study_record.time_zone) - make_interval(hours => public.study_day_start_hour()))
        + interval '1 day' + make_interval(hours => public.study_day_start_hour()))
        at time zone assistant_study_record.time_zone) as day_end
  ),
  mine as (
    select d.id, d.name, d.created_at
    from public.decks as d
    where d.user_id = (select auth.uid()) and d.deleted_at is null
      and (assistant_study_record.deck_id is null or d.id = assistant_study_record.deck_id)
  ),
  held as (
    select c.id, c.deck_id, c.front, c.back, c.template, c.template_version,
      s.due, s.last_review
    from public.cards as c
    join mine on mine.id = c.deck_id
    left join public.card_states as s on s.user_id = c.user_id and s.card_id = c.id
    where c.user_id = (select auth.uid()) and c.deleted_at is null
  ),
  answered as (
    select h.id, h.deck_id, count(*) as answers,
      count(*) filter (where r.rating = 'good') as known,
      count(*) filter (where r.rating = 'again') as missed
    from held as h
    join public.reviews as r on r.user_id = (select auth.uid()) and r.card_id = h.id
    join bounds on r.reviewed_at >= bounds.since and r.reviewed_at <= assistant_study_record.at
    group by h.id, h.deck_id
  )
  select jsonb_build_object(
    'decks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', mine.id,
        'name', mine.name,
        'new', (select count(*) from held as h where h.deck_id = mine.id and h.due is null),
        'learning', (select count(*) from held as h where h.deck_id = mine.id
          and h.due is not null and h.due - h.last_review < public.mastered_interval()),
        'mastered', (select count(*) from held as h where h.deck_id = mine.id
          and h.due - h.last_review >= public.mastered_interval()),
        'due', (select count(*) from held as h, bounds
          where h.deck_id = mine.id and h.due < bounds.day_end),
        'answers', (select coalesce(sum(a.answers), 0) from answered as a
          where a.deck_id = mine.id),
        'known', (select coalesce(sum(a.known), 0) from answered as a
          where a.deck_id = mine.id)
      ) order by mine.created_at, mine.id), '[]'::jsonb)
      from mine),
    'missed', (
      select coalesce(jsonb_agg(m.card order by m.misses desc, m.id), '[]'::jsonb)
      from (
        select h.id, a.missed as misses, jsonb_build_object(
          'id', h.id, 'deck_id', h.deck_id, 'misses', a.missed, 'answers', a.answers,
          'front', h.front, 'back', h.back, 'template', h.template,
          'template_version', h.template_version) as card
        from answered as a
        join held as h on h.id = a.id
        where a.missed > 0
        order by a.missed desc, h.id
        limit 50
      ) as m)
  );
$$;

revoke all on function public.mastered_interval(),
  public.assistant_study_record(uuid, integer, text, timestamptz)
  from public, anon;
grant execute on function public.mastered_interval(),
  public.assistant_study_record(uuid, integer, text, timestamptz)
  to authenticated;

-- The revert in the header.
create function private.revert_assistant_study_record() returns void
language plpgsql
set search_path = ''
as $revert$
begin
  drop function public.assistant_study_record(uuid, integer, text, timestamptz);
  drop function public.mastered_interval();
end;
$revert$;

revoke all on function private.revert_assistant_study_record() from public, anon, authenticated;
