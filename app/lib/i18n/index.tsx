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

const I18nContext = createContext<I18nContextType>({
  lang: 'ru',
  setLang: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ru');

  useEffect(() => {
    AsyncStorage.getItem(LANG_KEY).then((saved) => {
      if (saved === 'ru' || saved === 'fi' || saved === 'en') {
        setLangState(saved as Lang);
      }
    });
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
