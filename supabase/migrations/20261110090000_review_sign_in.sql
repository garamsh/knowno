-- The App Review address signs in with a fixed code kept in Vault (#835, ADR 0226): the attempt
-- limit and the read of the two secrets for the `review-sign-in` Edge Function.
--
-- `private.review_sign_in_attempts` records each attempt, by the hex SHA-256 of the address tried
-- and never the address, and a row is deleted a day after it. `public.review_sign_in_begin`
-- records one, and answers whether it may go on: no, when the address has made over 5 attempts in
-- the last 10 minutes or the function over 20, and then no secret is read. Otherwise it answers the
-- Vault secrets `review_sign_in_email` and `review_sign_in_code`, each null while the owner has
-- created none. Every attempt counts, whatever the address, so a limit tells nothing of which
-- address is the review address. Only service_role executes it.
--
-- Changes no row and no existing object, and stores no secret: the owner creates the two secrets.
--
-- Revert, run once against production: `select private.revert_review_sign_in();`, then
-- `drop function private.revert_review_sign_in();`. It drops the function and the table, with the
-- attempts; the Vault secrets stay.

create table private.review_sign_in_attempts (
  id bigint generated always as identity primary key,
  address_key text not null,
  at timestamptz not null default now()
);
create index review_sign_in_attempts_at_idx on private.review_sign_in_attempts (at);
alter table private.review_sign_in_attempts enable row level security;
revoke all on table private.review_sign_in_attempts from public, anon, authenticated, service_role;

-- Records an attempt by [address_key] and answers whether it may go on and, if so, the two secrets.
create function public.review_sign_in_begin(address_key text)
returns table (allowed boolean, email text, code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  by_address bigint;
  overall bigint;
begin
  delete from private.review_sign_in_attempts as a where a.at < now() - interval '1 day';
  insert into private.review_sign_in_attempts (address_key)
    values (review_sign_in_begin.address_key);
  select count(*) filter (where a.address_key = review_sign_in_begin.address_key), count(*)
    into by_address, overall
    from private.review_sign_in_attempts as a
    where a.at > now() - interval '10 minutes';
  if by_address > 5 or overall > 20 then
    return query select false, null::text, null::text;
    return;
  end if;
  return query select true,
    (select d.decrypted_secret from vault.decrypted_secrets as d
      where d.name = 'review_sign_in_email'),
    (select d.decrypted_secret from vault.decrypted_secrets as d
      where d.name = 'review_sign_in_code');
end;
$$;

revoke all on function public.review_sign_in_begin(text) from public, anon, authenticated;
grant execute on function public.review_sign_in_begin(text) to service_role;

-- The revert in the header.
create function private.revert_review_sign_in() returns void
language plpgsql
security definer
set search_path = ''
as $revert$
begin
  drop function public.review_sign_in_begin(text);
  drop table private.review_sign_in_attempts;
end;
$revert$;

revoke all on function private.revert_review_sign_in() from public, anon, authenticated;
