-- profiles: разрешаем SELECT всем (включая anon).
--
-- Раньше: policy "Profiles are visible to authenticated users" — anon
-- получал null при join'е stones↔profiles. В контексте authenticated
-- юзера PostgREST CSRF-проверка иногда не пропускает embed → профили
-- приходят null → в фиде/чате fallback на 🪨-эмодзи вместо аватарки.
--
-- Колонки профиля (username, avatar, photo_url, is_artist) — public
-- by design, видны в чате/ленте/карте. UPDATE по-прежнему защищён
-- (другая policy + триггер profiles_block_protected_updates).
-- Чувствительные поля (email, password) живут в auth.users, не здесь.

drop policy if exists "Profiles are visible to authenticated users" on profiles;

create policy "Profiles are publicly readable"
  on profiles
  for select
  using (true);
