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

// Phone numbers (any country, especially Finnish +358 XX XXX XXXX).
// Detects 7+ consecutive digits anywhere (even with spaces / dashes).
const PHONE_PATTERN = /(?:\+?\d[\s\-().]*){7,}/;

// Grooming / "let's meet alone" phrases — RU, FI, EN.
// Normalized version checked (lowercase, no punctuation).
const GROOMING_PHRASES = [
  // RU
  'встретимся', 'приходи одна', 'приходи один', 'приходи сам',
  'приди одна', 'приходи ко мне', 'приходи сюда', 'никому не говори',
  'это наш секрет', 'сколько тебе лет',
  // FI
  'tavataan', 'tule yksin', 'tule luokseni', 'alä kerro', 'tämä on salaisuutemme',
  'kuinka vanha olet',
  // EN
  'meet me', 'come alone', 'come by yourself', 'do not tell', "don't tell",
  'our little secret', 'how old are you', 'send me a pic', 'send a photo',
  'send me photos',
];

// Email addresses
const EMAIL_PATTERN = /[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

// Social media handles (@username, t.me/x, discord)
const SOCIAL_PATTERN = /@[a-z0-9_]{3,}|t\.me\/|discord\.gg/i;

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
  reason?: 'profanity' | 'link' | 'too_short' | 'phone' | 'email' | 'social' | 'grooming';
};

export function moderateMessage(text: string): ModerationResult {
  const trimmed = text.trim();

  if (!trimmed) {
    return { ok: false, reason: 'too_short' };
  }

  if (URL_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'link' };
  }

  // Child-safety layer: block personal contact info and grooming phrases.
  // These are stronger blocks than profanity — no point warning "be kind",
  // this is a pattern we never want in a public chat used by minors.
  if (PHONE_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'phone' };
  }
  if (EMAIL_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'email' };
  }
  if (SOCIAL_PATTERN.test(trimmed)) {
    return { ok: false, reason: 'social' };
  }

  const lowerSpaced = trimmed.toLowerCase();
  for (const phrase of GROOMING_PHRASES) {
    if (lowerSpaced.includes(phrase)) {
      return { ok: false, reason: 'grooming' };
    }
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
