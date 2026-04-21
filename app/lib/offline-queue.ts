// Offline queue для find flow.
//
// Когда юзер нашёл камень, но нет связи (лес, метро, самолёт), мы
// сохраняем находку локально и пытаемся синкать когда сеть появится.
//
// Storage: AsyncStorage по ключу `stobi:pending_finds`. JSON-массив.
// На 100 pending finds это ~100KB — AsyncStorage нормально держит.
// Для 1000+ pending стоит переехать на expo-sqlite, но до такого объёма
// не дойдём без багов в sync.
//
// Sync trigger:
//   1. При mount components/OfflineBanner определяет online →
//      вызывает syncPendingFinds() из `lib/offline-queue`.
//   2. После каждого успешного find клиент вызывает syncPendingFinds()
//      просто на случай если что-то накопилось.
//
// Каждый PendingFind обрабатывается:
//   - Загружаем photo_uri в storage (если ещё не загружен — локальный file://)
//   - POST в Edge Function process-find-photo → embedding
//   - RPC record_find_v2 (или search_stone_by_embedding если stone_id null)
//   - Удаляем из очереди на успехе
//   - На ошибке: увеличиваем retry_count, откладываем до следующего раза
//
// Retry limit: 3 попытки. После → помещаем в `stobi:failed_finds` для
// ручного review.

import AsyncStorage from '@react-native-async-storage/async-storage';

const QUEUE_KEY = 'stobi:pending_finds';
const FAILED_KEY = 'stobi:failed_finds';
const MAX_RETRIES = 3;

export type PendingFind = {
  id: string;                          // client-side uuid для дедупа
  stone_id: string | null;             // null если "найти по скану"
  photo_uri: string;                   // local file:// или public URL если уже uploaded
  lat: number | null;
  lng: number | null;
  created_at: number;                  // ms epoch
  retry_count: number;
  last_error?: string;
};

type SyncOutcome = 'synced' | 'retry' | 'failed';

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

/** Добавить find в очередь. Не шлёт на сервер. */
export async function enqueuePendingFind(
  entry: Omit<PendingFind, 'id' | 'retry_count' | 'created_at'>,
): Promise<PendingFind> {
  const full: PendingFind = {
    ...entry,
    id: uuid(),
    created_at: Date.now(),
    retry_count: 0,
  };
  const queue = await readQueue();
  queue.push(full);
  await writeQueue(queue);
  return full;
}

/** Размер очереди (для UI badge). */
export async function getPendingFindsCount(): Promise<number> {
  const q = await readQueue();
  return q.length;
}

/** Прочитать всю очередь (UI список "в ожидании"). */
export async function getPendingFinds(): Promise<PendingFind[]> {
  return readQueue();
}

/**
 * Попытаться синкнуть все pending finds на сервер.
 * Принимает callback который делает сам sync одного entry — так мы
 * не тянем импорты finds/storage/edge-functions в этот модуль
 * (избегаем циклов и держим тесты чистыми).
 */
export async function syncPendingFinds(
  syncOne: (entry: PendingFind) => Promise<SyncOutcome>,
): Promise<{ synced: number; retry: number; failed: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { synced: 0, retry: 0, failed: 0 };

  const remaining: PendingFind[] = [];
  const failed: PendingFind[] = [];
  let syncedCount = 0;
  let retryCount = 0;

  for (const entry of queue) {
    try {
      const outcome = await syncOne(entry);
      if (outcome === 'synced') {
        syncedCount++;
        continue;
      }
      if (outcome === 'retry') {
        const next: PendingFind = { ...entry, retry_count: entry.retry_count + 1 };
        if (next.retry_count >= MAX_RETRIES) {
          failed.push(next);
        } else {
          retryCount++;
          remaining.push(next);
        }
        continue;
      }
      // 'failed'
      failed.push({ ...entry, retry_count: entry.retry_count + 1 });
    } catch (e: any) {
      const next: PendingFind = {
        ...entry,
        retry_count: entry.retry_count + 1,
        last_error: e?.message ?? String(e),
      };
      if (next.retry_count >= MAX_RETRIES) {
        failed.push(next);
      } else {
        retryCount++;
        remaining.push(next);
      }
    }
  }

  await writeQueue(remaining);
  if (failed.length) await appendFailed(failed);

  return { synced: syncedCount, retry: retryCount, failed: failed.length };
}

/** Удалить конкретный entry из очереди (например после ручного cancel). */
export async function removePendingFind(id: string): Promise<void> {
  const queue = await readQueue();
  const filtered = queue.filter((e) => e.id !== id);
  await writeQueue(filtered);
}

/** Получить список failed (для экрана "нужна помощь"). */
export async function getFailedFinds(): Promise<PendingFind[]> {
  try {
    const raw = await AsyncStorage.getItem(FAILED_KEY);
    return raw ? (JSON.parse(raw) as PendingFind[]) : [];
  } catch {
    return [];
  }
}

/** Очистить failed (после review / ручной подачи). */
export async function clearFailedFinds(): Promise<void> {
  await AsyncStorage.removeItem(FAILED_KEY);
}

// ─────────────────────────────────────────────
// Internal
// ─────────────────────────────────────────────

async function readQueue(): Promise<PendingFind[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as PendingFind[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: PendingFind[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function appendFailed(items: PendingFind[]): Promise<void> {
  const existing = await getFailedFinds();
  const merged = [...existing, ...items];
  await AsyncStorage.setItem(FAILED_KEY, JSON.stringify(merged));
}

function uuid(): string {
  // Быстрый client-side uuid v4 (не криптостойкий, но достаточен для локальной дедупа).
  const rnd = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(1, '0');
  return `${rnd(0x10000000).padStart(8, '0')}-${rnd(0x10000)}-4${rnd(0x1000).slice(-3)}-${rnd(0x10000).slice(-4)}-${Date.now().toString(16).slice(-12)}`;
}
