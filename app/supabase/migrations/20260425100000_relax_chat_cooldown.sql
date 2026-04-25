-- Relax chat-message cooldown.
--
-- Before: 3 second cooldown between messages, surfaced to the user as
-- a hard alert ("Подожди 3 секунды"). On a fresh chat with two people
-- typing back and forth, every other message tripped it. Felt broken.
--
-- After: 1.5 second cooldown (still anti-spam), and the client now
-- disables the Send button for that duration so users see the wait
-- visually instead of receiving an error.
--
-- Hourly cap (30/h) and length cap (2000) are unchanged.

create or replace function messages_rate_limit()
returns trigger
language plpgsql
as $$
declare
  v_recent_count integer;
  v_last_message_at timestamptz;
begin
  if new.author_id is null then return new; end if;

  if length(coalesce(new.text, '')) > 2000 then
    raise exception 'message_too_long';
  end if;

  select max(created_at) into v_last_message_at
    from messages
    where author_id = new.author_id;

  if v_last_message_at is not null and
     v_last_message_at > now() - interval '1.5 seconds' then
    raise exception 'rate_limit: wait a moment between messages';
  end if;

  select count(*) into v_recent_count
    from messages
    where author_id = new.author_id
      and created_at > now() - interval '1 hour';

  if v_recent_count >= 30 then
    raise exception 'hourly_limit_exceeded: 30 messages per hour';
  end if;

  return new;
end;
$$;
