-- Public decks: another user reads a public deck, its live cards and its owner's display name,
-- and none of a private or hidden deck; writes stay the owner's; the listing leaves out blocked
-- users' decks; and a copy is counted.
begin;
select plan(24);

-- A owns a public deck, a private deck and a hidden public deck; B reads them; C is a third user.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'c@example.com');
insert into public.profiles (user_id, display_name) values
  ('00000000-0000-4000-8000-00000000000a', 'Alice'),
  ('00000000-0000-4000-8000-00000000000c', 'Carol');
insert into public.decks
  (id, user_id, name, description, visibility, published_at, hidden, created_at, updated_at) values
  ('d0000000-0000-4000-8000-00000000007a', '00000000-0000-4000-8000-00000000000a', 'French', 'Verbs', 'public',
   '2026-10-15 09:00+00', false, now(), now()),
  ('d0000000-0000-4000-8000-00000000008a', '00000000-0000-4000-8000-00000000000a', 'Diary', null, 'private',
   null, false, now(), now()),
  ('d0000000-0000-4000-8000-00000000009a', '00000000-0000-4000-8000-00000000000a', 'Hidden', null, 'public',
   '2026-10-15 09:00+00', true, now(), now()),
  ('d0000000-0000-4000-8000-00000000007c', '00000000-0000-4000-8000-00000000000c', 'German', null, 'public',
   '2026-10-15 10:00+00', false, now(), now());
insert into public.cards
  (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at, deleted_at) values
  ('c0000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000007a', '[]', '[]', 'p', 'manual',
   now(), now(), null),
  ('c0000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000007a', '[]', '[]', 'd',
   'manual', now(), now(), now()),
  ('c0000000-0000-4000-8000-000000000008', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000008a', '[]', '[]', 'q', 'manual',
   now(), now(), null),
  ('c0000000-0000-4000-8000-000000000009', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000009a', '[]', '[]', 'h', 'manual',
   now(), now(), null);

select results_eq(
  $$select (select count(*) from public.decks), (select count(*) from public.cards),
    (select count(*) filter (where hidden) from public.decks)$$,
  $$values (4::bigint, 4::bigint, 1::bigint)$$,
  'the fixture holds four decks, one of them hidden, and four cards');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';

-- Reads, each against a control in the same statement.
select results_eq(
  $$select id from public.decks order by id$$,
  $$values ('d0000000-0000-4000-8000-00000000007a'::uuid), ('d0000000-0000-4000-8000-00000000007c'::uuid)$$,
  'B reads the public decks, and neither the private nor the hidden one');
select results_eq(
  $$select id from public.cards order by id$$,
  $$values ('c0000000-0000-4000-8000-000000000007'::uuid)$$,
  'B reads the public deck''s live card, and not its deleted one or the private or hidden deck''s');
select results_eq(
  $$select display_name from public.profiles order by display_name$$,
  $$values ('Alice'), ('Carol')$$,
  'B reads the display names of the users whose public decks it reads');
select is_empty(
  $$select 1 from public.decks where id = 'd0000000-0000-4000-8000-00000000009a'$$,
  'B cannot read the hidden deck by its id');

-- Writes by a non-owner are refused or reach no row, with the owner's write as control below.
select throws_ok(
  $$insert into public.decks (id, user_id, name, created_at, updated_at)
    values ('d0000000-0000-4000-8000-00000000007a', '00000000-0000-4000-8000-00000000000a', 'Taken', now(), now())
    on conflict (id) do update set name = excluded.name$$,
  '42501', null, 'B cannot upsert over A''s public deck');
update public.decks set name = 'Renamed by B' where id = 'd0000000-0000-4000-8000-00000000007a';
update public.cards set card_key = 'by-b' where id = 'c0000000-0000-4000-8000-000000000007';
delete from public.cards where id = 'c0000000-0000-4000-8000-000000000007';
delete from public.decks where id = 'd0000000-0000-4000-8000-00000000007a';
select throws_ok(
  $$insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at)
    values ('c0000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000007a', '[]', '[]', 'b', 'manual', now(), now())$$,
  '42501', null, 'B cannot insert a card into A''s public deck');
select throws_ok(
  $$insert into public.profiles (user_id, display_name)
    values ('00000000-0000-4000-8000-00000000000a', 'Mallory')$$,
  '42501', null, 'B cannot write A''s profile');
update public.profiles set display_name = 'Mallory' where user_id = '00000000-0000-4000-8000-00000000000a';

reset role;
select results_eq(
  $$select d.name, c.card_key, p.display_name from public.decks as d
    join public.cards as c on c.id = 'c0000000-0000-4000-8000-000000000007'
    join public.profiles as p on p.user_id = d.user_id
    where d.id = 'd0000000-0000-4000-8000-00000000007a'$$,
  $$values ('French', 'p', 'Alice')$$,
  'B''s updates and deletes left A''s public deck, card and profile as they were');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
update public.decks set color = 'teal' where id = 'd0000000-0000-4000-8000-00000000007a';
reset role;
select results_eq(
  $$select color from public.decks where id = 'd0000000-0000-4000-8000-00000000007a'$$,
  $$values ('teal')$$,
  'the owner''s update of the same deck takes effect');

-- The listing, as B.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
select results_eq(
  $$select id, display_name, card_count from public.list_public_decks()$$,
  $$values ('d0000000-0000-4000-8000-00000000007c'::uuid, 'Carol', 0::bigint), ('d0000000-0000-4000-8000-00000000007a'::uuid, 'Alice', 1::bigint)$$,
  'the listing holds both public decks, newest first, with owner names and live card counts');
select results_eq(
  $$select id from public.list_public_decks(search => 'VERB')$$,
  $$values ('d0000000-0000-4000-8000-00000000007a'::uuid)$$,
  'a search matches the description, ignoring case');
select results_eq(
  $$select id from public.list_public_decks(search => 'germ')$$,
  $$values ('d0000000-0000-4000-8000-00000000007c'::uuid)$$,
  'a search matches the name');
select throws_ok(
  $$select * from public.list_public_decks(sort => 'random')$$,
  '22023', null, 'an unknown sort is refused');

-- A copy counts on someone else's deck, not on one's own, and not on a deck that is not public.
select results_eq(
  $$select public.record_deck_copy('d0000000-0000-4000-8000-00000000007a'), public.record_deck_copy('d0000000-0000-4000-8000-00000000007a'),
    public.record_deck_copy('d0000000-0000-4000-8000-00000000008a'), public.record_deck_copy('d0000000-0000-4000-8000-00000000009a')$$,
  $$values (true, true, false, false)$$,
  'record_deck_copy accepts a public deck and refuses a private or hidden one');
select results_eq(
  $$select id, copy_count from public.list_public_decks(sort => 'copied')$$,
  $$values ('d0000000-0000-4000-8000-00000000007a'::uuid, 1), ('d0000000-0000-4000-8000-00000000007c'::uuid, 0)$$,
  'B''s two copies counted once, and the most copied deck lists first');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select results_eq(
  $$select public.record_deck_copy('d0000000-0000-4000-8000-00000000007c')$$,
  $$values (true)$$,
  'the owner may copy its own public deck');
reset role;
select results_eq(
  $$select copy_count from public.decks where id = 'd0000000-0000-4000-8000-00000000007c'$$,
  $$values (0)$$,
  'the owner''s copy of its own deck is not counted');

-- Blocks: B blocks C, and C's deck leaves B's listing alone.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}';
insert into public.user_blocks (blocked_id) values ('00000000-0000-4000-8000-00000000000c');
select results_eq(
  $$select id from public.list_public_decks()$$,
  $$values ('d0000000-0000-4000-8000-00000000007a'::uuid)$$,
  'B''s listing leaves out the deck of C, whom B blocked, and keeps A''s');
select results_eq(
  $$select blocker_id::text, blocked_id::text from public.user_blocks$$,
  $$values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c')$$,
  'B reads its own block');
select throws_ok(
  $$insert into public.user_blocks (blocker_id, blocked_id)
    values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000c')$$,
  '42501', null, 'B cannot write a block as A');

reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq(
  $$select id from public.list_public_decks() order by id$$,
  $$values ('d0000000-0000-4000-8000-00000000007a'::uuid), ('d0000000-0000-4000-8000-00000000007c'::uuid)$$,
  'A, who blocked no one, still lists C''s deck');
select is_empty(
  $$select 1 from public.user_blocks$$,
  'A reads none of B''s blocks');

reset role;
set local role anon;
set local request.jwt.claims to '{"role":"anon"}';
select throws_ok(
  $$select * from public.list_public_decks()$$,
  '42501', null, 'anon cannot list public decks');

select * from finish();
rollback;
