import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MapPin,
  Sparkle,
  CheckCircle,
  CaretRight,
  Trophy,
} from 'phosphor-react-native';
import { router, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { StoneMascot } from '../../components/StoneMascot';
import { SkeletonRow } from '../../components/Skeleton';
import { getCurrentLocation } from '../../lib/location';
import {
  getActivityFeed,
  getDayStats,
  getRecentlyHidden,
  getLeaderboard,
  formatActivityTime,
  type Activity,
  type DayStats,
  type LeaderEntry,
  type LeaderboardKind,
  type LeaderboardPeriod,
} from '../../lib/activity';
import { STONE_PHOTOS } from '../../lib/stone-photos';
import { getStoneShape } from '../../lib/location';
import { requireAuth } from '../../lib/auth-gate';
import { getUserStoneStyle, getMyStyle, type UserStoneStyle } from '../../lib/user-stone-styles';
import { useI18n } from '../../lib/i18n';
import { getCurrentUser, type User } from '../../lib/auth';
import { SafeImage } from '../../components/SafeImage';

// Removed gold/silver/bronze — all ranks use the same neutral style

export default function FeedScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<DayStats | null>(null);
  const [recent, setRecent] = useState<Activity[]>([]);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderEntry[]>([]);
  const [leaderKind, setLeaderKind] = useState<LeaderboardKind>('hide');
  const [leaderPeriod, setLeaderPeriod] = useState<LeaderboardPeriod>('today');
  const [city, setCity] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [myStyle, setMyStyle] = useState<UserStoneStyle | null>(null);
  const { t } = useI18n();

  // Initial load on focus — refresh timestamps when user returns to tab.
  // 2-волновая загрузка: critical path (stats+recent+feed) сначала, чтобы
  // экран показал контент как можно быстрее. Вторичные данные (location,
  // user, style) грузятся в фоне и не блокируют первый пиксель.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        const [statsRes, recentRes, feedRes] = await Promise.all([
          getDayStats(),
          getRecentlyHidden(8),
          getActivityFeed(10),
        ]);
        if (!active) return;
        setStats(statsRes);
        setRecent(recentRes);
        setFeed(feedRes);
        setLoading(false);

        // Вторая волна — не блокирует UI
        Promise.all([
          getCurrentLocation(),
          getCurrentUser(),
          getMyStyle(),
        ]).then(([locRes, usr, style]) => {
          if (!active) return;
          setCity(locRes?.city ?? locRes?.region ?? null);
          setCurrentUser(usr);
          setMyStyle(style);
        }).catch((e) => console.warn('feed: secondary load failed', e));
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const [statsRes, recentRes, feedRes] = await Promise.all([
      getDayStats(),
      getRecentlyHidden(8),
      getActivityFeed(10),
    ]);
    setStats(statsRes);
    setRecent(recentRes);
    setFeed(feedRes);
    setRefreshing(false);
  }, []);

  // Resolve stone style: use customized style for current user, seed lookup for others
  const resolveStyle = (userId: string): UserStoneStyle => {
    if (myStyle && currentUser && userId === currentUser.id) return myStyle;
    return getUserStoneStyle(userId);
  };

  // Reload leaderboard when kind or period changes
  useEffect(() => {
    let active = true;
    getLeaderboard(leaderKind, leaderPeriod).then((res) => {
      if (active) setLeaderboard(res);
    });
    return () => {
      active = false;
    };
  }, [leaderKind, leaderPeriod]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('feed.title')}</Text>
          <View style={styles.cityChip}>
            <MapPin size={12} color={Colors.accent} weight="fill" />
            <Text style={styles.cityChipText}>{city ?? 'Финляндия'}</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loaderWrap}>
            <SkeletonRow count={5} />
          </View>
        ) : (
          <>
            {/* Hero stat card */}
            <LinearGradient
              colors={['#EEF2FF', '#F5F0FF', '#FFE4F0']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.hero}
            >
              <View style={styles.heroMascot}>
                <StoneMascot size={68} color="#C4B5FD" showSparkles={false} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.heroTitle}>{t('feed.today')}</Text>
                <View style={styles.heroStatsRow}>
                  <View style={styles.heroStat}>
                    <Text style={[styles.heroStatNum, { color: Colors.accent }]}>
                      {stats?.hiddenToday ?? 0}
                    </Text>
                    <Text style={styles.heroStatLabel}>{t('feed.hidden')}</Text>
                  </View>
                  <View style={styles.heroStat}>
                    <Text style={[styles.heroStatNum, { color: Colors.green }]}>
                      {stats?.foundToday ?? 0}
                    </Text>
                    <Text style={styles.heroStatLabel}>{t('feed.found')}</Text>
                  </View>
                </View>
                <View style={styles.heroFooter}>
                  <Sparkle size={11} color={Colors.accent2} weight="fill" />
                  <Text style={styles.heroFooterText}>
                    {`+${stats?.hiddenWeek ?? 0} ${t('feed.hidden')} · +${stats?.foundWeek ?? 0} ${t('feed.found')} ${t('feed.week').toLowerCase()}`}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            {/* Свежие камни — horizontal scroll */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('feed.fresh')}</Text>
              </View>
              {recent.length === 0 ? (
                <View style={styles.emptyCard}>
                  <StoneMascot size={56} variant="sleeping" showSparkles={false} />
                  <Text style={styles.emptyText}>{t('feed.no_recent_title')}</Text>
                  <Text style={styles.emptyTextSub}>{t('feed.no_recent_sub')}</Text>
                </View>
              ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.recentRow}
              >
                {recent.map((stone) => {
                  const shape = getStoneShape(stone.stoneId, 1.4);
                  return (
                    <TouchableOpacity
                      key={stone.id}
                      style={styles.recentCard}
                      activeOpacity={0.85}
                      onPress={async () => {
                        if (!(await requireAuth('открывать камни'))) return;
                        router.push(`/stone/${stone.stoneId}`);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${stone.stoneName ?? 'stone'} — ${stone.city ?? ''}`}
                    >
                      <View style={styles.recentVisual}>
                        {/* Свежие камни = засекреченные → реальное фото
                            размыто (BlurView) + замочек поверх. Игрок видит
                            что фото есть, но рисунок не разглядеть пока не
                            раскроет (5💎 на детальной карточке) или не найдёт. */}
                        {stone.photoUri || stone.photo ? (
                          <View style={styles.recentLockedWrap}>
                            <Image
                              source={
                                stone.photoUri
                                  ? { uri: stone.photoUri }
                                  : STONE_PHOTOS[stone.photo!]
                              }
                              style={styles.recentPhoto}
                              blurRadius={8}
                            />
                            <View style={styles.recentLockOverlay}>
                              <Text style={styles.recentLockEmoji}>🔒</Text>
                            </View>
                          </View>
                        ) : (
                          <LinearGradient
                            colors={stone.stoneColors as unknown as [string, string]}
                            start={{ x: 0.2, y: 0.05 }}
                            end={{ x: 0.85, y: 0.95 }}
                            style={[
                              styles.recentStone,
                              {
                                width: shape.width,
                                height: shape.height,
                                borderTopLeftRadius: shape.borderTopLeftRadius,
                                borderTopRightRadius: shape.borderTopRightRadius,
                                borderBottomLeftRadius: shape.borderBottomLeftRadius,
                                borderBottomRightRadius: shape.borderBottomRightRadius,
                                transform: [{ rotate: `${shape.rotation}deg` }],
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.recentEmoji,
                                { transform: [{ rotate: `${-shape.rotation}deg` }] },
                              ]}
                            >
                              {stone.stoneEmoji}
                            </Text>
                          </LinearGradient>
                        )}
                      </View>
                      <Text style={styles.recentName} numberOfLines={1}>
                        {stone.stoneName}
                      </Text>
                      <View style={styles.recentAuthorRow}>
                        {stone.userPhotoUrl ? (
                          <SafeImage
                            source={{ uri: stone.userPhotoUrl }}
                            style={{ width: 22, height: 22, borderRadius: 11 }}
                            fallbackIconSize={10}
                          />
                        ) : (
                          <Text style={{ fontSize: 18 }}>{stone.userAvatar}</Text>
                        )}
                        <Text style={styles.recentAuthor} numberOfLines={1}>
                          {stone.userName}
                        </Text>
                      </View>
                      <Text style={styles.recentMeta} numberOfLines={1}>
                        {stone.city} · {formatActivityTime(stone.createdAt)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              )}
            </View>

            {/* Лучшие — leaderboard */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Trophy size={14} color={Colors.accent} weight="fill" />
                <Text style={styles.sectionTitle}>{t('feed.best')}</Text>
              </View>

              {/* Kind switch */}
              <View style={styles.tabRow}>
                {(['hide', 'find'] as const).map((k) => {
                  const active = k === leaderKind;
                  return (
                    <TouchableOpacity
                      key={k}
                      onPress={() => setLeaderKind(k)}
                      style={[styles.kindTab, active && styles.kindTabActive]}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={k === 'hide' ? t('feed.hiders') : t('feed.finders')}
                    >
                      <Text
                        style={[
                          styles.kindTabText,
                          active && styles.kindTabTextActive,
                        ]}
                      >
                        {k === 'hide' ? t('feed.hiders') : t('feed.finders')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Period switch */}
              <View style={styles.periodRow}>
                {(['today', 'week', 'all'] as const).map((p) => {
                  const active = p === leaderPeriod;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setLeaderPeriod(p)}
                      style={[styles.periodChip, active && styles.periodChipActive]}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={p === 'today' ? t('feed.today_period') : p === 'week' ? t('feed.week') : t('feed.alltime')}
                    >
                      <Text
                        style={[
                          styles.periodChipText,
                          active && styles.periodChipTextActive,
                        ]}
                      >
                        {p === 'today' ? t('feed.today_period') : p === 'week' ? t('feed.week') : t('feed.alltime')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Leaderboard list */}
              {leaderboard.length === 0 ? (
                <View style={styles.emptyCard}>
                  <StoneMascot size={56} variant="sleeping" showSparkles={false} />
                  <Text style={styles.emptyText}>{t('feed.nobody_yet')}</Text>
                </View>
              ) : (
                <View style={styles.leaderCard}>
                  {leaderboard.map((entry, i) => {
                    return (
                      <View
                        key={entry.userId}
                        style={[
                          styles.leaderRow,
                          i < leaderboard.length - 1 && styles.leaderRowBorder,
                        ]}
                      >
                        <View style={styles.rankBadge}>
                          <Text style={styles.rankBadgeText}>
                            {entry.rank}
                          </Text>
                        </View>
                        <View style={styles.leaderAvatar}>
                          {entry.userPhotoUrl ? (
                            <SafeImage source={{ uri: entry.userPhotoUrl }} style={styles.leaderPhoto} fallbackIconSize={16} />
                          ) : (
                            <Text style={{ fontSize: 26 }}>{entry.userAvatar || '🪨'}</Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <View style={styles.leaderNameRow}>
                            <Text style={styles.leaderName}>{entry.userName}</Text>
                            {entry.isArtist && (
                              <CheckCircle
                                size={12}
                                color={Colors.accent}
                                weight="fill"
                              />
                            )}
                          </View>
                          <Text style={styles.leaderSub}>
                            {entry.count}{' '}
                            {pluralize(entry.count, 'камень', 'камня', 'камней')}
                          </Text>
                        </View>
                        <Text style={styles.leaderCount}>
                          {entry.count}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Активность — live timeline */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t('feed.activity')}</Text>
              </View>
              {feed.length === 0 ? (
                <View style={styles.emptyCard}>
                  <StoneMascot size={56} variant="happy" showSparkles={false} />
                  <Text style={styles.emptyText}>{t('feed.no_activity_title')}</Text>
                  <Text style={styles.emptyTextSub}>{t('feed.no_activity_sub')}</Text>
                </View>
              ) : (
              <View style={styles.timelineCard}>
                {feed.map((item, i) => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.timelineRow,
                      i < feed.length - 1 && styles.timelineRowBorder,
                    ]}
                    activeOpacity={0.7}
                    onPress={async () => {
                      if (!(await requireAuth('открывать камни'))) return;
                      router.push(`/stone/${item.stoneId}`);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.userName} ${item.type === 'find' ? 'нашёл' : 'спрятал'} ${item.stoneName}`}
                  >
                    <View style={styles.timelineAvatar}>
                      {item.userPhotoUrl ? (
                        <SafeImage
                          source={{ uri: item.userPhotoUrl }}
                          style={styles.timelineUserPhoto}
                          fallbackIconSize={16}
                        />
                      ) : (
                        <View style={styles.timelineUserEmoji}>
                          <Text style={{ fontSize: 22 }}>{item.userAvatar}</Text>
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.timelineText} numberOfLines={2}>
                        <Text style={styles.timelineName}>{item.userName}</Text>
                        {item.type === 'find' ? ' нашёл ' : ' спрятал '}
                        <Text>{item.stoneEmoji} </Text>
                        <Text style={styles.timelineStone}>{item.stoneName}</Text>
                      </Text>
                      <Text style={styles.timelineMeta}>
                        {item.city} · {formatActivityTime(item.createdAt)}
                      </Text>
                    </View>
                    {/* Превью фото камня показываем ТОЛЬКО для find-events.
                        Hide-events — секретный камень, фото скрыто (как на
                        карте — нужно либо пройти reveal за 💎, либо найти). */}
                    {item.type === 'find' && (item.photoUri || item.photo) && (
                      <Image
                        source={
                          item.photoUri
                            ? { uri: item.photoUri }
                            : STONE_PHOTOS[item.photo!]
                        }
                        style={styles.timelineThumb}
                      />
                    )}
                    <CaretRight size={14} color={Colors.text2} weight="bold" />
                  </TouchableOpacity>
                ))}
              </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function pluralize(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scrollContent: { paddingBottom: 120 },
  loaderWrap: { padding: 60, alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
  },
  cityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cityChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },

  // Hero
  hero: {
    marginHorizontal: 20,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingLeft: 8,
    paddingRight: 18,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroMascot: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'flex-end',
  },
  heroStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 5,
  },
  heroStatNum: {
    fontSize: 24,
    fontWeight: '800',
  },
  heroStatLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.text2,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  heroFooterText: {
    fontSize: 11,
    color: Colors.text2,
    flex: 1,
  },

  // Section
  section: {
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
  },

  // Recently hidden — horizontal scroll
  recentRow: {
    paddingHorizontal: 20,
    gap: 12,
  },
  recentCard: {
    width: 130,
    padding: 12,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  recentVisual: {
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  recentStone: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 4,
  },
  recentPhoto: {
    width: 100,
    height: 78,
    borderRadius: 14,
    backgroundColor: Colors.accentLight,
  },
  recentLockedWrap: {
    width: 100,
    height: 78,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  recentLockOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  recentLockEmoji: {
    fontSize: 22,
  },
  recentEmoji: { fontSize: 28 },
  recentName: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 3,
  },
  recentAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  recentAuthor: {
    fontSize: 11,
    color: Colors.text2,
  },
  recentMeta: {
    fontSize: 10,
    color: Colors.text2,
    textAlign: 'center',
    marginTop: 2,
  },

  // Leaderboard
  tabRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  kindTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  kindTabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  kindTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text2,
  },
  kindTabTextActive: {
    color: '#FFFFFF',
  },
  periodRow: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  periodChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: Colors.accentLight,
  },
  periodChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.text2,
  },
  periodChipTextActive: {
    color: Colors.accent,
    fontWeight: '700',
  },
  leaderCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  leaderRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rankBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text2,
  },
  leaderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 13,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  leaderPhoto: {
    width: 36,
    height: 36,
    borderRadius: 13,
  },
  leaderNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  leaderName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  leaderSub: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 1,
  },
  leaderCount: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text2,
  },

  // Empty state
  emptyCard: {
    marginHorizontal: 20,
    paddingVertical: 24,
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  emptyText: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyTextSub: {
    fontSize: 12,
    color: Colors.text2,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 16,
  },

  // Timeline
  timelineCard: {
    marginHorizontal: 20,
    backgroundColor: Colors.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  timelineRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  timelineAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  timelineUserPhoto: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  timelineUserEmoji: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accentLight,
  },
  timelineText: {
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  timelineName: {
    fontWeight: '700',
  },
  timelineStone: {
    fontWeight: '700',
    color: Colors.accent,
  },
  timelineMeta: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 3,
  },
  timelineThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
  },
});
