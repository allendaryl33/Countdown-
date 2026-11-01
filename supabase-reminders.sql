-- Poseidon Dispatch — the night-before reminder.
--
-- Run this whole file once in the Supabase SQL editor, the same way as the
-- others. It makes somewhere to keep the phone's push subscription, and two
-- functions the app calls to add and remove one.
--
-- As with the signing tables, anon gets NO rights on the table itself. The
-- only things reachable without a login are the two security definer
-- functions below, and neither of them can read anything back out.

create table if not exists push_subs (
  endpoint   text primary key,
  p256dh     text not null,
  auth       text not null,
  shop       text not null default 'shop',
  created_at timestamptz not null default now(),
  last_sent  timestamptz,
  fail_count int not null default 0
);

alter table push_subs enable row level security;
revoke all on push_subs from anon, authenticated;

-- Add or refresh this phone's subscription. The endpoint is the identity:
-- re-enabling on the same phone updates the row rather than piling up.
create or replace function save_push_sub(
  p_endpoint text, p_p256dh text, p_auth text, p_shop text default 'shop'
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint is null or length(p_endpoint) < 20 then
    raise exception 'bad endpoint';
  end if;
  insert into push_subs (endpoint, p256dh, auth, shop)
  values (p_endpoint, p_p256dh, p_auth, coalesce(p_shop, 'shop'))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh,
        auth   = excluded.auth,
        shop   = excluded.shop,
        fail_count = 0;
end $$;

-- Turning reminders off, or the phone retiring a subscription.
create or replace function drop_push_sub(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from push_subs where endpoint = p_endpoint;
end $$;

revoke all on function save_push_sub(text,text,text,text) from public;
revoke all on function drop_push_sub(text) from public;
grant execute on function save_push_sub(text,text,text,text) to anon;
grant execute on function drop_push_sub(text) to anon;
