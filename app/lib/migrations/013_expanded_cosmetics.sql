-- ═══════════════════════════════════════════════════════════════════
-- Migration 013: Expanded cosmetics — +5 colors, +3 emotions, +3 decors
-- ═══════════════════════════════════════════════════════════════════
--
-- Расширение каталога косметик. Добавляем на сервер — клиент уже
-- получит их из `items` таблицы при следующем login.
-- ═══════════════════════════════════════════════════════════════════

insert into items (id, category, price, free_by_default, premium_only) values
  -- 5 new colors
  ('color-ocean',    'color', 25, false, false),
  ('color-sunset',   'color', 25, false, false),
  ('color-rose',     'color', 30, false, false),
  ('color-emerald',  'color', 30, false, false),
  ('color-cream',    'color', 20, false, false),
  -- 3 new emotions
  ('eye-blush',      'eye',   15, false, false),
  ('eye-laughing',   'eye',   20, false, false),
  ('eye-surprised',  'eye',   20, false, false),
  -- 3 new decors
  ('decor-headband', 'decor', 25, false, false),
  ('decor-halo',     'decor', 35, false, true),
  ('decor-heart-hat','decor', 30, false, false)
on conflict (id) do update
  set category = excluded.category,
      price = excluded.price,
      free_by_default = excluded.free_by_default,
      premium_only = excluded.premium_only,
      active = true;

-- ROLLBACK
-- update items set active = false
--   where id in ('color-ocean','color-sunset','color-rose','color-emerald','color-cream',
--                'eye-blush','eye-laughing','eye-surprised',
--                'decor-headband','decor-halo','decor-heart-hat');
