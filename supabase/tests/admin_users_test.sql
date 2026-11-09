-- The admin area's users and decks (ADR 0072): suspension blocks a user's sync writes and sets the
-- ban Supabase Auth reads, against an active user as control; a removed deck stays private; a
-- user's decks read for an admin only; and no admin function writes an email, a password or a
-- profile field.
begin;
select plan(40);

-- The log starts empty here: a migration may record a change of its own, as
-- 20261019230003_activate_prompt_v9.sql records prompt v9's activation.
delete from private.admin_audit;

-- A is an admin, B a signed-in user who is not, C the user acted on, D an active user.
insert into auth.users (id, email, encrypted_password, raw_user_meta_data) values
  ('00000000-0000-4000-8000-00000000000a', 'admin@example.com', 'hash-a', '{"name": "A"}'),
  ('00000000-0000-4000-8000-00000000000b', 'user@example.com', 'hash-b', '{"name": "B"}'),
  ('00000000-0000-4000-8000-00000000000c', 'carol@example.com', 'hash-c', '{"name": "Carol"}'),
  ('00000000-0000-4000-8000-00000000000d', 'acarol@example.com', 'hash-d', '{"name": "D"}');
insert into private.admins (user_id) values ('00000000-0000-4000-8000-00000000000a');
insert into public.profiles (user_id, display_name) values ('00000000-0000-4000-8000-00000000000c', 'Carol');
insert into public.decks (id, user_id, name, visibility, published_at, created_at, updated_at) values
  ('d0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'Public', 'public', now(), now() - interval '2 days', now() - interval '1 hour'),
  ('d0000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-00000000000c', 'Diary', 'private', null, now() - interval '1 day', now()),
  ('d0000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000d', 'Active', 'private', null, now(), now());
insert into public.cards (id, user_id, deck_id, front, back, card_key, source, created_at, updated_at) values
  ('c0000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-00000000000c', 'd0000000-0000-4000-8000-0000000000c2',
    '[{"type":"text","payload":{"text":"secret"}}]', '[]', 'secret', 'manual', now(), now()),
  ('c0000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-00000000000d', 'd0000000-0000-4000-8000-0000000000d1',
    '[]', '[]', 'k', 'manual', now(), now());

-- Signs in as the user whose id ends in [who], or as anon for null.
create function pg_temp.sign_in(who text) returns void language plpgsql as $$
begin
  if who is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      format('{"sub":"00000000-0000-4000-8000-00000000000%s","role":"authenticated"}', who), true);
  end if;
end;
$$;
grant execute on function pg_temp.sign_in(text) to public;

-- Every new admin function, called with arguments that change nothing.
create function pg_temp.calls() returns setof text language sql as $$
  values
    ($q$select public.admin_suspend_user('00000000-0000-4000-8000-00000000ffff', 'x')$q$),
    ($q$select public.admin_unsuspend_user('00000000-0000-4000-8000-00000000000d')$q$),
    ($q$select * from public.admin_user_suspension('00000000-0000-4000-8000-00000000000d')$q$),
    ($q$select * from public.admin_user_decks('00000000-0000-4000-8000-00000000000c')$q$),
    ($q$select * from public.admin_user_deck('d0000000-0000-4000-8000-0000000000c2')$q$),
    ($q$select * from public.admin_user_deck_cards('d0000000-0000-4000-8000-0000000000c2')$q$),
    ($q$select public.admin_remove_deck('d0000000-0000-4000-8000-00000000ffff', 'x')$q$)
$$;
grant execute on function pg_temp.calls() to public;

create function pg_temp.refused_as(who text) returns setof text language plpgsql as $$
declare
  call text;
begin
  for call in select * from pg_temp.calls() loop
    -- A refusal rolls the block back, the sign-in with it.
    begin
      perform pg_temp.sign_in(who);
      execute call;
      perform set_config('role', 'none', true);
    exception
      when insufficient_privilege then
        return next call;
      when others then
        return next 'failed: ' || call || ': ' || sqlerrm;
    end;
  end loop;
end;
$$;

-- What no admin function may change: each user's email, password, phone and metadata, and the profiles.
create function pg_temp.personal() returns text language sql as $$
  select md5(string_agg(concat_ws('|', u.id, u.email, u.encrypted_password, u.phone,
      u.raw_user_meta_data::text, u.raw_app_meta_data::text, p.display_name), ',' order by u.id))
  from auth.users as u left join public.profiles as p on p.user_id = u.id;
$$;
create temp table personal_before as select pg_temp.personal() as digest;

-- The role.

select results_eq(
  $$select count(*) from pg_temp.refused_as('b') as r (call) where call not like 'failed: %'$$,
  $$values (7::bigint)$$, 'a signed-in user who is not an admin is refused by every new admin function');
reset role;
select results_eq(
  $$select count(*) from pg_temp.refused_as(null) as r (call) where call not like 'failed: %'$$,
  $$values (7::bigint)$$, 'anon is refused by every new admin function');
reset role;
select is_empty($$select * from pg_temp.refused_as('a')$$, 'control: an admin is refused by none, and none fails');
reset role;

select pg_temp.sign_in('b');
select throws_ok($$select public.user_suspended('00000000-0000-4000-8000-00000000000b')$$, '42501', null,
  'a signed-in user cannot ask whether another user is suspended');
select throws_ok($$select * from private.suspensions$$, '42501', null, 'nor read the suspensions');
select is((select public.is_suspended()), false, 'it may ask whether it is suspended itself');
reset role;

-- Suspension.

select pg_temp.sign_in('a');
select is(public.admin_suspend_user('00000000-0000-4000-8000-00000000000c', ' spam '), 'suspended', 'suspend C with a reason');
select is(public.admin_suspend_user('00000000-0000-4000-8000-00000000000c', 'again'), 'already', 'suspending again changes nothing');
select is(public.admin_suspend_user('00000000-0000-4000-8000-00000000000a', 'x'), 'self', 'an admin cannot suspend itself');
select is(public.admin_suspend_user('00000000-0000-4000-8000-00000000ffff', 'x'), 'no_user', 'nor a user that does not exist');
select throws_ok($$select public.admin_suspend_user('00000000-0000-4000-8000-00000000000d', '  ')$$, '23514', null,
  'a suspension needs a reason');
select results_eq(
  $$select reason, suspended_by_email from public.admin_user_suspension('00000000-0000-4000-8000-00000000000c')$$,
  $$values ('spam', 'admin@example.com')$$, 'the suspension, its reason and who suspended');
reset role;
select results_eq(
  $$select banned_until > now() + interval '99 years' from auth.users where id = '00000000-0000-4000-8000-00000000000c'$$,
  $$values (true)$$, 'C''s ban is set, which Supabase Auth reads to refuse its sign-in and refresh');
select results_eq(
  $$select banned_until from auth.users where id = '00000000-0000-4000-8000-00000000000d'$$,
  $$values (null::timestamptz)$$, 'control: the active user has no ban');

select pg_temp.sign_in('c');
select is((select public.is_suspended()), true, 'C knows it is suspended');
select throws_ok(
  $$insert into public.decks (id, name, created_at, updated_at) values ('d0000000-0000-4000-8000-0000000000c9', 'New', now(), now())$$,
  '42501', null, 'a suspended user cannot insert a deck');
select throws_ok(
  $$insert into public.cards (id, deck_id, front, back, card_key, source, created_at, updated_at)
    values ('c0000000-0000-4000-8000-0000000000c9', 'd0000000-0000-4000-8000-0000000000c2', '[]', '[]', 'n', 'manual', now(), now())$$,
  '42501', null, 'nor a card');
select throws_ok(
  $$insert into public.reviews (id, card_id, rating, reviewed_at, duration_ms, updated_at)
    values ('e0000000-0000-4000-8000-0000000000c9', 'c0000000-0000-4000-8000-0000000000c1', 'good', now(), 1, now())$$,
  '42501', null, 'nor a review');
select throws_ok(
  $$insert into public.card_states (card_id, stability, difficulty, last_review, due, updated_at)
    values ('c0000000-0000-4000-8000-0000000000c1', 1, 5, now(), now(), now())$$,
  '42501', null, 'nor a card state');
select is_empty(
  $$update public.decks set name = 'Renamed' where id = 'd0000000-0000-4000-8000-0000000000c2' returning id$$,
  'its update changes no row');
select is_empty(
  $$delete from public.cards where id = 'c0000000-0000-4000-8000-0000000000c1' returning id$$,
  'its delete removes no row');
select results_eq(
  $$select name from public.decks where id = 'd0000000-0000-4000-8000-0000000000c2'$$,
  $$values ('Diary')$$, 'it still reads its own data, which is kept');
reset role;

select pg_temp.sign_in('d');
select lives_ok(
  $$insert into public.decks (id, name, created_at, updated_at) values ('d0000000-0000-4000-8000-0000000000d9', 'New', now(), now())$$,
  'control: an active user inserts a deck');
select results_eq(
  $$update public.decks set name = 'Renamed' where id = 'd0000000-0000-4000-8000-0000000000d1' returning name$$,
  $$values ('Renamed')$$, 'control: and updates one');
reset role;

select pg_temp.sign_in('a');
select is(public.admin_unsuspend_user('00000000-0000-4000-8000-00000000000c'), true, 'lift C''s suspension');
select is(public.admin_unsuspend_user('00000000-0000-4000-8000-00000000000c'), false, 'lifting it again changes nothing');
reset role;
select results_eq(
  $$select banned_until from auth.users where id = '00000000-0000-4000-8000-00000000000c'$$,
  $$values (null::timestamptz)$$, 'C''s ban is cleared');
select pg_temp.sign_in('c');
select lives_ok(
  $$insert into public.decks (id, name, created_at, updated_at) values ('d0000000-0000-4000-8000-0000000000c9', 'New', now(), now())$$,
  'C writes again');
reset role;

-- Decks.

select pg_temp.sign_in('a');
select results_eq(
  $$select name, visibility, cards from public.admin_user_decks('00000000-0000-4000-8000-00000000000c')$$,
  $$values ('New', 'private', 0::bigint), ('Diary', 'private', 1::bigint), ('Public', 'public', 0::bigint)$$,
  'every live deck of a user, private ones included, newest first');
select results_eq(
  $$select name, owner_email from public.admin_user_deck('d0000000-0000-4000-8000-0000000000c2')$$,
  $$values ('Diary', 'carol@example.com')$$, 'a private deck, read-only');
select results_eq(
  $$select front->0->'payload'->>'text' from public.admin_user_deck_cards('d0000000-0000-4000-8000-0000000000c2')$$,
  $$values ('secret')$$, 'and its cards');

select is(public.admin_remove_deck('d0000000-0000-4000-8000-0000000000c1', 'copyright'), true, 'remove a public deck from sharing');
select is(public.admin_remove_deck('d0000000-0000-4000-8000-0000000000c1', 'again'), false, 'removing it again changes nothing');
select results_eq(
  $$select visibility, removal_reason from public.admin_user_deck('d0000000-0000-4000-8000-0000000000c1')$$,
  $$values ('private', 'copyright')$$, 'the deck is private, with the reason');
reset role;
select pg_temp.sign_in('c');
select throws_ok(
  $$select public.request_deck_publication('d0000000-0000-4000-8000-0000000000c1')$$,
  '42501', 'removed from sharing', 'its owner cannot publish a removed deck again');
select results_eq(
  $$select public.request_deck_publication('d0000000-0000-4000-8000-0000000000c2')$$,
  $$values ('checking')$$, 'control: the owner asks to publish another deck');
reset role;

-- The audit log, and what no admin function may write.

select results_eq(
  $$select action, target_id, detail from private.admin_audit order by id$$,
  $$values
    ('suspend_user', '00000000-0000-4000-8000-00000000000c', '{"email": "carol@example.com", "reason": "spam"}'::jsonb),
    ('unsuspend_user', '00000000-0000-4000-8000-00000000000c', '{"email": "carol@example.com"}'::jsonb),
    ('remove_deck', 'd0000000-0000-4000-8000-0000000000c1', '{"name": "Public", "reason": "copyright"}'::jsonb)$$,
  'each change is recorded once, and the refusals and no-ops not at all');

-- Every admin write function, called on C by an admin, then personal data compared.
select pg_temp.sign_in('a');
select public.admin_suspend_user('00000000-0000-4000-8000-00000000000c', 'x');
select public.admin_unsuspend_user('00000000-0000-4000-8000-00000000000c');
select public.admin_grant_plan('00000000-0000-4000-8000-00000000000c', 'pro');
select public.admin_revoke_plan('00000000-0000-4000-8000-00000000000c');
select public.admin_grant_admin('carol@example.com');
select public.admin_revoke_admin('00000000-0000-4000-8000-00000000000c');
select public.admin_set_deck_hidden('d0000000-0000-4000-8000-0000000000c2', true);
select public.admin_unpublish_deck('d0000000-0000-4000-8000-0000000000c2');
select public.admin_dismiss_reports('d0000000-0000-4000-8000-0000000000c2');
select public.admin_remove_deck('d0000000-0000-4000-8000-0000000000c2', 'x');
reset role;
select is((select pg_temp.personal()), (select digest from personal_before),
  'after every admin write, no email, password, phone, metadata or profile changed');
-- Each update of auth.users, to its statement's end, and every column its set clause assigns.
create function pg_temp.auth_columns(source text) returns setof text language sql as $$
  select c[1]
  from regexp_matches(source, 'update\s+auth\.users\M([^;]*)', 'gi') as m,
    regexp_matches(regexp_replace(m[1], '\mwhere\M.*$', '', 'i'),
      '(?:\mset|,)\s*(?:\w+\.)?(\w+)\s*=', 'gi') as c;
$$;
select is(
  (select array_agg(column_name order by column_name)
     from pg_temp.auth_columns($$update auth.users as u set banned_until = now(), email = 'x'
       where u.id = '00000000-0000-4000-8000-00000000000c';$$) as column_name),
  array['banned_until', 'email'],
  'control: the check reads every column an update of auth.users assigns, not the first alone');
select is_empty(
  $$select p.proname, column_name from pg_proc as p
      join pg_namespace as n on n.oid = p.pronamespace,
      pg_temp.auth_columns(p.prosrc) as column_name
    where n.nspname in ('public', 'private') and column_name <> 'banned_until'$$,
  'no function in public or private updates an auth.users column but banned_until');

select * from finish();
rollback;
