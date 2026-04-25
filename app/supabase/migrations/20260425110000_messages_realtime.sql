-- Enable Supabase Realtime on the messages table.
--
-- Without this, postgres_changes subscriptions never fire, and chat
-- looks broken: messages only appear after a manual pull-to-refresh.
--
-- Idempotent: skips ADD TABLE if messages is already in the publication
-- (re-running the migration on staging/prod is safe).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Replica identity FULL so UPDATE/DELETE payloads include the old row.
-- Not strictly required by current chat client (it just re-fetches on
-- any change), but cheap to set and avoids a footgun if a future change
-- starts using payload.old.
alter table public.messages replica identity full;
