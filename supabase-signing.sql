-- Poseidon Dispatch — estimates signed from a link
--
-- For the estimates he can't get signed in person: the app publishes one
-- estimate to this table under a long random token and sends the customer a
-- link. They open it on their phone, sign, and it comes back.
--
-- Run it the same way as the others: SQL Editor, New query, paste, Run.
-- Safe to run more than once.
--
-- THE SHAPE OF IT
--
-- The customer is not signed in and never will be, so the page they open
-- talks to the database as `anon` — the same role as the website form. That
-- role is given NO access to this table at all. Not select, not insert.
--
-- Instead it may call exactly two functions, and each one demands the token.
-- Knowing a token gets you one estimate. Not knowing one gets you nothing,
-- and there is no way to list them or guess your way across to another.

create table if not exists public.estimate_links (
  token        text primary key,
  owner        uuid not null references auth.users(id) on delete cascade,
  estimate_id  text not null,
  payload      jsonb not null,          -- the frozen estimate, as they'll see it
  signer_name  text,
  signer_role  text,
  signature    text,                    -- png data url
  signed_at    timestamptz,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists estimate_links_owner_idx on public.estimate_links (owner);

alter table public.estimate_links enable row level security;

-- ------------------------------------------------------------ him, signed in
drop policy if exists "owner reads own links"   on public.estimate_links;
create policy "owner reads own links" on public.estimate_links
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "owner writes own links"  on public.estimate_links;
create policy "owner writes own links" on public.estimate_links
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "owner updates own links" on public.estimate_links;
create policy "owner updates own links" on public.estimate_links
  for update to authenticated using (owner = (select auth.uid()))
         with check (owner = (select auth.uid()));

drop policy if exists "owner deletes own links" on public.estimate_links;
create policy "owner deletes own links" on public.estimate_links
  for delete to authenticated using (owner = (select auth.uid()));

grant select, insert, update, delete on public.estimate_links to authenticated;

-- --------------------------------------------------- the customer, not signed in
-- No table rights whatsoever.
revoke all on public.estimate_links from anon;

-- Fetch one estimate, by token. Returns nothing for a token that does not
-- exist, has expired, or was never real — all three look identical from
-- outside, which is the point.
create or replace function public.estimate_for_signing(p_token text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'payload',     l.payload,
           'signed',      (l.signed_at is not null),
           'signer_name', l.signer_name,
           'signed_at',   l.signed_at
         )
    from public.estimate_links l
   where l.token = p_token
     and l.expires_at > now();
$$;

-- Sign it. Once. A second attempt on the same token changes nothing and says
-- so, rather than overwriting the first signature.
create or replace function public.sign_estimate(
  p_token text, p_name text, p_role text, p_signature text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if coalesce(trim(p_name), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name required');
  end if;
  -- A real signature is a png data url of some size. This is not security,
  -- it just stops an empty box being recorded as agreement.
  if coalesce(p_signature, '') !~ '^data:image/png;base64,' or length(p_signature) < 200 then
    return jsonb_build_object('ok', false, 'reason', 'signature required');
  end if;
  if length(p_signature) > 400000 then
    return jsonb_build_object('ok', false, 'reason', 'signature too large');
  end if;

  update public.estimate_links
     set signer_name = trim(p_name),
         signer_role = nullif(trim(coalesce(p_role, '')), ''),
         signature   = p_signature,
         signed_at   = now()
   where token = p_token
     and expires_at > now()
     and signed_at is null;

  get diagnostics n = row_count;
  if n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'already signed, or the link has expired');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.estimate_for_signing(text) from public, anon, authenticated;
revoke all on function public.sign_estimate(text, text, text, text) from public, anon, authenticated;
grant execute on function public.estimate_for_signing(text) to anon, authenticated;
grant execute on function public.sign_estimate(text, text, text, text) to anon, authenticated;

-- WHAT THIS MEANS IN PLAIN WORDS
--
-- The link is the key. Anyone holding it can see that one estimate and sign
-- it, exactly like a DocuSign link, so don't post one anywhere public. It
-- reaches nothing else: not your customers, not your pricing, not your other
-- estimates, not the shop.
--
-- Links expire. After that the page says so and the token is dead.
