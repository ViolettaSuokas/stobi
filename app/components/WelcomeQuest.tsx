import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { CheckCircle, PaintBrush, MagnifyingGlass, ChatCircle } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { getAchievements } from '../lib/achievements';
import { WelcomeQuestTaskCompleted, WelcomeQuestFullyCompleted } from '../lib/analytics';
import { router } from 'expo-router';

/**
 * Welcome Quest — 3 первые задачи для нового пользователя,
 * показываются на профиле пока не выполнены.
 *
 * Привязано к существующим achievements:
 *   - hide-first → «Спрячь первый камень»
 *   - find-first → «Найди первый камень»
 *   - social-chat → «Напиши в чат»
 *
 * Когда все 3 unlocked → компонент возвращает null (исчезает).
 *
 * Per product-audit — главный retention lever для D1 retention (25%+).
 * Цель: чтобы юзер за первый день сделал 3 ключевых действия и
 * почувствовал core loop.
 */

type Task = {
  achievementId: 'hide-first' | 'find-first' | 'social-chat';
  labelKey: string;
  rewardKey: string;
  Icon: any;
  onPress: () => void;
};

const TASKS: Task[] = [
  {
    achievementId: 'hide-first',
    labelKey: 'welcome.hide_first',
    rewardKey: 'welcome.hide_first_reward',
    Icon: PaintBrush,
    onPress: () => router.push('/(tabs)/add' as any),
  },
  {
    achievementId: 'find-first',
    labelKey: 'welcome.find_first',
    rewardKey: 'welcome.find_first_reward',
    Icon: MagnifyingGlass,
    onPress: () => router.push('/(tabs)/map' as any),
  },
  {
    achievementId: 'social-chat',
    labelKey: 'welcome.chat_first',
    rewardKey: 'welcome.chat_first_reward',
    Icon: ChatCircle,
    onPress: () => router.push('/(tabs)/chat' as any),
  },
];

export function WelcomeQuest() {
  const { t } = useI18n();
  const [unlocked, setUnlocked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const state = await getAchievements();
    const newUnlocked = {
      'hide-first': !!state['hide-first']?.unlocked,
      'find-first': !!state['find-first']?.unlocked,
      'social-chat': !!state['social-chat']?.unlocked,
    };
    // Трекаем когда task-и закрываются (сравниваем с предыдущим состоянием).
    // Это для funnel-анализа: какой task является gateway к retention.
    setUnlocked((prev) => {
      for (const key of Object.keys(newUnlocked) as (keyof typeof newUnlocked)[]) {
        if (newUnlocked[key] && !prev[key]) {
          void WelcomeQuestTaskCompleted(key);
        }
      }
      const allDoneNew = Object.values(newUnlocked).every(Boolean);
      const allDonePrev = Object.values(prev).every(Boolean);
      if (allDoneNew && !allDonePrev && Object.values(prev).some(Boolean)) {
        void WelcomeQuestFullyCompleted();
      }
      return newUnlocked;
    });
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const done = Object.values(unlocked).filter(Boolean).length;
  const total = TASKS.length;
  const allDone = done === total;

  if (allDone) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.progress}>{done}/{total}</Text>
      </View>
      <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

      <View style={styles.tasks}>
        {TASKS.map((task) => {
          const completed = unlocked[task.achievementId];
          return (
            <TouchableOpacity
              key={task.achievementId}
              style={[styles.task, completed && styles.taskDone]}
              onPress={task.onPress}
              disabled={completed}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t(task.labelKey)}
              accessibilityState={{ disabled: completed, checked: completed }}
            >
              {completed ? (
                <CheckCircle size={22} color={Colors.green} weight="fill" />
              ) : (
                <CheckCircle size={22} color={Colors.text2} weight="regular" />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.taskLabel, completed && styles.taskLabelDone]}>
                  {t(task.labelKey)}
                </Text>
                <Text style={styles.taskReward}>{t(task.rewardKey)}</Text>
              </View>
              {!completed && <task.Icon size={20} color={Colors.accent} weight="fill" />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.accentLight,
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.accent,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.accent,
    letterSpacing: 0.3,
  },
  progress: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.text2,
    marginTop: 4,
    marginBottom: 12,
  },
  tasks: { gap: 8 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  taskDone: { opacity: 0.5 },
  taskLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  taskLabelDone: {
    textDecorationLine: 'line-through',
    color: Colors.text2,
  },
  taskReward: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.accent,
    marginTop: 2,
  },
});
