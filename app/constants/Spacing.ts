// Единая шкала отступов — используй вместо магических чисел (5, 7, 13 px).
// Базовая сетка — 4 px. Подбирай ближайшее значение; если не подходит —
// добавь новый ключ, а не захардкоживай число в стилях.
//
// Импорт: import { Spacing } from '../constants/Spacing';
// Использование: { padding: Spacing.md, marginBottom: Spacing.lg }

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

// Радиусы скруглений — тоже выделены чтобы карточки/кнопки/инпуты
// оставались консистентными.
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export type SpacingKey = keyof typeof Spacing;
export type RadiusKey = keyof typeof Radius;
