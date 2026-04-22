-- GDPR Article 17 (right to erasure) completeness.
--
-- Existing `delete_user` RPC removes auth.users, which cascades through the
-- FK chain (profiles → stones → finds → etc.), but the user's uploaded
-- photos in storage.objects are orphaned. They have no FK; they're keyed
-- only by the folder prefix `photos/<user_id>/…`.
--
-- This rewrite of `delete_user` deletes those storage objects first, then
-- proceeds with the auth.users delete. SECURITY DEFINER gives the function
-- rights to write to the storage schema, which users normally can't do
-- directly (they can only delete their own objects via RLS, but only one at
-- a time from the client).

create or replace function delete_user()
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 1. Remove user's photos from the photos bucket (no FK to drive cascade).
  delete from storage.objects
    where bucket_id = 'photos'
      and (storage.foldername(name))[1] = v_user_id::text;

  -- 2. Delete the auth row — cascades to public.profiles and everything
  --    keyed to it (balance_events, stones, finds, find_proofs,
  --    stone_reports, messages, push_tokens, moderation_events).
  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function delete_user() from public;
grant execute on function delete_user() to authenticated;
