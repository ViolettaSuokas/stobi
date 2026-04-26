// Public user profile screen — Instagram-style grid of someone else's
// hidden stones. Тап на username/avatar в feed/chat/stone-detail ведёт сюда.
//
// Видно: avatar, username, bio, joined date, stats (Hidden/Found/❤️),
// сетка камней (3 колонки). Тап на камень → /stone/[id]. Кнопка
// "Send DM" появится когда DM-фича готова (task #18).

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CaretLeft, CheckCircle, Heart, MapPin } from 'phosphor-react-native';
import { Colors } from '../../constants/Colors';
import { useI18n } from '../../lib/i18n';
import {
  getPublicProfile,
  getPublicProfileStats,
  getUserStonesGrid,
  getUserFoundStonesGrid,
  type PublicProfile,
  type PublicProfileStats,
  type PublicStoneItem,
} from '../../lib/public-profile';
import { StoneMascot } from '../../components/StoneMascot';

const { width } = Dimensions.get('window');
const GRID_GAP = 4;
const GRID_PADDING = 16;
const CELL_SIZE = Math.floor((width - GRID_PADDING * 2 - GRID_GAP * 2) / 3);

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [stats, setStats] = useState<PublicProfileStats>({ hiddenCount: 0, foundCount: 0, likesReceived: 0 });
  const [hiddenStones, setHiddenStones] = useState<PublicStoneItem[]>([]);
  const [foundStones, setFoundStones] = useState<PublicStoneItem[]>([]);
  const [activeTab, setActiveTab] = useState<'hidden' | 'found'>('hidden');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [p, s, hList, fList] = await Promise.all([
      getPublicProfile(id),
      getPublicProfileStats(id),
      getUserStonesGrid(id, 60),
      getUserFoundStonesGrid(id, 60),
    ]);
    setProfile(p);
    setStats(s);
    setHiddenStones(hList);
    setFoundStones(fList);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); }
    finally { setRefreshing(false); }
  }, [load]);

  const formatJoined = (iso: string | null) => {
    if (!iso) return '';
    try {
      const locale = lang === 'fi' ? 'fi-FI' : lang === 'en' ? 'en-US' : 'ru-RU';
      return new Date(iso).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
      return '';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <CaretLeft size={22} color={Colors.text} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {profile?.username || (t('user_profile.title') || 'Профиль')}
        </Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !profile ? (
        <View style={styles.center}>
          <Text style={styles.notFound}>
            {t('user_profile.not_found') || 'Профиль не найден'}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />}
        >
          {/* Hero — avatar + name + bio */}
          <View style={styles.hero}>
            <View style={styles.avatarWrap}>
              {profile.photoUrl ? (
                <Image source={{ uri: profile.photoUrl }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarMascot}>
                  <StoneMascot size={68} color={Colors.mascot} variant="happy" />
                </View>
              )}
            </View>
            <Text style={styles.heroName} numberOfLines={1}>
              {profile.username || (t('user_profile.no_name') || 'Без имени')}
              {profile.isArtist && (
                <Text> <CheckCircle size={14} color={Colors.accent} weight="fill" /></Text>
              )}
            </Text>
            {profile.bio ? (
              <Text style={styles.heroBio}>{profile.bio}</Text>
            ) : null}
            {profile.createdAt && (
              <Text style={styles.heroJoined}>
                {(t('user_profile.joined') || 'В Stobi с') + ' ' + formatJoined(profile.createdAt)}
              </Text>
            )}
          </View>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNum}>{stats.hiddenCount}</Text>
              <Text style={styles.statLabel}>
                {t('user_profile.stat_hidden') || 'Спрятал'}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statNum, { color: Colors.green }]}>{stats.foundCount}</Text>
              <Text style={styles.statLabel}>
                {t('user_profile.stat_found') || 'Нашёл'}
              </Text>
            </View>
            <View style={styles.statBox}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Heart size={16} color="#DC2626" weight="fill" />
                <Text style={[styles.statNum, { color: '#DC2626' }]}>{stats.likesReceived}</Text>
              </View>
              <Text style={styles.statLabel}>
                {t('user_profile.stat_likes') || 'Лайков'}
              </Text>
            </View>
          </View>

          {/* DM button — открывает DM thread с этим юзером */}
          <TouchableOpacity
            style={styles.dmBtn}
            activeOpacity={0.85}
            onPress={() => router.push(`/dm/${profile.id}` as any)}
            accessibilityRole="button"
            accessibilityLabel={t('user_profile.send_dm') || 'Написать сообщение'}
          >
            <Text style={styles.dmBtnText}>
              💬 {t('user_profile.send_dm') || 'Написать сообщение'}
            </Text>
          </TouchableOpacity>

          {/* Tabs: Спрятал / Нашёл */}
          <View style={styles.tabs}>
            {(['hidden', 'found'] as const).map((tab) => {
              const active = activeTab === tab;
              const count = tab === 'hidden' ? hiddenStones.length : foundStones.length;
              const label = tab === 'hidden'
                ? (t('user_profile.tab_hidden') || 'Спрятал')
                : (t('user_profile.tab_found') || 'Нашёл');
              return (
                <TouchableOpacity
                  key={tab}
                  style={[styles.tab, active && styles.tabActive]}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.tabText, active && styles.tabTextActive]}>
                    {label} {count > 0 ? `· ${count}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Stones grid for active tab */}
          <View style={styles.gridSection}>
            {(() => {
              const list = activeTab === 'hidden' ? hiddenStones : foundStones;
              if (list.length === 0) {
                return (
                  <Text style={styles.gridEmpty}>
                    {activeTab === 'hidden'
                      ? (t('user_profile.empty_hidden') || 'Пока ни одного камня не спрятал')
                      : (t('user_profile.empty_found') || 'Пока ничего не нашёл')}
                  </Text>
                );
              }
              return (
                <View style={styles.grid}>
                  {list.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={styles.cell}
                      activeOpacity={0.85}
                      onPress={() => router.push(`/stone/${s.id}` as any)}
                    >
                      {s.photoUrl ? (
                        <Image source={{ uri: s.photoUrl }} style={styles.cellImg} blurRadius={s.isFound ? 0 : 12} />
                      ) : (
                        <View style={styles.cellPlaceholder}>
                          <Text style={{ fontSize: 36 }}>{s.emoji || '🪨'}</Text>
                        </View>
                      )}
                      <View style={styles.cellOverlay}>
                        {s.isFound ? (
                          <CheckCircle size={16} color="#FFFFFF" weight="fill" />
                        ) : (
                          <MapPin size={14} color="#FFFFFF" weight="fill" />
                        )}
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>
        </ScrollView>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  notFound: { fontSize: 14, color: Colors.text2 },

  hero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 16 },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, overflow: 'hidden', backgroundColor: Colors.surface, marginBottom: 12 },
  avatarImg: { width: 88, height: 88 },
  avatarMascot: { width: 88, height: 88, alignItems: 'center', justifyContent: 'center' },
  heroName: { fontSize: 20, fontWeight: '900', color: Colors.text, textAlign: 'center' },
  heroBio: { fontSize: 14, color: Colors.text2, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  heroJoined: { fontSize: 12, color: Colors.text2, marginTop: 6 },

  statsRow: { flexDirection: 'row', alignItems: 'stretch', paddingHorizontal: 16, marginBottom: 16 },
  statBox: { flex: 1, marginHorizontal: 4, backgroundColor: Colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  statNum: { fontSize: 20, fontWeight: '800', color: Colors.accent },
  statLabel: { fontSize: 11, color: Colors.text2, marginTop: 3, fontWeight: '600' },

  dmBtn: {
    marginHorizontal: 16,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  dmBtnText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },

  tabs: {
    flexDirection: 'row',
    paddingHorizontal: GRID_PADDING,
    gap: 8,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  tabText: { fontSize: 13, fontWeight: '700', color: Colors.text2 },
  tabTextActive: { color: '#FFFFFF', fontWeight: '800' },

  gridSection: { paddingHorizontal: GRID_PADDING },
  gridSectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.text2, letterSpacing: 1, marginBottom: 8 },
  gridEmpty: { fontSize: 13, color: Colors.text2, fontStyle: 'italic', textAlign: 'center', paddingVertical: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cellImg: { width: '100%', height: '100%' },
  cellPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface2 },
  cellOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
