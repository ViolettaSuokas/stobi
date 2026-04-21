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

  // ── Replicate timeout — модель думает дольше 30 сек ──
  if (msg.includes('replicate timeout') || (msg.includes('timeout') && msg.includes('replicate'))) {
    return {
      title: 'AI долго думает',
      message: 'Нейросеть сейчас перегружена. Ненадолго.',
      tips: [
        'Попробуй ещё раз через минуту',
        'Если повторяется — у тебя может быть нестабильное соединение',
      ],
    };
  }

  // ── Network / offline ──
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
    return {
      title: 'Нет интернета',
      message: 'Не получилось связаться с сервером. Камень не получилось проверить.',
      tips: [
        'Проверь Wi-Fi или мобильный интернет',
        'Попробуй ещё раз когда подключение восстановится',
      ],
    };
  }

  // ── NSFW moderation ──
  if (msg.includes('nsfw') || msg.includes('moderation')) {
    return {
      title: 'Это не камень',
      message: 'В кадре что-то другое — AI не разрешил сохранить это фото.',
      tips: [
        'Сфотографируй именно камень',
        'Убедись что в кадре нет людей или посторонних предметов',
      ],
    };
  }

  // ── Любой server-side сбой мы показываем как «камень не распознан» ──
  //   — с точки зрения юзера без разницы, AI лёг или AI не нашёл совпадение.
  //   Важно только что надо что-то изменить в фото.
  if (msg.includes('non-2xx') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('timeout')) {
    return {
      title: 'Камень не распознан',
      message: 'AI не смог понять что на фото. Давай ещё раз.',
      tips: [
        'Поднеси камень ближе к камере — пусть займёт бо́льшую часть кадра',
        'Проверь освещение — может быть слишком темно или яркие блики',
        'Сфотографируй с другого ракурса',
        'Сфокусируй камеру тапом по экрану перед снимком',
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
  if (kind === 'find-anywhere') {
    return {
      title: 'Похожего камня нет',
      message: 'В базе Stobi не нашёлся такой камень. Возможно, его ещё не зарегистрировали, или AI не разобрал рисунок.',
      tips: [
        'Убедись что в кадре именно камень, а не стена или фон',
        'Поверни его стороной с рисунком, ярко освещённой',
        'Попробуй ещё один ракурс — крупнее и чётче',
        'Возможно, этот камень ещё не в Stobi',
      ],
    };
  }

  return {
    title: 'Это не тот камень',
    message: 'AI не узнал в этом фото именно тот камень, который ты сканируешь.',
    tips: [
      'Сфотографируй целиком — без обрезанных углов',
      'Следи чтобы рисунок был полностью виден и в фокусе',
      'Поверни камень к свету, убери тени',
      'Если уверена что это он — сделай ещё один снимок под другим углом',
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
        title: 'Камень не обнаружен',
        message: 'В кадре однотонная поверхность — похоже стена, пол или объектив чем-то закрыт.',
        tips: [
          'Поднеси камень в центр рамки — близко и чётко',
          'Убедись что объектив не закрыт пальцем',
          'Камень должен занимать бо́льшую часть кадра',
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
