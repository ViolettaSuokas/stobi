// Контекстные сообщения маскота. Выбирается одно случайное из подходящего
// набора — в зависимости от времени суток, streak, активности и т.д.
//
// Правило: сообщения короткие (≤80 chars), teплые, от лица мескота в
// первом лице. Финский рынок — аудитория семейная, избегаем сленга.

import type { MascotVariant } from '../components/StoneMascot';

export type MascotContext = {
  /** 0-23 час дня пользователя (local) */
  hour: number;
  /** Сколько дней подряд user делает daily challenge */
  streakDays: number;
  /** Найдено сегодня камней */
  findsToday: number;
  /** Всего найдено камней пользователем за всё время */
  totalFinds: number;
  /** Имя пользователя (для приветствия) */
  userName?: string | null;
  /** Имя мескота (character_name) */
  mascotName?: string | null;
  /** Есть ли активный премиум */
  isPremium: boolean;
};

export type MascotMessage = {
  text: string;
  /** Рекомендуемый вариант лица для этого сообщения */
  variant: MascotVariant;
};

// Вместо объектов с текстом на трёх языках делаем ключ → i18n резолвит
// на стороне UI. Здесь только массивы ключей.

type MessageRef = {
  key: string;
  variant: MascotVariant;
};

const WELCOME_MORNING: MessageRef[] = [
  { key: 'mascot.morning_1', variant: 'sparkle' },
  { key: 'mascot.morning_2', variant: 'happy' },
  { key: 'mascot.morning_3', variant: 'happy' },
];

const WELCOME_AFTERNOON: MessageRef[] = [
  { key: 'mascot.afternoon_1', variant: 'happy' },
  { key: 'mascot.afternoon_2', variant: 'wink' },
  { key: 'mascot.afternoon_3', variant: 'sparkle' },
];

const WELCOME_EVENING: MessageRef[] = [
  { key: 'mascot.evening_1', variant: 'wink' },
  { key: 'mascot.evening_2', variant: 'happy' },
];

const WELCOME_NIGHT: MessageRef[] = [
  { key: 'mascot.night_1', variant: 'sleeping' },
  { key: 'mascot.night_2', variant: 'sleeping' },
];

const STREAK_FIRE: MessageRef[] = [
  { key: 'mascot.streak_fire_1', variant: 'sparkle' },
  { key: 'mascot.streak_fire_2', variant: 'sparkle' },
];

const STREAK_BROKEN: MessageRef[] = [
  { key: 'mascot.no_activity_1', variant: 'sleeping' },
  { key: 'mascot.no_activity_2', variant: 'sleeping' },
];

const NEWBIE: MessageRef[] = [
  { key: 'mascot.newbie_1', variant: 'sparkle' },
  { key: 'mascot.newbie_2', variant: 'happy' },
];

const AFTER_FIND: MessageRef[] = [
  { key: 'mascot.finds_today_1', variant: 'happy' },
  { key: 'mascot.finds_today_2', variant: 'sparkle' },
];

const VETERAN: MessageRef[] = [
  { key: 'mascot.veteran_1', variant: 'sparkle' },
  { key: 'mascot.veteran_2', variant: 'wink' },
];

/** Выбирает контекстно-подходящее сообщение. Deterministic по часу — один и
 *  тот же контекст покажет одно и то же сообщение в течение часа. */
export function pickMascotMessage(ctx: MascotContext): MessageRef {
  // Ночь — всегда спим независимо от активности
  if (ctx.hour < 6 || ctx.hour >= 22) {
    return deterministicPick(WELCOME_NIGHT, ctx);
  }

  // Стрик 7+ — огонь, даже утром
  if (ctx.streakDays >= 7) {
    return deterministicPick(STREAK_FIRE, ctx);
  }

  // Новичок — приоритет onboarding tone
  if (ctx.totalFinds === 0) {
    return deterministicPick(NEWBIE, ctx);
  }

  // Уже есть находки сегодня — хвалим
  if (ctx.findsToday > 0) {
    return deterministicPick(AFTER_FIND, ctx);
  }

  // Ветеран (100+ находок) — особый тон
  if (ctx.totalFinds >= 100) {
    return deterministicPick(VETERAN, ctx);
  }

  // Время-зависимые приветствия
  if (ctx.hour < 11) return deterministicPick(WELCOME_MORNING, ctx);
  if (ctx.hour < 17) return deterministicPick(WELCOME_AFTERNOON, ctx);
  return deterministicPick(WELCOME_EVENING, ctx);
}

function deterministicPick(messages: MessageRef[], ctx: MascotContext): MessageRef {
  // Простой hash: час + streak — стабилен в пределах часа
  const seed = ctx.hour * 31 + ctx.streakDays * 7 + ctx.findsToday;
  return messages[seed % messages.length];
}

/** Время-зависимое приветствие для заголовка сверху */
export function getGreetingKey(hour: number): string {
  if (hour < 6) return 'greeting.late_night';
  if (hour < 11) return 'greeting.morning';
  if (hour < 17) return 'greeting.afternoon';
  if (hour < 22) return 'greeting.evening';
  return 'greeting.late_night';
}
