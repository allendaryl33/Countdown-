-- Poseidon Dispatch — when the night-before buzz goes out.
--
-- Run this AFTER Victor has deployed the nightly-reminder function, not
-- before: it only sets the alarm clock, it doesn't make the thing it rings.
--
-- Three values to fill in below, all from Supabase:
--   <PROJECT-REF>       Project Settings → General → Reference ID
--   <SERVICE-KEY>       Project Settings → API → service_role key
--   <REMINDER-SECRET>   the value of the REMINDER_SECRET function secret
--                       (Edge Functions → Secrets), which the function
--                       checks against the x-reminder-secret header
--
-- The service_role key and the reminder secret are both SECRET. They belong
-- in this SQL editor and nowhere else — never in the app, never in a link,
-- and never committed here. This repo is public, because GitHub Pages will
-- not serve a private one on a free plan, so a real value pasted into this
-- file is a real value published to the world. Fill them in in the editor,
-- leave the placeholders in the file.
--
-- The function returns 401 to anything without the matching header, so the
-- cron jobs stop working the moment REMINDER_SECRET is set and this has not
-- been re-run. If the night-before buzz goes quiet, that is the first thing
-- to check: cron.job_run_details will show the 401.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 7:30pm Edmonton. cron.schedule runs on UTC, so this is set twice and each
-- half only fires when it lands in the 7pm hour locally. Without that the
-- buzz would drift an hour every spring.
--
-- Alberta stopped changing its clocks on 1 November 2026: it is now
-- permanently UTC-6, called Alberta Time. So the second job below no longer
-- fires at all, and the first one runs year round. Both are left in place
-- deliberately. Nothing here needs re-running, and nothing needs deciding:
-- neither job hard-codes an offset, they ask Postgres what the local time
-- actually is, so if the rule changes again this keeps working. If you ever
-- replace that guard with a fixed offset, this breaks the next time a
-- government changes its mind.
select cron.unschedule('poseidon-reminder-mdt') where exists
  (select 1 from cron.job where jobname = 'poseidon-reminder-mdt');
select cron.unschedule('poseidon-reminder-mst') where exists
  (select 1 from cron.job where jobname = 'poseidon-reminder-mst');

-- UTC-6 (was MDT, now Alberta Time all year): 19:30 local = 01:30 UTC next day
select cron.schedule('poseidon-reminder-mdt', '30 1 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/nightly-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE-KEY>","x-reminder-secret":"<REMINDER-SECRET>"}'::jsonb,
    body    := '{}'::jsonb
  ) where (now() at time zone 'America/Edmonton')::time
          between '19:00' and '20:00';
$$);

-- UTC-7 (was MST; dormant since Alberta Time began): 19:30 local = 02:30 UTC
select cron.schedule('poseidon-reminder-mst', '30 2 * * *', $$
  select net.http_post(
    url     := 'https://<PROJECT-REF>.supabase.co/functions/v1/nightly-reminder',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE-KEY>","x-reminder-secret":"<REMINDER-SECRET>"}'::jsonb,
    body    := '{}'::jsonb
  ) where (now() at time zone 'America/Edmonton')::time
          between '19:00' and '20:00';
$$);

-- Both jobs fire every day, but the time check means only the one that
-- lands in the 7pm hour locally actually calls out. The other does nothing.

-- To see it worked:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--
-- A 401 in job_run_details means the header and the function secret do not
-- match. To check the header is in there at all without printing either
-- secret back at yourself:
--
--   select jobname,
--          command like '%x-reminder-secret%' as sends_the_header
--     from cron.job
--    where jobname like 'poseidon-reminder%';
--
-- Both rows should say true. Note that cron.job.command holds the filled-in
-- values, so that table is as sensitive as the keys in it — which was
-- already true of the service_role key before this.
