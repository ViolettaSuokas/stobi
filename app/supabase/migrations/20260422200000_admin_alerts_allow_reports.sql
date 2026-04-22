-- Fix: admin_alerts.kind CHECK (from 018) had a short whitelist and
-- didn't include the report escalations from 190000. Surfaced by chaos
-- test 08-safety-tier1.mjs — child_safety reports insert admin_alert
-- rows but hit the constraint: admin_alerts_kind_check violation.

alter table admin_alerts drop constraint if exists admin_alerts_kind_check;
alter table admin_alerts
  add constraint admin_alerts_kind_check
  check (kind in (
    'shadowban',
    'pending_find_stuck',
    'stone_hidden_mass',
    'child_safety_report',
    'nsfw_report',
    'harassment_report'
  ));
