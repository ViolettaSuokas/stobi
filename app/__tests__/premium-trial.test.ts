import { formatRemaining } from '../lib/premium-trial';

describe('formatRemaining', () => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  test('zero / negative → "0м"', () => {
    expect(formatRemaining(0)).toBe('0м');
    expect(formatRemaining(-100)).toBe('0м');
  });

  test('minutes only', () => {
    expect(formatRemaining(5 * MIN)).toBe('5м');
    expect(formatRemaining(59 * MIN)).toBe('59м');
  });

  test('hours and minutes', () => {
    expect(formatRemaining(1 * HOUR)).toBe('1ч');
    expect(formatRemaining(1 * HOUR + 30 * MIN)).toBe('1ч 30м');
    expect(formatRemaining(23 * HOUR + 15 * MIN)).toBe('23ч 15м');
  });

  test('days (7-day trial)', () => {
    expect(formatRemaining(7 * DAY)).toBe('7д');
    expect(formatRemaining(3 * DAY + 5 * HOUR)).toBe('3д 5ч');
    expect(formatRemaining(1 * DAY)).toBe('1д');
  });
});
