-- A finding carries `field`, the path of the string its offsets index (#875, ADR 0240): the
-- owner's `my_deck_screening` and the admin's `admin_screening_findings` return it, null for a
-- finding of the note's name or description, and the revert puts the function back without it.
begin;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@example.com'),
  ('00000000-0000-4000-8000-00000000000c', 'admin@example.com');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000c');

create function pg_temp.card_hash(front jsonb, back jsonb, template text, template_version smallint)
returns text language sql security definer as $$
  select private.card_hash(front, back, template, template_version);
$$;
create function pg_temp.hash() returns text language sql security definer as $$
  select private.note_content_hash('d0000000-0000-4000-8000-000000000001');
$$;

insert into public.decks (id, user_id, name, description, created_at, updated_at)
  values ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
    'Deck', 'About', now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at)
  values ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-00000000000a',
    'd0000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('type', 'senses', 'v', 1, 'id', 'b1',
      'payload', jsonb_build_object('senses', jsonb_build_array('one', 'call 010-1234-5678')))),
    '[]', 'k1', 'manual', now(), now());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select public.request_deck_publication('d0000000-0000-4000-8000-000000000001');
reset role;

set local role service_role;
select public.record_screening('d0000000-0000-4000-8000-000000000001', pg_temp.hash(),
  'rules', 'r1+0.0', 'refused', jsonb_build_array(
    jsonb_build_object('card', pg_temp.card_hash(
      (select front from public.cards where id = 'c0000000-0000-4000-8000-000000000001'), '[]', null, null),
      'where', 'front', 'block', 0, 'field', 'senses.1', 'category', 'phone', 'start', 5, 'end', 18),
    jsonb_build_object('card', null, 'where', 'name', 'block', null, 'field', null,
      'category', 'link', 'start', 0, 'end', 4)));
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
select is((public.my_deck_screening('d0000000-0000-4000-8000-000000000001') -> 'findings' -> 0) ->> 'field',
  'senses.1', 'the owner reads the path of the string a finding''s offsets index');
select is(jsonb_typeof(public.my_deck_screening('d0000000-0000-4000-8000-000000000001') -> 'findings' -> 1 -> 'field'),
  'null', 'a finding of the name has a null field, the key present');
reset role;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is((public.admin_screening_findings('d0000000-0000-4000-8000-000000000001', pg_temp.hash())
  -> 'findings' -> 0) ->> 'field', 'senses.1', 'the admin reads it too');
select is((public.admin_screening_findings('d0000000-0000-4000-8000-000000000001', pg_temp.hash())
  -> 'findings' -> 0) ->> 'start', '5', 'beside the offsets it places');
reset role;

select lives_ok($$select private.revert_finding_field()$$, 'the revert runs');
select is(private.screening_findings('d0000000-0000-4000-8000-000000000001', pg_temp.hash()) -> 0 ? 'field',
  false, 'the function is back without the field');
select is(private.screening_findings('d0000000-0000-4000-8000-000000000001', pg_temp.hash()) -> 0 ->> 'category',
  'phone', 'and answers the rest as before');

select * from finish();
rollback;
