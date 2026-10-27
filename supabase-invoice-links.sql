-- Poseidon Dispatch — the invoice the customer opens
--
-- Instead of saving a PDF and attaching it, the app publishes the invoice
-- under a long random token and texts or emails a link. They open it on
-- their phone, see the whole thing — letterhead, the work, before and after,
-- their signature, the total — and pay from the same page.
--
-- Run it like the others: SQL Editor, New query, paste, Run.
-- Safe to run more than once.
--
-- Same shape as the signing links: `anon` gets no rights on the table at
-- all, only permission to call two functions that each demand the token.

create table if not exists public.invoice_links (
  token       text primary key,
  owner       uuid not null references auth.users(id) on delete cascade,
  job_id      text not null,
  payload     jsonb not null,          -- the invoice, frozen as it was sent
  viewed_at   timestamptz,             -- so he knows they opened it
  view_count  int not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- Written by the Stripe webhook, never by the customer's page and never by
  -- the app. The app reads them and marks the job paid on its next sync.
  paid_at     timestamptz,
  paid_amount numeric,
  paid_ref    text
);

-- Safe to re-run against a table made before the Stripe webhook existed.
alter table public.invoice_links add column if not exists paid_at     timestamptz;
alter table public.invoice_links add column if not exists paid_amount numeric;
alter table public.invoice_links add column if not exists paid_ref    text;

create index if not exists invoice_links_owner_idx on public.invoice_links (owner);

alter table public.invoice_links enable row level security;

-- ------------------------------------------------------------ him, signed in
drop policy if exists "owner reads own invoices"   on public.invoice_links;
create policy "owner reads own invoices" on public.invoice_links
  for select to authenticated using (owner = (select auth.uid()));

drop policy if exists "owner writes own invoices"  on public.invoice_links;
create policy "owner writes own invoices" on public.invoice_links
  for insert to authenticated with check (owner = (select auth.uid()));

drop policy if exists "owner updates own invoices" on public.invoice_links;
create policy "owner updates own invoices" on public.invoice_links
  for update to authenticated using (owner = (select auth.uid()))
         with check (owner = (select auth.uid()));

drop policy if exists "owner deletes own invoices" on public.invoice_links;
create policy "owner deletes own invoices" on public.invoice_links
  for delete to authenticated using (owner = (select auth.uid()));

grant select, insert, update, delete on public.invoice_links to authenticated;

-- --------------------------------------------------- the customer, not signed in
revoke all on public.invoice_links from anon;

-- Fetch one invoice, by token. A token that does not exist and one that has
-- expired look exactly the same from outside.
create or replace function public.invoice_for_viewing(p_token text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select l.payload
    from public.invoice_links l
   where l.token = p_token
     and l.expires_at > now();
$$;

-- "They opened it." Worth knowing before chasing somebody who never did.
create or replace function public.mark_invoice_viewed(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.invoice_links
     set viewed_at = coalesce(viewed_at, now()),
         view_count = view_count + 1
   where token = p_token
     and expires_at > now();
$$;

revoke all on function public.invoice_for_viewing(text) from public, anon, authenticated;
revoke all on function public.mark_invoice_viewed(text) from public, anon, authenticated;
grant execute on function public.invoice_for_viewing(text) to anon, authenticated;
grant execute on function public.mark_invoice_viewed(text) to anon, authenticated;

-- A NOTE ON GETTING PAID
--
-- Stripe tells nobody by itself. An Edge Function listening to Stripe writes
-- paid_at here using the service role, and the app marks the job paid the
-- next time it looks. The customer's page cannot write these columns — anon
-- has no rights on this table at all — and the app does not write them
-- either. Only the webhook does.

-- A NOTE ON THE PHOTOS
--
-- Job photos live in a private bucket only Allen can read, and the customer
-- is not signed in to anything. So at the moment he sends the invoice, the
-- app mints a signed link for each photo that lasts as long as the invoice
-- link does, and stores those in the payload. Nothing in the bucket is made
-- public; the links are inside a payload that needs the token to reach.
