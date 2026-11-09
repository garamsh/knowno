-- A note is screened before it is public (#862, ADR 0238): no client write makes a deck public, and
-- a public note whose text a client edits is hidden until it is checked again; the owner asks
-- through `request_deck_publication`; the service-role functions record a layer's verdict by the
-- note's content hash and decide from the verdicts; an admin allows a held note or keeps it
-- hidden, each audited; the banned-word list and the suspension candidates; the reports' hold;
-- the sweeper; no client reaching the service functions; and the revert.
begin;
select plan(126);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000b', 'b@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'admin@example.com'),
  ('00000000-0000-4000-8000-00000000000d', 'd@example.com'),
  ('00000000-0000-4000-8000-00000000000e', 'e@example.com'),
  ('00000000-0000-4000-8000-00000000000f', 'f@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000c');

create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
end;
$$;

-- The hashes of the notes, asked from the roles that cannot reach the schema private.
create function pg_temp.hash(n text) returns text language sql security definer as $$
  select private.note_content_hash(('d0000000-0000-4000-8000-0000000000' || n)::uuid);
$$;
create function pg_temp.card_hash(front jsonb, back jsonb, template text, template_version smallint)
returns text language sql security definer as $$
  select private.card_hash(front, back, template, template_version);
$$;

-- A deck of [owner]'s, as a client would have it: private, with one live card.
create function pg_temp.deck(n text, owner text) returns void language plpgsql as $$
begin
  insert into public.decks (id, user_id, name, description, created_at, updated_at)
    values (('d0000000-0000-4000-8000-0000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || owner)::uuid,
      'Deck ' || n, 'About ' || n, now(), now());
  insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at)
    values (('c0000000-0000-4000-8000-0000000000' || n)::uuid, ('00000000-0000-4000-8000-00000000000' || owner)::uuid,
      ('d0000000-0000-4000-8000-0000000000' || n)::uuid,
      jsonb_build_array(jsonb_build_object('type', 'text', 'v', 1, 'id', 'b1', 'payload', jsonb_build_object('text', 'front ' || n))),
      '[]', 'k' || n, 'manual', now(), now());
end;
$$;

-- The state of deck [n]: publication, visibility, hidden.
create function pg_temp.state(n text) returns text language sql as $$
  select publication || '/' || visibility || '/' || hidden from public.decks
    where id = ('d0000000-0000-4000-8000-0000000000' || n)::uuid;
$$;

-- Deck 01 is public and screened, deck 02 is A's private deck, deck 03 is B's private deck.
select pg_temp.deck('01', 'a');
select pg_temp.deck('02', 'a');
select pg_temp.deck('03', 'b');
update public.decks set visibility = 'public', published_at = now()
  where id = 'd0000000-0000-4000-8000-000000000001';

-- A write that is not a client's keeps `publication` consistent: public and shown is public.
select is(pg_temp.state('01'), 'public/public/false',
  'a public deck written by the owner of the database is public, as a seed or a dashboard writes it');
select is(pg_temp.state('02'), 'private/private/false', 'a private deck is private');
select results_eq(
  $$select count(*) from public.decks where id = 'd0000000-0000-4000-8000-000000000001' and publication = 'public' and hidden = false$$,
  $$values (1::bigint)$$, 'a card written by the owner of the database does not re-check its deck');
update public.decks set hidden = true where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.state('01'), 'held/public/true', 'hiding a public deck from the dashboard holds it');
update public.decks set hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
select is(pg_temp.state('01'), 'public/public/false', 'unhiding it from the dashboard makes it public again');

-- The guard: no client makes a deck public.
select pg_temp.sign_in('a');
select lives_ok(
  $$insert into public.decks (id, name, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000011', 'New', now(), now())$$,
  'control: the owner inserts a private deck');
select throws_ok(
  $$insert into public.decks (id, name, visibility, published_at, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000012', 'Direct', 'public', now(), now(), now())$$,
  '42501', 'publication_requires_screening', 'the owner cannot insert a public deck');
select throws_ok(
  $$insert into public.decks (id, name, visibility, published_at, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000012', 'Upsert', 'public', now(), now(), now())
    on conflict (id) do update set name = excluded.name, visibility = excluded.visibility$$,
  '42501', 'publication_requires_screening', 'a sync upsert of a new public deck is refused');
select throws_ok(
  $$insert into public.decks (id, user_id, name, visibility, published_at, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'Over', 'public', now(), now(), now())
    on conflict (id) do update set visibility = excluded.visibility, published_at = excluded.published_at$$,
  '42501', 'publication_requires_screening', 'a sharing upsert over a private deck is refused');
select throws_ok(
  $$update public.decks set visibility = 'public', published_at = now() where id = 'd0000000-0000-4000-8000-000000000002'$$,
  '42501', 'publication_requires_screening', 'the web''s update of a private deck to public is refused');
select throws_ok(
  $$update public.decks set publication = 'public' where id = 'd0000000-0000-4000-8000-000000000002'$$,
  '42501', null, 'the owner cannot write publication');
select lives_ok(
  $$update public.decks set name = 'Deck 02 renamed', updated_at = now() where id = 'd0000000-0000-4000-8000-000000000002'$$,
  'control: the owner renames a private deck');
select is((select pg_temp.state('02')), 'private/private/false', 'and it stays private');

-- A sync that pushes a public deck it already holds changes nothing of its publication.
select lives_ok(
  $$insert into public.decks (id, user_id, name, description, visibility, published_at, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a', 'Deck 01', 'About 01', 'public', '2020-01-01', now(), now())
    on conflict (id) do update set name = excluded.name, description = excluded.description,
      visibility = excluded.visibility, published_at = excluded.published_at, updated_at = excluded.updated_at$$,
  'an upsert of a deck that is public already, unchanged, is let through');
reset role;
select is(pg_temp.state('01'), 'public/public/false', 'and the deck is still public');
select isnt((select published_at from public.decks where id = 'd0000000-0000-4000-8000-000000000001'),
  '2020-01-01'::timestamptz, 'with its publish time as it was');

set local role service_role;
select throws_ok(
  $$insert into public.decks (id, user_id, name, visibility, published_at, created_at, updated_at)
    values ('d0000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-00000000000a', 'Svc', 'public', now(), now(), now())$$,
  '42501', 'publication_requires_screening', 'the service role cannot insert a public deck');
select throws_ok(
  $$update public.decks set visibility = 'public', published_at = now() where id = 'd0000000-0000-4000-8000-000000000002'$$,
  '42501', 'publication_requires_screening', 'the service role cannot make a deck public by an update');
reset role;

-- An edit of a public note's text hides it until it is checked.
select pg_temp.sign_in('a');
update public.decks set color = 'teal' where id = 'd0000000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.state('01'), 'public/public/false', 'a public deck''s colour changes and it stays public');
select pg_temp.sign_in('a');
update public.decks set name = 'Deck 01 renamed' where id = 'd0000000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.state('01'), 'checking/public/true', 'renaming a public deck hides it and sets it checking');
select isnt((select requested_at from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000001'),
  null, 'with the request of its check stamped');

-- Back to public for the next case, as the pipeline would.
update public.decks set publication = 'public', hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a');
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at)
  values ('c0000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-00000000000a', 'd0000000-0000-4000-8000-000000000001',
    '[]', '[]', 'k101', 'manual', now(), now());
reset role;
select is(pg_temp.state('01'), 'checking/public/true', 'a client''s new card in a public deck hides it, checking');
update public.decks set publication = 'public', hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a');
update public.cards set card_key = 'other-key' where id = 'c0000000-0000-4000-8000-000000000101';
reset role;
select is(pg_temp.state('01'), 'public/public/false', 'a card''s key changes and the deck stays public');
select pg_temp.sign_in('a');
update public.cards set back = '[{"type":"text","v":1,"id":"b2","payload":{"text":"changed"}}]'
  where id = 'c0000000-0000-4000-8000-000000000101';
reset role;
select is(pg_temp.state('01'), 'checking/public/true', 'a card''s back changes and the deck is checking');
update public.decks set publication = 'public', hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a');
update public.cards set deleted_at = now() where id = 'c0000000-0000-4000-8000-000000000101';
reset role;
select is(pg_temp.state('01'), 'checking/public/true', 'a client''s delete of a live card makes the deck checking');
update public.decks set publication = 'public', hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a');
update public.cards set card_key = 'again' where id = 'c0000000-0000-4000-8000-000000000101';
reset role;
select is(pg_temp.state('01'), 'public/public/false', 'a deleted card changing its key does not re-check the deck');

-- A card edit of a private deck, and of a held one.
select pg_temp.sign_in('a');
update public.cards set back = '[{"type":"text","v":1,"id":"b2","payload":{"text":"edit"}}]'
  where id = 'c0000000-0000-4000-8000-000000000002';
reset role;
select is(pg_temp.state('02'), 'private/private/false', 'a card edit in a private deck changes no state');
update public.decks set hidden = true where id = 'd0000000-0000-4000-8000-000000000001';
select pg_temp.sign_in('a');
update public.cards set back = '[{"type":"text","v":1,"id":"b2","payload":{"text":"held edit"}}]'
  where id = 'c0000000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.state('01'), 'held/public/true', 'a card edit in a held deck leaves it held');
update public.decks set hidden = false where id = 'd0000000-0000-4000-8000-000000000001';
delete from private.deck_screening;

-- The owner unpublishes.
select pg_temp.sign_in('a');
update public.decks set visibility = 'private' where id = 'd0000000-0000-4000-8000-000000000001';
reset role;
select is(pg_temp.state('01'), 'private/private/false', 'the owner makes a public deck private, as before');

-- The owner asks to publish.
select pg_temp.sign_in('a');
select is(public.request_deck_publication('d0000000-0000-4000-8000-000000000001', 'A new description'), 'checking',
  'the owner asks to publish a private deck: checking');
reset role;
select is(pg_temp.state('01'), 'checking/public/true', 'the deck is public and hidden meanwhile');
select results_eq(
  $$select description, published_at is not null from public.decks where id = 'd0000000-0000-4000-8000-000000000001'$$,
  $$values ('A new description', true)$$, 'with the description given and a publish time');
select isnt((select requested_at from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000001'),
  null, 'and the check requested');
select pg_temp.sign_in('a');
select is(public.request_deck_publication('d0000000-0000-4000-8000-000000000001'), 'checking', 'asking again is idempotent');
reset role;
select pg_temp.sign_in('b');
select throws_ok($$select public.request_deck_publication('d0000000-0000-4000-8000-000000000002')$$,
  'P0002', 'no such deck', 'another user''s deck is not found');
reset role;
insert into private.suspensions (user_id, reason) values ('00000000-0000-4000-8000-00000000000b', 'spam');
select pg_temp.sign_in('b');
select throws_ok($$select public.request_deck_publication('d0000000-0000-4000-8000-000000000003')$$,
  '42501', 'suspended', 'a suspended owner cannot ask');
reset role;
delete from private.suspensions;

-- The verdicts, as the service role records and applies them.
select pg_temp.deck('04', 'd');
select pg_temp.sign_in('d');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000004');
reset role;
set local role service_role;

select is((select count(*) from public.screening_due(10)), 0::bigint, 'a note requested a moment ago is not due yet');
reset role;
update private.deck_screening set requested_at = now() - interval '1 minute';
set local role service_role;
select results_eq($$select deck_id from public.screening_due(10) order by 1$$,
  $$values ('d0000000-0000-4000-8000-000000000001'::uuid), ('d0000000-0000-4000-8000-000000000004'::uuid)$$,
  'after 20 seconds the checking notes are due');
select is((select count(*) from public.screening_due(1)), 1::bigint, 'and the limit bounds them');

select results_eq(
  $$select c ->> 'publication', c ->> 'name', jsonb_array_length(c -> 'cards'), c ->> 'hash' = pg_temp.hash('04'),
      jsonb_array_length(c -> 'verdicts'), c ->> 'terms_version'
    from (select public.screening_claim('d0000000-0000-4000-8000-000000000004') as c) as x$$,
  $$values ('checking', 'Deck 04', 1, true, 0, '0.0')$$, 'a claim holds the note, its hash, its card and no verdict');
select is(public.screening_claim('d0000000-0000-4000-8000-000000000003') is null, true, 'a private deck has no claim');

select is(public.apply_screening('d0000000-0000-4000-8000-000000000004', pg_temp.hash('04')),
  'pending', 'with no verdict of a required layer the note stays pending');
select is(public.record_screening('d0000000-0000-4000-8000-000000000004', 'not-the-hash', 'rules', 'r1+0.0', 'clean', '[]'),
  'changed', 'a verdict on a hash the note no longer has is not stored');
select is(public.apply_screening('d0000000-0000-4000-8000-000000000004', 'not-the-hash'), 'changed',
  'and a decision on it is not made');
select is(public.record_screening('d0000000-0000-4000-8000-000000000004',
  pg_temp.hash('04'), 'rules', 'r1+0.0', 'clean', '[]'),
  'recorded', 'a verdict on the note''s hash is stored');
select is(public.apply_screening('d0000000-0000-4000-8000-000000000004', pg_temp.hash('04')),
  'public', 'a clean verdict makes the note public');
reset role;
select is(pg_temp.state('04'), 'public/public/false', 'it is public and shown');
select results_eq(
  $$select content_hash = pg_temp.hash('04'), refusal from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000004'$$,
  $$values (true, null)$$, 'with the hash it was decided on');
set local role service_role;
select is(public.apply_screening('d0000000-0000-4000-8000-000000000004', pg_temp.hash('04')),
  'noop', 'deciding a decided note again does nothing');
reset role;

-- The hash follows the content, not the cards' ids or order.
select pg_temp.deck('05', 'e');
select pg_temp.deck('06', 'e');
update public.cards set id = 'c0000000-0000-4000-8000-0000000000f6', front = (select front from public.cards where id = 'c0000000-0000-4000-8000-000000000005')
  where id = 'c0000000-0000-4000-8000-000000000006';
update public.decks set name = 'Deck 05', description = 'About 05' where id = 'd0000000-0000-4000-8000-000000000006';
select is(pg_temp.hash('05'), pg_temp.hash('06'),
  'two notes of the same text and different card ids have one hash');
update public.decks set description = 'About 06' where id = 'd0000000-0000-4000-8000-000000000006';
select isnt(pg_temp.hash('05'), pg_temp.hash('06'),
  'a different description is another hash');
update public.decks set description = 'About 05' where id = 'd0000000-0000-4000-8000-000000000006';
update public.cards set deleted_at = now() where id = 'c0000000-0000-4000-8000-0000000000f6';
select isnt(pg_temp.hash('05'), pg_temp.hash('06'),
  'a deleted card is not part of it');

-- Republishing the same text finds its verdict again.
select pg_temp.sign_in('d');
update public.decks set visibility = 'private' where id = 'd0000000-0000-4000-8000-000000000004';
select public.request_deck_publication('d0000000-0000-4000-8000-000000000004');
reset role;
set local role service_role;
select is(public.apply_screening('d0000000-0000-4000-8000-000000000004', pg_temp.hash('04')),
  'public', 'republished unchanged, the note is decided on the stored verdict, with no new record');
reset role;

-- A refusal, and a severe one, and one the layers are unsure of.
select pg_temp.deck('07', 'e');
select pg_temp.deck('08', 'e');
select pg_temp.deck('09', 'f');
select pg_temp.sign_in('e');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000007');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000008');
reset role;
select pg_temp.sign_in('f');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000009');
reset role;
set local role service_role;
select public.record_screening('d0000000-0000-4000-8000-000000000007', pg_temp.hash('07'),
  'rules', 'r1+0.0', 'refused', jsonb_build_array(jsonb_build_object('card', pg_temp.card_hash(
    (select front from public.cards where id = 'c0000000-0000-4000-8000-000000000007'), '[]', null, null),
    'where', 'front', 'block', 0, 'category', 'phone', 'start', 3, 'end', 9)));
select is(public.apply_screening('d0000000-0000-4000-8000-000000000007', pg_temp.hash('07')),
  'refused', 'a refused verdict refuses the note');
select public.record_screening('d0000000-0000-4000-8000-000000000008', pg_temp.hash('08'),
  'rules', 'r1+0.0', 'severe', '[]');
select is(public.apply_screening('d0000000-0000-4000-8000-000000000008', pg_temp.hash('08')),
  'refused', 'a severe verdict refuses it too');
select public.record_screening('d0000000-0000-4000-8000-000000000009', pg_temp.hash('09'),
  'rules', 'r1+0.0', 'clean', '[]');
select public.record_screening('d0000000-0000-4000-8000-000000000009', pg_temp.hash('09'),
  'ai', 'm1', 'unsure', '[]');
select is(public.apply_screening('d0000000-0000-4000-8000-000000000009', pg_temp.hash('09')),
  'held', 'a layer unsure of a note holds it');
reset role;
select is(pg_temp.state('07'), 'refused/private/false', 'a refused note is private, shown to its owner as refused');
select results_eq($$select refusal, content_hash from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000007'$$,
  $$values ('rules', null)$$, 'with the layer that refused it');
select is(pg_temp.state('09'), 'held/public/true', 'the unsure note is held');
select results_eq($$select hold from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000009'$$,
  $$values ('ai')$$, 'with an ai hold');
select results_eq($$select deck_id, owner_id, kind from private.screening_violations order by deck_id$$,
  $$values ('d0000000-0000-4000-8000-000000000008'::uuid, '00000000-0000-4000-8000-00000000000e'::uuid, 'severe')$$,
  'only the severe refusal is a violation');

-- The owner reads where it was found, by card, never the text.
select pg_temp.sign_in('e');
select results_eq(
  $$select r ->> 'state', r ->> 'refusal', r -> 'findings' -> 0 ->> 'card_id', r -> 'findings' -> 0 ->> 'category',
    (r -> 'findings' -> 0 ->> 'start')::int, (r -> 'findings' -> 0 ->> 'end')::int, r::text ~ 'front 07'
    from (select public.my_deck_screening('d0000000-0000-4000-8000-000000000007') as r) as x$$,
  $$values ('refused', 'rules', 'c0000000-0000-4000-8000-000000000007', 'phone', 3, 9, false)$$,
  'the owner reads the refusal, the card and the span of the finding, and none of the text');
select is(public.my_deck_screening('d0000000-0000-4000-8000-000000000001') is null, true,
  'another owner''s note answers nothing');
reset role;

-- A note changed between the claim and the decision is not decided on the old content.
select pg_temp.deck('10', 'f');
select pg_temp.sign_in('f');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000010');
reset role;
set local role service_role;
select public.record_screening('d0000000-0000-4000-8000-000000000010', pg_temp.hash('10'),
  'rules', 'r1+0.0', 'clean', '[]');
reset role;
update public.cards set back = '[{"type":"text","v":1,"id":"b2","payload":{"text":"edited"}}]' where id = 'c0000000-0000-4000-8000-000000000010';
set local role service_role;
select is(public.apply_screening('d0000000-0000-4000-8000-000000000010', (select (public.screening_claim('d0000000-0000-4000-8000-000000000010') ->> 'hash'))),
  'pending', 'the new content has no verdict yet, and the old verdict is not reused for it');
reset role;

-- A public note that was never screened is screened where it stands.
select pg_temp.deck('21', 'f');
update public.decks set visibility = 'public', published_at = now() where id = 'd0000000-0000-4000-8000-000000000021';
set local role service_role;
select is((select count(*) from public.screening_due(50) where deck_id = 'd0000000-0000-4000-8000-000000000021'), 1::bigint,
  'a public note with no decided hash is due');
select public.record_screening('d0000000-0000-4000-8000-000000000021', pg_temp.hash('21'),
  'rules', 'r1+0.0', 'refused', '[]');
select is(public.apply_screening('d0000000-0000-4000-8000-000000000021', pg_temp.hash('21')),
  'refused', 'a hit on it refuses it where it stands');
reset role;
select is(pg_temp.state('21'), 'refused/private/false', 'and it is private');

-- No client reaches the service functions.
select pg_temp.sign_in('a');
select throws_ok($$select * from public.screening_due(1)$$, '42501', null, 'a client cannot ask what is due');
select throws_ok($$select public.screening_claim('d0000000-0000-4000-8000-000000000001')$$, '42501', null,
  'a client cannot claim a note');
select throws_ok($$select public.record_screening('d0000000-0000-4000-8000-000000000001', 'x', 'rules', 'v', 'clean', '[]')$$,
  '42501', null, 'a client cannot record a verdict');
select throws_ok($$select public.apply_screening('d0000000-0000-4000-8000-000000000001', 'x')$$, '42501', null,
  'a client cannot decide a note');
select throws_ok($$select * from private.screening_verdicts$$, '42501', null, 'a client cannot read the verdicts');
reset role;

-- The reports' third hides a public note and holds it.
select pg_temp.deck('22', 'a');
update public.decks set visibility = 'public', published_at = now() where id = 'd0000000-0000-4000-8000-000000000022';
insert into public.deck_reports (deck_id, reporter_id, reason) values
  ('d0000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-00000000000b', 'spam'),
  ('d0000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-00000000000d', 'spam'),
  ('d0000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-00000000000e', 'spam');
select is(pg_temp.state('22'), 'held/public/true', 'the third report holds a public note');
select results_eq($$select hold from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000022'$$,
  $$values ('reports')$$, 'with the hold of the reports');

-- The admin's decisions.
select pg_temp.sign_in('b');
select throws_ok($$select * from public.admin_screening_queue()$$, '42501', null, 'a user who is no admin cannot read the held notes');
select throws_ok($$select public.admin_allow_deck('d0000000-0000-4000-8000-000000000022', 'x')$$, '42501', null,
  'nor allow one');
reset role;
select pg_temp.sign_in('c');
select results_eq($$select deck_id, hold from public.admin_screening_queue() order by deck_id$$,
  $$values ('d0000000-0000-4000-8000-000000000009'::uuid, 'ai'), ('d0000000-0000-4000-8000-000000000022'::uuid, 'reports')$$,
  'the admin reads the held notes with their holds');
select is(public.admin_allow_deck('d0000000-0000-4000-8000-000000000022', 'stale-hash'), 'changed',
  'a decision on a hash the note no longer has is not made');
select is(public.admin_allow_deck('d0000000-0000-4000-8000-000000000003', 'x'), 'not_held', 'a note that is not held is not allowed');
select is(public.admin_screening_findings('d0000000-0000-4000-8000-000000000022', 'stale-hash') ->> 'changed', 'true',
  'findings of an old hash answer changed');
select is(public.admin_screening_findings('d0000000-0000-4000-8000-000000000022', pg_temp.hash('22')) ->> 'changed',
  'false', 'and of the live hash answer the findings');
select is(public.admin_allow_deck('d0000000-0000-4000-8000-000000000022', pg_temp.hash('22')),
  'allowed', 'the admin allows a held note by its hash');
reset role;
select is(pg_temp.state('22'), 'public/public/false', 'it is public and shown');
select results_eq($$select hold, decided_by, content_hash = pg_temp.hash('22') from private.deck_screening where deck_id = 'd0000000-0000-4000-8000-000000000022'$$,
  $$values (null, '00000000-0000-4000-8000-00000000000c'::uuid, true)$$, 'the hold is cleared and the decision kept');
select results_eq($$select action, target_id, detail ->> 'name' from private.admin_audit where action = 'allow_deck'$$,
  $$values ('allow_deck', 'd0000000-0000-4000-8000-000000000022', 'Deck 22')$$, 'the decision is audited');
select pg_temp.sign_in('c');
select is(public.admin_allow_deck('d0000000-0000-4000-8000-000000000022', pg_temp.hash('22')),
  'not_held', 'allowing it again does nothing');

select is(public.admin_keep_deck_hidden('d0000000-0000-4000-8000-000000000009', pg_temp.hash('09'), 'spam ads'),
  'kept', 'the admin keeps a held note hidden');
reset role;
select is(pg_temp.state('09'), 'refused/private/false', 'it is refused and private');
select results_eq($$select action, detail ->> 'reason' from private.admin_audit where action = 'keep_deck_hidden'$$,
  $$values ('keep_deck_hidden', 'spam ads')$$, 'the decision is audited with its reason');
select results_eq($$select kind from private.screening_violations where deck_id = 'd0000000-0000-4000-8000-000000000009'$$,
  $$values ('kept_hidden')$$, 'and counted as a violation of its owner');
select pg_temp.sign_in('f');
select public.request_deck_publication('d0000000-0000-4000-8000-000000000009');
reset role;
set local role service_role;
select is(public.apply_screening('d0000000-0000-4000-8000-000000000009', pg_temp.hash('09')),
  'refused', 'the same text published again is refused, whatever the rules say');
reset role;

-- The banned-word list: audited by id, never the term.
select pg_temp.sign_in('c');
select isnt(public.admin_add_screening_term('  Ｂａｄ word  '), null, 'the admin adds a term');
select results_eq($$select term from public.admin_screening_terms()$$, $$values ('Bad word')$$, 'stored as NFKC text');
select is(public.admin_add_screening_term('Bad word'), (select id from public.admin_screening_terms()), 'adding it again answers the same id');
select throws_ok($$select public.admin_add_screening_term('   ')$$, '22023', null, 'an empty term is refused');
reset role;
select results_eq($$select action, target_kind, detail from private.admin_audit where action = 'add_screening_term'$$,
  $$values ('add_screening_term', 'screening_term', '{}'::jsonb)$$, 'the audit row holds no term');
set local role service_role;
select results_eq($$select c -> 'terms', c ->> 'terms_version' from (select public.screening_claim('d0000000-0000-4000-8000-000000000001') as c) as x$$,
  $$values ('["Bad word"]'::jsonb, '1.0')$$, 'a claim carries the terms and their version');
reset role;
select pg_temp.sign_in('c');
select is(public.admin_remove_screening_term((select id from public.admin_screening_terms())), true, 'the admin removes it');
select is(public.admin_remove_screening_term(-1), false, 'removing an unknown term does nothing');
reset role;
select results_eq($$select count(*), count(removed_at) from private.screening_terms$$, $$values (1::bigint, 1::bigint)$$,
  'the row stays, removed');
set local role service_role;
select is(public.screening_claim('d0000000-0000-4000-8000-000000000001') ->> 'terms_version', '1.1',
  'and the version moves');
reset role;

-- The suspension candidates: 3 notes with violations, and not suspended.
insert into private.screening_violations (deck_id, owner_id, kind) values
  ('d0000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-00000000000d', 'severe'),
  ('d0000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000d', 'severe'),
  ('d0000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-00000000000d', 'kept_hidden'),
  ('d0000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-00000000000b', 'severe'),
  ('d0000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-00000000000b', 'severe'),
  ('d0000000-0000-4000-8000-0000000000a5', '00000000-0000-4000-8000-00000000000b', 'kept_hidden');
select pg_temp.sign_in('c');
select results_eq($$select user_id, decks from public.admin_suspension_candidates()$$,
  $$values ('00000000-0000-4000-8000-00000000000b'::uuid, 3::bigint)$$,
  'an owner with violations on three notes is a candidate, one with two notes is not');
reset role;
insert into private.suspensions (user_id, reason) values ('00000000-0000-4000-8000-00000000000b', 'x');
select pg_temp.sign_in('c');
select is((select count(*) from public.admin_suspension_candidates()), 0::bigint, 'a suspended owner is no longer one');

-- The hide, unpublish and remove functions keep the state.
select is(public.admin_set_deck_hidden('d0000000-0000-4000-8000-000000000004', true), true, 'the admin hides a public note');
reset role;
select is(pg_temp.state('04'), 'held/public/true', 'it is held');
select pg_temp.sign_in('c');
select is(public.admin_set_deck_hidden('d0000000-0000-4000-8000-000000000004', true), false, 'hiding a held note changes nothing');
select is(public.admin_set_deck_hidden('d0000000-0000-4000-8000-000000000004', false), true, 'unhiding it');
reset role;
select is(pg_temp.state('04'), 'public/public/false', 'makes it public');
update public.decks set publication = 'checking', hidden = true where id = 'd0000000-0000-4000-8000-000000000004';
select pg_temp.sign_in('c');
select is(public.admin_set_deck_hidden('d0000000-0000-4000-8000-000000000004', false), false,
  'a note being checked is not unhidden by hand');
select is(public.admin_unpublish_deck('d0000000-0000-4000-8000-000000000004'), true, 'the admin unpublishes it');
reset role;
select is(pg_temp.state('04'), 'private/private/true', 'it is private');
update public.decks set visibility = 'public', hidden = false where id = 'd0000000-0000-4000-8000-000000000022';
select pg_temp.sign_in('c');
select is(public.admin_remove_deck('d0000000-0000-4000-8000-000000000022', 'copyright'), true, 'the admin removes a public note');
reset role;
select is(pg_temp.state('22'), 'private/private/false', 'it is private');

-- The sweeper.
create function pg_temp.sweep() returns bigint language plpgsql as $$
begin
  delete from net.http_request_queue;
  perform private.sweep_deck_screening();
  return (select count(*) from net.http_request_queue);
end;
$$;
update private.deck_screening set requested_at = now() - interval '1 minute';
update public.decks set publication = 'checking', visibility = 'public', hidden = true, published_at = now() where id = 'd0000000-0000-4000-8000-000000000003';
update private.deck_screening set requested_at = now() - interval '1 minute' where deck_id = 'd0000000-0000-4000-8000-000000000003';
select is(pg_temp.sweep(), 0::bigint, 'a due note and no secrets: nothing requested');
select vault.create_secret('https://example.supabase.co/functions/v1/publish-note', 'screening_function_url');
select is(pg_temp.sweep(), 0::bigint, 'a due note and no key: nothing requested');
select vault.create_secret('service-key', 'assistant_service_role_key');
select is(pg_temp.sweep(), 1::bigint, 'a due note and both secrets: the worker requested once');
select results_eq($$select method::text, url, headers ->> 'Authorization', headers ->> 'apikey' from net.http_request_queue$$,
  $$values ('POST', 'https://example.supabase.co/functions/v1/publish-note/work', 'Bearer service-key', 'service-key')$$,
  'a POST to the work route with the service key');
update public.decks set publication = 'private', visibility = 'private' where id = 'd0000000-0000-4000-8000-000000000003';
update public.decks set publication = 'private', visibility = 'private' where publication in ('checking', 'public') and id <> 'd0000000-0000-4000-8000-000000000003';
select is(pg_temp.sweep(), 0::bigint, 'no note due: nothing requested');
select is((select schedule from cron.job where jobname = 'sweep-deck-screening'), '* * * * *', 'cron runs it every minute');
select pg_temp.sign_in('a');
select throws_ok($$select private.sweep_deck_screening()$$, '42501', null, 'no client reaches the sweep');
reset role;

-- The revert.
select lives_ok($$select private.revert_publish_screening()$$, 'the revert runs');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'decks' and column_name = 'publication'),
  0::bigint, 'the column is gone');
select is((select count(*) from cron.job where jobname = 'sweep-deck-screening'), 0::bigint, 'the job is gone');
select is((select count(*) from pg_proc as p join pg_namespace as n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and (p.proname like '%screening%' and p.proname <> 'revert_publish_screening'
      or p.proname in ('guard_deck_publication', 'recheck_decks', 'note_content_hash', 'card_hash'))),
  0::bigint, 'and its functions');
select is((select count(*) from pg_trigger where tgname in ('decks_guard_publication', 'decks_stamp_screening', 'cards_recheck_inserted', 'cards_recheck_updated')),
  0::bigint, 'and its triggers');
select pg_temp.sign_in('c');
select is(public.admin_unpublish_deck('d0000000-0000-4000-8000-000000000003'), false, 'the replaced functions are back, as they were');
reset role;

select * from finish();
rollback;
