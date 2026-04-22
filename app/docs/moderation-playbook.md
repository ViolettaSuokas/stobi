# Moderation playbook

How to triage reports that come in from TestFlight testers and, later,
from production users. Pair this with `docs/moderation-queries.sql`.

## Daily 5-min triage

Once per day (morning), open Supabase Studio → SQL editor:

1. Run query **#1** (unresolved reports by priority). Anything with
   `category = 'child_safety'` is top priority — review the target,
   take action within an hour.
2. Run query **#2** (admin_alerts). Same thing — alerts are auto-created
   for child_safety reports plus any shadowban triggers.
3. Run query **#9** to eyeball volume. Sudden spike in one category =
   something's happening on the platform (abuse campaign, broken feature).

Queries are defined by number in `docs/moderation-queries.sql`.

## Feedback loop — verify end-to-end before inviting testers

**Run this once, with a throwaway test user, before your first batch of
real testers arrives.** Catches misconfigured RLS / triggers / escalation
that chaos tests alone won't:

1. On a test device, sign in as User A. Create User B on a second device.
2. User A posts a test message in chat. User B long-presses it → Report →
   pick any category → send.
3. On your Mac, open Supabase Studio → run query **#1**. You should see
   the new row within 10 seconds.
4. Run query **#5** with the report id to mark it resolved.
5. Refresh query **#1** — the row is gone.
6. Now User B files a `child_safety` report on something. Refresh query
   **#2** (admin_alerts) — a new row should appear with
   `kind = 'child_safety_report'` and the report payload embedded.
7. Refresh query **#11** with the alert id to acknowledge it.

If any step silently does nothing, the moderation pipeline is broken.
Fix before inviting more than 2 testers.

## Response SLAs

- **child_safety** → 1 hour. Pull the stone/message (query #6), delete
  the user if it's CSAM / grooming (query #8), report to local law if
  the content suggests active harm (in Finland: 112 or keskusrikospoliisi).
- **nsfw** → same day. Pull content (#6), warn or shadowban the author
  (#7).
- **harassment** → same day. Mark reported message hidden, warn the
  author. Repeat offenders → shadowban.
- **unsafe_location** → next triage window. Verify via OSM (Overpass /
  Google Maps) — is this near a school? Private property? If yes,
  hide the stone (#6).
- **spam** → whenever. Low priority. Shadowban on 3+ distinct reports.

## Shadowban — what it does

`profiles.upload_shadowbanned = true` stops the user from uploading new
photos via the storage RLS policy. They:

- Can still sign in, see map, read chat.
- Cannot post new messages with photos.
- Cannot hide new stones (scan fails upload).

They don't get told. This buys time for the user to drift off the
platform without giving them feedback to tune their abuse around.

Undo with the same query but `= false`.

## What NOT to do

- Don't delete rows from `content_reports` directly. Mark them
  resolved (#5) so the paper trail stays — important for dispute
  handling and for looking back when a pattern emerges weeks later.
- Don't manually edit `stones.is_hidden` bypassing the RPC. Use query
  #6 which also sets `hidden_reason` — that's what distinguishes
  moderation-hidden from auto-hidden-by-reports.
- Don't outright delete a user on a single report unless it's CSAM.
  One bad report is often a personal feud; wait for the pattern.

## When to escalate to me (the developer)

- Same abuse pattern across 5+ reports within a day (likely a systemic
  hole, not isolated).
- Reports arriving but admin_alerts empty (trigger broken).
- A category you don't know how to handle.
- Any CSAM — stop everything, take it down, then contact authorities
  and me.
