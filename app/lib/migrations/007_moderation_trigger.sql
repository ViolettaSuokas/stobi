-- ═══════════════════════════════════════════════════════════════════
-- Migration 007: Server-side content moderation
-- ═══════════════════════════════════════════════════════════════════
--
-- Client-side moderation (moderation.ts) is easily bypassed by editing
-- the JS bundle. Enforce on server for messages, stone names/descriptions,
-- and profile username/bio.
--
-- This is a simple regex-based filter to mirror moderation.ts. For
-- production, replace internals with a call to an external Moderation
-- API (OpenAI Moderation, Perspective API) via pg_net or an Edge
-- Function. This migration sets up the hook.
-- ═══════════════════════════════════════════════════════════════════

-- Banned words table (editable at runtime without code changes)
create table if not exists moderation_banned_words (
  word text primary key,
  lang text,
  severity smallint not null default 2,  -- 1=warn, 2=block
  added_at timestamptz default now()
);

alter table moderation_banned_words enable row level security;
-- No policies → only service_role can read/write (admin only).

-- Seed with a minimal starter list. Violetta: expand via admin UI later.
insert into moderation_banned_words (word, lang, severity) values
  -- Russian
  ('бляд', 'ru', 2), ('сука', 'ru', 2), ('пизд', 'ru', 2), ('хуй', 'ru', 2),
  ('ебан', 'ru', 2), ('нахуй', 'ru', 2), ('пидор', 'ru', 2), ('мудак', 'ru', 2),
  -- English
  ('fuck', 'en', 2), ('shit', 'en', 2), ('bitch', 'en', 2), ('asshole', 'en', 2),
  ('cunt', 'en', 2), ('nigger', 'en', 2), ('faggot', 'en', 2),
  -- Finnish
  ('vittu', 'fi', 2), ('perkele', 'fi', 1), ('paska', 'fi', 2), ('saatana', 'fi', 2),
  ('huora', 'fi', 2)
on conflict (word) do nothing;

-- URL pattern (blocks most links — spam prevention)
create or replace function moderation_contains_url(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text ~* '(https?://|www\.|t\.me/|\.com|\.ru|\.fi|\.net|\.org|\.io|\.app)';
$$;

create or replace function moderation_normalize(p_text text)
returns text
language sql
immutable
as $$
  -- Lowercase, strip common separators used to bypass filters
  select lower(regexp_replace(coalesce(p_text, ''), '[\s\-\.\_\*\#]+', '', 'g'));
$$;

create or replace function moderation_contains_banned(p_text text)
returns text  -- returns matched word, or null
language plpgsql
stable
as $$
declare
  v_norm text := moderation_normalize(p_text);
  v_word text;
begin
  if v_norm = '' then return null; end if;
  for v_word in select word from moderation_banned_words where severity >= 2 loop
    if v_norm like '%' || v_word || '%' then
      return v_word;
    end if;
  end loop;
  return null;
end;
$$;

-- Messages trigger
create or replace function messages_moderation()
returns trigger
language plpgsql
as $$
declare
  v_banned text;
begin
  if moderation_contains_url(new.text) then
    raise exception 'moderation_url_blocked: messages cannot contain links';
  end if;

  v_banned := moderation_contains_banned(new.text);
  if v_banned is not null then
    raise exception 'moderation_profanity: contains banned word';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_moderation_trigger on messages;
create trigger messages_moderation_trigger
  before insert on messages
  for each row execute function messages_moderation();

-- Profiles trigger (username, bio)
create or replace function profiles_moderation()
returns trigger
language plpgsql
as $$
declare
  v_banned text;
begin
  if new.username is distinct from old.username then
    if length(new.username) < 2 or length(new.username) > 32 then
      raise exception 'username_length: must be 2..32 chars';
    end if;
    v_banned := moderation_contains_banned(new.username);
    if v_banned is not null then
      raise exception 'username_moderation';
    end if;
  end if;

  if new.bio is distinct from old.bio and new.bio is not null then
    if length(new.bio) > 280 then
      raise exception 'bio_too_long: max 280 chars';
    end if;
    if moderation_contains_url(new.bio) then
      raise exception 'bio_url_blocked';
    end if;
    v_banned := moderation_contains_banned(new.bio);
    if v_banned is not null then
      raise exception 'bio_moderation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_moderation_trigger on profiles;
create trigger profiles_moderation_trigger
  before update on profiles
  for each row execute function profiles_moderation();

-- Stones trigger (name, description)
create or replace function stones_moderation()
returns trigger
language plpgsql
as $$
declare
  v_banned text;
begin
  v_banned := moderation_contains_banned(new.name);
  if v_banned is not null then raise exception 'stone_name_moderation'; end if;

  if new.description is not null then
    if moderation_contains_url(new.description) then
      raise exception 'stone_description_url_blocked';
    end if;
    v_banned := moderation_contains_banned(new.description);
    if v_banned is not null then raise exception 'stone_description_moderation'; end if;
  end if;

  return new;
end;
$$;

drop trigger if exists stones_moderation_trigger on stones;
create trigger stones_moderation_trigger
  before insert on stones
  for each row execute function stones_moderation();

-- ═══════════════════════════════════════════════════════════════════
-- ROLLBACK
-- ═══════════════════════════════════════════════════════════════════
-- drop trigger if exists messages_moderation_trigger on messages;
-- drop trigger if exists profiles_moderation_trigger on profiles;
-- drop trigger if exists stones_moderation_trigger on stones;
-- drop function if exists messages_moderation();
-- drop function if exists profiles_moderation();
-- drop function if exists stones_moderation();
-- drop function if exists moderation_contains_banned(text);
-- drop function if exists moderation_contains_url(text);
-- drop function if exists moderation_normalize(text);
-- drop table if exists moderation_banned_words;
