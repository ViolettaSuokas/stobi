-- Supabase platform now blocks direct DELETE on storage.objects with
-- hint "Direct deletion from storage tables is not allowed. Use the
-- Storage API instead." This broke delete_user() — 20260422170000 was
-- written before the block existed.
--
-- Wrap the storage cleanup in exception-swallow so the auth.users delete
-- still runs. User's identifiable rows (profiles → stones → finds →
-- messages → reports) all cascade correctly. Photos become orphan blobs;
-- a follow-up Edge Function cron (purge-orphan-photos, service-role) is
-- needed to actually delete them. GDPR Article 17 allows up to 30 days.
--
-- Bug surfaced by chaos test 10-content-reports-edges.mjs.

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

  -- Best-effort photo cleanup. Platform policy may block direct DELETE;
  -- if so, swallow the error — GDPR requires data erased within 30 days,
  -- cron reaps orphans.
  begin
    delete from storage.objects
      where bucket_id = 'photos'
        and (storage.foldername(name))[1] = v_user_id::text;
  exception when others then
    -- Log notice only; do not raise.
    raise notice 'delete_user: storage cleanup skipped (%): %', sqlstate, sqlerrm;
  end;

  delete from auth.users where id = v_user_id;
end;
$$;

revoke all on function delete_user() from public;
grant execute on function delete_user() to authenticated;
