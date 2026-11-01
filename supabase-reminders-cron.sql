-- Poseidon Dispatch — when the night-before buzz goes out.
--
-- Run this AFTER Victor has deployed the nightly-reminder function, not
-- before: it only sets the alarm clock, it doesn't make the thing it rings.
--
-- Two values to fill in below, both from Supabase:
--   <PROJECT-REF>  Project Settings → General → Reference ID
--   <SERVICE-KEY>  Project Settings → API → service_role key
--
-- The service_role key is the SECRET one. It belongs in this SQL editor and
-- nowhere else — never in the app, never in a link, never in the repo.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 7:30pm Edmonton. cron.schedule runs on UTC, and Edmonton is UTC-7 in
-- summer and UTC-6 in winter, so this is set twice and each half only fires
-- in its own season. Without that the buzz would drift an hour every spring.
select cron.unschedule('poseidon-reminder-mdt') where exists
  (select 1 from cron.job where jobname = 'poseidon-reminder-mdt');
select cron.unschedule('poseidon-reminder-mst') where exists
  (select 1 from cron.job where jobname = 'poseidon-reminder-mst');

-- summer (MDT, UTC-6): 19:30 local = 01:30 UTC next day
select cron.schedule('poseidon-reminder-mdt', '30 1 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/nightly-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE-KEY>"}'::jsonb,
    body    := '{}'::jsonb
  ) where (now() at time zone 'America/Edmonton')::time
          between '19:00' and '20:00';
$$);

-- winter (MST, UTC-7): 19:30 local = 02:30 UTC next day
select cron.schedule('poseidon-reminder-mst', '30 2 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/nightly-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE-KEY>"}'::jsonb,
    body    := '{}'::jsonb
  ) where (now() at time zone 'America/Edmonton')::time
          between '19:00' and '20:00';
$$);

-- Both jobs fire every day, but the time check means only the one that
-- lands in the 7pm hour locally actually calls out. The other does nothing.

-- To see it worked:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
