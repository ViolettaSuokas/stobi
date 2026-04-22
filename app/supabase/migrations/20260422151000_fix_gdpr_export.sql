-- Fix gdpr_export_my_data: `finds.created_at` does not exist — column is
-- `finds.found_at`. All other tables use `created_at`. Found via chaos-test 06.

create or replace function gdpr_export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'user_id', v_user_id,
    'profile', (select row_to_json(p) from profiles p where p.id = v_user_id),
    'balance_events', coalesce((select jsonb_agg(row_to_json(e) order by e.created_at)
      from balance_events e where e.user_id = v_user_id), '[]'::jsonb),
    'stones_authored', coalesce((select jsonb_agg(row_to_json(s) order by s.created_at)
      from stones s where s.author_id = v_user_id), '[]'::jsonb),
    'finds', coalesce((select jsonb_agg(row_to_json(f) order by f.found_at)
      from finds f where f.user_id = v_user_id), '[]'::jsonb),
    'find_proofs', coalesce((select jsonb_agg(row_to_json(fp) order by fp.created_at)
      from find_proofs fp where fp.user_id = v_user_id), '[]'::jsonb),
    'stone_reports', coalesce((select jsonb_agg(row_to_json(r) order by r.created_at)
      from stone_reports r where r.reporter_id = v_user_id), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(row_to_json(m) order by m.created_at)
      from messages m where m.user_id = v_user_id), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function gdpr_export_my_data() from public;
grant execute on function gdpr_export_my_data() to authenticated;
