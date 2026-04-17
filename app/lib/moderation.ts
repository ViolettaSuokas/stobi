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

const URL_PATTERN = /https?:\/\/|www\./i;

export type ModerationResult = {
  ok: boolean;
  reason?: 'profanity' | 'link' | 'too_short';
};

export function moderateMessage(text: string): ModerationResult {
  const lower = text.toLowerCase().trim();

  if (!lower && !text.trim()) {
    return { ok: false, reason: 'too_short' };
  }

  if (URL_PATTERN.test(lower)) {
    return { ok: false, reason: 'link' };
  }

  for (const word of ALL_BANNED) {
    if (lower.includes(word)) {
      return { ok: false, reason: 'profanity' };
    }
  }

  return { ok: true };
}
