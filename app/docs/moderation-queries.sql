-- =====================================================================
-- Moderation quick-queries for Supabase Studio.
-- =====================================================================
--
-- Paste individual blocks into:
--   Studio → SQL Editor → New query → Run
--
-- Until we build a proper admin UI, this is how Violetta triages
-- reports and takes moderation actions. All writes here are service-role
-- (Studio SQL runs with superuser); keep usage careful.
--
-- Grouped by task.
--
-- =====================================================================


-- ─── 1. Daily triage: unresolved reports by priority ─────────────────
-- Sorted so child_safety bubbles to the top.
-- Run first thing each day.

select
  cr.id,
  cr.created_at,
  cr.category,
  cr.target_type,
  cr.target_id,
  cr.reason,
  reporter.username   as reporter_username,
  reporter.id         as reporter_id
from content_reports cr
left join profiles reporter on reporter.id = cr.reporter_id
where cr.resolved_at is null
order by
  case cr.category
    when 'child_safety'    then 1
    when 'nsfw'            then 2
    when 'harassment'      then 3
    when 'unsafe_location' then 4
    when 'spam'            then 5
    else 6
  end,
  cr.created_at desc;


-- ─── 2. Admin alerts (child-safety escalations, shadowbans) ──────────
-- admin_alerts is a firehose — unack'd first.

select id, kind, payload, created_at, acknowledged_at
from admin_alerts
where acknowledged_at is null
order by created_at desc;


-- ─── 3. Open "stone missing" reports per stone ───────────────────────
-- Stones with growing reports that haven't triggered auto-hide yet.
-- The trigger fires at 3 reports in 90d + 30d no-confirm; this surfaces
-- almost-there stones so you can nudge the author to confirm.

select
  s.id            as stone_id,
  s.name          as stone_name,
  s.city,
  s.author_id,
  p.username      as author_username,
  s.last_confirmed_at,
  s.is_hidden,
  count(sr.id)    as report_count_90d
from stones s
left join profiles p on p.id = s.author_id
left join stone_reports sr
  on sr.stone_id = s.id
  and sr.created_at > now() - interval '90 days'
group by s.id, p.username
having count(sr.id) >= 1
order by count(sr.id) desc, s.last_confirmed_at asc nulls first;


-- ─── 4. Triage a specific target: see ALL reports on one stone/user ──
-- Replace '<uuid>' with content_reports.target_id.

select
  cr.*,
  reporter.username as reporter_username
from content_reports cr
left join profiles reporter on reporter.id = cr.reporter_id
where cr.target_id = '<uuid>'
order by cr.created_at desc;


-- ─── 5. Resolve a report (mark handled) ──────────────────────────────
-- Replace '<report_id>' with content_reports.id.

update content_reports
set resolved_at = now(),
    resolution  = 'reviewed — no action needed'   -- or "removed stone", "warned user", etc.
where id = '<report_id>';


-- ─── 6. Take down a stone (moderation action) ────────────────────────
-- Soft-hide via is_hidden so users stop seeing it. Preserves author's
-- data for audit.
-- Replace '<stone_id>'.

update stones
set is_hidden  = true,
    hidden_reason = 'moderation action'
where id = '<stone_id>';


-- ─── 7. Shadowban a user for repeat abuse ────────────────────────────
-- profiles.upload_shadowbanned = true blocks them from posting new
-- uploads (storage RLS). They see the app work but nothing new saves.
-- Replace '<user_id>'.

update profiles
set upload_shadowbanned = true
where id = '<user_id>';


-- ─── 8. Delete a user outright (CSAM, repeated child_safety) ─────────
-- Cascades through all their stones, finds, messages, reports.
-- Replace '<user_id>'. VERY destructive — be sure.
-- Studio SQL runs as service-role so this works directly.

delete from auth.users where id = '<user_id>';


-- ─── 9. 24-hour report volume check ──────────────────────────────────
-- If this jumps, something's happening on the platform.

select
  date_trunc('hour', created_at) as hour,
  category,
  count(*)                        as n
from content_reports
where created_at > now() - interval '24 hours'
group by 1, 2
order by 1 desc, n desc;


-- ─── 10. Users with many reports against them in last 7 days ─────────
-- Good signal for shadowban.

select
  p.id,
  p.username,
  p.created_at                     as joined,
  count(distinct cr.id)            as reports_received,
  count(distinct cr.reporter_id)   as distinct_reporters,
  array_agg(distinct cr.category)  as categories
from profiles p
join content_reports cr
  on cr.target_type = 'user'::report_target_type
  and cr.target_id = p.id
  and cr.created_at > now() - interval '7 days'
group by p.id
having count(distinct cr.id) >= 3
order by count(distinct cr.id) desc;


-- ─── 11. Mark admin_alerts acknowledged ──────────────────────────────
-- After handling the payload.
-- Replace '<alert_id>'.

update admin_alerts
set acknowledged_at = now()
where id = '<alert_id>';


-- =====================================================================
-- Tips:
-- - Save each block as a named query in Supabase Studio for 1-click reuse.
-- - Report a user/stone you didn't actually review? Use query 5 with
--   resolution = 'no action' — empty resolutions look like backlog.
-- - No admin_alerts after 24h means either (a) quiet day, (b) triggers
--   broken. Check content_reports volume; if reports are landing but
--   alerts aren't, trigger needs a look.
-- =====================================================================
