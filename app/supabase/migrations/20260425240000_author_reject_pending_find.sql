-- Author может отклонить pending find ("нет, не мой камень").
-- find_proofs.status='rejected', никакие 💎 не начисляются.
-- Finder в своей истории увидит что find отклонён.

create or replace function author_reject_pending_find(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proof find_proofs%rowtype;
  v_stone stones%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_proof from find_proofs where id = p_proof_id;
  if v_proof.id is null then
    raise exception 'Proof not found';
  end if;
  if v_proof.status != 'pending' then
    raise exception 'Proof is not pending';
  end if;

  select * into v_stone from stones where id = v_proof.stone_id;
  if v_stone.author_id != v_user_id then
    raise exception 'Only stone author can reject';
  end if;

  update find_proofs
    set status = 'rejected',
        rejection_reason = 'author_rejected'
    where id = p_proof_id;

  return jsonb_build_object('proof_id', p_proof_id, 'rejected', true);
end;
$$;

revoke all on function author_reject_pending_find(uuid) from public;
grant execute on function author_reject_pending_find(uuid) to authenticated;
