-- The owner writes a deck's publishing columns but never hidden or copy_count, which only the
-- server sets; a copied card carries source 'copy' and its origin; a display name is 2 to 20
-- characters.
begin;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';

select lives_ok(
  $$insert into public.decks (id, name, created_at, updated_at, description)
    values ('d0000000-0000-4000-8000-00000000000a', 'French', now(), now(), 'Verbs')$$,
  'the owner inserts a deck with its description');
select throws_ok(
  $$insert into public.decks (id, name, created_at, updated_at, hidden)
    values ('d0000000-0000-4000-8000-000000000004', 'Hidden', now(), now(), false)$$,
  '42501', null, 'the owner cannot insert hidden');
select throws_ok(
  $$update public.decks set hidden = false where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'the owner cannot update hidden');
select throws_ok(
  $$update public.decks set copy_count = 100 where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'the owner cannot update copy_count');
-- Control: the same owner updates the writable columns of the same deck.
select lives_ok(
  $$update public.decks set visibility = 'private', published_at = null, description = null,
    name = 'Renamed', updated_at = now() where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  'the owner updates the deck''s writable columns');
select throws_ok(
  $$update public.decks set visibility = 'public', published_at = now() where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  '42501', 'publication_requires_screening', 'the owner cannot make a deck public with an update (ADR 0238)');
select throws_ok(
  $$update public.decks set description = repeat('x', 301) where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'a description over 300 characters is refused');

select lives_ok(
  $$insert into public.cards (id, deck_id, front, back, card_key, source, origin_deck_id, created_at, updated_at)
    values ('c0000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-00000000000a', '[]', '[]', 'a', 'copy', 'd0000000-0000-4000-8000-000000000012', now(), now())$$,
  'a copied card is stored with source copy and its origin deck');

select throws_ok(
  $$insert into public.profiles (display_name) values ('A')$$,
  '23514', null, 'a one-character display name is refused');
select throws_ok(
  $$insert into public.profiles (display_name) values (repeat('가', 21))$$,
  '23514', null, 'a 21-character display name is refused');
select lives_ok(
  $$insert into public.profiles (display_name) values ('가나')$$,
  'a two-character display name is accepted');

reset role;
select results_eq(
  $$select name, visibility, hidden, copy_count from public.decks where id = 'd0000000-0000-4000-8000-00000000000a'$$,
  $$values ('Renamed', 'private', false, 0)$$,
  'the deck holds the owner''s writes, with hidden and copy_count at their defaults');

select * from finish();
rollback;
