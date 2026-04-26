// Followers / Following list — accessible by tapping stat counters on
// user-profile или own-profile. Tabs Подписчики / Подписки.
//
// URL params:
//   id — user uuid (whose follows we're viewing)
//   tab — 'followers' | 'following' (initial tab)

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CaretLeft, CheckCircle } from 'phosphor-react-native';
import { Colors } from '../../constants/Colors';
import { useI18n } from '../../lib/i18n';
import { getFollowingList, getFollowersList, type FollowListItem } from '../../lib/follows';
import { StoneMascot } from '../../components/StoneMascot';

type Tab = 'followers' | 'following';

export default function FollowsListScreen() {
  const { id, tab: initialTab } = useLocalSearchParams<{ id: string; tab?: Tab }>();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(initialTab === 'following' ? 'following' : 'followers');
  const [followers, setFollowers] = useState<FollowListItem[]>([]);
  const [following, setFollowing] = useState<FollowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    const [f, g] = await Promise.all([
      getFollowersList(id),
      getFollowingList(id),
    ]);
    setFollowers(f);
    setFollowing(g);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const list = tab === 'followers' ? followers : following;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <CaretLeft size={22} color={Colors.text} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {tab === 'followers'
            ? (t('follows.title_followers') || 'Подписчики')
            : (t('follows.title_following') || 'Подписки')}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['followers', 'following'] as const).map((tt) => {
          const active = tab === tt;
          const count = tt === 'followers' ? followers.length : following.length;
          const label = tt === 'followers'
            ? (t('follows.tab_followers') || 'Подписчики')
            : (t('follows.tab_following') || 'Подписки');
          return (
            <TouchableOpacity
              key={tt}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(tt)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {label} {count > 0 ? `· ${count}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>
            {tab === 'followers'
              ? (t('follows.empty_followers') || 'Пока никто не подписался')
              : (t('follows.empty_following') || 'Пока ни на кого не подписан')}
          </Text>
          <Text style={styles.emptyText}>
            {tab === 'followers'
              ? (t('follows.empty_followers_text') || 'Создавай красивые камни и раскрашивай — подпишутся!')
              : (t('follows.empty_following_text') || 'Найди интересных людей в чате или ленте — и подпишись на их профиль.')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => it.userId}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push(`/user/${item.userId}` as any)}
            >
              <View style={styles.avatar}>
                {item.photoUrl ? (
                  <Image source={{ uri: item.photoUrl }} style={styles.avatarImg} />
                ) : (
                  <StoneMascot size={36} color={Colors.mascot} variant="happy" />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.username || (t('user_profile.no_name') || 'Без имени')}
                  </Text>
                  {item.isArtist && <CheckCircle size={13} color={Colors.accent} weight="fill" />}
                </View>
              </View>
            </TouchableOpacity>
          )}
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
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: Colors.text },

  tabs: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  tabActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { fontSize: 13, fontWeight: '700', color: Colors.text2 },
  tabTextActive: { color: '#FFFFFF', fontWeight: '800' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  emptyText: { fontSize: 13, color: Colors.text2, textAlign: 'center', lineHeight: 18 },

  listContent: { paddingVertical: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 40, height: 40 },
  name: { fontSize: 14, fontWeight: '700', color: Colors.text },
});
