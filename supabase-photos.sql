-- Poseidon Dispatch — photo storage
--
-- Run this AFTER supabase-setup.sql, the same way: SQL Editor, paste, Run.
-- Safe to run more than once.
--
-- Photos don't go in the shop record. One phone photo is bigger than the
-- entire rest of your shop, so they live in Supabase Storage and the shop
-- only remembers their names.
--
-- The bucket is private. Nothing in it is reachable by a URL alone — every
-- view is signed for a few minutes, for you, after you've signed in. These
-- are photographs of customers' homes, so that matters.

-- ------------------------------------------------------------- the bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- --------------------------------------------------------- who can see it
-- Each file is owned by whoever uploaded it, and only they ever touch it.

drop policy if exists "own photos read"   on storage.objects;
create policy "own photos read" on storage.objects
  for select using (bucket_id = 'job-photos' and owner = (select auth.uid()));

drop policy if exists "own photos write"  on storage.objects;
create policy "own photos write" on storage.objects
  for insert with check (bucket_id = 'job-photos' and owner = (select auth.uid()));

drop policy if exists "own photos update" on storage.objects;
create policy "own photos update" on storage.objects
  for update using (bucket_id = 'job-photos' and owner = (select auth.uid()))
         with check (bucket_id = 'job-photos' and owner = (select auth.uid()));

drop policy if exists "own photos delete" on storage.objects;
create policy "own photos delete" on storage.objects
  for delete using (bucket_id = 'job-photos' and owner = (select auth.uid()));

-- The anon role — what the publishable key is before anyone signs in — is
-- given nothing here, same as the shop tables.
