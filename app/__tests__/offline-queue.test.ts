/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
      }),
      removeItem: jest.fn(async (k: string) => {
        store.delete(k);
      }),
      __store: store,
    },
  };
});

import {
  enqueuePendingFind,
  getPendingFinds,
  getPendingFindsCount,
  syncPendingFinds,
  removePendingFind,
  getFailedFinds,
  clearFailedFinds,
} from '../lib/offline-queue';

const AsyncStorage = require('@react-native-async-storage/async-storage').default as any;

async function resetStorage(): Promise<void> {
  AsyncStorage.__store.clear();
  await clearFailedFinds();
}

describe('offline-queue — enqueue / read', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  test('enqueue persists and round-trips', async () => {
    await enqueuePendingFind({
      stone_id: 'stone-1',
      photo_uri: 'file:///tmp/a.jpg',
      lat: 60.1,
      lng: 25.1,
    });
    const all = await getPendingFinds();
    expect(all).toHaveLength(1);
    expect(all[0].stone_id).toBe('stone-1');
    expect(all[0].retry_count).toBe(0);
  });

  test('count reflects enqueues', async () => {
    for (let i = 0; i < 3; i++) {
      await enqueuePendingFind({
        stone_id: `s-${i}`,
        photo_uri: `file://${i}.jpg`,
        lat: null,
        lng: null,
      });
    }
    expect(await getPendingFindsCount()).toBe(3);
  });

  test('enqueue supports stone_id=null ("find anywhere" scenario)', async () => {
    await enqueuePendingFind({
      stone_id: null,
      photo_uri: 'file:///x.jpg',
      lat: null,
      lng: null,
    });
    const all = await getPendingFinds();
    expect(all[0].stone_id).toBeNull();
  });
});

describe('offline-queue — sync', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  test('synced entries are removed from queue', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });
    await enqueuePendingFind({ stone_id: 'b', photo_uri: 'y', lat: null, lng: null });

    const result = await syncPendingFinds(async () => 'synced');
    expect(result.synced).toBe(2);
    expect(await getPendingFindsCount()).toBe(0);
  });

  test('retry entries stay in queue with incremented retry_count', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });

    const result = await syncPendingFinds(async () => 'retry');
    expect(result.retry).toBe(1);
    const queue = await getPendingFinds();
    expect(queue).toHaveLength(1);
    expect(queue[0].retry_count).toBe(1);
  });

  test('after 3 retries, entry moves to failed', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });

    for (let i = 0; i < 3; i++) {
      await syncPendingFinds(async () => 'retry');
    }
    expect(await getPendingFindsCount()).toBe(0);
    const failed = await getFailedFinds();
    expect(failed).toHaveLength(1);
    expect(failed[0].retry_count).toBe(3);
  });

  test('failed outcome goes to failed bucket immediately', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });
    const result = await syncPendingFinds(async () => 'failed');
    expect(result.failed).toBe(1);
    expect(await getPendingFindsCount()).toBe(0);
    expect(await getFailedFinds()).toHaveLength(1);
  });

  test('thrown errors count as retry', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });
    await syncPendingFinds(async () => {
      throw new Error('network down');
    });
    const queue = await getPendingFinds();
    expect(queue).toHaveLength(1);
    expect(queue[0].retry_count).toBe(1);
    expect(queue[0].last_error).toBe('network down');
  });
});

describe('offline-queue — remove', () => {
  beforeEach(async () => {
    await resetStorage();
  });

  test('removePendingFind drops entry by id', async () => {
    const entry = await enqueuePendingFind({
      stone_id: 'a',
      photo_uri: 'x',
      lat: null,
      lng: null,
    });
    await removePendingFind(entry.id);
    expect(await getPendingFindsCount()).toBe(0);
  });

  test('remove with unknown id is a no-op', async () => {
    await enqueuePendingFind({ stone_id: 'a', photo_uri: 'x', lat: null, lng: null });
    await removePendingFind('no-such-id');
    expect(await getPendingFindsCount()).toBe(1);
  });
});
