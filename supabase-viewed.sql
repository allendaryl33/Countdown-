-- Poseidon Dispatch — did they open it?
--
-- "Sent three days ago, never opened" and "opened four times, no answer" are
-- two completely different phone calls. The app could already tell you an
-- estimate was signed; this tells you whether it was ever looked at.
--
-- Run it the same way as the others: SQL Editor, New query, paste, Run.
-- Safe to run more than once.
--
-- Invoices already carried this. Estimates did not, and nothing displayed
-- either. This adds the estimate half and the app shows both.

alter table public.estimate_links add column if not exists viewed_at  timestamptz;
alter table public.estimate_links add column if not exists view_count int not null default 0;

-- Stamped by the customer's page when it opens. The customer has no rights
-- on this table at all — the function is security definer, so it writes on
-- their behalf and they still cannot read, list or alter a single row.
--
-- A token that is wrong or expired updates nothing and returns nothing,
-- which is the same as every other answer this table gives a stranger.
create or replace function public.mark_estimate_viewed(p_token text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.estimate_links
     set viewed_at  = coalesce(viewed_at, now()),
         view_count = view_count + 1
   where token = p_token
     and expires_at > now();
$$;

revoke all on function public.mark_estimate_viewed(text) from public, anon, authenticated;
grant execute on function public.mark_estimate_viewed(text) to anon, authenticated;

-- WHAT IT DOES NOT TELL YOU
--
-- That they read it. Only that the page was opened on some device holding
-- the link. If you open your own link to check it, that counts as a view —
-- so the first one is often yours.
