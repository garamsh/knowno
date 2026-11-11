# Server study reads

The study functions the database serves: each user's study settings, the study day's start, the streak, the study days, the record the web reads and the study record the assistant reads.

## Current decisions

### Study settings

- `public.study_settings` holds a user's daily study minutes: `user_id`, the key, referencing `auth.users` with `on delete cascade`; `daily_minutes`, checked to 5 to 180; and `updated_at`, when the user last set them, on whichever client ([ADR 0085](adr/0085-fill-each-day-s-new-cards-from-the-daily-study-minutes-the-user-sets-stored-per-user-on-the-server-and-synced.md)). A user without a row studies the default, 20 minutes.
- Row-level security lets a user select its own row alone; no client role may insert, update or delete it. `public.save_study_settings(daily_minutes, updated_at)`, `security definer`, executable by `authenticated` and not `anon`, stores the caller's row where the stored one is older or absent, and answers whether it did, so an older push from another device never overwrites a later edit.
- The phone pulls the row whole on every sync run and pushes it through the function ([`sync.md`](sync.md)); the web reads it with `readToday` and saves it through the same function ([`web-study.md`](web-study.md)).
- Migration `20261019230004_study_settings.sql` creates the table, its policy and the function, and changes no row.

### Study day start

- `public.study_day_start_hour()` returns 4, the hour a study day starts at in local time, `studyDayStartHour` of `app/lib/study/src/queue.dart` and `web/src/features/study/queue.ts`. `study_streak_before`, `study_days_before` and `study_record_days` start each study day there, so the server holds the hour once (issue #220).
- `web/src/features/study/__tests__/rules.test.ts` fails when the hour the latest migration defining the function returns differs from `queue.ts`'s, and `study_day_start_test.sql` when one of the three functions does not follow a change of it.
- It is `immutable`, `security invoker`, and sets `search_path = ''`. `execute` is revoked from `public` and `anon` and granted to `authenticated`, which calls the three functions.
- Migration `20261019180001_study_day_start.sql` added it and replaced the three functions with the same results, changing no row.

### Streak

- `public.study_streak_before(time_zone, before)` returns how many study days in a row before the one holding `before` hold one of the caller's answers, with days from 04:00 to 04:00 in the zone named, as `web/src/features/study/queue.ts` counts them, starting at `study_day_start_hour()` ([ADR 0034](adr/0034-key-synced-rows-by-client-made-uuids-purge-tombstones-past-a-revision-horizon-and-index-each-query.md) §4). The web's `readToday` calls it ([`web-study.md`](web-study.md)).
- It walks back one day at a time from local 04:00 to local 04:00, so a day across a change of offset keeps both ends, and stops at the first day without an answer. Each day is one backward probe of `reviews_user_id_reviewed_at` for its latest answer.
- It is `security invoker`, so row-level security decides what it reads, `stable`, and sets `search_path = ''`. `execute` is revoked from `public` and `anon` and granted to `authenticated`. A zone Postgres does not know raises `22023`.
- Migration `20261017090000_study_streak.sql` added it, changing no row.

### Study days

- `public.study_days_before(time_zone, before, days, cap_ms)` returns the caller's latest `days` study days before `before`, oldest first, each from 04:00 to 04:00 in the zone named, as `web/src/features/study/queue.ts` counts them, starting at `study_day_start_hour()`: its start, and the time and number of the answers that were not their card's first answer and of those that were, each answer counted up to `cap_ms` ([ADR 0043](adr/0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md)). The web's `readToday` calls it with 30 days and 30 s ([`web-study.md`](web-study.md)).
- A day without an answer is no study day, so it is neither returned nor counted. The function walks back one study day at a time, each step one backward probe of `reviews_user_id_reviewed_at`, then reads the window's answers through the same index; whether an answer is its card's first is one probe of `reviews_user_id_card_id`.
- It is `security invoker`, `stable`, and sets `search_path = ''`. `execute` is revoked from `public` and `anon` and granted to `authenticated`. A zone Postgres does not know raises `22023`.
- Migration `20261018090000_study_days.sql` added it, changing no row.

### Record

- `public.study_record_days(time_zone, before)` returns one row per study day before `before` holding one of the caller's answers, oldest first, each from 04:00 to 04:00 in the zone named, starting at `study_day_start_hour()`: its start, the distinct cards answered, its scheduled reviews and those answered "good" ([ADR 0037](adr/0037-define-the-record-tab-s-retention-recall-bands-mastered-weeks-and-study-days-and-compute-them-on-the-device.md), [ADR 0047](adr/0047-read-the-web-record-through-two-server-functions-and-fold-it-through-the-engine-on-the-server.md)). A review is scheduled when it is its card's first answer of the day and the card has an answer on an earlier day. Every answer counts, whether or not its card is live. It reads the caller's answers through `reviews_user_id_reviewed_at`.
- `public.study_record_cards()` returns one row per live card of a live deck of the caller's with an answer: its state or nulls, and its answers' ratings, times and fuzz factors, oldest first. A card's answers are read through `reviews_user_id_card_id`; the cards are the whole library, as the web's library read scans them.
- Both are `security invoker`, `stable`, and set `search_path = ''`. `execute` is revoked from `public` and `anon` and granted to `authenticated`. A zone Postgres does not know raises `22023`. The web's `/record` page calls both ([`web-study.md`](web-study.md)).
- Migration `20261018090001_study_record.sql` added them, changing no row.

### Study record read

- `public.assistant_study_record(deck_id, period_days, time_zone, at)` ([`assistant.md`](assistant.md) §Tools, `read_study_record`, #761) answers the caller's study record as one json object, from `decks`, `cards`, `card_states` and `reviews` read as the caller and filtered to the caller's own rows, since a public deck of another user is readable by row-level security: `decks`, the live decks (the one `deck_id` names, when given), oldest first, each with its live cards `new` (no card state), `learning` and `mastered`, `due`, and `answers` and `known` within the period; and `missed`, up to 50 live cards of those decks answered "again" in it, most often first, each with its `misses`, its `answers` and the stored `front`, `back`, `template` and `template_version` a card is read by. It is `security invoker`, `stable`, with `search_path = ''`; `execute` is revoked from `public` and `anon` and granted to `authenticated`. `time_zone` is `Asia/Seoul` unless given and `at` is now unless given; the assistant passes the zone its message's `context.time_zone` names, checked as an IANA name before the call, and Asia/Seoul when it names none or one the runtime or this function does not know (SQLSTATE `22023`), and never `at`. The study settings hold no zone, and the daily budget's day is Asia/Seoul's.
- **The rules, held once.** A card is mastered when its state's due time less its last review is at least `public.mastered_interval()`, 21 days, `masteredInterval` of `app/lib/study/src/overview.dart` and `masteredIntervalDays` of `web/src/features/study/overview.ts`, learning when it has a state below that, and new without one; a reviewed card is due when its due time is before the end of the study day holding `at`, the day running from `study_day_start_hour()` to the next in the zone, as the queue's due rule. A period counts the answers from `at` less `period_days` days, that instant included.
- Nothing yet compares `mastered_interval()` with the clients' constants: `rules.test.ts` compares the queue's constants and the study day's hour alone.
- Migration `20261108160000_assistant_study_record.sql` creates the two functions and changes no row and no existing object. **Revert:** `select private.revert_assistant_study_record();` and then `drop function private.revert_assistant_study_record();`, run once by the PM against production, drop both functions.

## Rationale

- [ADR 0043](adr/0043-set-each-day-s-new-cards-from-the-user-s-recency-weighted-study-time-and-pace-and-count-an-answer-s-time-only-in-the-foreground.md) records why the web reads a day's study days through `study_days_before`.
- [ADR 0047](adr/0047-read-the-web-record-through-two-server-functions-and-fold-it-through-the-engine-on-the-server.md) records why the web's 기록 reads through `study_record_days` and `study_record_cards`, and folds the cards through the engine on the server.

## Open questions

- None.
