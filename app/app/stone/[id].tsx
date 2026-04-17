import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Dimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CaretDown,
  MapPin,
  CheckCircle,
  Footprints,
  Eye,
} from 'phosphor-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../constants/Colors';
import {
  getNearbyStones,
  getCurrentLocation,
  haversineDistance,
  type NearbyStone,
} from '../../lib/location';
import {
  getActivityFeed,
  formatActivityTime,
  type Activity,
} from '../../lib/activity';
import { STONE_PHOTOS } from '../../lib/stone-photos';
import { earnPoints, getPoints, spendPoints, REWARD_FIND, ALL_ITEMS } from '../../lib/points';
import { hasFoundStone, markStoneFound, getFindsToday } from '../../lib/finds';
import { requireAuth } from '../../lib/auth-gate';
import { getCurrentUser } from '../../lib/auth';
import { deleteUserStone, editUserStone } from '../../lib/user-stones';
import { activateTrial, DAILY_CHALLENGE_GOAL } from '../../lib/premium-trial';
import { DEMO_SEED_USER_MAP } from '../../lib/activity';
import * as ImagePicker from 'expo-image-picker';
import { PencilSimple, Trash } from 'phosphor-react-native';
import { useModal } from '../../lib/modal';
import { useI18n } from '../../lib/i18n';
import { StoneMascot } from '../../components/StoneMascot';
import { gatherAchievementStats, checkAchievements, ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { updateChallengeProgress } from '../../lib/daily-challenge';
import { isStoneRevealed, revealStone } from '../../lib/reveals';
import { getTrialInfo } from '../../lib/premium-trial';

const { width } = Dimensions.get('window');
const HERO_HEIGHT = width * 0.95;

export default function StoneDetailScreen() {
  const params = useLocalSearchParams();
  const stoneId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [stone, setStone] = useState<NearbyStone | null>(null);
  const [history, setHistory] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [alreadyFound, setAlreadyFound] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [isOwnStone, setIsOwnStone] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load location-aware stone list (real distance via haversine)
      const loc = await getCurrentLocation();
      const fallback = { lat: 60.1699, lng: 24.9384 };
      const stones = await getNearbyStones(loc?.coords ?? fallback);
      if (cancelled) return;

      const found = stones.find((s) => s.id === stoneId) ?? null;
      setStone(found);

      // Load all activities for this stone, newest first
      const allActivities = await getActivityFeed();
      const stoneHistory = allActivities.filter((a) => a.stoneId === stoneId);
      setHistory(stoneHistory);

      // Check if user already claimed this stone
      if (stoneId) {
        const claimed = await hasFoundStone(stoneId);
        setAlreadyFound(claimed);
        // Already found or already revealed → show details
        if (claimed) {
          setRevealed(true);
        } else {
          const wasRevealed = await isStoneRevealed(stoneId);
          if (wasRevealed) setRevealed(true);
        }
      }

      // Own stones are always revealed
      const user = await getCurrentUser();
      if (user && stoneHistory.length > 0) {
        const seedId = DEMO_SEED_USER_MAP[user.email] ?? user.id;
        const hideEvent = [...stoneHistory].reverse().find((a) => a.type === 'hide');
        if (hideEvent && (hideEvent.userId === seedId || hideEvent.userId === user.id)) {
          setIsOwnStone(true);
          setRevealed(true);
        }
      }

      // Premium users see all details
      const trial = await getTrialInfo();
      if (trial.active) setRevealed(true);

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [stoneId]);


  const modal = useModal();
  const { t } = useI18n();

  const REVEAL_COST = 5;

  const handleReveal = async () => {
    if (!stoneId) return;
    setRevealLoading(true);
    try {
      const success = await spendPoints(REVEAL_COST);
      if (!success) {
        modal.show({
          title: t('stone.reveal_title'),
          message: t('stone.reveal_not_enough'),
          buttons: [{ label: t('common.understood'), style: 'cancel' }],
        });
        return;
      }
      await revealStone(stoneId);
      setRevealed(true);
    } catch {
      modal.show({
        title: t('common.error'),
        message: t('stone.reveal_error'),
        buttons: [{ label: t('common.understood'), style: 'cancel' }],
      });
    } finally {
      setRevealLoading(false);
    }
  };

  const handleEditName = () => {
    modal.show({
      title: t('stone.edit_name_title'),
      input: { placeholder: t('stone.new_name'), defaultValue: stone?.name },
      buttons: [
        { label: t('common.cancel'), style: 'cancel' },
        {
          label: t('common.save'),
          onPress: async (newName) => {
            if (!newName?.trim() || !stoneId) return;
            await editUserStone(stoneId, { name: newName.trim() });
            router.dismiss();
            router.replace('/(tabs)/map');
          },
        },
      ],
    });
  };

  const handleEditPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0] && stoneId) {
      await editUserStone(stoneId, { photoUri: result.assets[0].uri });
      router.dismiss();
      router.replace('/(tabs)/map');
    }
  };

  const handleDeleteStone = () => {
    Alert.alert(
      t('stone.delete_title'),
      `"${stone?.name}" будет удалён с карты и из профиля.`,
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!stoneId) return;
            await deleteUserStone(stoneId);
            router.dismiss();
            router.replace('/(tabs)/map');
          },
        },
      ],
    );
  };

  const handleFound = async () => {
    if (!stoneId || alreadyFound || claiming) return;
    if (isOwnStone) {
      Alert.alert(t('stone.own_stone'), t('stone.cant_find_own'));
      return;
    }

    // Anti-fraud: stone must be at least 1 hour old
    if (stone?.createdAt) {
      const ageMs = Date.now() - new Date(stone.createdAt).getTime();
      if (ageMs < 60 * 60 * 1000) {
        const minLeft = Math.ceil((60 * 60 * 1000 - ageMs) / 60000);
        Alert.alert(t('stone.cooldown_title'), t('stone.cooldown_text').replace('{min}', String(minLeft)));
        return;
      }
    }

    if (!(await requireAuth('отметить находку'))) return;

    // ── GPS verification: must be within 100m of the stone ──
    const userLocation = await getCurrentLocation();
    if (!userLocation) {
      Alert.alert(t('common.no_gps'), t('add.no_gps'));
      return;
    }

    if (stone?.coords) {
      const distanceM = haversineDistance(userLocation.coords, stone.coords);
      if (distanceM > 100) {
        const distStr = distanceM > 1000
          ? `${(distanceM / 1000).toFixed(1)}км`
          : `${Math.round(distanceM)}м`;
        const userCity = userLocation.city ?? '';
        const stoneCity = stone.city ?? '';
        const cityHint = userCity && stoneCity && userCity !== stoneCity
          ? `\n\n${t('stone.too_far_city').replace('{userCity}', userCity).replace('{stoneCity}', stoneCity)}`
          : '';
        Alert.alert(
          t('stone.too_far_title'),
          `${t('stone.too_far_text')} ${distStr}${cityHint}`,
        );
        return;
      }
    }

    // ── Photo required as proof ──
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });

    if (result.canceled || !result.assets?.[0]) {
      Alert.alert(t('stone.photo_required_title'), t('stone.photo_required_text'));
      return;
    }

    setClaiming(true);
    try {
      await markStoneFound(stoneId);
      // Awarding the finder (+REWARD_FIND) is client-side.
      // Awarding the author (+REWARD_AUTHOR_ON_FIND) is server-side via
      // trigger on the `finds` table — RLS blocks cross-user updates.
      const newBalance = await earnPoints(REWARD_FIND);
      setAlreadyFound(true);

      // Check daily challenge: 5 finds → 24h premium trial
      const todayFinds = await getFindsToday();
      let trialActivated = false;
      if (todayFinds >= DAILY_CHALLENGE_GOAL) {
        await activateTrial();
        trialActivated = true;
      }

      // Track challenge + achievements
      await updateChallengeProgress('find');
      const achStats = await gatherAchievementStats();
      const unlocked = await checkAchievements(achStats);

      const baseMessage = `+1 💎 · ${newBalance} 💎`;
      const trialMessage = trialActivated
        ? `\n\n${t('trial.activated_message')}`
        : '';
      const unlockedCosmetics = unlocked
        .map((id) => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.unlockCosmeticId)
        .filter((id): id is string => !!id)
        .map((id) => ALL_ITEMS.find((it) => it.id === id)?.label)
        .filter((label): label is string => !!label);
      const cosmeticSuffix = unlockedCosmetics.length > 0
        ? ` + ${unlockedCosmetics.join(', ')}`
        : '';
      const achMessage = unlocked.length > 0
        ? `\n\n🏆 ${t('achievement.unlocked')}${cosmeticSuffix}`
        : '';

      Alert.alert(
        trialActivated ? t('trial.activated_title') : `🎉 ${t('stone.congrats')}`,
        `${baseMessage}${trialMessage}${achMessage}`,
        [{
          text: t('common.nice'),
          onPress: () => {
            router.dismiss();
            router.replace('/(tabs)/map');
          },
        }],
      );
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? '');
    } finally {
      setClaiming(false);
    }
  };

  // Pick the best photo: prefer real URI, then bundled photo key
  const actWithPhoto = history.find((a) => a.photoUri || a.photo);
  const heroPhotoUri = actWithPhoto?.photoUri;
  const heroPhoto = actWithPhoto?.photo;
  // Original creator: oldest hide event
  const creator = [...history].reverse().find((a) => a.type === 'hide');
  const findCount = history.filter((a) => a.type === 'find').length;

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  if (!stone) {
    return (
      <SafeAreaView style={[styles.container, { padding: 20 }]} edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backLink}>
          <CaretDown size={22} color={Colors.text} weight="bold" />
          <Text style={styles.backLinkText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <View style={styles.notFound}>
          <Text style={styles.notFoundEmoji}>🤔</Text>
          <Text style={styles.notFoundTitle}>{t('stone.not_found')}</Text>
          <Text style={styles.notFoundText}>
            {t('stone.not_found_text')}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Hero — large photo or gradient blob */}
        <View style={styles.heroArea}>
          {revealed && heroPhotoUri ? (
            <Image source={{ uri: heroPhotoUri }} style={styles.heroImage} />
          ) : revealed && heroPhoto ? (
            <Image source={STONE_PHOTOS[heroPhoto]} style={styles.heroImage} />
          ) : (
            <LinearGradient
              colors={stone.colors as unknown as [string, string]}
              start={{ x: 0.2, y: 0.05 }}
              end={{ x: 0.85, y: 0.95 }}
              style={[styles.heroImage, styles.heroFallback]}
            >
              {revealed ? (
                <Text style={styles.heroFallbackEmoji}>{stone.emoji}</Text>
              ) : (
                <Text style={styles.heroFallbackEmoji}>🔒</Text>
              )}
            </LinearGradient>
          )}

          <SafeAreaView style={styles.heroButtons} edges={['top']}>
            <TouchableOpacity
              style={styles.heroBtn}
              onPress={() => router.back()}
              activeOpacity={0.8}
            >
              <CaretDown size={22} color={Colors.text} weight="bold" />
            </TouchableOpacity>
          </SafeAreaView>
        </View>

        {!revealed ? (
          <View style={styles.body}>
            <View style={{ alignItems: 'center', paddingVertical: 32 }}>
              <Text style={{ fontSize: 48, marginBottom: 16 }}>🔒</Text>
              <Text style={{ fontSize: 20, fontWeight: '800', color: Colors.text, marginBottom: 8, textAlign: 'center' }}>
                {t('stone.reveal_title')}
              </Text>
              <Text style={{ fontSize: 14, color: Colors.text2, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 20 }}>
                {t('stone.reveal_desc')}
              </Text>
              <TouchableOpacity
                style={{
                  backgroundColor: Colors.accent,
                  borderRadius: 16,
                  paddingVertical: 16,
                  paddingHorizontal: 32,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  opacity: revealLoading ? 0.6 : 1,
                }}
                onPress={handleReveal}
                disabled={revealLoading}
                activeOpacity={0.85}
              >
                <Text style={{ fontSize: 16, fontWeight: '800', color: '#FFFFFF' }}>
                  {t('stone.reveal_cta')} · {REVEAL_COST} 💎
                </Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: Colors.text2, marginTop: 12 }}>
                {t('stone.reveal_or_premium')}
              </Text>
            </View>
          </View>
        ) : (
        <View style={styles.body}>
          {/* Title + meta */}
          <View style={styles.titleRow}>
            <Text style={styles.stoneEmoji}>{stone.emoji}</Text>
            <Text style={styles.stoneName}>{stone.name}</Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MapPin size={13} color={Colors.accent} weight="fill" />
              <Text style={styles.metaText}>{stone.distance} от тебя</Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaItem}>
              <Eye size={13} color={Colors.text2} weight="regular" />
              <Text style={styles.metaText}>
                {findCount} {pluralize(findCount, 'находка', 'находки', 'находок')}
              </Text>
            </View>
          </View>

          {/* Artist / creator card */}
          {creator && (
            <View style={styles.creatorCard}>
              <View style={styles.creatorAvatar}>
                <Text style={{ fontSize: 22 }}>{creator.userAvatar}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.creatorLabel}>{t('stone.creator')}</Text>
                <View style={styles.creatorNameRow}>
                  <Text style={styles.creatorName}>{creator.userName}</Text>
                  {creator.isArtist && (
                    <CheckCircle size={13} color={Colors.accent} weight="fill" />
                  )}
                </View>
              </View>
              <Text style={styles.creatorDate}>
                {formatActivityTime(creator.createdAt)}
              </Text>
            </View>
          )}

          {/* Approximate location notice */}
          {!alreadyFound && !isOwnStone && (
            <View style={styles.approxNotice}>
              <Text style={styles.approxNoticeIcon}>🔍</Text>
              <Text style={styles.approxNoticeText}>
                {t('stone.approx_location')}
              </Text>
            </View>
          )}

          {/* Journey timeline */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Footprints size={14} color={Colors.accent} weight="fill" />
              <Text style={styles.sectionTitle}>{t('stone.journey')}</Text>
            </View>

            {history.length === 0 ? (
              <View style={styles.emptyJourney}>
                <Text style={styles.emptyJourneyText}>
                  {t('stone.no_finds')}
                </Text>
                <Text style={styles.emptyJourneySub}>
                  {t('stone.be_first')}
                </Text>
              </View>
            ) : (
              <View style={styles.journeyList}>
                {history.map((step, i) => {
                  const isFind = step.type === 'find';
                  return (
                    <View key={step.id} style={styles.journeyStep}>
                      <View
                        style={[
                          styles.journeyDot,
                          isFind ? styles.journeyDotFind : styles.journeyDotHide,
                        ]}
                      >
                        <Text style={styles.journeyDotIcon}>
                          {isFind ? '👀' : '🪨'}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.journeyAction}>
                          <Text style={styles.journeyName}>{step.userName}</Text>
                          {isFind ? t('stone.found_action') : t('stone.hid_action')}
                        </Text>
                        <Text style={styles.journeyMeta}>
                          {step.city} · {formatActivityTime(step.createdAt)}
                        </Text>
                      </View>
                      {i < history.length - 1 && (
                        <View style={styles.journeyLine} />
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Reward hint */}
          {!alreadyFound && (
            <View style={styles.rewardHint}>
              <Text style={styles.rewardHintEmoji}>💎</Text>
              <Text style={styles.rewardHintText}>
                {t('stone.reward_hint')}
              </Text>
            </View>
          )}
        </View>
        )}
      </ScrollView>

      {/* Sticky bottom CTA */}
      <SafeAreaView style={styles.ctaWrap} edges={['bottom']}>
        {isOwnStone ? (
          <View style={styles.ownActions}>
            <TouchableOpacity
              style={styles.ownActionBtn}
              onPress={handleEditName}
              activeOpacity={0.85}
            >
              <PencilSimple size={18} color={Colors.accent} weight="bold" />
              <Text style={styles.ownActionText}>{t('stone.edit_name')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ownActionBtn}
              onPress={handleEditPhoto}
              activeOpacity={0.85}
            >
              <PencilSimple size={18} color={Colors.accent} weight="bold" />
              <Text style={styles.ownActionText}>{t('stone.edit_photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ownActionBtn, { borderColor: '#FCA5A5' }]}
              onPress={handleDeleteStone}
              activeOpacity={0.85}
            >
              <Trash size={18} color="#DC2626" weight="bold" />
              <Text style={[styles.ownActionText, { color: '#DC2626' }]}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
        ) : alreadyFound ? (
          <View style={[styles.findBtn, styles.findBtnDone]}>
            <CheckCircle size={20} color={Colors.green} weight="fill" />
            <Text style={[styles.findBtnText, { color: Colors.green }]}>
              {t('stone.already_found')}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.findBtn}
            activeOpacity={0.85}
            onPress={handleFound}
            disabled={claiming}
          >
            {claiming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.findBtnText}>{t('stone.found_button')}</Text>
            )}
          </TouchableOpacity>
        )}
      </SafeAreaView>
    </View>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Hero
  heroArea: {
    height: HERO_HEIGHT,
    backgroundColor: Colors.accentLight,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFallbackEmoji: { fontSize: 130 },
  heroButtons: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  heroBtn: {
    width: 44,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 5,
  },

  body: { padding: 20 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  stoneEmoji: { fontSize: 28 },
  stoneName: {
    flex: 1,
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -0.3,
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 18,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: { fontSize: 13, color: Colors.text2, fontWeight: '600' },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.text2,
  },

  // Creator card
  creatorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  creatorAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
    marginBottom: 2,
  },
  creatorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  creatorName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  creatorDate: { fontSize: 11, color: Colors.text2, fontWeight: '600' },

  // Section
  section: { marginBottom: 20 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
  },

  // Journey
  journeyList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
  },
  journeyStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 18,
    position: 'relative',
  },
  journeyDot: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  journeyDotFind: { backgroundColor: Colors.greenLight },
  journeyDotHide: { backgroundColor: Colors.accentLight },
  journeyDotIcon: { fontSize: 18 },
  journeyLine: {
    position: 'absolute',
    left: 18,
    top: 42,
    width: 2,
    height: 22,
    backgroundColor: Colors.border,
  },
  journeyAction: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  journeyName: { fontWeight: '700' },
  journeyMeta: { fontSize: 12, color: Colors.text2, marginTop: 3 },

  emptyJourney: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 20,
    alignItems: 'center',
  },
  emptyJourneyText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyJourneySub: {
    fontSize: 12,
    color: Colors.text2,
    textAlign: 'center',
  },

  // Reward hint
  rewardHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  rewardHintEmoji: { fontSize: 24 },
  rewardHintText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },
  rewardHintBold: { fontWeight: '800', color: Colors.accent },

  approxNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  approxNoticeIcon: { fontSize: 22 },
  approxNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
    fontWeight: '600',
  },

  // CTA
  ctaWrap: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: 'rgba(250,250,248,0.96)',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  findBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 18,
    paddingVertical: 18,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  findBtnDone: {
    backgroundColor: Colors.greenLight,
    shadowOpacity: 0,
  },
  findBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // Own stone actions (edit/delete)
  ownActions: {
    flexDirection: 'row',
    gap: 10,
  },
  ownActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  ownActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },

  // Not found state
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  backLinkText: { fontSize: 15, color: Colors.text, fontWeight: '700' },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },
  notFoundEmoji: { fontSize: 64 },
  notFoundTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 16,
  },
  notFoundText: {
    fontSize: 14,
    color: Colors.text2,
    marginTop: 6,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
