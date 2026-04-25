import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCurrentUser } from './auth';
import { supabase, isSupabaseConfigured } from './supabase';
import { trackEvent } from './analytics';
import { getCached, setCached, invalidate } from './cache';
import type { StonePhotoKey } from './stone-photos';

const MESSAGES_KEY = 'stobi:chat_messages';

export type ChatMessage = {
  id: string;
  authorId: string;
  authorName: string;
  authorAvatar: string;
  /** Real user photo URI (if available) */
  authorPhotoUrl?: string;
  isArtist?: boolean;
  text: string;
  createdAt: number;
  /** Optional photo of a stone the user is sharing */
  photo?: StonePhotoKey;
  /** If this message is a reply to another message */
  replyToId?: string;
  /** User-sent photo URI (camera/gallery) */
  photoUri?: string;
  /** Set to true after the message has been edited */
  isEdited?: boolean;
};

// Pre-seeded community messages — calculated on import so timestamps
// stay relative to "now" and feel fresh between launches.
const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

const SEED_MESSAGES: ChatMessage[] = [
  {
    id: 'seed-1',
    authorId: 'seed-aleksi',
    authorName: 'Aleksi Korhonen',
    authorAvatar: '🦋',
    text: 'Привет всем! Сегодня нашёл целых 3 камня в Tikkurila 🌸 вот один из них!',
    createdAt: NOW - 5 * HOUR,
    photo: 'pinkFlower',
  },
  {
    id: 'seed-2',
    authorId: 'seed-anna',
    authorName: 'Anna Virtanen',
    authorAvatar: '🎨',
    isArtist: true,
    text: 'Спасибо что нашли мой синий камень с бабочкой! Очень рада ❤️',
    createdAt: NOW - 4 * HOUR - 35 * MIN,
    photo: 'blueSwirls',
  },
  {
    id: 'seed-3',
    authorId: 'seed-mika',
    authorName: 'Mika Laine',
    authorAvatar: '🌲',
    text: 'Кто-то прячет в районе Myyrmäki? Хочу прогуляться там в субботу',
    createdAt: NOW - 3 * HOUR - 20 * MIN,
  },
  {
    id: 'seed-4',
    authorId: 'seed-sari',
    authorName: 'Sari Mäki',
    authorAvatar: '🌿',
    text: 'Поделитесь идеями для зимнего расписывания? Какие краски лучше держатся в холод?',
    createdAt: NOW - 2 * HOUR - 50 * MIN,
  },
  {
    id: 'seed-5',
    authorId: 'seed-aleksi',
    authorName: 'Aleksi Korhonen',
    authorAvatar: '🦋',
    text: 'Sari, я использую acrylic + лак сверху. Держится всю зиму, никакая Финляндия не страшна 😄',
    createdAt: NOW - 2 * HOUR - 30 * MIN,
  },
  {
    id: 'seed-6',
    authorId: 'seed-julia',
    authorName: 'Юлия Иванова',
    authorAvatar: '🌸',
    text: 'Завтра в Helsinki около Esplanadi в 11 утра спрячу 5 новых камней! Один из них вот такой 👇',
    createdAt: NOW - 2 * HOUR,
    photo: 'pinkOwl',
  },
  {
    id: 'seed-7',
    authorId: 'seed-anna',
    authorName: 'Anna Virtanen',
    authorAvatar: '🎨',
    isArtist: true,
    text: 'Ого, обязательно загляну! У тебя такие красивые цветочные мотивы 🌺',
    createdAt: NOW - 1 * HOUR - 45 * MIN,
  },
  {
    id: 'seed-8',
    authorId: 'seed-petri',
    authorName: 'Petri Nieminen',
    authorAvatar: '🔥',
    text: 'У меня малыш только начал собирать камни, ему 6 лет — такой счастливый когда находит 😍 вот сегодня нашли',
    createdAt: NOW - 1 * HOUR - 15 * MIN,
    photo: 'ghostCupcake',
  },
  {
    id: 'seed-9',
    authorId: 'seed-mika',
    authorName: 'Mika Laine',
    authorAvatar: '🌲',
    text: "Нашёл сегодня камень с надписью 'You are loved' в Vantaa, прям растрогало 💙",
    createdAt: NOW - 50 * MIN,
    photo: 'heartFlowers',
  },
  {
    id: 'seed-10',
    authorId: 'seed-sari',
    authorName: 'Sari Mäki',
    authorAvatar: '🌿',
    text: 'Anna, недавно нашла твой космический камень около Sello! Перепрятала в Otaniemi 🌌',
    createdAt: NOW - 25 * MIN,
    photo: 'oceanView',
  },
  {
    id: 'seed-11',
    authorId: 'seed-aleksi',
    authorName: 'Aleksi Korhonen',
    authorAvatar: '🦋',
    text: 'Кстати, скоро летний фестиваль Stobi в Helsinki — будет показ камней от художников 🎉',
    createdAt: NOW - 8 * MIN,
    photo: 'marioSet',
  },
];

async function readPersisted(): Promise<ChatMessage[]> {
  const json = await AsyncStorage.getItem(MESSAGES_KEY);
  return json ? (JSON.parse(json) as ChatMessage[]) : [];
}

async function writePersisted(messages: ChatMessage[]): Promise<void> {
  await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
}

/** Default page size for chat history. Tuned so initial render stays
 * snappy even when the room has thousands of messages. */
export const MESSAGES_PAGE_SIZE = 50;

/**
 * Загружает последние N сообщений канала.
 *
 * @param channel — имя канала (default: 'global')
 * @param limit   — сколько взять с сервера за один вызов (default: 50)
 * @param beforeMs — epoch ms; взять только сообщения ДО этого момента
 *                   (для "load older"). Без него = последние.
 *
 * Возвращает всегда в хронологическом порядке (старые → новые).
 */
export async function getMessages(
  channel: string = 'global',
  limit: number = MESSAGES_PAGE_SIZE,
  beforeMs?: number,
): Promise<ChatMessage[]> {
  // Кэш только для первой страницы (последних limit). Older-pages не кэшим —
  // их редко листают, и инвалидация по курсору была бы геморройной.
  const isFirstPage = beforeMs === undefined;
  const cacheKey = `messages:${channel}:${limit}`;
  if (isFirstPage) {
    const cached = getCached<ChatMessage[]>(cacheKey);
    if (cached) return cached;
  }

  if (isSupabaseConfigured()) {
    try {
      let query = supabase
        .from('messages')
        .select('*, profiles!messages_author_id_fkey(username, avatar, is_artist, photo_url)')
        .eq('channel', channel)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (beforeMs) {
        query = query.lt('created_at', new Date(beforeMs).toISOString());
      }

      const { data, error } = await query;

      if (!error && data) {
        // descending → ascending для нормального chat-flow
        const msgs = data.map((row: Record<string, any>) => ({
          id: row.id,
          authorId: row.author_id,
          authorName: row.profiles?.username ?? 'Unknown',
          authorAvatar: row.profiles?.avatar ?? '🪨',
          authorPhotoUrl: row.profiles?.photo_url ?? undefined,
          isArtist: row.profiles?.is_artist ?? false,
          text: row.text ?? '',
          createdAt: new Date(row.created_at).getTime(),
          photo: row.photo_url ?? undefined,
          replyToId: row.reply_to_id ?? undefined,
          isEdited: row.is_edited ?? false,
        })).reverse();
        if (isFirstPage) setCached(cacheKey, msgs, 10_000);
        return msgs;
      }
    } catch (e) {
      console.warn('getMessages fallback to local', e);
      // Fall through to local
    }
  }

  // Local fallback — strict channel filtering.
  // Legacy messages без channel считаем как 'FI' (default при создании).
  const persisted = await readPersisted();
  let filtered = persisted
    .filter((m) => {
      const msgChannel = (m as any).channel ?? 'FI';
      return msgChannel === channel;
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  if (beforeMs) {
    filtered = filtered.filter((m) => m.createdAt < beforeMs);
  }
  // Вернуть последние `limit` (с конца)
  if (filtered.length > limit) {
    filtered = filtered.slice(filtered.length - limit);
  }
  return filtered;
}

export async function sendMessage(
  text: string,
  photo?: StonePhotoKey,
  replyToId?: string,
  photoUri?: string,
  channel: string = 'global',
): Promise<ChatMessage> {
  const trimmed = text.trim();
  if (!trimmed && !photo && !photoUri) throw new Error('Сообщение не может быть пустым');

  const user = await getCurrentUser();
  if (!user) throw new Error('Войди в аккаунт чтобы писать в чат');

  if (isSupabaseConfigured()) {
    try {
      const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
      if (authError || !authUser) {
        // Auth session broken / expired. The user thinks they're signed
        // in (we have local user cache) but Supabase doesn't agree, so
        // every send would silently fall back to local-only storage and
        // nobody else sees the message. Surface a real error instead.
        console.warn('sendMessage: supabase.auth.getUser() returned no user', authError);
        throw new Error('Сессия истекла. Закрой и открой приложение, или войди заново.');
      }
      const { data: row, error } = await supabase
        .from('messages')
        .insert({
          author_id: authUser.id,
          text: trimmed,
          photo_url: photo ?? null,
          reply_to_id: replyToId ?? null,
          channel,
        })
        .select('*, profiles!messages_author_id_fkey(username, avatar, is_artist, photo_url)')
        .single();

      if (error) {
        // Real DB error (RLS / moderation / rate limit). Surface it
        // instead of silently writing to local — silent fallback was
        // the root cause of the "messages don't sync between devices" bug.
        console.warn('sendMessage db insert failed', error);
        // Map known error messages to friendlier text.
        var msg = error.message || 'unknown';
        if (msg.includes('moderation_url')) throw new Error('Ссылки в чате запрещены.');
        if (msg.includes('moderation_phone')) throw new Error('Телефонные номера нельзя.');
        if (msg.includes('moderation_email')) throw new Error('Email-адреса нельзя.');
        if (msg.includes('moderation_social')) throw new Error('Никнеймы соцсетей нельзя.');
        if (msg.includes('moderation_grooming')) throw new Error('Сообщение выглядит небезопасно.');
        if (msg.includes('moderation_profanity')) throw new Error('Без мата, пожалуйста.');
        if (msg.includes('rate_limit')) throw new Error('Подожди 3 секунды перед следующим сообщением.');
        if (msg.includes('hourly_limit')) throw new Error('Лимит 30 сообщений в час исчерпан.');
        if (msg.includes('message_too_long')) throw new Error('Сообщение слишком длинное (макс 2000).');
        throw new Error('Не удалось отправить сообщение: ' + msg);
      }
      if (row) {
        invalidate(`messages:${channel}`);
        trackEvent('chat_message');
        return {
          id: row.id,
          authorId: row.author_id,
          authorName: row.profiles?.username ?? user.username,
          authorAvatar: row.profiles?.avatar ?? user.avatar,
          authorPhotoUrl: row.profiles?.photo_url ?? undefined,
          isArtist: row.profiles?.is_artist ?? false,
          text: row.text ?? '',
          createdAt: new Date(row.created_at).getTime(),
          photo: row.photo_url ?? undefined,
          replyToId: row.reply_to_id ?? undefined,
          isEdited: false,
        };
      }
      // If neither error nor row — defensive fallthrough.
      throw new Error('Не удалось отправить сообщение (пустой ответ).');
    } catch (e) {
      // Re-throw so the caller (chat.tsx handleSend) can show the alert.
      throw e;
    }
  }

  const message: ChatMessage & { channel?: string } = {
    id: `msg-${Date.now()}`,
    authorId: user.id,
    authorName: user.username,
    authorAvatar: user.avatar,
    authorPhotoUrl: user.photoUrl,
    isArtist: user.isArtist,
    text: trimmed,
    createdAt: Date.now(),
    photo,
    photoUri,
    replyToId,
    channel, // Сохраняем channel чтобы сообщения не смешивались между каналами
  };

  const persisted = await readPersisted();
  persisted.push(message);
  await writePersisted(persisted);
  return message;
}

export async function deleteMessage(messageId: string): Promise<void> {
  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase
        .from('messages')
        .delete()
        .eq('id', messageId);
      if (!error) return;
    } catch (e) { console.warn(e);
      // Fall through to local
    }
  }

  const persisted = await readPersisted();
  const filtered = persisted.filter((m) => m.id !== messageId);
  await writePersisted(filtered);
}

export async function editMessage(
  messageId: string,
  newText: string,
): Promise<void> {
  const trimmed = newText.trim();
  if (!trimmed) throw new Error('Сообщение не может быть пустым');

  if (isSupabaseConfigured()) {
    try {
      const { error } = await supabase
        .from('messages')
        .update({ text: trimmed, is_edited: true })
        .eq('id', messageId);
      if (!error) return;
    } catch (e) { console.warn(e);
      // Fall through to local
    }
  }

  const persisted = await readPersisted();
  const msg = persisted.find((m) => m.id === messageId);
  if (!msg) throw new Error('Сообщение не найдено');

  msg.text = trimmed;
  msg.isEdited = true;
  await writePersisted(persisted);
}

export async function clearMessages(): Promise<void> {
  await AsyncStorage.removeItem(MESSAGES_KEY);
}

// ────────────────────────────────────────────
// Unread count — tracks when user last viewed chat
// ────────────────────────────────────────────

const LAST_READ_KEY = 'stobi:chat_last_read';

export async function markChatRead(): Promise<void> {
  await AsyncStorage.setItem(LAST_READ_KEY, String(Date.now()));
}

export async function getUnreadCount(): Promise<number> {
  const lastReadStr = await AsyncStorage.getItem(LAST_READ_KEY);
  const lastRead = lastReadStr ? Number(lastReadStr) : 0;
  const messages = await getMessages();
  return messages.filter((m) => m.createdAt > lastRead).length;
}

// ────────────────────────────────────────────
// Likes — stored separately so seed messages can also have likes
// ────────────────────────────────────────────

const LIKES_KEY = 'stobi:chat_likes';

// Empty by default — only real user likes
const SEED_LIKES: Record<string, string[]> = {};

async function readLikes(): Promise<Record<string, string[]>> {
  const json = await AsyncStorage.getItem(LIKES_KEY);
  const persisted: Record<string, string[]> = json ? JSON.parse(json) : {};
  // Merge seed + persisted (persisted overrides seed for same key)
  const merged = { ...SEED_LIKES };
  for (const [k, v] of Object.entries(persisted)) {
    merged[k] = v;
  }
  return merged;
}

async function writeLikes(likes: Record<string, string[]>): Promise<void> {
  await AsyncStorage.setItem(LIKES_KEY, JSON.stringify(likes));
}

export async function getLikes(): Promise<Record<string, string[]>> {
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await supabase
        .from('likes')
        .select('*');

      if (!error && data) {
        const grouped: Record<string, string[]> = {};
        for (const row of data) {
          if (!grouped[row.message_id]) grouped[row.message_id] = [];
          grouped[row.message_id].push(row.user_id);
        }
        return grouped;
      }
    } catch (e) { console.warn(e);
      // Fall through to local
    }
  }

  return readLikes();
}

/**
 * Toggle like for the current user on a message.
 * Returns the new like count for that message.
 */
export async function toggleLike(messageId: string): Promise<{
  count: number;
  liked: boolean;
}> {
  const user = await getCurrentUser();
  if (!user) throw new Error('Login required');

  if (isSupabaseConfigured()) {
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        // Check if like already exists
        const { data: existing } = await supabase
          .from('likes')
          .select('*')
          .eq('user_id', authUser.id)
          .eq('message_id', messageId)
          .maybeSingle();

        let liked: boolean;
        if (existing) {
          await supabase
            .from('likes')
            .delete()
            .eq('user_id', authUser.id)
            .eq('message_id', messageId);
          liked = false;
        } else {
          await supabase
            .from('likes')
            .insert({ user_id: authUser.id, message_id: messageId });
          liked = true;
        }

        // Get updated count
        const { count } = await supabase
          .from('likes')
          .select('*', { count: 'exact', head: true })
          .eq('message_id', messageId);

        return { count: count ?? 0, liked };
      }
    } catch (e) { console.warn(e);
      // Fall through to local
    }
  }

  const userId = user.id;
  const likes = await readLikes();
  const list = [...(likes[messageId] ?? [])];
  const idx = list.indexOf(userId);
  let liked: boolean;

  if (idx >= 0) {
    list.splice(idx, 1);
    liked = false;
  } else {
    list.push(userId);
    liked = true;
  }

  likes[messageId] = list;
  await writeLikes(likes);
  return { count: list.length, liked };
}

// Format a timestamp for chat display ("сейчас" / "5 мин" / "2 ч" / "12 мар")
export function formatChatTime(ts: number): string {
  const date = new Date(ts);
  const diffMs = Date.now() - ts;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'сейчас';
  if (diffMin < 60) return `${diffMin} мин`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ч`;

  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
