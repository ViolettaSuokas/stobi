-- ═══════════════════════════════════════════════════════════════════
-- Universal content_reports — abuse/safety reports across targets
-- ═══════════════════════════════════════════════════════════════════
--
-- Before this, reports were scattered:
--   - `stone_reports` → "stone is physically missing" (geo-freshness)
--   - chat `report_message` → analytics-only, no DB persistence
--   - no user/avatar/stone-inappropriate report at all
--
-- Adds one table `content_reports` that covers stone / user / message /
-- photo, each with a category (nsfw / child_safety / harassment /
-- unsafe_location / spam / other). Writes go through the
-- `file_content_report` RPC so we get: rate-limiting, dedupe, and
-- escalation into `admin_alerts` for critical categories.
-- ═══════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_target_type') then
    create type report_target_type as enum ('stone', 'user', 'message', 'photo');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'report_category') then
    create type report_category as enum (
      'nsfw',           -- pornography / sexual content
      'child_safety',   -- grooming / CSAM / targeting of minors (highest priority)
      'harassment',     -- bullying, threats, hate speech
      'unsafe_location',-- stone hidden near school / private property
      'spam',           -- commercial spam, repeated garbage
      'other'           -- catch-all with required free-text reason
    );
  end if;
end $$;

create table if not exists content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type report_target_type not null,
  target_id uuid not null,
  category report_category not null,
  reason text,
  created_at timestamptz default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolution text
);

-- Same reporter cannot file the same report twice on the same target —
-- this stops one user from spam-reporting to trigger auto-action.
create unique index if not exists content_reports_unique_reporter
  on content_reports (reporter_id, target_type, target_id, category);

-- Moderator dashboard queries by target_type + category + unresolved.
create index if not exists content_reports_unresolved_idx
  on content_reports (target_type, category, created_at desc)
  where resolved_at is null;

create index if not exists content_reports_target_idx
  on content_reports (target_type, target_id, created_at desc);

alter table content_reports enable row level security;

-- Reporters can see their own reports (status tracking in UI).
drop policy if exists content_reports_read_own on content_reports;
create policy content_reports_read_own
  on content_reports for select to authenticated
  using (reporter_id = auth.uid());

-- No direct insert/update/delete — everything goes through RPC.

-- ─── admin_alerts table (if not already present) ─────────────────────
-- 018_moderation_pipeline may have created it; guard.
create table if not exists admin_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz default now(),
  acknowledged_at timestamptz
);

alter table admin_alerts enable row level security;
-- No public policies — only service_role reads (admin dashboard).

-- ─── RPC: file_content_report ────────────────────────────────────────
create or replace function file_content_report(
  p_target_type text,
  p_target_id uuid,
  p_category text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reporter uuid := auth.uid();
  v_count int;
  v_target_type report_target_type;
  v_category report_category;
  v_report_id uuid;
begin
  if v_reporter is null then
    raise exception 'auth_required';
  end if;

  -- Validate enums via explicit cast. Bad values → 22P02 invalid_input_value.
  begin
    v_target_type := p_target_type::report_target_type;
  exception when others then
    raise exception 'invalid_target_type';
  end;

  begin
    v_category := p_category::report_category;
  exception when others then
    raise exception 'invalid_category';
  end;

  -- "other" requires a reason so moderator has context.
  if v_category = 'other' and (p_reason is null or length(trim(p_reason)) < 5) then
    raise exception 'reason_required_for_other';
  end if;

  if p_reason is not null and length(p_reason) > 500 then
    raise exception 'reason_too_long';
  end if;

  -- Rate-limit: 20 reports per user per 24h. Abuse deterrent.
  select count(*) into v_count
  from content_reports
  where reporter_id = v_reporter
    and created_at > now() - interval '24 hours';
  if v_count >= 20 then
    raise exception 'rate_limit_exceeded';
  end if;

  -- Cannot report yourself (user→user case).
  if v_target_type = 'user' and p_target_id = v_reporter then
    raise exception 'cannot_report_self';
  end if;

  insert into content_reports (
    reporter_id, target_type, target_id, category, reason
  ) values (
    v_reporter, v_target_type, p_target_id, v_category, nullif(trim(p_reason), '')
  )
  on conflict (reporter_id, target_type, target_id, category) do nothing
  returning id into v_report_id;

  -- Escalate to admin_alerts for child_safety category — needs eyes fast.
  if v_category = 'child_safety' and v_report_id is not null then
    insert into admin_alerts (kind, payload) values (
      'child_safety_report',
      jsonb_build_object(
        'report_id', v_report_id,
        'target_type', v_target_type,
        'target_id', p_target_id,
        'reporter_id', v_reporter,
        'reason', p_reason
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report_id,
    'deduped', (v_report_id is null)
  );
end;
$$;

revoke all on function file_content_report(text, uuid, text, text) from public;
grant execute on function file_content_report(text, uuid, text, text) to authenticated;
