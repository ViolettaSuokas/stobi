// i18n — мультиязычные строки Stobi.
//
// Использование:
//   const { t, lang, setLang } = useI18n();
//   <Text>{t('tab.map')}</Text>
//
// Добавить новый ключ:
//   1. Добавь в lib/i18n/strings/ru.ts
//   2. Добавь тот же ключ в fi.ts и en.ts (fallback на en если ключ
//      пропущен в твоей локали)
//   3. Используй в коде через t('your.key')
//
// Интерполяция (простая, без плюралов):
//   добавь {placeholder} в строку, потом .replace('{placeholder}', value)
//   в месте использования — см. примеры в add.tsx / premium.tsx.
//
// Новый язык: создай strings/<code>.ts, расширь тип Lang, добавь в
// объект T + LANGUAGE_NAMES. Готово.

import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { ru } from './strings/ru';
import { fi } from './strings/fi';
import { en } from './strings/en';

export type Lang = 'ru' | 'fi' | 'en';

const LANG_KEY = 'stobi:language';

const T: Record<Lang, Record<string, string>> = { ru, fi, en };

type I18nContextType = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
};

// Default — всегда английский (международная аудитория). Раньше hardcoded
// 'ru', потом auto-detect device locale — но владелец app просит начать
// с английского. Юзер сразу видит language picker на онбординге, может
// переключить за 1 тап. AsyncStorage override побеждает (запоминается).
function detectDeviceLang(): Lang {
  return 'en';
}

const I18nContext = createContext<I18nContextType>({
  lang: 'en',
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectDeviceLang);

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      const saved = await AsyncStorage.getItem(LANG_KEY);
      if (!mounted) return;
      if (saved === 'ru' || saved === 'fi' || saved === 'en') {
        setLangState(saved as Lang);
      } else {
        // LANG_KEY был очищен (resetAll при delete account / logout) —
        // возвращаемся к дефолту вместо stale value из памяти.
        setLangState('en');
      }
    };
    void sync();
    // Перечитываем язык при изменении auth-сессии. Это срабатывает после
    // logout/deleteAccount: resetAll очищает LANG_KEY → onAuthStateChange
    // (event='SIGNED_OUT') → sync() → fallback на 'en'.
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        const { supabase } = await import('../supabase');
        const { data } = supabase.auth.onAuthStateChange(() => { void sync(); });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch {/* offline / not configured — ничего не делаем */}
    })();
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const setLang = (newLang: Lang) => {
    setLangState(newLang);
    AsyncStorage.setItem(LANG_KEY, newLang);
  };

  // Fallback chain: текущий язык → en → сам ключ (последнее хотя бы подскажет
  // разработчику что ключ отсутствует во всех локалях)
  const t = (key: string): string => {
    return T[lang]?.[key] ?? T.en[key] ?? key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}

export const LANGUAGE_NAMES: Record<Lang, string> = {
  ru: 'Русский',
  fi: 'Suomi',
  en: 'English',
};
