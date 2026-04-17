-- ═══════════════════════════════════════════════════════════════════
-- Migration 008: Storage policies for photos bucket
-- ═══════════════════════════════════════════════════════════════════
--
-- Photos are uploaded from the app (stone photos, profile avatars,
-- chat attachments). Without Storage policies, the bucket is either
-- fully public (leaks) or fully private (app can't read).
--
-- Policy goals:
--   - Authenticated users can UPLOAD to `photos/<user_id>/*` (own folder)
--   - Anyone authenticated can READ photos (they're public-ish anyway)
--   - Users can DELETE their own photos
--   - Max file size 2 MB (set in bucket config via dashboard)
--   - Only image/* MIME types
--
-- NOTE: Run this AFTER creating the `photos` bucket in Supabase
-- Dashboard → Storage → New Bucket → name=photos, public=false,
-- file size limit=2MB, allowed mime types=image/jpeg,image/png,image/webp
-- ═══════════════════════════════════════════════════════════════════

-- Drop existing policies if any (idempotent)
drop policy if exists "photos_read_authenticated" on storage.objects;
drop policy if exists "photos_upload_own_folder" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;

-- READ: any authenticated user can read
create policy "photos_read_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'photos');

-- INSERT: users can upload only to their own folder (photos/<user_id>/...)
create policy "photos_upload_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE: users can delete their own photos
create policy "photos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE: users can update metadata on own photos (rarely needed)
create policy "photos_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop policy if exists "photos_read_authenticated" on storage.objects;
-- drop policy if exists "photos_upload_own_folder" on storage.objects;
-- drop policy if exists "photos_delete_own" on storage.objects;
-- drop policy if exists "photos_update_own" on storage.objects;
