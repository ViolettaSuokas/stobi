import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from './supabase';
import { trackEvent } from './analytics';

const USER_KEY = 'stobi:user';
const ONBOARDING_KEY = 'stobi:onboarding_seen';
const REGISTERED_KEY = 'stobi:registered_users';

// ────────────────────────────────────────────
// Google Sign-in OAuth client IDs
// ────────────────────────────────────────────

/** iOS OAuth client ID — from Google Cloud Console (project stobi-ee201). */
const GOOGLE_IOS_CLIENT_ID =
  '984920601746-3of6pe9k4klltqo6mruu8mpc73ka3n3j.apps.googleusercontent.com';

/** Web OAuth client ID — used by Android SDK to issue Supabase-compatible tokens. */
const GOOGLE_WEB_CLIENT_ID =
  '984920601746-dta6cvqtot5sc4u45pss0t9jik1ksnol.apps.googleusercontent.com';

let googleConfigured = false;

/** Lazily resolve the Google Sign-in SDK — handles Metro's ESM interop. */
export function getGoogleSignin(): any {
  try {
    const mod = require('@react-native-google-signin/google-signin');
    if (!mod) return null;
    return mod.GoogleSignin ?? mod.default?.GoogleSignin ?? mod.default ?? null;
  } catch (e) { console.warn(e);
    return null;
  }
}

/** Configure the Google Sign-in SDK. Safe to call repeatedly (no-op after first). */
export function configureGoogleSignIn(): void {
  if (googleConfigured) return;
  const GoogleSignin = getGoogleSignin();
  if (!GoogleSignin) return;
  GoogleSignin.configure({
    iosClientId: GOOGLE_IOS_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID,
  });
  googleConfigured = true;
}

export type User = {
  id: string;
  email: string;
  username: string;
  bio?: string;
  avatar: string;
  /** Real user photo URI (camera/gallery upload) */
  photoUrl?: string;
  /** Custom name for the stone mascot character */
  characterName?: string;
  isArtist?: boolean;
};

// ────────────────────────────────────────────
// Demo accounts (visible only in __DEV__)
// ────────────────────────────────────────────

type StoredCredential = { password: string; user: User };

const DEMO_USERS: Record<string, StoredCredential> = {
  'demo@stobi.app': {
    password: 'demo123',
    user: {
      id: 'demo-1',
      email: 'demo@stobi.app',
      username: 'Aleksi Korhonen',
      bio: 'Люблю прятать камни в лесах Вантаа 🌲 #Stobi',
      avatar: '🦋',
    },
  },
  'anna@stobi.app': {
    password: 'anna123',
    user: {
      id: 'demo-2',
      email: 'anna@stobi.app',
      username: 'Anna Virtanen',
      bio: 'Художница из Хельсинки 🎨 расписываю камни с 2019',
      avatar: '🎨',
      isArtist: true,
    },
  },
};

export const DEMO_ACCOUNTS = [
  { email: 'demo@stobi.app', password: 'demo123', label: 'Demo пользователь', emoji: '🦋' },
  { email: 'anna@stobi.app', password: 'anna123', label: 'Anna (художница)', emoji: '🎨' },
];

// ────────────────────────────────────────────
// Local fallback helpers (used when Supabase is not configured)
// ────────────────────────────────────────────

async function readRegistered(): Promise<Record<string, StoredCredential>> {
  const json = await AsyncStorage.getItem(REGISTERED_KEY);
  return json ? JSON.parse(json) : {};
}

async function writeRegistered(data: Record<string, StoredCredential>): Promise<void> {
  await AsyncStorage.setItem(REGISTERED_KEY, JSON.stringify(data));
}

// ────────────────────────────────────────────
// Public API — auto-routes to Supabase or local
// ────────────────────────────────────────────

export async function getCurrentUser(): Promise<User | null> {
  if (isSupabaseConfigured()) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (!profile) return null;
      // Cache locally for offline
      const mapped: User = {
        id: profile.id,
        email: user.email ?? '',
        username: profile.username,
        bio: profile.bio,
        avatar: profile.avatar ?? '🪨',
        photoUrl: profile.photo_url ?? undefined,
        characterName: profile.character_name ?? undefined,
        isArtist: profile.is_artist,
      };
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(mapped));
      return mapped;
    } catch (e) { console.warn(e);
      // Fallback to cached user if offline
      const cached = await AsyncStorage.getItem(USER_KEY);
      return cached ? JSON.parse(cached) : null;
    }
  }

  // Local mode
  const json = await AsyncStorage.getItem(USER_KEY);
  return json ? (JSON.parse(json) as User) : null;
}

export async function login(email: string, password: string): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new Error('Введи email и пароль');
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });
    if (error) throw new Error(error.message);
    await trackEvent('login');
    const user = await getCurrentUser();
    if (!user) throw new Error('Profile not found');
    return user;
  }

  // Local fallback — demo accounts + registered
  const demo = DEMO_USERS[normalizedEmail];
  if (demo) {
    if (demo.password !== password) throw new Error('Неверный пароль');
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(demo.user));
    return demo.user;
  }

  const registered = await readRegistered();
  const found = registered[normalizedEmail];
  if (!found) throw new Error('Пользователь не найден');
  if (found.password !== password) throw new Error('Неверный пароль');
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(found.user));
  return found.user;
}

export async function register(
  email: string,
  password: string,
  username: string,
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedName = username.trim();

  if (!normalizedEmail || !password || !trimmedName) {
    throw new Error('Заполни все поля');
  }
  if (password.length < 6) {
    throw new Error('Пароль должен быть не меньше 6 символов');
  }

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: { data: { username: trimmedName } },
    });
    if (error) throw new Error(error.message);
    await trackEvent('register');
    // Profile is auto-created by database trigger
    const user = await getCurrentUser();
    if (!user) {
      // Trigger may not have fired yet — manual fallback
      return {
        id: data.user?.id ?? `user-${Date.now()}`,
        email: normalizedEmail,
        username: trimmedName,
        avatar: '🪨',
      };
    }
    return user;
  }

  // Local fallback
  if (DEMO_USERS[normalizedEmail]) throw new Error('Этот email уже занят');
  const registered = await readRegistered();
  if (registered[normalizedEmail]) throw new Error('Этот email уже зарегистрирован');

  const newUser: User = {
    id: `user-${Date.now()}`,
    email: normalizedEmail,
    username: trimmedName,
    avatar: '🪨',
  };

  registered[normalizedEmail] = { password, user: newUser };
  await writeRegistered(registered);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(newUser));
  return newUser;
}

export async function logout(): Promise<void> {
  if (isSupabaseConfigured()) {
    await supabase.auth.signOut();
  }
  // Full reset on logout — not just USER_KEY. Block list, safety ack,
  // reported-messages, etc. are user-specific; leaving them around
  // leaks the previous user's state into the next signed-in user's
  // session (e.g. new user inherits an already-acked SafetyGate).
  await resetAll();
}

export async function deleteAccount(): Promise<void> {
  // Order is critical:
  //   1. RPC first (server cascade of profile + all owned rows).
  //   2. signOut to revoke the local session (also invalidates refresh
  //      token, though the access token remains cryptographically valid
  //      until its JWT exp; server-side RLS fails anyway because
  //      auth.uid() is no longer a row in auth.users after the cascade).
  //   3. resetAll runs in `finally` so if signOut throws, local state is
  //      still wiped and the next login starts clean.
  //
  // Do not reorder: signOut before the RPC would strip the JWT and the
  // RPC would fail with "not_authenticated".
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase.rpc('delete_user');
      if (error) {
        throw new Error(error.message || 'Не удалось удалить аккаунт. Попробуй ещё раз.');
      }
      await supabase.auth.signOut();
      await trackEvent('account_deleted');
    } finally {
      await resetAll();
    }
  } else {
    await resetAll();
  }
}

/** GDPR Article 15: export all personal data tied to the current user. */
export async function exportMyData(): Promise<Record<string, unknown>> {
  if (!isSupabaseConfigured()) throw new Error('Export is available only when signed in online.');
  const { data, error } = await supabase.rpc('gdpr_export_my_data');
  if (error) throw new Error(error.message || 'Export failed.');
  await trackEvent('data_exported');
  return data as Record<string, unknown>;
}

/** Update user's profile photo URI */
export async function updateProfilePhoto(photoUrl: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').update({ photo_url: photoUrl }).eq('id', user.id);
    }
  }
  const cached = await AsyncStorage.getItem(USER_KEY);
  if (cached) {
    const u = JSON.parse(cached);
    u.photoUrl = photoUrl;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
  }
}

/** Update stone mascot character name */
export async function updateCharacterName(name: string): Promise<void> {
  if (isSupabaseConfigured()) {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('profiles').update({ character_name: name }).eq('id', user.id);
    }
  }
  const cached = await AsyncStorage.getItem(USER_KEY);
  if (cached) {
    const u = JSON.parse(cached);
    u.characterName = name;
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(u));
  }
}

export async function hasSeenOnboarding(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ONBOARDING_KEY);
  return value === '1';
}

export async function markOnboardingSeen(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDING_KEY, '1');
}

export async function resetOnboarding(): Promise<void> {
  await AsyncStorage.removeItem(ONBOARDING_KEY);
}

export async function resetAll(): Promise<void> {
  await AsyncStorage.multiRemove([
    USER_KEY,
    ONBOARDING_KEY,
    REGISTERED_KEY,
    'stobi:points',
    'stobi:chat_messages',
    'stobi:chat_likes',
    'stobi:chat_last_read',
    'stobi:user_finds',
    'stobi:premium_trial',
    'stobi:user_stones',
    'stobi:achievements',
    'stobi:daily_challenge',
    'stobi:notif:push',
    'stobi:notif:email',
    'stobi:notif:chat',
    'stobi:language',
    // Per-user state added for TestFlight launch. Missing these would
    // leak state into a freshly-logged-in second user (e.g. new user
    // bypasses SafetyGate because old user already acked it).
    'stobi:reported_messages',
    'stobi:blocked_users_v1',
    'stobi:safety_acknowledged_v1',
  ]);
}
