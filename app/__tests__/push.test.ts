// Тесты для push.ts — lightweight smoke tests.
// Полное покрытие requires E2E на real device (expo-notifications
// lazy-loaded через await import(), и хранит state в модуле).

let mockIsDevice = true;

jest.mock('expo-device', () => ({
  get isDevice() { return mockIsDevice; },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: null })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 4 },
}));

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      upsert: jest.fn(async () => ({ error: null })),
      delete: jest.fn(() => ({ eq: jest.fn().mockReturnThis() })),
    })),
  },
  isSupabaseConfigured: () => true,
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'test-id' } } },
    easConfig: null,
  },
}));

import { registerPushToken, attachResponseListener, unregisterPushToken } from '../lib/push';

describe('push — registerPushToken (simulator/denied paths)', () => {
  beforeEach(() => {
    mockIsDevice = true;
  });

  test('returns null на симуляторе', async () => {
    mockIsDevice = false;
    const token = await registerPushToken('user-1');
    expect(token).toBeNull();
  });

  test('returns null когда permission denied', async () => {
    mockIsDevice = true;
    const token = await registerPushToken('user-1');
    // Mocked getPermissionsAsync + requestPermissionsAsync → 'denied' → null
    expect(token).toBeNull();
  });

  test('не throws независимо от результата', async () => {
    await expect(registerPushToken('user-1')).resolves.toBeDefined();
  });
});

describe('push — attachResponseListener', () => {
  test('возвращает cleanup function', async () => {
    const cleanup = await attachResponseListener(() => {});
    expect(typeof cleanup).toBe('function');
    // Cleanup должен работать без ошибок
    expect(() => cleanup()).not.toThrow();
  });

  test('принимает callback (onStone)', async () => {
    const callback = jest.fn();
    const cleanup = await attachResponseListener(callback);
    expect(cleanup).toBeDefined();
  });
});

describe('push — unregisterPushToken', () => {
  test('не throws на missing token', async () => {
    await expect(unregisterPushToken('user-1')).resolves.toBeUndefined();
  });
});
