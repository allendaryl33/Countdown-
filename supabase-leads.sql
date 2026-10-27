-- Poseidon Dispatch — website leads
--
-- The website writes every inquiry into public.inquiries, in the SAME
-- Supabase project the dispatch app syncs to. So there is no pipe to build
-- and nothing for the website to send anywhere new: the app is already
-- signed in to the database the leads are sitting in. This just opens a
-- window between the two rooms.
--
-- The app only ever READS that table. It never inserts, updates or deletes
-- a row of it. The table belongs to the website, and a bug in dispatch must
-- not be able to break the thing that is taking the calls.
--
-- Run it the same way as the other two: SQL Editor, New query, paste, Run.

-- =====================================================================
-- STEP 1 — look before touching anything.
--
-- Run this part on its own FIRST and read what comes back. It changes
-- nothing. It answers two questions: can the app read the table, and can
-- anybody else?
-- =====================================================================

select 'row security on?' as question,
       case when c.relrowsecurity then 'yes' else 'NO — anyone with the key can read every lead' end as answer
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'inquiries';

select 'policy' as kind, policyname, cmd, roles::text
  from pg_policies
 where schemaname = 'public' and tablename = 'inquiries'
 order by policyname;

select 'grant' as kind, grantee, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'inquiries'
   and grantee in ('anon','authenticated')
 order by grantee, privilege_type;

-- WHAT TO LOOK FOR
--
-- The publishable key is in your website's page source. Anyone can read it.
-- It is fine for that key to be able to INSERT an inquiry — that is how the
-- form works. It is NOT fine for it to SELECT them: that would mean anybody
-- who views the source of your site could pull every name, phone number and
-- address that has ever been through the form.
--
-- So: `anon` with INSERT = correct. `anon` with SELECT = fix it (step 3).

-- =====================================================================
-- STEP 2 — let the app read the table. Safe; adds nothing for anyone else.
-- =====================================================================

grant usage on schema public to authenticated;
grant select on public.inquiries to authenticated;

-- With row security on, a grant alone is not enough — there has to be a
-- policy as well. This one lets a signed-in user (you, on your own devices)
-- read inquiries and nobody else do anything new.
drop policy if exists "dispatch reads inquiries" on public.inquiries;
create policy "dispatch reads inquiries" on public.inquiries
  for select to authenticated using (true);

-- =====================================================================
-- STEP 3 — ONLY IF step 1 showed `anon` can SELECT.
--
-- Read this before running it. Removing anon's read is right, but if the
-- website's form reads the row back after inserting it (a .select() chained
-- onto the .insert()), this will break the form. That is a one-line change
-- on the website's side, and Victor would need to make it.
--
-- So: uncomment, run, then GO AND SUBMIT YOUR OWN FORM to check it still
-- works. If it doesn't, run the revert at the bottom and talk to Victor
-- before trying again.
-- =====================================================================

-- alter table public.inquiries enable row level security;
-- revoke select on public.inquiries from anon;
--
-- drop policy if exists "website can submit" on public.inquiries;
-- create policy "website can submit" on public.inquiries
--   for insert to anon with check (true);

-- revert, if the form stops working:
-- grant select on public.inquiries to anon;
