-- ═══════════════════════════════════════════════════════════════════
-- Extend server-side moderation: phone / email / social / grooming
-- ═══════════════════════════════════════════════════════════════════
--
-- Client-side `moderateMessage` (app/lib/moderation.ts) already blocks
-- phone numbers, emails, social handles, and grooming phrases — but
-- client moderation can be bypassed by editing the JS bundle. This
-- migration mirrors those checks at the DB trigger level so a user
-- cannot set `profiles.bio = "write me +358401234567"` via direct
-- PATCH to the REST API.
--
-- Applies to:
--   - profiles.username / profiles.bio (via profiles_moderation trigger)
--   - messages.text                   (via messages_moderation trigger)
--   - stones.name / stones.description (via stones_moderation trigger)
--
-- Rationale: child safety. Predators try to funnel minors off-platform
-- through contact-info drops or grooming phrases. Every free-text
-- field readable by others must filter these.
-- ═══════════════════════════════════════════════════════════════════

-- 1. Phone: 7+ digits with optional separators. Deliberately loose —
-- false positives (e.g. sequences like "123456789 camels") are fine
-- because that's not plausible legit content in a bio/username/chat.
create or replace function moderation_contains_phone(p_text text)
returns boolean
language sql
immutable
as $$
  -- Strip everything except digits, then check length >= 7.
  select length(regexp_replace(coalesce(p_text, ''), '[^0-9]', '', 'g')) >= 7
         and p_text ~ '(\+?\d[\s\-().]*){7,}';
$$;

-- 2. Email: standard-ish pattern.
create or replace function moderation_contains_email(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text ~* '[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}';
$$;

-- 3. Social handles: @username, t.me/x, discord.gg/x.
-- Usernames in-app don't include "@" so any "@foo" is an external handle.
create or replace function moderation_contains_social(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text ~* '(@[a-z0-9_]{3,}|t\.me/|discord\.gg|instagram\.com|facebook\.com|snapchat\.com|tiktok\.com|wa\.me/|whatsapp\.com)';
$$;

-- 4. Grooming phrases — RU / FI / EN. Match against lowered text.
create or replace function moderation_contains_grooming(p_text text)
returns boolean
language sql
immutable
as $$
  with lowered as (select lower(coalesce(p_text, '')) as t)
  select
    -- RU
    t like '%встретимся%' or t like '%приходи одна%' or t like '%приходи один%'
    or t like '%приходи сам%' or t like '%приди одна%' or t like '%приходи ко мне%'
    or t like '%никому не говори%' or t like '%это наш секрет%' or t like '%сколько тебе лет%'
    -- FI
    or t like '%tavataan%' or t like '%tule yksin%' or t like '%tule luokseni%'
    or t like '%älä kerro%' or t like '%ala kerro%' or t like '%tämä on salaisuutemme%'
    or t like '%kuinka vanha olet%'
    -- EN
    or t like '%meet me%' or t like '%come alone%' or t like '%come by yourself%'
    or t like '%do not tell%' or t like '%don''t tell%' or t like '%our little secret%'
    or t like '%how old are you%' or t like '%send me a pic%' or t like '%send a photo%'
    or t like '%send me photos%'
  from lowered;
$$;

-- 5. Update profiles_moderation trigger to call the new checks.
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
    if moderation_contains_phone(new.username) then
      raise exception 'username_phone';
    end if;
    if moderation_contains_email(new.username) then
      raise exception 'username_email';
    end if;
    if moderation_contains_social(new.username) then
      raise exception 'username_social';
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
    if moderation_contains_phone(new.bio) then
      raise exception 'bio_phone';
    end if;
    if moderation_contains_email(new.bio) then
      raise exception 'bio_email';
    end if;
    if moderation_contains_social(new.bio) then
      raise exception 'bio_social';
    end if;
    if moderation_contains_grooming(new.bio) then
      raise exception 'bio_grooming';
    end if;
  end if;

  return new;
end;
$$;

-- 6. Update messages_moderation trigger.
create or replace function messages_moderation()
returns trigger
language plpgsql
as $$
declare
  v_banned text;
begin
  if moderation_contains_url(new.text) then
    raise exception 'moderation_url_blocked';
  end if;

  v_banned := moderation_contains_banned(new.text);
  if v_banned is not null then
    raise exception 'moderation_profanity';
  end if;

  if moderation_contains_phone(new.text) then
    raise exception 'moderation_phone';
  end if;
  if moderation_contains_email(new.text) then
    raise exception 'moderation_email';
  end if;
  if moderation_contains_social(new.text) then
    raise exception 'moderation_social';
  end if;
  if moderation_contains_grooming(new.text) then
    raise exception 'moderation_grooming';
  end if;

  return new;
end;
$$;

-- 7. Update stones_moderation trigger (stone name + description).
-- Names are displayed publicly on the map, descriptions shown in detail.
create or replace function stones_moderation()
returns trigger
language plpgsql
as $$
declare
  v_banned text;
begin
  v_banned := moderation_contains_banned(new.name);
  if v_banned is not null then raise exception 'stone_name_moderation'; end if;
  if moderation_contains_phone(new.name) then raise exception 'stone_name_phone'; end if;
  if moderation_contains_email(new.name) then raise exception 'stone_name_email'; end if;
  if moderation_contains_social(new.name) then raise exception 'stone_name_social'; end if;

  if new.description is not null then
    if moderation_contains_url(new.description) then
      raise exception 'stone_description_url_blocked';
    end if;
    v_banned := moderation_contains_banned(new.description);
    if v_banned is not null then raise exception 'stone_description_moderation'; end if;
    if moderation_contains_phone(new.description) then raise exception 'stone_description_phone'; end if;
    if moderation_contains_email(new.description) then raise exception 'stone_description_email'; end if;
    if moderation_contains_social(new.description) then raise exception 'stone_description_social'; end if;
    if moderation_contains_grooming(new.description) then raise exception 'stone_description_grooming'; end if;
  end if;

  return new;
end;
$$;
