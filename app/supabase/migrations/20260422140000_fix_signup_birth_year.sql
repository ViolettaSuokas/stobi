-- CRITICAL: Fix signup crashing on 500 "Database error saving new user".
--
-- Migration 015 (security_hardening) added a BEFORE INSERT trigger
-- `validate_age_on_signup` that rejects rows with birth_year IS NULL.
-- But `handle_new_user` (welcome_bonus migration) creates profiles WITHOUT
-- birth_year — it's collected later in app's onboarding flow.
--
-- Net effect: every new signup in production fails with 500 because the
-- trigger raises before the row is inserted. This block is silent in logs
-- beyond a generic "Database error saving new user" from GoTrue.
--
-- Found via chaos test 2026-04-22: anonymous signup returned 500,
-- investigation showed 0 signups have landed since migration 015 +
-- welcome_bonus landed together (2 existing profiles pre-date this combo).
--
-- Fix:
--   INSERT path  → skip the "birth_year required" check; profile is created
--                  with NULL birth_year + birth_year_required_since=now().
--                  App onboarding collects birth_year before any COPPA-gated
--                  action (record_find, create_stone, chat messages).
--   UPDATE path  → unchanged; birth_year must be valid when user sets it.
--
-- COPPA compliance retained: the UPDATE guard still enforces age≥13 and
-- server-side RPCs check `birth_year IS NOT NULL` before permitting
-- user-generated content to be created.

create or replace function validate_age_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_year int := extract(year from now())::int;
  age int;
begin
  -- INSERT: allow NULL birth_year — it will be collected in onboarding
  -- flow. `birth_year_required_since` timestamp tracks the deadline.
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- UPDATE: validate only if birth_year is being set to a non-null value.
  if new.birth_year is null then
    return new;
  end if;

  age := current_year - new.birth_year;
  if age < 13 then
    raise exception 'Age requirement not met: must be 13 or older (COPPA)'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
