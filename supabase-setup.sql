-- Poseidon Dispatch — Supabase setup
--
-- Paste this whole file into your Supabase project's SQL Editor and press Run.
-- It is safe to run more than once.
--
-- What it makes:
--   shops         one row — your whole shop, as JSON. This is the live copy.
--   shop_backups  the last 30 versions, written automatically on every save.
--
-- Nobody but you can read either one. The policies below tie every row to
-- your login, so even somebody holding your publishable key gets nothing
-- back without your password.

-- ---------------------------------------------------------------- the shop
create table if not exists public.shops (
  owner      uuid primary key references auth.users(id) on delete cascade,
  data       jsonb       not null,
  rev        bigint      not null default 1,
  device     text,
  updated_at timestamptz not null default now()
);

comment on column public.shops.rev is
  'Bumped by one on every write. A device must say which rev it is replacing, '
  'so two devices editing at once collide loudly instead of overwriting.';

-- ------------------------------------------------------------ the history
create table if not exists public.shop_backups (
  id         bigint generated always as identity primary key,
  owner      uuid        not null references auth.users(id) on delete cascade,
  data       jsonb       not null,
  rev        bigint      not null,
  device     text,
  created_at timestamptz not null default now()
);

create index if not exists shop_backups_owner_created
  on public.shop_backups (owner, created_at desc);

-- Keep a snapshot of what was there before each overwrite, and keep the list
-- short — 30 versions is plenty to undo a bad day and still costs nothing.
create or replace function public.snapshot_shop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shop_backups (owner, data, rev, device)
  values (old.owner, old.data, old.rev, old.device);

  delete from public.shop_backups
  where owner = old.owner
    and id not in (
      select id from public.shop_backups
      where owner = old.owner
      order by created_at desc
      limit 30
    );

  return new;
end;
$$;

drop trigger if exists shops_snapshot on public.shops;
create trigger shops_snapshot
  before update on public.shops
  for each row execute function public.snapshot_shop();

-- ------------------------------------------------- lock both tables down
alter table public.shops        enable row level security;
alter table public.shop_backups enable row level security;

drop policy if exists "own shop" on public.shops;
create policy "own shop" on public.shops
  for all
  using      (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- History is readable and deletable, never editable by hand.
drop policy if exists "own history" on public.shop_backups;
create policy "own history" on public.shop_backups
  for select using (owner = (select auth.uid()));

drop policy if exists "clear own history" on public.shop_backups;
create policy "clear own history" on public.shop_backups
  for delete using (owner = (select auth.uid()));

-- The trigger writes history on your behalf, so no insert policy is needed:
-- it runs as the function's owner, not as you.

-- ------------------------------------------- hand the API these two tables
-- Needed when "Automatically expose new tables" is switched off at project
-- creation, which is what Supabase recommends and what you should do: nothing
-- is reachable through the API unless it is named here.
--
-- Note who is missing. The anon role — the one your publishable key maps to
-- before anybody signs in — is granted nothing at all, so that key on its own
-- cannot read a single row. Everything below requires a signed-in user, and
-- the policies above then narrow it to that user's own rows.
--
-- History is select and delete only. Nothing hand-edits an old version; the
-- trigger writes those, running as its owner rather than as you.

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.shops        to authenticated;
grant select, delete                 on public.shop_backups to authenticated;

revoke all on public.shops        from anon;
revoke all on public.shop_backups from anon;
