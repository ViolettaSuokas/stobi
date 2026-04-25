// Notifications screen — список уведомлений юзера.
//
// Сейчас MVP-stub: показывает пустое состояние. Полная реализация требует:
//   - таблица user_notifications в БД (find / message / referral / system)
//   - триггеры/edge function вставки при событиях
//   - push-уведомления через Expo Push (push_queue → APNs/FCM)
//   - mark-as-read RPC + badge-counter
// Trackers: пункты "Push на find" и "Колокольчик с историей" в backlog.

import { Stack, router } from 'expo-router';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CaretLeft, BellSlash } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';

export default function NotificationsScreen() {
  const { t } = useI18n();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <CaretLeft size={22} color={Colors.text} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('notifications.title') || 'Уведомления'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.empty}>
        <View style={styles.emptyIconBox}>
          <BellSlash size={42} color={Colors.text2} weight="duotone" />
        </View>
        <Text style={styles.emptyTitle}>
          {t('notifications.empty_title') || 'Пока тут тихо'}
        </Text>
        <Text style={styles.emptyText}>
          {t('notifications.empty_text') ||
            'Здесь будут уведомления когда кто-то найдёт твой камень, ответит в чате или подтвердит находку.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 14,
  },
  emptyIconBox: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
  },
});
