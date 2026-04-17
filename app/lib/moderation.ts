const BANNED_WORDS_RU = [
  'блять', 'бляд', 'сука', 'хуй', 'хуе', 'хуё', 'пизд', 'ебат', 'ебан',
  'ёбан', 'нахуй', 'нахуя', 'пидор', 'пидар', 'мудак', 'мудил', 'залуп',
  'шлюх', 'дерьм', 'жоп', 'говн', 'трах', 'ублюд',
];

const BANNED_WORDS_FI = [
  'vittu', 'perkele', 'saatan', 'helvet', 'paska', 'kusip', 'huora',
  'mulkk', 'kyrp', 'nussi',
];

const BANNED_WORDS_EN = [
  'fuck', 'shit', 'bitch', 'asshole', 'dick', 'cunt', 'nigger', 'faggot',
  'whore', 'slut', 'bastard', 'damn', 'cock', 'pussy',
];

const ALL_BANNED = [...BANNED_WORDS_RU, ...BANNED_WORDS_FI, ...BANNED_WORDS_EN];

const URL_PATTERN = /https?:\/\/|www\.|\.com|\.ru|\.fi|\.net|\.org|t\.me\//i;

const TRANSLIT_MAP: Record<string, string> = {
  'а': 'a', 'о': 'o', 'е': 'e', 'с': 'c', 'р': 'p', 'у': 'y',
  'х': 'x', 'к': 'k', 'н': 'h', 'в': 'b', 'м': 'm', 'т': 't',
};

function normalize(text: string): string {
  let result = text.toLowerCase();
  result = result.replace(/[^a-zа-яёА-ЯЁ0-9]/g, '');
  result = result.replace(/(.)\1{2,}/g, '$1$1');
  let normalized = '';
  for (const ch of result) {
    normalized += TRANSLIT_MAP[ch] ?? ch;
  }
  return normalized;
}

export type ModerationResult = {
  ok: boolean;
  reason?: 'profanity' | 'link' | 'too_short';
};

export function moderateMessage(text: string): ModerationResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return { ok: false, reason: 'too_short' };
  }

  if (URL_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'link' };
  }

  const normalized = normalize(trimmed);
  const original = trimmed.toLowerCase().replace(/\s+/g, '');

  for (const word of ALL_BANNED) {
    if (original.includes(word) || normalized.includes(word)) {
      return { ok: false, reason: 'profanity' };
    }
  }

  return { ok: true };
}
