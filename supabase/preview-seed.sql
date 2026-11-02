-- Synthetic data the migration preview loads between main's migrations and a pull request's
-- (scripts/migration-preview.sh): rows in every table of public and private that the migrations
-- leave empty, in each state the schema distinguishes. Every user is fictional, at example.com.
-- supabase/seed.sql stays empty, since every `supabase start` loads it and the database tests'
-- fixtures assume no rows.

insert into auth.users (id, email, created_at, banned_until) values
  ('5eed0000-0000-4000-8000-0000000000a1', 'seed-learner@example.com', now() - interval '60 days', null),
  ('5eed0000-0000-4000-8000-0000000000a2', 'seed-sharer@example.com', now() - interval '45 days', null),
  ('5eed0000-0000-4000-8000-0000000000a3', 'seed-admin@example.com', now() - interval '90 days', null),
  ('5eed0000-0000-4000-8000-0000000000a4', 'seed-suspended@example.com', now() - interval '10 days', 'infinity');

insert into public.profiles (user_id, display_name) values
  ('5eed0000-0000-4000-8000-0000000000a1', 'Seed Learner'),
  ('5eed0000-0000-4000-8000-0000000000a2', 'Seed Sharer'),
  ('5eed0000-0000-4000-8000-0000000000a4', 'Seed Suspended');

insert into public.study_settings (user_id, daily_minutes, updated_at) values
  ('5eed0000-0000-4000-8000-0000000000a1', 20, now() - interval '30 days'),
  ('5eed0000-0000-4000-8000-0000000000a2', 45, now() - interval '5 days');

insert into public.media (user_id, id, kind, mime_type, byte_size, sha256) values
  ('5eed0000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000e1', 'image', 'image/jpeg', 182344,
   repeat('a1', 32)),
  ('5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000e2', 'image', 'image/jpeg', 95021,
   repeat('b2', 32));

-- A private deck, a deck deleted as a tombstone, a public deck with an image, a public deck later
-- removed from sharing, and the learner's copy of the public one.
insert into public.decks (id, user_id, name, created_at, updated_at, deleted_at, visibility, published_at,
                          description, icon, color, image_media_id) values
  ('5eed0000-0000-4000-8000-0000000000d1', '5eed0000-0000-4000-8000-0000000000a1', '영단어', now() - interval '50 days',
   now() - interval '2 days', null, 'private', null, null, 'book', 'blue', null),
  ('5eed0000-0000-4000-8000-0000000000d2', '5eed0000-0000-4000-8000-0000000000a1', '지난 학기', now() - interval '40 days',
   now() - interval '20 days', now() - interval '20 days', 'private', null, null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000d3', '5eed0000-0000-4000-8000-0000000000a2', '광합성', now() - interval '30 days',
   now() - interval '3 days', null, 'public', now() - interval '25 days', '생물 1단원', 'leaf', 'green',
   '5eed0000-0000-4000-8000-0000000000e1'),
  ('5eed0000-0000-4000-8000-0000000000d4', '5eed0000-0000-4000-8000-0000000000a4', 'Removed deck', now() - interval '9 days',
   now() - interval '8 days', null, 'private', now() - interval '9 days', null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000d5', '5eed0000-0000-4000-8000-0000000000a1', '광합성', now() - interval '12 days',
   now() - interval '12 days', null, 'private', null, null, 'leaf', 'green', null);

-- One card of each block type, a templated card, an imported card, a copy, and a tombstone.
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at, deleted_at,
                          origin_deck_id, template, template_version) values
  ('5eed0000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000d1',
   '[{"type":"text","v":1,"payload":{"text":"apple"}}]',
   '[{"type":"senses","v":1,"payload":{"senses":[{"labels":[{"kind":"part_of_speech","text":"명","category":"noun"}],"meaning":"사과","examples":[]}]}}]',
   'apple', 'manual', now() - interval '50 days', now() - interval '2 days', null, null, 'flip', 1),
  ('5eed0000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000d1',
   '[{"type":"text","v":1,"payload":{"text":"run"}}]',
   '[{"type":"text","v":1,"payload":{"text":"[동] 달리다"}}]',
   'run', 'import', now() - interval '49 days', now() - interval '49 days', null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000c3', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000d1',
   '[{"type":"text","v":1,"payload":{"text":"walk"}}]', '[]',
   'walk', 'manual', now() - interval '48 days', now() - interval '30 days', now() - interval '30 days', null, null, null),
  ('5eed0000-0000-4000-8000-0000000000c4', '5eed0000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000d3',
   '[{"type":"cloze","v":1,"payload":{"text":"광합성은 ___ 에너지로 포도당을 만든다","answers":["빛"]}}]',
   '[{"type":"text","v":1,"payload":{"text":"광합성은 빛 에너지로 포도당을 만든다"}}]',
   '광합성은 ___ 에너지로 포도당을 만든다', 'manual', now() - interval '29 days', now() - interval '3 days', null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000c5', '5eed0000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000d3',
   '[{"type":"text","v":1,"payload":{"text":"엽록체"}},{"type":"table","v":1,"payload":{"columns":["기관","역할"],"rows":[["엽록체","광합성"],["미토콘드리아","호흡"]],"blanks":[{"row":0,"column":1}]}}]',
   '[{"type":"text","v":1,"payload":{"text":"엽록체: 광합성"}}]',
   '엽록체', 'import', now() - interval '28 days', now() - interval '28 days', null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000c6', '5eed0000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000d3',
   '[{"type":"image","v":1,"id":"i1","payload":{"media":"5eed0000-0000-4000-8000-0000000000e1","width":4,"height":3,"boxes":[{"id":"b1","x":0.1,"y":0.2,"w":0.3,"h":0.1,"answer":"잎"}]}}]',
   '[]', 'leaf photo', 'manual', now() - interval '27 days', now() - interval '27 days', null, null, 'free', 1),
  ('5eed0000-0000-4000-8000-0000000000c7', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000d5',
   '[{"type":"cloze","v":1,"payload":{"text":"광합성은 ___ 에너지로 포도당을 만든다","answers":["빛"]}}]',
   '[{"type":"text","v":1,"payload":{"text":"광합성은 빛 에너지로 포도당을 만든다"}}]',
   '광합성은 ___ 에너지로 포도당을 만든다', 'copy', now() - interval '12 days', now() - interval '12 days', null,
   '5eed0000-0000-4000-8000-0000000000d3', null, null),
  ('5eed0000-0000-4000-8000-0000000000c8', '5eed0000-0000-4000-8000-0000000000a4', '5eed0000-0000-4000-8000-0000000000d4',
   '[{"type":"text","v":1,"payload":{"text":"spam"}}]', '[{"type":"text","v":1,"payload":{"text":"spam"}}]',
   'spam', 'manual', now() - interval '9 days', now() - interval '9 days', null, null, null, null);

insert into public.reviews (id, user_id, card_id, rating, reviewed_at, duration_ms, updated_at, fuzz_factor) values
  ('5eed0000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c1',
   'again', now() - interval '10 days', 8200, now() - interval '10 days', null),
  ('5eed0000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c1',
   'good', now() - interval '9 days', 4100, now() - interval '9 days', 0.42),
  ('5eed0000-0000-4000-8000-0000000000f3', '5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c7',
   'good', now() - interval '1 day', 6500, now() - interval '1 day', 0.17);

insert into public.card_states (user_id, card_id, stability, difficulty, last_review, due, updated_at) values
  ('5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c1', 3.2, 5.1,
   now() - interval '9 days', now() - interval '6 days', now() - interval '9 days'),
  ('5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c7', 2.3, 4.9,
   now() - interval '1 day', now() + interval '1 day', now() - interval '1 day');

insert into public.deck_copies (deck_id, user_id, created_at) values
  ('5eed0000-0000-4000-8000-0000000000d3', '5eed0000-0000-4000-8000-0000000000a1', now() - interval '12 days');
update public.decks set copy_count = 1 where id = '5eed0000-0000-4000-8000-0000000000d3';

insert into public.deck_reports (deck_id, reporter_id, reason) values
  ('5eed0000-0000-4000-8000-0000000000d4', '5eed0000-0000-4000-8000-0000000000a1', 'spam');

insert into public.user_blocks (blocker_id, blocked_id) values
  ('5eed0000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000a4');

insert into private.admins (user_id, granted_by) values ('5eed0000-0000-4000-8000-0000000000a3', null);

insert into private.suspensions (user_id, reason, suspended_by) values
  ('5eed0000-0000-4000-8000-0000000000a4', 'Posted spam decks', '5eed0000-0000-4000-8000-0000000000a3');

insert into private.deck_removals (deck_id, reason, removed_by) values
  ('5eed0000-0000-4000-8000-0000000000d4', 'Spam', '5eed0000-0000-4000-8000-0000000000a3');

insert into private.admin_audit (admin_id, admin_email, action, target_kind, target_id, detail) values
  ('5eed0000-0000-4000-8000-0000000000a3', 'seed-admin@example.com', 'suspend_user', 'user',
   '5eed0000-0000-4000-8000-0000000000a4', '{"reason":"Posted spam decks"}'),
  ('5eed0000-0000-4000-8000-0000000000a3', 'seed-admin@example.com', 'remove_deck', 'deck',
   '5eed0000-0000-4000-8000-0000000000d4', '{"reason":"Spam"}');

-- A Pro grant on the current version and an ended Max grant, with the grants' backup.
insert into private.user_plans (user_id, plan, ends_at, granted_by, version_id)
select '5eed0000-0000-4000-8000-0000000000a2', 'pro', null, '5eed0000-0000-4000-8000-0000000000a3', max(id)
from private.plan_versions where plan = 'pro';
insert into private.user_plans (user_id, plan, ends_at, granted_by, version_id)
select '5eed0000-0000-4000-8000-0000000000a1', 'max', now() - interval '3 days', '5eed0000-0000-4000-8000-0000000000a3', max(id)
from private.plan_versions where plan = 'max';
insert into private.user_plans_before_versions (user_id, plan, ends_at, granted_by, granted_at) values
  ('5eed0000-0000-4000-8000-0000000000a2', 'pro', null, '5eed0000-0000-4000-8000-0000000000a3', now() - interval '20 days');

-- Three photos, each recorded with the plan, model and prompt version that served it.
with usage as (
  insert into public.extraction_usage (user_id, created_at) values
    ('5eed0000-0000-4000-8000-0000000000a2', now() - interval '3 days'),
    ('5eed0000-0000-4000-8000-0000000000a2', now() - interval '1 day'),
    ('5eed0000-0000-4000-8000-0000000000a1', now() - interval '2 hours')
  returning id, user_id
)
insert into private.extraction_calls (usage_id, plan, model, prompt_version_id)
select usage.id, case when usage.user_id = '5eed0000-0000-4000-8000-0000000000a2' then 'pro' else 'free' end,
  'anthropic/claude-haiku-5.5', (select version_id from private.prompt_labels where label = 'active')
from usage;
insert into private.extraction_calls_before_versions (usage_id)
select min(usage_id) from private.extraction_calls;
insert into private.extraction_cursors (token, usage_id, expires_at)
select '5eed0000-0000-4000-8000-0000000000e1', max(usage_id), now() + interval '10 minutes'
from private.extraction_calls;

insert into private.revision_marks (taken_at, revision)
select now() - interval '1 day', coalesce(max(revision), 0) from public.cards;

insert into private.card_frame_backup (card_id, user_id, front, back, template, template_version, written, migrated_at) values
  ('5eed0000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-0000000000a1',
   '[{"type":"text","v":1,"payload":{"text":"run"}}]', '[{"type":"text","v":1,"payload":{"text":"[동] 달리다"}}]',
   null, null, '[{"type":"text","v":2,"payload":{"front":"run","back":"[동] 달리다"}}]', now() - interval '1 day');

insert into private.senses_migration_backup (card_id, back, migrated_at) values
  ('5eed0000-0000-4000-8000-0000000000c1', '[{"type":"text","v":1,"payload":{"text":"[명] 사과"}}]', now() - interval '8 days');
