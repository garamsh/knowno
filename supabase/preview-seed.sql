-- Synthetic data the migration preview loads between main's migrations and a pull request's
-- (scripts/migration-preview.ts): rows in every table of public and private that the migrations
-- leave empty, in each state the schema distinguishes. Every user is fictional, at example.com.
-- supabase/seed.sql stays empty, since every `supabase start` loads it and the database tests'
-- fixtures assume no rows.

insert into auth.users (id, email, created_at, banned_until) values
  ('5eed0000-0000-4000-8000-0000000000a1', 'seed-learner@example.com', now() - interval '60 days', null),
  ('5eed0000-0000-4000-8000-0000000000a2', 'seed-sharer@example.com', now() - interval '45 days', null),
  ('5eed0000-0000-4000-8000-0000000000a3', 'seed-admin@example.com', now() - interval '90 days', null),
  ('5eed0000-0000-4000-8000-0000000000a4', 'seed-suspended@example.com', now() - interval '10 days', 'infinity'),
  ('5eed0000-0000-4000-8000-0000000000a5', 'seed-special@example.com', now() - interval '30 days', null);

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

-- A note being screened, one held for its AI check and one refused for severe content, each with
-- the content hash its screening reads, the verdicts of both layers, a banned word and the
-- violation the refusal recorded.
insert into public.decks (id, user_id, name, created_at, updated_at, visibility, published_at, hidden, publication) values
  ('5eed0000-0000-4000-8000-0000000000d6', '5eed0000-0000-4000-8000-0000000000a2', '세포 소기관', now() - interval '2 hours',
   now() - interval '1 hour', 'public', now() - interval '1 hour', true, 'checking'),
  ('5eed0000-0000-4000-8000-0000000000d7', '5eed0000-0000-4000-8000-0000000000a2', '광고 같은 노트', now() - interval '6 days',
   now() - interval '5 days', 'public', now() - interval '5 days', true, 'held'),
  ('5eed0000-0000-4000-8000-0000000000d8', '5eed0000-0000-4000-8000-0000000000a4', 'Refused deck', now() - interval '4 days',
   now() - interval '4 days', 'private', null, false, 'refused');
insert into private.deck_screening (deck_id, requested_at, content_hash, hold, refusal, decided_by, decided_at) values
  ('5eed0000-0000-4000-8000-0000000000d6', now() - interval '1 hour', repeat('c1', 32), null, null, null, null),
  ('5eed0000-0000-4000-8000-0000000000d7', now() - interval '5 days', repeat('c2', 32), 'ai', null, null, null),
  ('5eed0000-0000-4000-8000-0000000000d8', now() - interval '4 days', repeat('c3', 32), null, 'ai',
   '5eed0000-0000-4000-8000-0000000000a3', now() - interval '4 days');
insert into private.screening_verdicts (content_hash, layer, version, outcome, findings, created_at) values
  (repeat('c2', 32), 'rules', '2', 'clean', '[]', now() - interval '5 days'),
  (repeat('c2', 32), 'ai', 'seed-model', 'unsure', '[{"kind":"advertising"}]', now() - interval '5 days'),
  (repeat('c3', 32), 'rules', '2', 'clean', '[]', now() - interval '4 days'),
  (repeat('c3', 32), 'ai', 'seed-model', 'severe', '[{"kind":"spam"}]', now() - interval '4 days');
insert into private.screening_terms (term, created_by, created_at, removed_at) values
  ('seed-banned-word', '5eed0000-0000-4000-8000-0000000000a3', now() - interval '20 days', null),
  ('seed-removed-word', '5eed0000-0000-4000-8000-0000000000a3', now() - interval '30 days', now() - interval '10 days');
insert into private.screening_violations (deck_id, owner_id, kind, at) values
  ('5eed0000-0000-4000-8000-0000000000d8', '5eed0000-0000-4000-8000-0000000000a4', 'severe', now() - interval '4 days');

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
-- A 스페셜 grant ending in a week, moved from a 무제한 grant over a Pro grant, with both backed up.
insert into private.user_plans (user_id, plan, ends_at, granted_by, granted_at, version_id)
select '5eed0000-0000-4000-8000-0000000000a5', 'special', now() + interval '7 days',
  '5eed0000-0000-4000-8000-0000000000a3', now() - interval '5 days', max(id)
from private.plan_versions where plan = 'special';
insert into private.unlimited_grants_before_special (user_id, ends_at, granted_by, granted_at) values
  ('5eed0000-0000-4000-8000-0000000000a5', now() + interval '7 days', '5eed0000-0000-4000-8000-0000000000a3',
   now() - interval '5 days');
insert into private.user_plans_before_special (user_id, plan, ends_at, granted_by, granted_at, version_id)
select '5eed0000-0000-4000-8000-0000000000a5', 'pro', null, '5eed0000-0000-4000-8000-0000000000a3',
  now() - interval '15 days', max(id)
from private.plan_versions where plan = 'pro';
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
insert into private.extraction_calls (usage_id, plan, provider, model, prompt_version_id)
select usage.id, case when usage.user_id = '5eed0000-0000-4000-8000-0000000000a2' then 'pro' else 'free' end,
  'openrouter', 'anthropic/claude-haiku-5.5', (select max(id) from private.prompt_versions)
from usage;
insert into private.extraction_calls_before_versions (usage_id)
select min(usage_id) from private.extraction_calls;
insert into private.extraction_cursors (token, usage_id, expires_at)
select '5eed0000-0000-4000-8000-0000000000e1', max(usage_id), now() + interval '10 minutes'
from private.extraction_calls;

-- A draft for Pro on OpenAI with the first prompt version, beside the seeded active
-- configurations, and an OpenAI key in Vault that is no real key.
with draft as (
  insert into private.ai_configurations (plan, provider, model, prompt_version_id, created_by)
  values ('pro', 'openai', 'gpt-seed-model', 1, '5eed0000-0000-4000-8000-0000000000a3')
  returning id, plan
)
insert into private.ai_configuration_labels (plan, label, configuration_id, set_by)
select draft.plan, 'test', draft.id, '5eed0000-0000-4000-8000-0000000000a3' from draft;
insert into private.provider_keys (provider, secret_id, last_four, set_by)
values ('openai', vault.create_secret('seed-not-a-real-key-0000', 'knowno_provider_key_openai'),
  '0000', '5eed0000-0000-4000-8000-0000000000a3');

-- A store grant for the Free learner on a renewing Pro, and the store's webhook value in Vault.
insert into private.store_grants (user_id, plan, ends_at, renews, version_id)
select '5eed0000-0000-4000-8000-0000000000a1', 'pro', now() + interval '20 days', true, max(id)
from private.plan_versions where plan = 'pro';
insert into private.store_secrets (name, secret_id, set_by)
values ('knowno_store_webhook_authorization',
  vault.create_secret('seed-not-a-real-webhook-value', 'knowno_store_webhook_authorization'),
  '5eed0000-0000-4000-8000-0000000000a3');

-- Two assistant messages of the Free user: one recorded with what it used, one never finished.
insert into private.assistant_messages (user_id, plan, configuration_id, created_at, outcome,
  model_calls, input_tokens, output_tokens, reasoning_tokens, web_search_requests, latency_ms)
select '5eed0000-0000-4000-8000-0000000000a1', 'free', l.configuration_id,
  now() - interval '1 hour', 'ok', 2, 3200, 410, 0, 0, 5200
from private.assistant_configuration_labels as l where l.plan = 'free' and l.label = 'active';
insert into private.assistant_messages (user_id, plan, configuration_id, created_at)
select '5eed0000-0000-4000-8000-0000000000a1', 'free', l.configuration_id, now() - interval '30 minutes'
from private.assistant_configuration_labels as l where l.plan = 'free' and l.label = 'active';

-- Two photo jobs of the Free user: one done, a photo read and one failed, and one running, a photo
-- queued on the queue; a step recorded for each read and one in flight.
insert into private.assistant_jobs (id, user_id, plan, configuration_id, instructions, status,
  created_at, finished_at)
select j.id::uuid, '5eed0000-0000-4000-8000-0000000000a1', 'free', l.configuration_id, j.instructions,
  j.status, now() - j.age, case when j.status = 'done' then now() - j.age + interval '2 minutes' end
from private.assistant_configuration_labels as l,
  (values ('5eed0000-0000-4000-8000-0000000000f1', '단원별로 나눠줘', 'done', interval '2 hours'),
    ('5eed0000-0000-4000-8000-0000000000f2', '', 'running', interval '1 minute'))
    as j (id, instructions, status, age)
where l.plan = 'free' and l.label = 'active';
insert into private.assistant_job_photos (job_id, position, photo_id, message_id, status, attempts,
  reading, cut) values
  ('5eed0000-0000-4000-8000-0000000000f1', 1, '5eed0000-0000-4000-8000-0000000000e1', null, 'read',
    1, E'# 1단원\n\n| 단어 | 뜻 |\n|---|---|\n| run | 달리다 |', false),
  ('5eed0000-0000-4000-8000-0000000000f1', 2, '5eed0000-0000-4000-8000-0000000000e2', null, 'failed',
    3, null, null),
  ('5eed0000-0000-4000-8000-0000000000f2', 1, '5eed0000-0000-4000-8000-0000000000e3',
    (select pgmq.send('assistant_photo_reads',
      '{"job_id": "5eed0000-0000-4000-8000-0000000000f2", "position": 1}')), 'queued', 1, null, null);
insert into private.assistant_job_steps (user_id, job_id, position, plan, configuration_id,
  created_at, outcome, input_tokens, output_tokens, reasoning_tokens, latency_ms)
select '5eed0000-0000-4000-8000-0000000000a1', s.job_id::uuid, s.position, 'free', l.configuration_id,
  now() - s.age, s.outcome, s.input_tokens, s.output_tokens, s.reasoning_tokens, s.latency_ms
from private.assistant_configuration_labels as l,
  (values ('5eed0000-0000-4000-8000-0000000000f1', 1, interval '2 hours', 'ok', 1900, 640, 0, 14000),
    ('5eed0000-0000-4000-8000-0000000000f2', 1, interval '30 seconds', null, null, null, null, null))
    as s (job_id, position, age, outcome, input_tokens, output_tokens, reasoning_tokens, latency_ms)
where l.plan = 'free' and l.label = 'active';

insert into private.revision_marks (taken_at, revision)
select now() - interval '1 day', coalesce(max(revision), 0) from public.cards;

insert into private.card_frame_backup (card_id, user_id, front, back, template, template_version, written, migrated_at) values
  ('5eed0000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-0000000000a1',
   '[{"type":"text","v":1,"payload":{"text":"run"}}]', '[{"type":"text","v":1,"payload":{"text":"[동] 달리다"}}]',
   null, null, '[{"type":"text","v":2,"payload":{"front":"run","back":"[동] 달리다"}}]', now() - interval '1 day');

insert into private.senses_migration_backup (card_id, back, migrated_at) values
  ('5eed0000-0000-4000-8000-0000000000c1', '[{"type":"text","v":1,"payload":{"text":"[명] 사과"}}]', now() - interval '8 days');

insert into private.review_sign_in_attempts (address_key, at) values
  (encode(sha256('review@example.com'::bytea), 'hex'), now() - interval '2 hours');
