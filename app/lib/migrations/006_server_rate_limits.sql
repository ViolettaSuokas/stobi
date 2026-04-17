-- ═══════════════════════════════════════════════════════════════════
-- Migration 006: Server-side rate limits for messages + stones
-- ═══════════════════════════════════════════════════════════════════
--
-- Client-side rate limits (3 sec between chat messages, etc) can be
-- bypassed by anyone who edits the JS bundle. Move to BEFORE INSERT
-- triggers so they cannot be cheated.
--
-- Limits:
--   - messages: max 1 message per 3 seconds per user
--             : max 30 messages per hour per user
--             : max 2000 chars per message (also enforced here)
--   - stones:   max 5 new stones per day per author
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- Messages rate limit
-- ─────────────────────────────────────────────
create or replace function messages_rate_limit()
returns trigger
language plpgsql
as $$
declare
  v_recent_count integer;
  v_last_message_at timestamptz;
begin
  if new.author_id is null then return new; end if;

  -- Length cap (also enforced client-side, but server is the ruler)
  if length(coalesce(new.text, '')) > 2000 then
    raise exception 'message_too_long';
  end if;

  -- Cooldown: 3 seconds between messages
  select max(created_at) into v_last_message_at
    from messages
    where author_id = new.author_id;

  if v_last_message_at is not null and
     v_last_message_at > now() - interval '3 seconds' then
    raise exception 'rate_limit: wait 3 seconds between messages';
  end if;

  -- Hourly cap: 30 messages
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

drop trigger if exists messages_rate_limit_trigger on messages;
create trigger messages_rate_limit_trigger
  before insert on messages
  for each row execute function messages_rate_limit();

-- ─────────────────────────────────────────────
-- Stones rate limit
-- ─────────────────────────────────────────────
create or replace function stones_rate_limit()
returns trigger
language plpgsql
as $$
declare
  v_today_count integer;
begin
  if new.author_id is null then return new; end if;

  -- Length caps
  if length(coalesce(new.name, '')) > 80 then
    raise exception 'stone_name_too_long: max 80 chars';
  end if;
  if length(coalesce(new.description, '')) > 500 then
    raise exception 'stone_description_too_long: max 500 chars';
  end if;

  -- Max 5 stones per author per 24 hours
  select count(*) into v_today_count
    from stones
    where author_id = new.author_id
      and created_at > now() - interval '24 hours';

  if v_today_count >= 5 then
    raise exception 'daily_stone_limit: max 5 new stones per day';
  end if;

  return new;
end;
$$;

drop trigger if exists stones_rate_limit_trigger on stones;
create trigger stones_rate_limit_trigger
  before insert on stones
  for each row execute function stones_rate_limit();

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists messages_rate_limit_trigger on messages;
-- drop trigger if exists stones_rate_limit_trigger on stones;
-- drop function if exists messages_rate_limit();
-- drop function if exists stones_rate_limit();
