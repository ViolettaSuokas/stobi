// Error-translator для scan flow. Маппит сырые сообщения ошибок
// (edge function 5xx, network fail, RPC rejection) на человеческие
// советы с actionable tips.
//
// Используется в scan-stone.tsx и find-anywhere.tsx чтобы избежать
// страшных "Edge function process-find-photo failed: non-2xx" в UI.

export type FriendlyError = {
  title: string;
  message: string;
  tips: string[];
};

export function translateScanError(
  raw: string | null | undefined,
  kind: 'find' | 'find-anywhere' = 'find',
): FriendlyError {
  const msg = (raw ?? '').toLowerCase();

  // ── Network / offline ──
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return {
      title: 'Нет подключения',
      message: 'Не получилось связаться с сервером.',
      tips: [
        'Проверь Wi-Fi или мобильный интернет',
        'Попробуй ещё раз через минуту',
      ],
    };
  }

  // ── NSFW moderation ──
  if (msg.includes('nsfw') || msg.includes('moderation')) {
    return {
      title: 'Это не похоже на камень',
      message: 'Фото не прошло проверку безопасности.',
      tips: [
        'Сфотографируй именно камень',
        'Убедись что в кадре нет других людей или предметов',
      ],
    };
  }

  // ── Edge function 5xx ──
  if (msg.includes('non-2xx') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('timeout')) {
    return {
      title: 'AI сейчас отдыхает',
      message: 'Не получилось проанализировать фото.',
      tips: [
        'Попробуй ещё раз через пару секунд',
        'Если не помогло — проверь интернет',
      ],
    };
  }

  // ── Upload failed ──
  if (msg.includes('upload') || msg.includes('storage')) {
    return {
      title: 'Не получилось загрузить фото',
      message: 'Проверь интернет и попробуй ещё раз.',
      tips: ['Сильное сжатие WiFi может ломать загрузку — переподключись'],
    };
  }

  // ── Auth ──
  if (msg.includes('not authenticated') || msg.includes('not_authenticated')) {
    return {
      title: 'Нужно войти',
      message: 'Сначала войди в аккаунт чтобы отметить находку.',
      tips: [],
    };
  }

  // ── Per-user / global limits ──
  if (msg.includes('per_user_daily_limit')) {
    return {
      title: 'Лимит находок у этого автора',
      message: 'Сегодня можно найти не больше 2 камней от одного автора.',
      tips: ['Вернись завтра — лимит обнулится в полночь'],
    };
  }
  if (msg.includes('global_author_limit')) {
    return {
      title: 'Этого автора уже много находят',
      message: 'Сегодняшний лимит на камни этого автора исчерпан всеми юзерами вместе.',
      tips: ['Попробуй завтра'],
    };
  }
  if (msg.includes('own_stone')) {
    return {
      title: 'Это твой камень',
      message: 'Свои камни искать нельзя.',
      tips: [],
    };
  }
  if (msg.includes('stone_hidden')) {
    return {
      title: 'Камень уехал с карты',
      message: 'Другие юзеры сообщили что его нет на месте.',
      tips: ['Автор может его вернуть, подойдя к месту'],
    };
  }

  // ── Default: couldn't recognize stone ──
  // (тут попадаем когда отсканировали стену / что-то непохожее)
  if (kind === 'find-anywhere') {
    return {
      title: 'Не нашли похожий камень',
      message: 'AI не узнал этот объект среди зарегистрированных камней Stobi.',
      tips: [
        'Убедись что в кадре именно камень, а не стена или фон',
        'Проверь освещение — может быть слишком темно',
        'Поверни камень ярче стороной с рисунком',
        'Возможно, этот камень ещё не зарегистрирован в Stobi',
      ],
    };
  }

  return {
    title: 'AI не узнал этот камень',
    message: 'Фото не похоже на тот камень, что ты сканируешь.',
    tips: [
      'Сфотографируй именно этот камень целиком',
      'Проверь что хорошее освещение и нет бликов',
      'Поверни камень ярче стороной с рисунком',
      'Если уверена что это он — попробуй ещё один ракурс',
    ],
  };
}

/**
 * Отдельный mapper для client-side scene quality reasons.
 */
export function sceneQualityError(reason: 'blurry' | 'too_dark' | 'too_uniform'): FriendlyError {
  switch (reason) {
    case 'too_dark':
      return {
        title: 'Слишком темно',
        message: 'AI не сможет разобрать рисунок при таком освещении.',
        tips: [
          'Отойди к окну или включи свет',
          'Используй вспышку телефона',
          'Попробуй на улице днём',
        ],
      };
    case 'too_uniform':
      return {
        title: 'Я не вижу камня',
        message: 'В кадре однотонная поверхность — похоже стена или фон.',
        tips: [
          'Поднеси камень в центр рамки',
          'Проверь что объектив не закрыт пальцем',
          'Сделай так чтобы камень занимал большую часть кадра',
        ],
      };
    case 'blurry':
      return {
        title: 'Фото размыто',
        message: 'AI не различит рисунок при такой размытости.',
        tips: [
          'Держи телефон устойчивее',
          'Подожди пока камера сфокусируется — тап по экрану помогает',
          'Убедись что объектив чистый',
        ],
      };
  }
}
