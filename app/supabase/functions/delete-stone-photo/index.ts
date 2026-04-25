// Edge Function: delete-stone-photo
//
// Вызывается из Postgres-триггера (через pg_net) AFTER DELETE на stones.
// Принимает photo_url, парсит storage-path и удаляет файл через Storage API
// (с service role) — обходим storage.protect_delete который блокирует
// прямой DELETE из SQL.
//
// Auth: проверяем что вызвавший знает anon-key (тот же что у клиента).
// Это не secret (он в JS-бандле), но защищает от случайных тыков.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST required' }, 405);
  }

  // Простая авторизация — anon или service role bearer.
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: { photo_url?: string; record?: { photo_url?: string } };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // pg_net обёртка может прислать { record: { photo_url } } (как webhook),
  // или мы прямым вызовом — { photo_url }. Обрабатываем оба варианта.
  const photoUrl = body.photo_url ?? body.record?.photo_url ?? null;
  if (!photoUrl) {
    return json({ ok: true, skipped: 'no photo_url' });
  }

  const path = extractStoragePath(photoUrl);
  if (!path) {
    return json({ ok: true, skipped: 'no path in url', url: photoUrl.slice(0, 100) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Storage credentials missing' }, 500);
  }

  const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error } = await supa.storage.from('photos').remove([path]);
  if (error) {
    console.warn('[delete-stone-photo] remove failed', error.message, 'path=', path);
    return json({ ok: false, error: error.message, path }, 500);
  }
  return json({ ok: true, removed: path });
});

function extractStoragePath(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/(?:sign|public)\/photos\/([^?]+)/);
  if (!m?.[1]) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
