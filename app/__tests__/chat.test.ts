import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: jest.fn() } },
  isSupabaseConfigured: () => false,
}));

// Мутабельный mock user — можно менять between tests
let mockUser: any = null;

jest.mock('../lib/auth', () => ({
  getCurrentUser: jest.fn(async () => mockUser),
}));

jest.mock('../lib/analytics', () => ({
  trackEvent: jest.fn(),
}));

jest.mock('../lib/cache', () => ({
  getCached: jest.fn(() => undefined),
  setCached: jest.fn(),
  invalidate: jest.fn(),
}));

import {
  getMessages,
  sendMessage,
  deleteMessage,
  editMessage,
  clearMessages,
  markChatRead,
  getUnreadCount,
  formatChatTime,
  toggleLike,
  getLikes,
} from '../lib/chat';

const LAST_READ_KEY = 'stobi:chat_last_read';

const loggedInUser = {
  id: 'u-test',
  email: 'test@stobi.app',
  username: 'Tester',
  avatar: '🪨',
  photoUrl: undefined,
  isArtist: false,
  bio: undefined,
  characterName: undefined,
};

describe('chat — formatChatTime', () => {
  test('< 1 мин → "сейчас"', () => {
    expect(formatChatTime(Date.now())).toBe('сейчас');
    expect(formatChatTime(Date.now() - 30_000)).toBe('сейчас');
  });

  test('1-59 мин → "N мин"', () => {
    expect(formatChatTime(Date.now() - 5 * 60_000)).toBe('5 мин');
    expect(formatChatTime(Date.now() - 45 * 60_000)).toBe('45 мин');
  });

  test('1-23 ч → "N ч"', () => {
    expect(formatChatTime(Date.now() - 2 * 3600_000)).toBe('2 ч');
    expect(formatChatTime(Date.now() - 10 * 3600_000)).toBe('10 ч');
  });

  test('> 24 ч → локализованная дата', () => {
    const result = formatChatTime(Date.now() - 3 * 86400_000);
    expect(result).not.toMatch(/\d+\s*(мин|ч)$/);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('chat — getMessages (local mode)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('пустой список когда никто не писал', async () => {
    const msgs = await getMessages();
    expect(msgs).toEqual([]);
  });

  test('возвращает отправленные сообщения в хронологическом порядке', async () => {
    mockUser = loggedInUser;
    await sendMessage('Первое');
    await new Promise((r) => setTimeout(r, 5));
    await sendMessage('Второе');
    await new Promise((r) => setTimeout(r, 5));
    await sendMessage('Третье');

    const msgs = await getMessages();
    expect(msgs).toHaveLength(3);
    expect(msgs[0].text).toBe('Первое');
    expect(msgs[1].text).toBe('Второе');
    expect(msgs[2].text).toBe('Третье');
    for (let i = 1; i < msgs.length; i++) {
      expect(msgs[i].createdAt).toBeGreaterThanOrEqual(msgs[i - 1].createdAt);
    }
  });

  test('limit параметр — возвращает последние N сообщений', async () => {
    mockUser = loggedInUser;
    for (let i = 0; i < 5; i++) {
      await sendMessage(`msg-${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    const msgs = await getMessages('global', 3);
    expect(msgs).toHaveLength(3);
    // Последние 3 = msg-2, msg-3, msg-4
    expect(msgs[0].text).toBe('msg-2');
    expect(msgs[2].text).toBe('msg-4');
  });
});

describe('chat — sendMessage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('бросает ошибку если guest (no user)', async () => {
    mockUser = null;
    await expect(sendMessage('text')).rejects.toThrow();
  });

  test('бросает ошибку на пустом тексте без photo', async () => {
    mockUser = loggedInUser;
    await expect(sendMessage('')).rejects.toThrow();
    await expect(sendMessage('   ')).rejects.toThrow();
  });

  test('принимает пустой текст если есть photo', async () => {
    mockUser = loggedInUser;
    await expect(sendMessage('', undefined, undefined, 'file://photo.jpg')).resolves.toBeDefined();
  });

  test('сохраняет сообщение с правильными полями', async () => {
    mockUser = loggedInUser;
    const msg = await sendMessage('Привет!');
    expect(msg.text).toBe('Привет!');
    expect(msg.authorId).toBe(loggedInUser.id);
    expect(msg.authorName).toBe(loggedInUser.username);
    expect(msg.id).toBeTruthy();
    expect(typeof msg.createdAt).toBe('number');
  });

  test('trim применяется к тексту', async () => {
    mockUser = loggedInUser;
    const msg = await sendMessage('  hello  ');
    expect(msg.text).toBe('hello');
  });
});

describe('chat — deleteMessage + editMessage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('deleteMessage удаляет сообщение', async () => {
    mockUser = loggedInUser;
    const msg = await sendMessage('to-delete');
    await deleteMessage(msg.id);
    const msgs = await getMessages();
    expect(msgs.find((m) => m.id === msg.id)).toBeUndefined();
  });

  test('editMessage обновляет текст + помечает как edited', async () => {
    mockUser = loggedInUser;
    const msg = await sendMessage('original');
    await editMessage(msg.id, 'edited');
    const msgs = await getMessages();
    const updated = msgs.find((m) => m.id === msg.id);
    expect(updated?.text).toBe('edited');
    expect(updated?.isEdited).toBe(true);
  });

  test('editMessage с пустым текстом — бросает ошибку (нельзя опустошить)', async () => {
    mockUser = loggedInUser;
    const msg = await sendMessage('original');
    await expect(editMessage(msg.id, '')).rejects.toThrow();
  });
});

describe('chat — markChatRead + getUnreadCount', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('unread = 0 на пустом chat', async () => {
    expect(await getUnreadCount()).toBe(0);
  });

  test('отправленное сообщение → unread=1 (без markRead)', async () => {
    mockUser = loggedInUser;
    await sendMessage('unread msg');
    // Собственные сообщения тоже могут считаться unread в этой реализации
    const count = await getUnreadCount();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('markChatRead → unread=0', async () => {
    mockUser = loggedInUser;
    await sendMessage('msg1');
    await markChatRead();
    expect(await getUnreadCount()).toBe(0);
  });

  test('lastRead сохраняется в AsyncStorage', async () => {
    await markChatRead();
    const stored = await AsyncStorage.getItem(LAST_READ_KEY);
    expect(stored).toBeTruthy();
    expect(Number(stored)).toBeLessThanOrEqual(Date.now());
  });
});

describe('chat — toggleLike + getLikes', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('getLikes — пустой объект на чистом storage', async () => {
    const likes = await getLikes();
    expect(likes).toEqual({});
  });

  test('toggleLike добавляет лайк', async () => {
    mockUser = loggedInUser;
    const result = await toggleLike('msg-id-123');
    expect(result.liked).toBe(true);
    const likes = await getLikes();
    expect(likes['msg-id-123']).toContain(loggedInUser.id);
  });

  test('toggleLike повторно убирает лайк', async () => {
    mockUser = loggedInUser;
    await toggleLike('msg-x');
    const result = await toggleLike('msg-x');
    expect(result.liked).toBe(false);
    const likes = await getLikes();
    expect(likes['msg-x'] ?? []).not.toContain(loggedInUser.id);
  });
});

describe('chat — clearMessages', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockUser = null;
  });

  test('clearMessages на пустом storage не ломается', async () => {
    await expect(clearMessages()).resolves.not.toThrow();
  });

  test('clearMessages удаляет все сохранённые сообщения', async () => {
    mockUser = loggedInUser;
    await sendMessage('a');
    await sendMessage('b');
    await clearMessages();
    const msgs = await getMessages();
    expect(msgs).toEqual([]);
  });
});
