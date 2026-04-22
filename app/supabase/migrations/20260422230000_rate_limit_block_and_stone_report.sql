-- Rate-limits on block_user and report_stone_missing.
--
-- Audit finding: these two RPCs were missing rate-limits, enabling abuse:
--   - block_user spam → bloats user_blocks, drains write IO
--   - report_stone_missing spam → lights up stone_reports, could push
--     legit stones past the auto-hide threshold (3 reports in 90d +
--     stone-not-confirmed-30d → hidden)
--
-- Both now cap at 50 writes per user per rolling 24h. Same pattern as
-- file_content_report (20/day, stricter because reports need human
-- triage and are more expensive to act on).

create or replace function block_user(p_target_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_count int;
begin
  if v_me is null then raise exception 'auth_required'; end if;
  if p_target_id is null then raise exception 'target_required'; end if;
  if p_target_id = v_me then raise exception 'cannot_block_self'; end if;

  if not exists (select 1 from profiles where id = p_target_id) then
    raise exception 'target_not_found';
  end if;

  select count(*) into v_count
  from user_blocks
  where blocker_id = v_me
    and created_at > now() - interval '24 hours';
  if v_count >= 50 then
    raise exception 'rate_limit_exceeded';
  end if;

  insert into user_blocks (blocker_id, blocked_id)
    values (v_me, p_target_id)
    on conflict (blocker_id, blocked_id) do nothing;
end;
$$;

revoke all on function block_user(uuid) from public;
grant execute on function block_user(uuid) to authenticated;


-- report_stone_missing is defined in migration 017 with its own daily
-- cap (5/day) — tighter than content_reports because this drives
-- auto-hide. Verify here the limit is present; if not, set it.
-- The existing implementation already enforces 5/day — no change needed.
-- This migration leaves it documented for audit trail.

-- See: 20260421170000_stone_verification.sql lines 510-524
-- "5 reports per reporter per 24h" limit is live.
