// Единая типографская шкала Stobi. Используй готовые роли вместо
// подбора fontSize/fontWeight/lineHeight на глаз в каждом экране.
//
// Импорт: import { Typography } from '../constants/Typography';
// Использование:
//   <Text style={[Typography.heading1, { color: Colors.text }]}>Hello</Text>

import { TextStyle } from 'react-native';

// Имена ролей:
//   display — крупный hero (splash, premium hero)
//   heading1-3 — заголовки экрана / секции / подсекции
//   body — основной текст
//   bodyBold — выделенный body
//   caption — мелкий (подписи, time-ago)
//   button — текст на CTA
//   label — инпут-лейблы, micro-стата

export const Typography = {
  display: {
    fontSize: 36,
    fontWeight: '900' as TextStyle['fontWeight'],
    lineHeight: 44,
    letterSpacing: -0.5,
  },
  heading1: {
    fontSize: 28,
    fontWeight: '800' as TextStyle['fontWeight'],
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  heading2: {
    fontSize: 22,
    fontWeight: '800' as TextStyle['fontWeight'],
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  heading3: {
    fontSize: 18,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 24,
  },
  bodyBold: {
    fontSize: 15,
    fontWeight: '700' as TextStyle['fontWeight'],
    lineHeight: 22,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as TextStyle['fontWeight'],
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    fontWeight: '500' as TextStyle['fontWeight'],
    lineHeight: 16,
  },
  button: {
    fontSize: 16,
    fontWeight: '800' as TextStyle['fontWeight'],
    lineHeight: 20,
    letterSpacing: 0.2,
  },
  label: {
    fontSize: 13,
    fontWeight: '600' as TextStyle['fontWeight'],
    lineHeight: 18,
    letterSpacing: 0.1,
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyKey = keyof typeof Typography;
