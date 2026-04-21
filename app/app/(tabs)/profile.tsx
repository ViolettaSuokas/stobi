import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CheckCircle,
  CaretRight,
  SignOut,
  Plus,
  Camera,
  Lock,
  GearSix,
  Sparkle,
  Medal,
  Compass,
  Trophy,
  PaintBrush,
  Star,
  PencilSimple,
  ChartBar,
  Palette,
  SmileyWink,
  Shapes,
  type IconProps,
} from 'phosphor-react-native';
import type { ComponentType } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/Colors';
import {
  getCurrentUser,
  logout,
  type User,
} from '../../lib/auth';
import {
  COLOR_ITEMS,
  EYE_ITEMS,
  SHAPE_ITEMS,
  DECOR_ITEMS,
  ALL_ITEMS,
  buyItem,
  getState,
  getEquippedIds,
  setEquippedIds,
  type CosmeticItem,
} from '../../lib/points';
import type {
  MascotVariant,
  MascotShape,
  MascotDecor,
} from '../../components/StoneMascot';
import {
  getUserActivities,
  formatActivityTime,
  DEMO_SEED_USER_MAP,
  type Activity,
  type ActivityType,
} from '../../lib/activity';
import { STONE_PHOTOS } from '../../lib/stone-photos';
import { getStoneShape } from '../../lib/location';
import { requireAuth } from '../../lib/auth-gate';
import { useI18n } from '../../lib/i18n';
import { useModal } from '../../lib/modal';
import { StoneMascot } from '../../components/StoneMascot';
import { MascotScene } from '../../components/MascotScene';
import { SafeImage } from '../../components/SafeImage';
import { WelcomeQuest } from '../../components/WelcomeQuest';
import { StreakBadge } from '../../components/StreakBadge';
import { ReferralCard } from '../../components/ReferralCard';
import { LinearGradient } from 'expo-linear-gradient';
import { getTrialInfo, formatRemaining } from '../../lib/premium-trial';
import * as ImagePicker from 'expo-image-picker';
import * as haptics from '../../lib/haptics';
import { processPhoto } from '../../lib/photo';
import { updateProfilePhoto, updateCharacterName } from '../../lib/auth';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

const ACHIEVEMENT_CONFIGS = [
  { Icon: Sparkle, labelKey: 'achievement.find_first', earned: false, tint: '#A855F7', premium: false },
  { Icon: Medal, labelKey: 'achievement.find_10', earned: false, tint: '#FACC15', premium: false },
  { Icon: Compass, labelKey: 'achievement.explorer_3', earned: false, tint: '#16A34A', premium: true },
  { Icon: Trophy, labelKey: 'achievement.find_50', earned: false, tint: '#EA580C', premium: false },
  { Icon: PaintBrush, labelKey: 'achievement.hide_5', earned: false, tint: '#DB2777', premium: false },
  { Icon: Star, labelKey: 'achievement.find_100', earned: false, tint: '#7C3AED', premium: true },
];

type MainTab = 'overview' | 'customize';
type CustomTab = 'color' | 'face' | 'shape' | 'decor';

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [mainTab, setMainTab] = useState<MainTab>('overview');
  const [customTab, setCustomTab] = useState<CustomTab>('color');
  const [selectedColorId, setSelectedColorId] = useState<string>(COLOR_ITEMS[0].id);
  const [selectedEyeId, setSelectedEyeId] = useState<string>(EYE_ITEMS[0].id);
  const [selectedShapeId, setSelectedShapeId] = useState<string>(SHAPE_ITEMS[0].id);
  const [selectedDecorId, setSelectedDecorId] = useState<string>(DECOR_ITEMS[0].id);
  const [balance, setBalance] = useState<number>(0);
  const [ownedIds, setOwnedIds] = useState<string[]>([]);
  const [myStonesTab, setMyStonesTab] = useState<ActivityType>('hide');
  const [myActivities, setMyActivities] = useState<Activity[]>([]);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [foundCount, setFoundCount] = useState(0);
  const [trialActive, setTrialActive] = useState(false);
  const [trialRemaining, setTrialRemaining] = useState('');
  const { t } = useI18n();
  const modal = useModal();
  const achievements = ACHIEVEMENT_CONFIGS.map(a => ({ ...a, label: t(a.labelKey) }));

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          // Wave 1 — критический путь для первого paint: юзер, баланс,
          // экипировка маскота. Это то, что должно появиться сразу при
          // возврате на таб.
          const [u, state, equipped] = await Promise.all([
            getCurrentUser(),
            getState(),
            getEquippedIds(),
          ]);
          if (!active) return;
          setUser(u);
          setBalance(state.balance);
          setOwnedIds(state.ownedItemIds);
          if (equipped.color) setSelectedColorId(equipped.color);
          if (equipped.eye) setSelectedEyeId(equipped.eye);
          if (equipped.shape) setSelectedShapeId(equipped.shape);
          if (equipped.decor) setSelectedDecorId(equipped.decor);

          // Wave 2 — trial info и списки активностей. Не блокируют render:
          // экран уже виден, эти данные дорисуют вторичные блоки.
          getTrialInfo()
            .then((trial) => {
              if (!active) return;
              setTrialActive(trial.active);
              if (trial.active) setTrialRemaining(formatRemaining(trial.msRemaining));
            })
            .catch((e) => console.warn('profile: trial load failed', e));

          if (u) {
            const seedUserId = DEMO_SEED_USER_MAP[u.email] ?? u.id;
            Promise.all([
              getUserActivities(seedUserId, myStonesTab),
              getUserActivities(seedUserId, 'hide'),
              getUserActivities(seedUserId, 'find'),
            ])
              .then(([acts, hides, finds]) => {
                if (!active) return;
                setMyActivities(acts);
                setHiddenCount(hides.length);
                setFoundCount(finds.length);
              })
              .catch((e) => console.warn('profile: activities load failed', e));
          }
        } catch (e) {
          console.warn('profile load error', e);
        }
      })();
      return () => { active = false; };
    }, [myStonesTab]),
  );

  const selectedColor =
    COLOR_ITEMS.find((c) => c.id === selectedColorId)?.color ?? COLOR_ITEMS[0].color!;
  const selectedVariant: MascotVariant =
    EYE_ITEMS.find((e) => e.id === selectedEyeId)?.variant ?? 'happy';
  const selectedShape: MascotShape =
    (SHAPE_ITEMS.find((s) => s.id === selectedShapeId)?.shape as MascotShape) ?? 'pebble';
  const selectedDecor: MascotDecor =
    (DECOR_ITEMS.find((d) => d.id === selectedDecorId)?.decor as MascotDecor) ?? 'none';

  // Preview-режим: тап на любой item сразу меняет mascot.
  // Если item owned — сохраняется в equipped (persist на сервер).
  // Если нет — preview остаётся на экране + показываем "купить" модал.
  // Preview сбрасывается только при blur экрана через useFocusEffect.
  const handlePickItem = async (
    item: CosmeticItem,
    setPreview: (id: string) => void,
    persist: (id: string) => void,
  ) => {
    // ① Preview — мгновенно (selectedColorId/Eye/Shape/Decor update)
    // haptic selection → юзер чувствует что тап принят.
    void haptics.selection();
    setPreview(item.id);

    if (ownedIds.includes(item.id)) {
      // Owned — сохранить в equipped
      persist(item.id);
      return;
    }

    // ② Не owned — preview уже показан. Показываем модал покупки.
    // Preview НЕ сбрасывается при отмене — юзер видит mascot в новом
    // образе пока не уйдёт с экрана.
    if (!(await requireAuth('менять внешний вид камня'))) return;

    if (balance < item.price) {
      modal.show({
        title: t('profile.not_enough'),
        message: t('profile.cost_info').replace('{label}', item.label).replace('{price}', String(item.price)).replace('{balance}', String(balance)),
        buttons: [{ label: t('common.understood'), style: 'cancel' }],
      });
      return;
    }
    modal.show({
      title: t('profile.buy_title').replace('{label}', item.label),
      message: t('profile.buy_message').replace('{price}', String(item.price)).replace('{balance}', String(balance)),
      buttons: [
        { label: t('common.cancel'), style: 'cancel' },
        {
          label: `${t('profile.buy_confirm')} ${item.price} 💎`,
          onPress: async () => {
            const result = await buyItem(item.id);
            if (result.ok) {
              void haptics.success();
              setBalance(result.balance);
              setOwnedIds(result.ownedItemIds);
              persist(item.id);
            }
          },
        },
      ],
    });
  };

  const handlePickColor = (item: CosmeticItem) =>
    handlePickItem(item,
      (id) => setSelectedColorId(id),
      (id) => { setSelectedColorId(id); setEquippedIds({ color: id }); });

  const handlePickEye = (item: CosmeticItem) =>
    handlePickItem(item,
      (id) => setSelectedEyeId(id),
      (id) => { setSelectedEyeId(id); setEquippedIds({ eye: id }); });

  const handlePickShape = (item: CosmeticItem) =>
    handlePickItem(item,
      (id) => setSelectedShapeId(id),
      (id) => { setSelectedShapeId(id); setEquippedIds({ shape: id }); });

  const handlePickDecor = (item: CosmeticItem) =>
    handlePickItem(item,
      (id) => setSelectedDecorId(id),
      (id) => { setSelectedDecorId(id); setEquippedIds({ decor: id }); });

  const handleChangePhoto = async () => {
    try {
      // Request photo permission first so we fail fast with a useful error.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        modal.show({
          title: t('profile.photo_permission_title') || 'Нет доступа к фото',
          message: t('profile.photo_permission_text') || 'Открой Настройки → Stobi → Photos и разреши доступ.',
          buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
        });
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        quality: 1,
        allowsEditing: true,
        aspect: [1, 1],
      });
      if (result.canceled || !result.assets[0]) return;

      const processed = await processPhoto(result.assets[0].uri);

      // Optimistic update — показываем новое фото сразу, не ждём сервер.
      // Иначе если supabase update молча падает (stale JWT → RLS), getCurrentUser
      // вернул бы серверное значение (null) и затёр бы локальный кеш.
      setUser((prev) => (prev ? { ...prev, photoUrl: processed.uri } : prev));

      // Persist — серверный update + обновление AsyncStorage. Ошибки не
      // фатальны: локально фото уже показано.
      try {
        await updateProfilePhoto(processed.uri);
      } catch (e) {
        console.warn('updateProfilePhoto failed', e);
      }
    } catch (e: any) {
      console.warn('handleChangePhoto error', e);
      modal.show({
        title: t('common.error') || 'Ошибка',
        message: e?.message ?? 'Не удалось загрузить фото',
        buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
      });
    }
  };

  const handleLogout = () => {
    modal.show({
      title: t('profile.logout_title'),
      message: t('profile.logout_text'),
      buttons: [
        { label: t('common.cancel'), style: 'cancel' },
        { label: t('profile.logout_button'), style: 'destructive', onPress: async () => { await logout(); router.replace('/login'); } },
      ],
    });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
      >
        {/* Hero — deep purple background with mascot */}
        <View style={styles.hero}>
          <View style={[styles.heroGlow, styles.heroGlowTL]} />
          <View style={[styles.heroGlow, styles.heroGlowBR]} />

          <SafeAreaView edges={['top']}>
            <View style={styles.heroTopBar}>
              <View style={styles.levelChip}>
                <Text style={styles.levelChipText}>💎 {balance}</Text>
              </View>
              {trialActive && (
                <View style={styles.trialChip}>
                  <Text style={styles.trialChipText}>{t('trial.badge')} · {trialRemaining}</Text>
                </View>
              )}
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.settingsBtn}
                onPress={() => router.push('/settings')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('settings.title')}
              >
                <GearSix size={20} color="#FFFFFF" weight="regular" />
              </TouchableOpacity>
            </View>

            <View style={styles.mascotWrap}>
              {/* key форсит перерендер только в customize-сабтабе, чтобы preview
                  обновлялся при смене косметики. На overview key стабилен —
                  иначе MascotScene ремаунтится на каждом возврате в профиль
                  и таб переключается с задержкой ~300мс. */}
              <MascotScene
                key={mainTab === 'customize'
                  ? `${selectedColorId}-${selectedEyeId}-${selectedShapeId}-${selectedDecorId}`
                  : 'profile-mascot-stable'}
                size={180}
                color={selectedColor}
                variant={selectedVariant}
                shape={selectedShape}
                decor={selectedDecor}
                userName={user?.username}
                mascotName={user?.characterName}
              />
              {/* Preview indicator — виден если юзер примеряет что не купил */}
              {(() => {
                const previewItemIds = [
                  selectedColorId, selectedEyeId, selectedShapeId, selectedDecorId,
                ].filter((id): id is string => !!id && !ownedIds.includes(id));
                if (previewItemIds.length === 0) return null;
                const firstId = previewItemIds[0];
                const previewItem = ALL_ITEMS.find((i) => i.id === firstId);
                if (!previewItem) return null;
                return (
                  <View style={styles.previewBadge}>
                    <Text style={styles.previewBadgeText}>
                      {t('profile.preview_unlock').replace('{price}', String(previewItem.price))}
                    </Text>
                  </View>
                );
              })()}
            </View>

            <TouchableOpacity
              style={styles.heroNameRow}
              accessibilityRole="button"
              accessibilityLabel={t('profile.character_name_title')}
              onPress={user ? () => {
                modal.show({
                  title: t('profile.character_name_title'),
                  input: { placeholder: t('profile.character_name_placeholder'), defaultValue: user.characterName ?? '' },
                  buttons: [
                    { label: t('common.cancel'), style: 'cancel' },
                    {
                      label: t('common.save'),
                      onPress: async (name) => {
                        if (!name?.trim()) return;
                        await updateCharacterName(name.trim());
                        const fresh = await getCurrentUser();
                        setUser(fresh);
                      },
                    },
                  ],
                });
              } : undefined}
              activeOpacity={user ? 0.7 : 1}
            >
              <Text style={styles.heroName}>{user?.characterName || t('profile.character_name_default')}</Text>
              {user && (
                <PencilSimple size={16} color="rgba(255,255,255,0.6)" weight="bold" />
              )}
              {user?.isArtist && (
                <View style={styles.verifiedBadge}>
                  <CheckCircle size={14} color="#FFFFFF" weight="fill" />
                  <Text style={styles.verifiedText}>Artist</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole={user ? 'button' : undefined}
              accessibilityLabel={user ? t('profile.edit_bio') : t('profile.guest_cta')}
              onPress={user ? () => {
                modal.show({
                  title: t('profile.edit_bio'),
                  input: { placeholder: t('profile.bio_placeholder'), defaultValue: user.bio ?? '' },
                  buttons: [
                    { label: t('common.cancel'), style: 'cancel' },
                    {
                      label: t('common.save'),
                      onPress: async (newBio) => {
                        if (isSupabaseConfigured()) {
                          await supabase.from('profiles').update({ bio: newBio?.trim() || null }).eq('id', user.id);
                        }
                        const fresh = await getCurrentUser();
                        setUser(fresh);
                      },
                    },
                  ],
                });
              } : undefined}
              activeOpacity={user ? 0.7 : 1}
            >
              <Text style={styles.heroBio}>
                {user
                  ? user.bio ?? t('profile.bio_placeholder')
                  : t('profile.guest_cta')}
              </Text>
            </TouchableOpacity>

            {!user && (
              <View style={styles.guestCtaRow}>
                <TouchableOpacity
                  style={styles.guestSignUpBtn}
                  onPress={() => router.push('/register')}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.register')}
                >
                  <Text style={styles.guestSignUpText}>{t('common.register')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.guestLoginBtn}
                  onPress={() => router.push('/login')}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.login')}
                >
                  <Text style={styles.guestLoginText}>{t('common.login')}</Text>
                </TouchableOpacity>
              </View>
            )}
          </SafeAreaView>
        </View>

        {/* Main tab switcher */}
        <View style={styles.mainTabs}>
          {(['overview', 'customize'] as const).map((tab) => {
            const active = tab === mainTab;
            const Icon = tab === 'overview' ? ChartBar : Palette;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setMainTab(tab)}
                style={[styles.mainTab, active && styles.mainTabActive]}
                activeOpacity={0.85}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tab === 'overview' ? t('profile.overview') : t('profile.customize')}
              >
                <View style={styles.mainTabInner}>
                  <Icon
                    size={18}
                    color={active ? Colors.accent : Colors.text2}
                    weight={active ? 'fill' : 'regular'}
                  />
                  <Text
                    style={[
                      styles.mainTabText,
                      active && styles.mainTabTextActive,
                    ]}
                  >
                    {tab === 'overview' ? t('profile.overview') : t('profile.customize')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {mainTab === 'overview' ? (
          <View style={styles.body}>
            {/* Profile photo + name card */}
            <View style={styles.profilePhotoCard}>
              <TouchableOpacity
                onPress={handleChangePhoto}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={user?.photoUrl ? t('profile.change_photo') : t('profile.add_photo')}
              >
                <View style={styles.profilePhotoCircle}>
                  {user?.photoUrl ? (
                    <SafeImage source={{ uri: user.photoUrl }} style={styles.profilePhotoImg} fallbackIconSize={28} />
                  ) : (
                    <Camera size={28} color={Colors.text2} weight="regular" />
                  )}
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1 }}
                accessibilityRole={user ? 'button' : undefined}
                accessibilityLabel={user ? t('profile.edit_name') : undefined}
                onPress={user ? () => {
                  modal.show({
                    title: t('profile.edit_name'),
                    input: { placeholder: t('profile.name_placeholder'), defaultValue: user.username },
                    buttons: [
                      { label: t('common.cancel'), style: 'cancel' },
                      {
                        label: t('common.save'),
                        onPress: async (newName) => {
                          if (!newName?.trim()) return;
                          const { supabase, isSupabaseConfigured } = await import('../../lib/supabase');
                          if (isSupabaseConfigured()) {
                            await supabase.from('profiles').update({ username: newName.trim() }).eq('id', user.id);
                          }
                          const fresh = await getCurrentUser();
                          setUser(fresh);
                        },
                      },
                    ],
                  });
                } : undefined}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={styles.profilePhotoName}>{user?.username ?? t('profile.guest')}</Text>
                  {user && <PencilSimple size={14} color={Colors.text2} weight="bold" />}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <Text style={styles.profilePhotoHint}>
                    {user?.photoUrl ? t('profile.change_photo') : t('profile.add_photo')}
                  </Text>
                  <StreakBadge />
                </View>
              </TouchableOpacity>
            </View>

            {/* Welcome quest — скрывается когда все 3 задачи выполнены */}
            <WelcomeQuest />

            {/* Referral card — appears when logged in, always shown */}
            {user && <ReferralCard />}

            {/* Stats */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: Colors.accent }]} numberOfLines={1}>{String(hiddenCount ?? 0)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.hidden_count')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: Colors.green }]} numberOfLines={1}>{String(foundCount ?? 0)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.found_count')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: Colors.orange }]} numberOfLines={1}>
                  {String(balance ?? 0)}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.diamonds')}</Text>
              </View>
            </View>

          {/* Achievements */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile.achievements')}</Text>
            {/* Если не заработано ни одного — подсказка как анлокать.
                Просто locked-иконки без контекста = юзер не понимает как unlock. */}
            {achievements.every((a) => !a.earned) && (
              <Text style={styles.achievementsHint}>
                {t('profile.achievements_hint')}
              </Text>
            )}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.achievementsRow}
            >
              {achievements.map((a, i) => {
                const { Icon } = a;
                return (
                  <View
                    key={i}
                    style={styles.achievement}
                    accessibilityLabel={`${a.label}${a.earned ? '' : ` · ${t('profile.achievement_locked')}`}`}
                  >
                    <View
                      style={[
                        styles.achievementIcon,
                        a.earned && { backgroundColor: a.tint + '22', borderColor: a.tint + '55' },
                        !a.earned && styles.achievementIconLocked,
                      ]}
                    >
                      <Icon
                        size={26}
                        color={a.earned ? a.tint : Colors.text2}
                        weight={a.earned ? 'fill' : 'regular'}
                      />
                      {a.premium && (
                        <View style={styles.achievementPremiumBadge}>
                          <Star size={10} color="#FFFFFF" weight="fill" />
                        </View>
                      )}
                    </View>
                    <Text style={styles.achievementLabel}>{a.label}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {/* My stones — find/hide tabs */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('profile.my_stones')}</Text>

            <View style={styles.myStonesTabs}>
              {(['hide', 'find'] as const).map((stTab) => {
                const active = stTab === myStonesTab;
                return (
                  <TouchableOpacity
                    key={stTab}
                    onPress={() => setMyStonesTab(stTab)}
                    style={[styles.myStonesTab, active && styles.myStonesTabActive]}
                    activeOpacity={0.85}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={stTab === 'hide' ? t('profile.tab_hidden') : t('profile.tab_found')}
                  >
                    <Text
                      style={[
                        styles.myStonesTabText,
                        active && styles.myStonesTabTextActive,
                      ]}
                    >
                      {stTab === 'hide' ? t('profile.tab_hidden') : t('profile.tab_found')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {myActivities.length === 0 ? (
              <View style={styles.myStonesEmpty}>
                <Text style={styles.myStonesEmptyEmoji}>
                  {myStonesTab === 'hide' ? '🪨' : '🔍'}
                </Text>
                <Text style={styles.myStonesEmptyText}>
                  {myStonesTab === 'hide'
                    ? t('profile.no_hidden')
                    : t('profile.no_found')}
                </Text>
                <Text style={styles.myStonesEmptySub}>
                  {myStonesTab === 'hide'
                    ? t('profile.hide_first')
                    : t('profile.find_first')}
                </Text>
              </View>
            ) : (
              <View style={styles.myStonesList}>
                {myActivities.map((item, i) => {
                  const shape = getStoneShape(item.stoneId, 0.85);
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.myStoneRow,
                        i < myActivities.length - 1 && styles.myStoneRowBorder,
                      ]}
                      onPress={() => router.push(`/stone/${item.stoneId}`)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.stoneName} · ${item.city ?? ''}`}
                    >
                      <View style={styles.myStoneVisual}>
                        {item.photoUri ? (
                          <Image
                            source={{ uri: item.photoUri }}
                            style={styles.myStonePhoto}
                          />
                        ) : item.photo ? (
                          <Image
                            source={STONE_PHOTOS[item.photo]}
                            style={styles.myStonePhoto}
                          />
                        ) : (
                          <LinearGradient
                            colors={item.stoneColors as unknown as [string, string]}
                            start={{ x: 0.2, y: 0.05 }}
                            end={{ x: 0.85, y: 0.95 }}
                            style={[
                              styles.myStoneIcon,
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
                                styles.myStoneEmoji,
                                { transform: [{ rotate: `${-shape.rotation}deg` }] },
                              ]}
                            >
                              {item.stoneEmoji}
                            </Text>
                          </LinearGradient>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.myStoneName} numberOfLines={1}>
                          {item.stoneName}
                        </Text>
                        <Text style={styles.myStoneMeta}>
                          {item.city} · {formatActivityTime(item.createdAt)}
                        </Text>
                      </View>
                      <CaretRight size={14} color={Colors.text2} weight="bold" />
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {myStonesTab === 'hide' && (
              <TouchableOpacity
                style={styles.addStoneBtn}
                activeOpacity={0.85}
                onPress={() => router.push('/add')}
                accessibilityRole="button"
                accessibilityLabel={t('profile.add_stone')}
              >
                <Plus size={18} color={Colors.accent} weight="bold" />
                <Text style={styles.addStoneText}>{t('profile.add_stone')}</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Premium — viewable by everyone, CTA inside handles auth */}
          {!user?.isArtist && (
            <TouchableOpacity
              style={styles.artistCard}
              activeOpacity={0.85}
              onPress={() => router.push('/premium')}
              accessibilityRole="button"
              accessibilityLabel={t('profile.open_premium')}
            >
              <View style={styles.artistCardIcon}>
                <Text style={{ fontSize: 24 }}>💎</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.artistCardTitle}>{t('profile.open_premium')}</Text>
                <Text style={styles.artistCardSub}>
                  {t('profile.premium_sub')}
                </Text>
              </View>
              <CaretRight size={18} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}

          {user?.email && <Text style={styles.emailHint}>{user.email}</Text>}
          </View>
        ) : (
          <View style={styles.body}>
            {/* Character name */}
            <TouchableOpacity
              style={styles.characterNameRow}
              accessibilityRole="button"
              accessibilityLabel={t('profile.character_name_title')}
              onPress={() => {
                modal.show({
                  title: t('profile.character_name_title'),
                  input: { placeholder: t('profile.character_name_placeholder'), defaultValue: user?.characterName ?? '' },
                  buttons: [
                    { label: t('common.cancel'), style: 'cancel' },
                    {
                      label: t('common.save'),
                      onPress: async (name) => {
                        if (!name?.trim()) return;
                        await updateCharacterName(name.trim());
                        const fresh = await getCurrentUser();
                        setUser(fresh);
                      },
                    },
                  ],
                });
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.characterNameLabel}>{t('profile.character_name')}</Text>
              <Text style={styles.characterNameValue}>
                {user?.characterName || t('profile.character_name_default')}
              </Text>
              <PencilSimple size={14} color={Colors.text2} weight="bold" />
            </TouchableOpacity>

            {/* Sub-tabs: Color / Face / Shape / Decor — горизонтальные pills с Phosphor иконками */}
            <View style={styles.customTabs}>
              {(['color', 'face', 'shape', 'decor'] as const).map((tab) => {
                const active = customTab === tab;
                const Icon =
                  tab === 'color' ? Palette :
                  tab === 'face' ? SmileyWink :
                  tab === 'shape' ? Shapes :
                  Sparkle;
                const label =
                  tab === 'color' ? t('profile.section_color') :
                  tab === 'face' ? t('profile.section_face') :
                  tab === 'shape' ? t('profile.section_shape') :
                  t('profile.section_decor');
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.customTab, active && styles.customTabActive]}
                    onPress={() => setCustomTab(tab)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                  >
                    <View style={styles.customTabInner}>
                      <Icon
                        size={15}
                        color={active ? '#FFFFFF' : Colors.text2}
                        weight={active ? 'fill' : 'regular'}
                      />
                      <Text
                        style={[styles.customTabText, active && styles.customTabTextActive]}
                        numberOfLines={1}
                      >
                        {label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Balance hint */}
            <View style={styles.balanceHint}>
              <Text style={styles.balanceHintText}>
                💎 {balance} {t('profile.earn_hint')}
              </Text>
            </View>

            {/* Color picker — visible only if customTab==='color' */}
            {customTab === 'color' && (
            <View style={styles.section}>
              <View style={styles.colorGrid}>
                {COLOR_ITEMS.map((item) => {
                  const owned = ownedIds.includes(item.id);
                  const active = item.id === selectedColorId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.colorSwatch,
                        active && styles.colorSwatchActive,
                        !owned && styles.colorSwatchLocked,
                      ]}
                      onPress={() => handlePickColor(item)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={owned ? item.label : `${item.label} — ${item.price} 💎`}
                    >
                      <View
                        style={[
                          styles.colorInner,
                          { backgroundColor: item.color },
                          !owned && { opacity: 0.5 },
                        ]}
                      />
                      {!owned && (
                        <View style={styles.colorLockOverlay}>
                          <Lock size={11} color="#FFFFFF" weight="fill" />
                        </View>
                      )}
                      {!owned && (
                        <View style={styles.colorPriceBadge}>
                          <Text style={styles.colorPriceText}>{item.price}💎</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            )}
            {/* Eye / expression picker */}
            {customTab === 'face' && (
            <View style={styles.section}>
              <View style={styles.eyeGrid}>
                {EYE_ITEMS.map((item) => {
                  const owned = ownedIds.includes(item.id);
                  const active = item.id === selectedEyeId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.eyeCard,
                        active && styles.eyeCardActive,
                        !owned && styles.eyeCardLocked,
                      ]}
                      onPress={() => handlePickEye(item)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={owned ? item.label : `${item.label} — ${item.price} 💎`}
                    >
                      <View style={styles.eyePreview}>
                        <StoneMascot
                          size={56}
                          color={selectedColor}
                          variant={item.variant ?? 'happy'}
                          shape={selectedShape}
                          decor={selectedDecor}
                          showSparkles={false}
                        />
                      </View>
                      <Text
                        style={[
                          styles.eyeLabel,
                          active && { color: Colors.accent },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      {!owned && (
                        <View style={styles.eyeLockBadge}>
                          <Lock size={9} color="#FFFFFF" weight="fill" />
                          <Text style={styles.eyeLockText}>{item.price}💎</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            )}
            {/* Shape picker */}
            {customTab === 'shape' && (
            <View style={styles.section}>
              <View style={styles.eyeGrid}>
                {SHAPE_ITEMS.map((item) => {
                  const owned = ownedIds.includes(item.id);
                  const active = item.id === selectedShapeId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.eyeCard,
                        active && styles.eyeCardActive,
                        !owned && styles.eyeCardLocked,
                      ]}
                      onPress={() => handlePickShape(item)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={owned ? item.label : `${item.label} — ${item.price} 💎`}
                    >
                      <View style={styles.eyePreview}>
                        <StoneMascot
                          size={56}
                          color={selectedColor}
                          variant={selectedVariant}
                          shape={(item.shape as MascotShape) ?? 'pebble'}
                          decor={selectedDecor}
                          showSparkles={false}
                        />
                      </View>
                      <Text
                        style={[
                          styles.eyeLabel,
                          active && { color: Colors.accent },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      {!owned && (
                        <View style={styles.eyeLockBadge}>
                          <Lock size={9} color="#FFFFFF" weight="fill" />
                          <Text style={styles.eyeLockText}>{item.price}💎</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            )}
            {/* Decor picker */}
            {customTab === 'decor' && (
            <View style={styles.section}>
              <View style={styles.eyeGrid}>
                {DECOR_ITEMS.map((item) => {
                  const owned = ownedIds.includes(item.id);
                  const active = item.id === selectedDecorId;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[
                        styles.eyeCard,
                        active && styles.eyeCardActive,
                        !owned && styles.eyeCardLocked,
                      ]}
                      onPress={() => handlePickDecor(item)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={owned ? item.label : `${item.label} — ${item.price} 💎`}
                    >
                      <View style={styles.eyePreview}>
                        <StoneMascot
                          size={64}
                          color={selectedColor}
                          variant={selectedVariant}
                          shape={selectedShape}
                          decor={(item.decor as MascotDecor) ?? 'none'}
                          showSparkles={false}
                        />
                      </View>
                      <Text
                        style={[
                          styles.eyeLabel,
                          active && { color: Colors.accent },
                        ]}
                        numberOfLines={1}
                      >
                        {item.label}
                      </Text>
                      {!owned && (
                        <View style={styles.eyeLockBadge}>
                          <Lock size={9} color="#FFFFFF" weight="fill" />
                          <Text style={styles.eyeLockText}>{item.price}💎</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, paddingBottom: 90 },

  // Hero
  hero: {
    backgroundColor: Colors.bgDeep,
    paddingBottom: 28,
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  heroGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: Colors.accent2,
    opacity: 0.35,
  },
  heroGlowTL: { top: -120, left: -100 },
  heroGlowBR: { bottom: -160, right: -120, backgroundColor: '#7C3AED', opacity: 0.3 },

  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  heroTopBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 6,
  },
  levelChip: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelChipText: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 18 },
  trialChip: {
    backgroundColor: 'rgba(250,204,21,0.25)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(250,204,21,0.4)',
    marginLeft: 8,
  },
  trialChipText: { color: '#FCD34D', fontSize: 12, fontWeight: '700' },

  mascotWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  previewBadge: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: '#FCD34D',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  previewBadgeText: {
    color: '#78350F',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // Customize sub-tabs
  customTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 4,
    marginTop: 12,
    marginBottom: 8,
  },
  customTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 14,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customTabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  customTabActive: {
    backgroundColor: Colors.accent,
  },
  customTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
  },
  customTabTextActive: {
    color: '#FFFFFF',
  },
  balanceHint: {
    backgroundColor: Colors.accentLight,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 12,
    alignItems: 'center',
  },
  balanceHintText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },
  profilePhotoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  profilePhotoCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: Colors.surface2,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profilePhotoImg: {
    width: 60,
    height: 60,
    borderRadius: 30,
  },
  profilePhotoName: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  profilePhotoHint: {
    fontSize: 13,
    color: Colors.accent,
    marginTop: 2,
  },
  characterNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  characterNameLabel: {
    fontSize: 13,
    color: Colors.text2,
    fontWeight: '600',
  },
  characterNameValue: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },

  heroNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    flexWrap: 'wrap',
    paddingHorizontal: 24,
  },
  heroName: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    textAlign: 'center',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  verifiedText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  heroBio: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 28,
    lineHeight: 19,
  },

  // Guest CTAs (when not logged in)
  guestCtaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingHorizontal: 24,
  },
  guestSignUpBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 4,
  },
  guestSignUpText: {
    color: Colors.bgDeep,
    fontSize: 14,
    fontWeight: '800',
  },
  guestLoginBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  guestLoginText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  // Main tabs — folder-tab style (active tab "merges" with the content below)
  mainTabs: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 14,
    gap: 4,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.border,
  },
  mainTab: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: 'transparent',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderColor: 'transparent',
    marginBottom: -1.5, // overlap the row's bottom line so active tab "cuts" it
  },
  mainTabActive: {
    backgroundColor: Colors.bg, // matches page bg → hides the row line behind it
    borderColor: Colors.border,
  },
  mainTabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mainTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text2,
  },
  mainTabTextActive: {
    color: Colors.accent,
    fontWeight: '800',
  },

  // Body
  body: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 20 },

  statsRow: { flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  statCard: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: Colors.text2, marginTop: 3 },


  section: { marginTop: 24 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
    marginBottom: 14,
  },

  // Color picker
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  colorSwatch: {
    width: 56,
    height: 56,
    borderRadius: 18,
    borderWidth: 2.5,
    borderColor: 'transparent',
    padding: 3,
    position: 'relative',
  },
  colorSwatchActive: { borderColor: Colors.accent },
  colorSwatchLocked: { borderColor: Colors.border, borderStyle: 'dashed' },
  colorInner: { flex: 1, borderRadius: 12 },
  colorLockOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(26,26,46,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorPriceBadge: {
    position: 'absolute',
    bottom: -7,
    left: 4,
    right: 4,
    backgroundColor: Colors.accent,
    borderRadius: 8,
    paddingVertical: 2,
    alignItems: 'center',
  },
  colorPriceText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Eye / expression picker
  eyeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  eyeCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    position: 'relative',
  },
  eyeCardActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
  },
  eyeCardLocked: {
    borderStyle: 'dashed',
  },
  eyePreview: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  eyeLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text,
  },
  eyeLockBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  eyeLockText: {
    fontSize: 9,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // Earning hint card
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  hintEmoji: { fontSize: 22 },
  hintText: {
    flex: 1,
    fontSize: 12,
    color: Colors.text2,
    lineHeight: 17,
  },

  // Achievements
  achievementsHint: {
    fontSize: 12,
    color: Colors.text2,
    marginBottom: 10,
    lineHeight: 16,
    fontStyle: 'italic',
  },
  achievementsRow: { gap: 14, paddingRight: 10 },
  achievement: { alignItems: 'center', width: 60 },
  achievementIcon: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementIconLocked: { opacity: 0.4, borderStyle: 'dashed' },
  achievementEmoji: { fontSize: 26 },
  achievementPremiumBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
  achievementLabel: {
    fontSize: 10,
    color: Colors.text2,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 13,
  },

  // My stones — find/hide tabs + list
  myStonesTabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
  },
  myStonesTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  myStonesTabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  myStonesTabText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text2,
  },
  myStonesTabTextActive: { color: '#FFFFFF' },

  myStonesList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  myStoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  myStoneRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  myStoneVisual: {
    width: 56,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myStoneIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  myStonePhoto: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.accentLight,
  },
  myStoneEmoji: { fontSize: 18 },
  myStoneName: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  myStoneMeta: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 2,
  },

  myStonesEmpty: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 26,
    alignItems: 'center',
    gap: 4,
  },
  myStonesEmptyEmoji: { fontSize: 36, marginBottom: 4 },
  myStonesEmptyText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.text,
  },
  myStonesEmptySub: {
    fontSize: 12,
    color: Colors.text2,
    textAlign: 'center',
    paddingHorizontal: 20,
  },

  addStoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    paddingVertical: 12,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
  },
  addStoneText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.accent,
  },

  // Artist
  artistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderRadius: 16,
    padding: 16,
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  artistCardIcon: {
    width: 44,
    height: 44,
    backgroundColor: '#fff',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  artistCardSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },

  // Dev / logout
  devBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#DDD6FE',
  },
  devBtnText: { fontSize: 14, fontWeight: '700', color: Colors.accent },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 10,
  },
  logoutText: { fontSize: 14, fontWeight: '700', color: '#DC2626' },
  emailHint: {
    textAlign: 'center',
    fontSize: 11,
    color: Colors.text2,
    marginTop: 10,
  },
});
