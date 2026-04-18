import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Fire } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { getTodayChallenge } from '../lib/daily-challenge';

/**
 * 🔥 Streak badge — показывает сколько дней подряд юзер делал
 * daily challenge. Читает из daily-challenge state.streakCount.
 *
 * Показывается только если streak ≥ 1. При 3+ становится "огненным"
 * (фоновый градиент), при 7+ — золотым.
 *
 * Цель: видимое напоминание не пропустить день. Classical retention
 * mechanic (Duolingo, Headspace).
 */
export function StreakBadge() {
  const { t } = useI18n();
  const [streak, setStreak] = useState(0);

  const load = useCallback(async () => {
    const challenge = await getTodayChallenge();
    setStreak(challenge.streakCount);
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (streak < 1) return null;

  const tier = streak >= 7 ? 'gold' : streak >= 3 ? 'hot' : 'warm';
  const bg = tier === 'gold' ? '#FCD34D' : tier === 'hot' ? '#F59E0B' : Colors.accentLight;
  const fg = tier === 'gold' ? '#78350F' : tier === 'hot' ? '#FFFFFF' : Colors.accent;

  return (
    <View
      style={[styles.badge, { backgroundColor: bg }]}
      accessibilityRole="text"
      accessibilityLabel={`${streak} ${t('streak.days_label')}`}
    >
      <Fire size={16} color={fg} weight="fill" />
      <Text style={[styles.text, { color: fg }]}>
        {streak} {streak === 1 ? t('streak.day') : t('streak.days')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  text: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
