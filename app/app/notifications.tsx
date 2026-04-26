// Notifications screen — список уведомлений юзера из push_queue.
//
// При входе автоматом markAllNotificationsRead — bell-badge на карте
// сбрасывается. Тап на запись → если есть stone_id → открывает камень.

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import {
  CaretLeft,
  BellSlash,
  Heart,
  Question,
  Users,
  Sparkle,
  type IconProps,
} from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import {
  getNotifications,
  markAllNotificationsRead,
  type NotificationItem,
} from '../lib/notifications';
import type { ComponentType } from 'react';

function iconForType(type: string): { Icon: ComponentType<IconProps>; bg: string; color: string } {
  switch (type) {
    case 'stone_found':
      return { Icon: Heart, bg: '#DCFCE7', color: '#16A34A' };
    case 'pending_find':
      return { Icon: Question, bg: '#FEF3C7', color: '#92400E' };
    case 'referral_redeemed':
      return { Icon: Users, bg: '#E0E7FF', color: Colors.accent };
    default:
      return { Icon: Sparkle, bg: Colors.surface, color: Colors.text2 };
  }
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return locale === 'fi' ? 'juuri nyt' : locale === 'en' ? 'just now' : 'только что';
    if (diffMin < 60) {
      if (locale === 'fi') return `${diffMin} min sitten`;
      if (locale === 'en') return `${diffMin}m ago`;
      return `${diffMin} мин назад`;
    }
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) {
      if (locale === 'fi') return `${diffH} t sitten`;
      if (locale === 'en') return `${diffH}h ago`;
      return `${diffH} ч назад`;
    }
    const lang = locale === 'fi' ? 'fi-FI' : locale === 'en' ? 'en-US' : 'ru-RU';
    return d.toLocaleDateString(lang, { day: '2-digit', month: 'short' });
  } catch {
    return iso;
  }
}

export default function NotificationsScreen() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await getNotifications(50);
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    // Помечаем всё как прочитанное когда юзер открыл экран — bell-badge
    // на карте сбросится при следующем focus'е.
    void markAllNotificationsRead();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); }
    finally { setRefreshing(false); }
  }, [load]);

  const handleTap = (item: NotificationItem) => {
    if (item.type === 'pending_find' && item.stoneId) {
      router.push(`/stone/${item.stoneId}` as any);
    } else if (item.stoneId) {
      router.push(`/stone/${item.stoneId}` as any);
    } else if (item.type === 'referral_redeemed') {
      router.push('/(tabs)/profile' as any);
    }
  };

  const renderItem = ({ item }: { item: NotificationItem }) => {
    const { Icon, bg, color } = iconForType(item.type);
    const unread = !item.readAt;
    return (
      <TouchableOpacity
        style={[styles.row, unread && styles.rowUnread]}
        activeOpacity={0.7}
        onPress={() => handleTap(item)}
      >
        <View style={[styles.iconBox, { backgroundColor: bg }]}>
          <Icon size={20} color={color} weight="fill" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>{item.body}</Text>
          <Text style={styles.date}>{formatDate(item.createdAt, lang)}</Text>
        </View>
        {unread && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

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

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
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
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.accent}
            />
          }
        />
      )}
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
  center: {
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
  listContent: {
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowUnread: {
    backgroundColor: Colors.accentLight,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  titleUnread: {
    fontWeight: '800',
  },
  body: {
    fontSize: 13,
    color: Colors.text2,
    marginTop: 2,
    lineHeight: 18,
  },
  date: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 4,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    marginTop: 14,
  },
});
