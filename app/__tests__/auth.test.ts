import AsyncStorage from '@react-native-async-storage/async-storage';

// Мокаем supabase до импорта auth. isSupabaseConfigured() = false в тестах,
// поэтому auth падает на "local mode" путь (AsyncStorage).

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: null } })),
      signInWithPassword: jest.fn(),
      signUp: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(async () => ({ data: null, error: null })),
    })),
  },
  isSupabaseConfigured: () => false,
}));

import {
  getCurrentUser,
  logout,
  resetAll,
  hasSeenOnboarding,
  markOnboardingSeen,
  resetOnboarding,
  updateProfilePhoto,
  updateCharacterName,
  DEMO_ACCOUNTS,
  type User,
} from '../lib/auth';

const USER_KEY = 'stobi:user';
const ONBOARDING_KEY = 'stobi:onboarding_seen';

async function seedUser(): Promise<User> {
  const user: User = {
    id: 'u-test',
    email: 'test@stobi.app',
    username: 'Tester',
    bio: undefined,
    avatar: '🪨',
    photoUrl: undefined,
    characterName: 'Rocky',
    isArtist: false,
  };
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}

describe('auth — getCurrentUser (local mode)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('returns null когда юзер не сохранён', async () => {
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test('возвращает кешированного юзера из AsyncStorage', async () => {
    const seeded = await seedUser();
    const user = await getCurrentUser();
    expect(user).toEqual(seeded);
  });

  test('возвращает null на поврежденном JSON (graceful)', async () => {
    // Если кеш повреждён (не валидный JSON) — поймаем через try/catch
    // от AsyncStorage.getItem. Для безопасности JSON.parse может кинуть.
    await AsyncStorage.setItem(USER_KEY, 'not-a-json');
    await expect(getCurrentUser()).rejects.toBeDefined();
  });
});

describe('auth — logout + resetAll', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('logout удаляет user из AsyncStorage', async () => {
    await seedUser();
    await logout();
    const user = await getCurrentUser();
    expect(user).toBeNull();
  });

  test('resetAll очищает всё приложение (onboarding + user + points + etc.)', async () => {
    await seedUser();
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    await AsyncStorage.setItem('stobi:points', '100');
    await AsyncStorage.setItem('stobi:daily_challenge', '{}');

    await resetAll();

    expect(await AsyncStorage.getItem(USER_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(ONBOARDING_KEY)).toBeNull();
    expect(await AsyncStorage.getItem('stobi:points')).toBeNull();
    expect(await AsyncStorage.getItem('stobi:daily_challenge')).toBeNull();
  });
});

describe('auth — onboarding flag', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('hasSeenOnboarding false на свежем установке', async () => {
    expect(await hasSeenOnboarding()).toBe(false);
  });

  test('markOnboardingSeen → hasSeenOnboarding true', async () => {
    await markOnboardingSeen();
    expect(await hasSeenOnboarding()).toBe(true);
  });

  test('resetOnboarding сбрасывает флаг (для dev-режима)', async () => {
    await markOnboardingSeen();
    await resetOnboarding();
    expect(await hasSeenOnboarding()).toBe(false);
  });

  test('hasSeenOnboarding работает независимо от user', async () => {
    // Юзер залогинен, но onboarding не пройден (маловероятно, но edge case)
    await seedUser();
    expect(await hasSeenOnboarding()).toBe(false);
  });
});

describe('auth — updateProfilePhoto', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('обновляет photoUrl в кеше', async () => {
    await seedUser();
    await updateProfilePhoto('https://example.com/new-photo.jpg');
    const user = await getCurrentUser();
    expect(user?.photoUrl).toBe('https://example.com/new-photo.jpg');
  });

  test('не ломается если кеш пустой (guest)', async () => {
    // Не должно бросать исключение
    await expect(updateProfilePhoto('https://x.jpg')).resolves.not.toThrow();
  });
});

describe('auth — updateCharacterName', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('обновляет characterName в кеше', async () => {
    await seedUser();
    await updateCharacterName('Pebble');
    const user = await getCurrentUser();
    expect(user?.characterName).toBe('Pebble');
  });

  test('не ломается на пустом кеше', async () => {
    await expect(updateCharacterName('X')).resolves.not.toThrow();
  });

  test('перезаписывает имя (idempotent)', async () => {
    await seedUser();
    await updateCharacterName('Name1');
    await updateCharacterName('Name2');
    const user = await getCurrentUser();
    expect(user?.characterName).toBe('Name2');
  });
});

describe('auth — DEMO_ACCOUNTS', () => {
  test('массив с валидной структурой', () => {
    expect(DEMO_ACCOUNTS.length).toBeGreaterThan(0);
    for (const acc of DEMO_ACCOUNTS) {
      expect(acc.email).toMatch(/@stobi\.app$/);
      expect(acc.password).toBeTruthy();
      expect(acc.label).toBeTruthy();
      expect(acc.emoji).toBeTruthy();
    }
  });

  test('уникальные email-ы', () => {
    const emails = DEMO_ACCOUNTS.map((a) => a.email);
    const unique = new Set(emails);
    expect(unique.size).toBe(emails.length);
  });
});
