// История алмазиков — список balance_events текущего юзера.
//
// Источник правды: таблица balance_events на Supabase. Каждое начисление
// и списание (welcome_bonus, find_reward, achievement:*, buy_item,
// referral_*, и т.д.) попадает сюда сразу из соответствующих RPC.
//
// Раньше "История платежей" в settings была заглушкой — modal "Пусто".
// Реальной истории платежей (in-app purchases) у нас пока нет; там
// будут подписки когда RevenueCat ливнёт. А вот история алмазиков —
// это то что юзеру действительно полезно.

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
import { CaretLeft, Sparkle, Trophy, Gift, ShoppingBag, MapPin, Users } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { getBalanceHistory, type BalanceEvent } from '../lib/points';

type Reason =
  | 'welcome_bonus'
  | 'find_reward'
  | 'find_author_bonus'
  | 'achievement'
  | 'referral_invited'
  | 'referral_redeemed'
  | 'buy_item'
  | 'unknown';

function classifyReason(reason: string): Reason {
  if (reason === 'welcome_bonus') return 'welcome_bonus';
  if (reason === 'find_reward') return 'find_reward';
  if (reason === 'find_author_bonus') return 'find_author_bonus';
  if (reason.startsWith('achievement:')) return 'achievement';
  if (reason === 'referral_invited') return 'referral_invited';
  if (reason === 'referral_redeemed') return 'referral_redeemed';
  if (reason === 'buy_item') return 'buy_item';
  return 'unknown';
}

function reasonIcon(r: Reason) {
  switch (r) {
    case 'welcome_bonus': return Gift;
    case 'find_reward': return MapPin;
    case 'find_author_bonus': return MapPin;
    case 'achievement': return Trophy;
    case 'referral_invited': return Users;
    case 'referral_redeemed': return Users;
    case 'buy_item': return ShoppingBag;
    default: return Sparkle;
  }
}

function formatDate(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    const lang = locale === 'fi' ? 'fi-FI' : locale === 'en' ? 'en-US' : 'ru-RU';
    return d.toLocaleDateString(lang, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export default function DiamondHistoryScreen() {
  const { t, lang } = useI18n();
  const [events, setEvents] = useState<BalanceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const rows = await getBalanceHistory(100);
    setEvents(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); }
    finally { setRefreshing(false); }
  }, [load]);

  const renderItem = ({ item }: { item: BalanceEvent }) => {
    const reasonClass = classifyReason(item.reason);
    const Icon = reasonIcon(reasonClass);
    const isPositive = item.amount > 0;
    const labelKey = `diamond_history.reason_${reasonClass}`;
    const label = t(labelKey) || item.reason;
    return (
      <View style={styles.eventRow}>
        <View
          style={[
            styles.iconBox,
            { backgroundColor: isPositive ? '#DCFCE7' : '#FEE2E2' },
          ]}
        >
          <Icon
            size={18}
            color={isPositive ? Colors.green : '#DC2626'}
            weight="fill"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.eventLabel} numberOfLines={1}>{label}</Text>
          <Text style={styles.eventDate}>{formatDate(item.createdAt, lang)}</Text>
        </View>
        <Text
          style={[
            styles.eventAmount,
            { color: isPositive ? Colors.green : '#DC2626' },
          ]}
        >
          {isPositive ? '+' : ''}{item.amount} 💎
        </Text>
      </View>
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
          {t('diamond_history.title') || 'История алмазиков'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIconBox}>
            <Sparkle size={42} color={Colors.text2} weight="duotone" />
          </View>
          <Text style={styles.emptyTitle}>
            {t('diamond_history.empty_title') || 'Пока пусто'}
          </Text>
          <Text style={styles.emptyText}>
            {t('diamond_history.empty_text') ||
              'Найди или спрячь камень — алмазики начнут начисляться, и здесь будет вся история.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={events}
          keyExtractor={(e) => e.id}
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  eventDate: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 2,
  },
  eventAmount: {
    fontSize: 15,
    fontWeight: '800',
  },
});
