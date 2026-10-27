-- Poseidon Dispatch — photos on a website inquiry
--
-- So somebody can photograph the problem instead of describing it. People
-- describe plumbing wrong, reliably, and a photo decides whether the job
-- needs a visit to quote or can be quoted from the truck.
--
-- Run it the same way as the others: SQL Editor, New query, paste, Run.
-- Safe to run more than once.
--
-- THE SHAPE OF IT
--
-- Whoever fills in the form is not signed in, so the upload happens as
-- `anon` — the same role as the form itself. That role may PUT a file into
-- this bucket and do nothing else: it cannot read one back, cannot list what
-- is in there, cannot overwrite, cannot delete. Someone who pulls the key out
-- of the page source can post a photo nobody will ever see but Allen, which
-- is the worst they can do with it.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inquiry-photos', 'inquiry-photos', false, 8388608,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------- the person filling in the form
-- Write only. No select, no update, no delete: a photo that goes in cannot be
-- read back, replaced or removed by whoever put it there.
drop policy if exists "inquiry photo upload" on storage.objects;
create policy "inquiry photo upload" on storage.objects
  for insert to anon with check (bucket_id = 'inquiry-photos');

-- ------------------------------------------------------------------ Allen
drop policy if exists "owner reads inquiry photos" on storage.objects;
create policy "owner reads inquiry photos" on storage.objects
  for select to authenticated using (bucket_id = 'inquiry-photos');

drop policy if exists "owner clears inquiry photos" on storage.objects;
create policy "owner clears inquiry photos" on storage.objects
  for delete to authenticated using (bucket_id = 'inquiry-photos');

-- ------------------------------------------------- where the paths are kept
-- The website records which files belong to which inquiry. Adding a column
-- does not disturb anything already in the table or the form that writes it.
alter table public.inquiries
  add column if not exists photos jsonb not null default '[]'::jsonb;

-- WHAT THIS MEANS IN PLAIN WORDS
--
-- Photos sent through the form are private. They are not on a public URL and
-- cannot be reached by guessing one — the app asks for a signed link, good for
-- a few minutes, each time it shows one.
--
-- The 8 MB cap and the image-only list are the whole defence against the
-- bucket being used as free storage by someone who found the key. Keep them.
