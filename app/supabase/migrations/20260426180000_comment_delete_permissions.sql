-- Расширенные permissions на удаление комментария:
--   - сам автор коммента
--   - author камня (тот кто спрятал) — модерация
--   - любой finder камня (тот кто нашёл) — модерация
--
-- RLS-политика comment_likes_self_delete остаётся для лайков. Для комментов
-- добавляем delete-policy "author OR stone_owner OR finder", дополняя
-- существующую stone_comments_self_delete.

drop policy if exists stone_comments_moderation_delete on stone_comments;
create policy stone_comments_moderation_delete on stone_comments
  for delete using (
    auth.uid() = author_id
    or exists (
      select 1 from stones s
      where s.id = stone_comments.stone_id and s.author_id = auth.uid()
    )
    or exists (
      select 1 from finds f
      where f.stone_id = stone_comments.stone_id and f.user_id = auth.uid()
    )
  );

-- Cleanup: дроп старой узкой policy чтобы не было double-evaluation
drop policy if exists stone_comments_self_delete on stone_comments;
