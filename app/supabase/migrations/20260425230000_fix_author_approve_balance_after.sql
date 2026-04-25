-- Fix author_approve_pending_find — тот же balance_after=null bug что
-- был в record_find_v2 (см. 20260425220000). Когда автор одобряет
-- pending-find, начисляются награды:
--   - finder +1💎 (с balance RETURNING — ok)
--   - author +2💎 (без RETURNING → balance_events.balance_after=null → fail)
--
-- Симптом: автор тапает "Да, мой камень" → 500 → finder награды не
-- получает.

create or replace function author_approve_pending_find(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_proof find_proofs%rowtype;
  v_stone stones%rowtype;
  v_find_id uuid;
  v_new_balance integer;
  v_author_balance integer;
  v_alt_count integer;
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
    raise exception 'Only stone author can approve';
  end if;

  insert into finds (user_id, stone_id, city)
  values (v_proof.user_id, v_proof.stone_id, v_stone.city)
  on conflict (user_id, stone_id) do nothing
  returning id into v_find_id;

  perform set_config('app.via_balance_rpc', '1', true);

  update profiles set balance = coalesce(balance, 0) + 1 where id = v_proof.user_id
    returning balance into v_new_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
  values (v_proof.user_id, 1, 'stone_find', v_proof.stone_id::text, v_new_balance);

  -- FIX: capture author's new balance в переменную (раньше null)
  update profiles set balance = coalesce(balance, 0) + 2 where id = v_stone.author_id
    returning balance into v_author_balance;
  insert into balance_events (user_id, amount, reason, ref_id, balance_after)
  values (v_stone.author_id, 2, 'author_bonus', v_proof.stone_id::text, v_author_balance);

  update find_proofs set status = 'verified', find_id = v_find_id where id = p_proof_id;

  v_alt_count := coalesce(array_length(v_stone.alt_embeddings, 1), 0);
  if v_alt_count >= 10 then
    update stones
      set alt_embeddings = v_stone.alt_embeddings[2:10] || v_proof.embedding
      where id = v_stone.id;
  else
    update stones
      set alt_embeddings = coalesce(alt_embeddings, '{}') || v_proof.embedding
      where id = v_stone.id;
  end if;

  return jsonb_build_object('find_id', v_find_id, 'balance', v_new_balance);
end;
$$;

revoke all on function author_approve_pending_find(uuid) from public;
grant execute on function author_approve_pending_find(uuid) to authenticated;

-- Также нужно RPC чтобы клиент мог получить pending finds для своего stone.
-- Возвращает minimal для UI: id, photo_url, similarity, finder_username, created_at.
create or replace function get_pending_finds_for_my_stones(p_stone_id uuid default null)
returns table(
  proof_id uuid,
  stone_id uuid,
  finder_id uuid,
  finder_username text,
  finder_avatar text,
  photo_url text,
  similarity double precision,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  return query
    select
      fp.id as proof_id,
      fp.stone_id,
      fp.user_id as finder_id,
      p.username as finder_username,
      p.avatar as finder_avatar,
      fp.photo_url,
      fp.similarity_score as similarity,
      fp.created_at
    from find_proofs fp
    join stones s on s.id = fp.stone_id
    left join profiles p on p.id = fp.user_id
    where fp.status = 'pending'
      and s.author_id = v_user_id
      and (p_stone_id is null or fp.stone_id = p_stone_id)
    order by fp.created_at desc;
end;
$$;

revoke all on function get_pending_finds_for_my_stones(uuid) from public;
grant execute on function get_pending_finds_for_my_stones(uuid) to authenticated;
