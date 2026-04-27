import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  RefreshControl,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
  CaretUp,
  CaretDown,
  Microphone,
  ChatCircle,
  PaperPlaneRight,
  ArrowLeft,
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
import { getPendingFindsForMyStones } from '../../lib/finds';
import { getFollowState } from '../../lib/follows';
import { gatherAchievementStats, checkAchievements, getAchievements } from '../../lib/achievements';
import { getStoneShape } from '../../lib/location';
import { requireAuth } from '../../lib/auth-gate';
import { setTabBarVisible } from '../../lib/tab-bar-visibility';
import { useI18n } from '../../lib/i18n';
import { useModal } from '../../lib/modal';
import { moderateMessage } from '../../lib/moderation';
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
import { processPhoto, uploadPhotoToStorage } from '../../lib/photo';
import { updateProfilePhoto, updateCharacterName } from '../../lib/auth';
import { supabase, isSupabaseConfigured } from '../../lib/supabase';

// id — должен совпадать с ACHIEVEMENT_DEFS.id из lib/achievements.ts
// чтобы мы могли посмотреть unlocked-state в карусели на профайле.
const ACHIEVEMENT_CONFIGS = [
  { id: 'find-first', Icon: Sparkle, labelKey: 'achievement.find_first', tint: '#A855F7', premium: false },
  { id: 'find-10', Icon: Medal, labelKey: 'achievement.find_10', tint: '#FACC15', premium: false },
  { id: 'explorer-3', Icon: Compass, labelKey: 'achievement.explorer_3', tint: '#16A34A', premium: true },
  { id: 'find-50', Icon: Trophy, labelKey: 'achievement.find_50', tint: '#EA580C', premium: false },
  { id: 'hide-5', Icon: PaintBrush, labelKey: 'achievement.hide_5', tint: '#DB2777', premium: false },
  { id: 'find-100', Icon: Star, labelKey: 'achievement.find_100', tint: '#7C3AED', premium: true },
];

type MainTab = 'profile' | 'mascot';
type CustomTab = 'color' | 'face' | 'shape' | 'decor';

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  // profileLoaded стартует false → guest CTA не мигает пока async getCurrentUser
  // не вернёт ответ. Ставится в true только после первого resolve.
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingFindsCount, setPendingFindsCount] = useState(0);
  const [unlockedAchievements, setUnlockedAchievements] = useState<Set<string>>(new Set());
  const [mainTab, setMainTab] = useState<MainTab>('profile');
  const [customTab, setCustomTab] = useState<CustomTab>('color');
  // Кастомизация на mascot-табе спрятана за стрелкой сверху —
  // юзер хочет fullscreen маскот без заваленного снизу UI.
  const [customizeOpen, setCustomizeOpen] = useState(false);
  // Chat-режим: tap на иконку → маскот уменьшается влево вверху,
  // справа/внизу появляется чат. Реальный LLM пока не подключён —
  // показываем статичные приветственные сообщения как заглушку.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  // Stub-чат до подключения LLM. Сообщения хранятся в state, юзерские
  // отображаются справа, ответы Stobi — слева. Реальный AI пока не
  // подключён — отвечаем шаблонной фразой через 600мс.
  const [chatMessages, setChatMessages] = useState<{ role: 'user' | 'stobi'; text: string }[]>([
    { role: 'stobi', text: 'Скоро со мной можно будет болтать по-настоящему — про твои камни, маршруты, что нашёл за день.' },
    { role: 'stobi', text: 'А пока я только учусь. Но если попробуешь написать — я запомню что тебе интересно.' },
  ]);

  // Скрываем нижний tab-bar пока юзер в чате со Stobi — fullscreen
  // conversation как в reference (Tolan/Replika). На unmount/закрытие
  // чата возвращаем bar обратно.
  useEffect(() => {
    setTabBarVisible(!chatOpen);
    return () => setTabBarVisible(true);
  }, [chatOpen]);

  const handleSendChat = useCallback(() => {
    const text = chatDraft.trim();
    if (!text) return;
    setChatMessages((prev) => [...prev, { role: 'user', text }]);
    setChatDraft('');
    // Stub-ответ — пока LLM не подключён. Позже здесь будет вызов
    // AI provider'а с системным промптом про Stobi-собеседника.
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'stobi',
          text: 'Я ещё не научился отвечать как настоящий Stobi 💜 Совсем скоро — обещаю!',
        },
      ]);
    }, 600);
  }, [chatDraft]);
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
  const [followingCount, setFollowingCount] = useState(0);
  const [followersCount, setFollowersCount] = useState(0);
  const [trialActive, setTrialActive] = useState(false);
  const [trialRemaining, setTrialRemaining] = useState('');
  const { t } = useI18n();
  const modal = useModal();
  // Insets для расчёта отступа чата над floating tab-bar (mascot-таб).
  const insets = useSafeAreaInsets();
  // earned читается из реального state (lib/achievements). Карусель на профайле
  // подсвечивает unlocked vs locked на основании этого.
  const achievements = ACHIEVEMENT_CONFIGS.map((a) => ({
    ...a,
    label: t(a.labelKey),
    earned: unlockedAchievements.has(a.id),
  }));

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
          setProfileLoaded(true);
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

            // Pending finds для бейджа "Одобрить находки".
            getPendingFindsForMyStones()
              .then((pf) => { if (active) setPendingFindsCount(pf.length); })
              .catch(() => {});

            // Follow counts — отдаются getFollowState (следит за target юзером,
            // но в данном случае target == me, так что обе цифры наши).
            getFollowState(u.id)
              .then((s) => {
                if (!active) return;
                setFollowingCount(s.followingCount);
                setFollowersCount(s.followersCount);
              })
              .catch(() => {});

            // Re-check достижений при каждом фокусе профайла. Это ловит
            // случаи когда чужой автор approve'ил твой pending-find пока
            // ты был оффлайн / на другом табе → totalFinds увеличился →
            // find-1/find-5/etc должен разблокироваться. Achievements
            // дедуплируются по balance_events, повтора награды не будет.
            // После checkAchievements грузим actual state для подсветки
            // карусели в overview.
            gatherAchievementStats()
              .then(async (s) => {
                await checkAchievements(s);
                const state = await getAchievements();
                if (active) {
                  const ids = new Set(
                    Object.entries(state)
                      .filter(([, v]) => v?.unlocked)
                      .map(([id]) => id),
                  );
                  setUnlockedAchievements(ids);
                }
              })
              .catch((e) => console.warn('profile: achievement re-check', e));
          }
        } catch (e) {
          console.warn('profile load error', e);
        }
      })();
      return () => { active = false; };
    }, [myStonesTab]),
  );

  // Pull-to-refresh — повторяет тот же запрос что и useFocusEffect.
  // Юзер может тянуть экран вниз чтобы принудительно обновить данные
  // (баланс, найдено/спрятано, achievements) без переключения табов.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [u, state, equipped, trial] = await Promise.all([
        getCurrentUser(),
        getState(),
        getEquippedIds(),
        getTrialInfo().catch(() => ({ active: false, msRemaining: 0 } as any)),
      ]);
      setUser(u);
      setBalance(state.balance);
      setOwnedIds(state.ownedItemIds);
      if (equipped.color) setSelectedColorId(equipped.color);
      if (equipped.eye) setSelectedEyeId(equipped.eye);
      if (equipped.shape) setSelectedShapeId(equipped.shape);
      if (equipped.decor) setSelectedDecorId(equipped.decor);
      setTrialActive(trial.active);
      if (trial.active) setTrialRemaining(formatRemaining(trial.msRemaining));
      if (u) {
        const seedUserId = DEMO_SEED_USER_MAP[u.email] ?? u.id;
        const [acts, hides, finds, pending] = await Promise.all([
          getUserActivities(seedUserId, myStonesTab),
          getUserActivities(seedUserId, 'hide'),
          getUserActivities(seedUserId, 'find'),
          getPendingFindsForMyStones().catch(() => [] as any[]),
        ]);
        setMyActivities(acts);
        setHiddenCount(hides.length);
        setFoundCount(finds.length);
        setPendingFindsCount(pending.length);

        // Achievement re-check + reload state for highlight
        try {
          const stats = await gatherAchievementStats();
          await checkAchievements(stats);
          const state = await getAchievements();
          const ids = new Set(
            Object.entries(state)
              .filter(([, v]) => v?.unlocked)
              .map(([id]) => id),
          );
          setUnlockedAchievements(ids);
        } catch (e) {
          console.warn('profile refresh: achievement check', e);
        }
      }
    } catch (e) {
      console.warn('profile refresh error', e);
    } finally {
      setRefreshing(false);
    }
  }, [myStonesTab]);

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

      // 'avatar' tier: 512px / q=0.7 ≈ 30 КБ — аватарка маленькая в UI.
      const processed = await processPhoto(result.assets[0].uri, 'avatar');

      // Optimistic UI сразу — юзер видит фото без ожидания.
      setUser((prev) => (prev ? { ...prev, photoUrl: processed.uri } : prev));

      // Server sync: upload → NSFW moderation → update profile.
      // Если что-то падает — локально фото уже показано, ошибка не
      // фатальна, но и не пишем на сервер (чтобы не получить отклонённое фото).
      try {
        const { signedUrl } = await uploadPhotoToStorage(processed.uri, 'avatar');
        const { moderateAndEmbedPhoto } = await import('../../lib/photo');
        // Для avatar нам нужен только NSFW-check, embedding не используем.
        // Если небезопасно — откатываем локальный URI.
        const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
        if (!moderation.safe) {
          setUser((prev) => (prev ? { ...prev, photoUrl: undefined } : prev));
          modal.show({
            title: t('find_anywhere.error_nsfw') || 'Фото не прошло проверку',
            message: 'Попробуй другое фото без людей или посторонних предметов.',
            buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
          });
          return;
        }
        await updateProfilePhoto(signedUrl);
      } catch (e) {
        console.warn('avatar upload/moderate failed', e);
        // Revert the optimistic local photoUrl — without this the user
        // sees the new avatar, then edits their name, and the avatar
        // "disappears" (because getCurrentUser returns DB state with
        // no photo_url). Better to show the failure immediately.
        setUser((prev) => (prev ? { ...prev, photoUrl: undefined } : prev));
        modal.show({
          title: t('common.error') || 'Ошибка',
          message: t('profile.avatar_upload_failed') ||
            'Не удалось загрузить фото. Попробуй ещё раз.',
          buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
        });
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

  // Customize-блок (color/face/shape/decor pickers) вынесен в отдельную
  // функцию — он рендерится в двух местах:
  // 1) внутри ScrollView (legacy, скрыт через display:none — оставлен только
  //    как fallback совместимости пока mascot-таб использует overlay)
  // 2) внутри слайд-апа из mascot-fullscreen overlay (стрелка вверху)
  // Объявлен здесь чтобы иметь доступ к state/handlers без передачи props.
  // Компактная кастомизация на mascot-табе: тонкая горизонтальная
  // строка с табами + horizontal scroll квадратиков. Прозрачный фон,
  // на deep-purple видны только сами элементы. Имя персонажа НЕ
  // редактируется отсюда — юзер хочет чистый вид.
  const renderCompactCustomizePill = (
    item: CosmeticItem,
    active: boolean,
    owned: boolean,
    onPress: () => void,
    inner: React.ReactNode,
  ) => (
    <TouchableOpacity
      key={item.id}
      style={[
        styles.compactPill,
        active && styles.compactPillActive,
      ]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={owned ? item.label : `${item.label} — ${item.price} 💎`}
    >
      {inner}
      {!owned && (
        <View style={styles.compactPillLock}>
          <Lock size={10} color="#FFFFFF" weight="fill" />
          <Text style={styles.compactPillPrice}>{item.price}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderCustomizeBody = () => (
    <View>
      {/* Tabs: ЦВЕТ / ЛИЦО / ФОРМА / ДЕКОР — pill стиль на purple bg */}
      <View style={styles.compactTabs}>
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
              style={[styles.compactTab, active && styles.compactTabActive]}
              onPress={() => setCustomTab(tab)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Icon
                size={14}
                color={active ? Colors.accent : 'rgba(255,255,255,0.85)'}
                weight={active ? 'fill' : 'regular'}
              />
              <Text
                style={[
                  styles.compactTabText,
                  active && styles.compactTabTextActive,
                ]}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Horizontal scroll квадратиков для активной категории */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.compactRow}
      >
        {customTab === 'color' &&
          COLOR_ITEMS.map((item) =>
            renderCompactCustomizePill(
              item,
              item.id === selectedColorId,
              ownedIds.includes(item.id),
              () => handlePickColor(item),
              <View style={[styles.compactColorInner, { backgroundColor: item.color }]} />,
            ),
          )}
        {customTab === 'face' &&
          EYE_ITEMS.map((item) =>
            renderCompactCustomizePill(
              item,
              item.id === selectedEyeId,
              ownedIds.includes(item.id),
              () => handlePickEye(item),
              <StoneMascot
                size={48}
                color={selectedColor}
                variant={item.variant ?? 'happy'}
                shape={selectedShape}
                decor={selectedDecor}
                showSparkles={false}
              />,
            ),
          )}
        {customTab === 'shape' &&
          SHAPE_ITEMS.map((item) =>
            renderCompactCustomizePill(
              item,
              item.id === selectedShapeId,
              ownedIds.includes(item.id),
              () => handlePickShape(item),
              <StoneMascot
                size={48}
                color={selectedColor}
                variant={selectedVariant}
                shape={(item.shape as MascotShape) ?? 'pebble'}
                decor={selectedDecor}
                showSparkles={false}
              />,
            ),
          )}
        {customTab === 'decor' &&
          DECOR_ITEMS.map((item) =>
            renderCompactCustomizePill(
              item,
              item.id === selectedDecorId,
              ownedIds.includes(item.id),
              () => handlePickDecor(item),
              <StoneMascot
                size={52}
                color={selectedColor}
                variant={selectedVariant}
                shape={selectedShape}
                decor={(item.decor as MascotDecor) ?? 'none'}
                showSparkles={false}
              />,
            ),
          )}
      </ScrollView>
    </View>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={'#FFFFFF'} />
        }
        style={mainTab !== 'profile' && { display: 'none' }}
      >
        {/* Bounce-extender: visually 0px, но фон покрывает зону overscroll'а
            когда юзер тянет ScrollView вниз — без него виден белый
            промежуток над hero. */}
        <View style={styles.bounceExtender} />

        {/* Top tabs (Профайл / Stobi) — самый первый элемент экрана,
            выше шестерёнки и баланса. Юзер хочет чтобы переключатель
            был сразу под status-bar'ом, до всего остального контента. */}
        <SafeAreaView edges={['top']} style={styles.topTabsSafeArea}>
          <View style={styles.mainTabs}>
            {(['profile', 'mascot'] as const).map((tab) => {
              const active = tab === mainTab;
              const Icon = tab === 'profile' ? ChartBar : SmileyWink;
              const label = tab === 'profile' ? t('profile.tab_profile') : t('profile.tab_mascot');
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setMainTab(tab)}
                  style={[styles.mainTab, active && styles.mainTabActive]}
                  activeOpacity={0.85}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={label}
                >
                  <View style={styles.mainTabInner}>
                    <Icon
                      size={18}
                      color={active ? Colors.accent : 'rgba(255,255,255,0.6)'}
                      weight={active ? 'fill' : 'regular'}
                    />
                    <Text
                      style={[
                        styles.mainTabText,
                        active && styles.mainTabTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </SafeAreaView>

        {/* Hero — deep purple background with mascot */}
        <View style={styles.hero}>
          <View style={[styles.heroGlow, styles.heroGlowTL]} />
          <View style={[styles.heroGlow, styles.heroGlowBR]} />

          <View>
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
              {/* key форсит перерендер только в mascot-сабтабе, чтобы preview
                  обновлялся при смене косметики. На profile key стабилен —
                  иначе MascotScene ремаунтится на каждом возврате в профиль
                  и таб переключается с задержкой ~300мс.
                  На profile-табе hero показывает аватар юзера вместо маскота —
                  юзер хочет иметь чёткое разделение "профайл vs маскот". */}
              {mainTab === 'mascot' ? (
                <MascotScene
                  key={`${selectedColorId}-${selectedEyeId}-${selectedShapeId}-${selectedDecorId}`}
                  size={180}
                  color={selectedColor}
                  variant={selectedVariant}
                  shape={selectedShape}
                  decor={selectedDecor}
                  userName={user?.username}
                  mascotName={user?.characterName}
                />
              ) : (
                <View style={styles.heroAvatarWrap}>
                  {user?.photoUrl ? (
                    <SafeImage source={{ uri: user.photoUrl }} style={styles.heroAvatarImg} fallbackIconSize={56} />
                  ) : (
                    <View style={styles.heroAvatarPlaceholder}>
                      <Camera size={48} color="rgba(255,255,255,0.7)" weight="regular" />
                    </View>
                  )}
                </View>
              )}
              {/* Preview indicator — виден если юзер примеряет что не купил.
                  Только на mascot-табе (на profile-табе hero показывает аватар). */}
              {mainTab === 'mascot' && (() => {
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
                        // Preserve in-flight optimistic photoUrl so
                        // avatar doesn't blink out during rapid edits.
                        setUser((prev) =>
                          fresh
                            ? { ...fresh, photoUrl: fresh.photoUrl ?? prev?.photoUrl }
                            : prev,
                        );
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
                        const trimmed = newBio?.trim() ?? '';
                        // Child-safety: bio is public, block phone/email/social/grooming/profanity.
                        // Empty bio is allowed (user clearing it).
                        if (trimmed.length > 0) {
                          const check = moderateMessage(trimmed);
                          if (!check.ok) {
                            modal.show({
                              title: t('profile.bio_rejected_title') || 'Нельзя сохранить',
                              message: t(`profile.bio_rejected_${check.reason}`) || t(`chat.mod_${check.reason}`) || 'Это нельзя написать в профиле.',
                              buttons: [{ label: t('common.ok') || 'OK' }],
                            });
                            return;
                          }
                        }
                        if (isSupabaseConfigured()) {
                          await supabase.from('profiles').update({ bio: trimmed || null }).eq('id', user.id);
                        }
                        const fresh = await getCurrentUser();
                        // Preserve in-flight optimistic photoUrl — see the
                        // equivalent comment in the username-edit handler.
                        setUser((prev) =>
                          fresh
                            ? { ...fresh, photoUrl: fresh.photoUrl ?? prev?.photoUrl }
                            : prev,
                        );
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

            {/* Guest CTA — показываем только когда точно знаем что юзер не
                залогинен (profileLoaded=true && !user). До первого resolve
                асинхронного getCurrentUser ничего не рендерим — иначе при
                каждом возврате на таб мигает guest-state на полсекунды. */}
            {profileLoaded && !user && (
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
          </View>
        </View>

        {/* Обе вкладки рендерим всегда, переключаем через display:'none'.
            Раньше при переключении profile→mascot→profile ReferralCard
            размонтировался → re-fetch'ил код с пустым state → юзер видел
            мигание. С display:'none' state живёт через переключения. */}
        <View style={[styles.body, mainTab !== 'profile' && { display: 'none' }]}>
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
                          const trimmed = newName?.trim();
                          if (!trimmed) return;
                          // Child-safety: username is public, same rules as bio.
                          const check = moderateMessage(trimmed);
                          if (!check.ok) {
                            modal.show({
                              title: t('profile.name_rejected_title') || 'Нельзя сохранить',
                              message: t(`profile.name_rejected_${check.reason}`) || t(`chat.mod_${check.reason}`) || 'Это нельзя использовать как имя.',
                              buttons: [{ label: t('common.ok') || 'OK' }],
                            });
                            return;
                          }
                          const { supabase, isSupabaseConfigured } = await import('../../lib/supabase');
                          if (isSupabaseConfigured()) {
                            await supabase.from('profiles').update({ username: trimmed }).eq('id', user.id);
                          }
                          const fresh = await getCurrentUser();
                          // Merge, keeping optimistic photoUrl if the DB
                          // hasn't caught up yet (avatar upload / NSFW
                          // check still in flight). Without this, editing
                          // name right after setting avatar wipes the
                          // avatar out of the local UI.
                          setUser((prev) =>
                            fresh
                              ? { ...fresh, photoUrl: fresh.photoUrl ?? prev?.photoUrl }
                              : prev,
                          );
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

            {/* "Посмотреть как видят меня другие" — сразу под profile-photo-card,
                чтобы юзер сразу видел что у него есть public-view. */}
            {user && (
              <TouchableOpacity
                style={styles.publicViewLink}
                activeOpacity={0.7}
                onPress={() => router.push(`/user/${user.id}` as any)}
              >
                <Text style={styles.publicViewText}>
                  👁 {t('profile.view_as_public') || 'Посмотреть как видят меня другие'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Welcome quest — скрывается когда все 3 задачи выполнены */}
            <WelcomeQuest />

            {/* Referral card переехал после "Одобрить находки" (см. ниже) */}

            {/* Stats — 4 бокса: Спрятал / Нашёл / Подписки / Подписчики.
                Алмазики уже видны сверху-слева hero'я, в stats не дублируем. */}
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: Colors.accent }]} numberOfLines={1}>{String(hiddenCount ?? 0)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.hidden_count')}</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={[styles.statNum, { color: Colors.green }]} numberOfLines={1}>{String(foundCount ?? 0)}</Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.found_count')}</Text>
              </View>
              <TouchableOpacity
                style={styles.statCard}
                activeOpacity={0.7}
                onPress={() => user && router.push(`/follows/${user.id}?tab=following` as any)}
              >
                <Text style={[styles.statNum, { color: Colors.text }]} numberOfLines={1}>
                  {String(followingCount ?? 0)}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.following_link') || 'Подписки'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.statCard}
                activeOpacity={0.7}
                onPress={() => user && router.push(`/follows/${user.id}?tab=followers` as any)}
              >
                <Text style={[styles.statNum, { color: Colors.text }]} numberOfLines={1}>
                  {String(followersCount ?? 0)}
                </Text>
                <Text style={styles.statLabel} numberOfLines={1}>{t('profile.followers_link') || 'Подписчики'}</Text>
              </TouchableOpacity>
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
                      {a.earned && (
                        <View style={styles.achievementEarnedBadge}>
                          <CheckCircle size={14} color="#FFFFFF" weight="fill" />
                        </View>
                      )}
                      {a.premium && (
                        <View style={styles.achievementPremiumBadge}>
                          <Star size={10} color="#FFFFFF" weight="fill" />
                        </View>
                      )}
                    </View>
                    <Text style={[styles.achievementLabel, a.earned && styles.achievementLabelEarned]}>{a.label}</Text>
                  </View>
                );
              })}
            </ScrollView>
          </View>

          {/* Referral (compact) + Premium — над grid'ом, чтобы не уходили
              вниз когда сетка камней разрастается. marginTop для отступа от
              ачивок выше. */}
          <View style={{ marginTop: 20 }}>
            {user && <ReferralCard compact />}
          </View>

          {!user?.isArtist && (
            <TouchableOpacity
              style={styles.premiumCompact}
              activeOpacity={0.85}
              onPress={() => router.push('/premium')}
              accessibilityRole="button"
              accessibilityLabel={t('profile.open_premium')}
            >
              <Text style={{ fontSize: 22 }}>💎</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.premiumCompactTitle}>{t('profile.open_premium')}</Text>
                <Text style={styles.premiumCompactSub} numberOfLines={1}>
                  {t('profile.premium_sub')}
                </Text>
              </View>
              <CaretRight size={16} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          )}

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
              // 3-колоночный photo grid как на public-profile (зеркало того
              // что видят другие). Tap на ячейку → /stone/<id> с историей.
              <View style={styles.myStonesGrid}>
                {myActivities.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.myStonesGridCell}
                    activeOpacity={0.85}
                    onPress={() => router.push(`/stone/${item.stoneId}`)}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.stoneName} · ${item.city ?? ''}`}
                  >
                    {item.photoUri ? (
                      <Image source={{ uri: item.photoUri }} style={styles.myStonesGridImg} />
                    ) : item.photo ? (
                      <Image source={STONE_PHOTOS[item.photo]} style={styles.myStonesGridImg} />
                    ) : (
                      <View style={styles.myStonesGridPlaceholder}>
                        <Text style={{ fontSize: 32 }}>{item.stoneEmoji || '🪨'}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* "Спрятать новый камень" кнопка убрана — кнопка "+" в tab-bar
                всегда видна, дублировать здесь смысла нет. */}

            {/* "Одобрить находки" карточка убрана — Stobi сам уверенно
                определяет камни по AI-эмбеддингу. Pending-flow остался
                как fallback для borderline-кейсов в БД (find_proofs),
                но юзеру в UI не предлагаем — слишком много трения. */}
          </View>

          {/* Подписки + Подписчики теперь оба в stats-row выше — отдельные
              link'и убраны во избежание дубликации. */}

          {/* publicViewLink переехал под profile-photo-card.
              Referral compact + Premium compact переехали ВЫШЕ grid'а
              (см. блок над "My stones"), чтобы не уезжали вниз при росте grid'а. */}

          {user?.email && <Text style={styles.emailHint}>{user.email}</Text>}
          </View>
      </ScrollView>

      {/* ═══════════════════════════════════════════════════════════════
          Mascot fullscreen overlay — рендерится только когда выбрана
          вкладка "Маскот". Покрывает весь экран (поверх ScrollView) и
          выглядит как чат-собеседник:
            • Сверху: стрелка (caret) — toggle для customize-панели,
              рядом — балланс и шестерёнка настроек, плюс tab-switcher
              чтобы вернуться обратно на профайл-таб.
            • Центр: большой маскот.
            • Снизу: chat-input bar (placeholder, реальный чат скоро).
            • Slide-up customize panel — открывается стрелкой.
          ═══════════════════════════════════════════════════════════ */}
      {mainTab === 'mascot' && (
        <View style={styles.mascotFullscreen}>
          <View style={[styles.heroGlow, styles.heroGlowTL]} />
          <View style={[styles.heroGlow, styles.heroGlowBR]} />

          <SafeAreaView edges={['top']} style={{ zIndex: 2 }}>
            {/* Tabs ВЫШЕ алмазиков и шестерёнки — самый первый элемент. */}
            <View style={styles.mainTabs}>
              {(['profile', 'mascot'] as const).map((tab) => {
                const active = tab === mainTab;
                const Icon = tab === 'profile' ? ChartBar : SmileyWink;
                const label = tab === 'profile' ? t('profile.tab_profile') : t('profile.tab_mascot');
                return (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => setMainTab(tab)}
                    style={[styles.mainTab, active && styles.mainTabActive]}
                    activeOpacity={0.85}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={label}
                  >
                    <View style={styles.mainTabInner}>
                      <Icon
                        size={18}
                        color={active ? Colors.accent : 'rgba(255,255,255,0.6)'}
                        weight={active ? 'fill' : 'regular'}
                      />
                      <Text
                        style={[
                          styles.mainTabText,
                          active && styles.mainTabTextActive,
                        ]}
                      >
                        {label}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Chip + caret + settings — спрятаны в чат-режиме, юзер хочет
                чистый чат без шума сверху. */}
            {!chatOpen && (
              <View style={styles.mascotFullTopBar}>
                <View style={styles.levelChip}>
                  <Text style={styles.levelChipText}>💎 {balance}</Text>
                </View>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={() => setCustomizeOpen((o) => !o)}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.customize')}
                  style={styles.mascotCaretBtn}
                >
                  {customizeOpen ? (
                    <CaretDown size={22} color="#FFFFFF" weight="bold" />
                  ) : (
                    <CaretUp size={22} color="#FFFFFF" weight="bold" />
                  )}
                </TouchableOpacity>
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
            )}

            {/* Inline customize — рендерим внутри SafeAreaView сразу под
                топ-баром, чтобы пилюли не наезжали на стрелку. */}
            {customizeOpen && !chatOpen && (
              <View style={styles.compactCustomizeWrap}>{renderCustomizeBody()}</View>
            )}
          </SafeAreaView>

          {chatOpen ? (
            // ─── CHAT MODE: маскот сверху, баблы под ним, активный input
            //     внизу. KeyboardAvoidingView поднимает input над клавой.
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              keyboardVerticalOffset={0}
            >
              {/* Маскот сверху по центру (над сообщениями), не сбоку. */}
              <View style={styles.chatMascotTop}>
                <TouchableOpacity
                  onPress={() => setChatOpen(false)}
                  style={styles.chatCloseInline}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.back') || 'Назад'}
                >
                  <ArrowLeft size={18} color="#FFFFFF" weight="bold" />
                  <Text style={styles.chatCloseText}>
                    {user?.characterName || t('profile.character_name_default')}
                  </Text>
                </TouchableOpacity>
                <MascotScene
                  key={`chat-${selectedColorId}-${selectedEyeId}-${selectedShapeId}-${selectedDecorId}`}
                  size={180}
                  color={selectedColor}
                  variant={selectedVariant}
                  shape={selectedShape}
                  decor={selectedDecor}
                  hideSpeech
                />
              </View>

              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.chatMessagesContent}
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.chatBubbleStobi}>
                  <Text style={styles.chatBubbleText}>
                    Привет, {user?.username || 'друг'}! 💜
                  </Text>
                </View>
                {chatMessages.map((m, i) => (
                  <View
                    key={i}
                    style={m.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleStobi}
                  >
                    <Text
                      style={m.role === 'user' ? styles.chatBubbleUserText : styles.chatBubbleText}
                    >
                      {m.text}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              <View style={[styles.mascotFullBottomArea, { paddingBottom: Math.max(insets.bottom, 12) }]}>
                <View style={styles.chatInputBar}>
                  <View style={styles.chatInputPlus}>
                    <Plus size={20} color="rgba(255,255,255,0.7)" weight="bold" />
                  </View>
                  <View style={[styles.chatInputField, { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
                    <TextInput
                      style={styles.chatInputText}
                      value={chatDraft}
                      onChangeText={setChatDraft}
                      placeholder={t('dm.input_placeholder') || 'Сообщение…'}
                      placeholderTextColor="rgba(255,255,255,0.55)"
                    />
                  </View>
                  {chatDraft.trim().length > 0 ? (
                    <TouchableOpacity
                      style={styles.chatInputSend}
                      onPress={handleSendChat}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={t('common.send') || 'Отправить'}
                    >
                      <PaperPlaneRight size={18} color="#FFFFFF" weight="fill" />
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.chatInputMic}>
                      <Microphone size={20} color="rgba(255,255,255,0.7)" weight="bold" />
                    </View>
                  )}
                </View>
              </View>
            </KeyboardAvoidingView>
          ) : (
            // ─── DEFAULT MODE: fullscreen маскот + tap-to-open chat ───
            <>
              <View
                style={[
                  styles.mascotFullCenter,
                  customizeOpen && styles.mascotFullCenterShifted,
                ]}
                pointerEvents="box-none"
              >
                <MascotScene
                  key={`fullscreen-${selectedColorId}-${selectedEyeId}-${selectedShapeId}-${selectedDecorId}`}
                  size={customizeOpen ? 200 : 280}
                  color={selectedColor}
                  variant={selectedVariant}
                  shape={selectedShape}
                  decor={selectedDecor}
                  userName={user?.username}
                  mascotName={user?.characterName}
                />
              </View>

              {/* Простая chat-иконка справа внизу — tap открывает чат-режим.
                  Раньше была полноразмерная имитация input'а — выглядело
                  будто можно сразу писать, юзер хочет один FAB. */}
              <View style={[styles.chatFabWrap, { bottom: insets.bottom + 100 }]}>
                <TouchableOpacity
                  style={styles.chatFab}
                  activeOpacity={0.85}
                  onPress={() => setChatOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('profile.companion_coming_title')}
                >
                  <ChatCircle size={28} color="#FFFFFF" weight="fill" />
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Inline customize рендерится внутри SafeAreaView выше — здесь
              ничего, чтобы не дублировать. */}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, paddingBottom: 90 },
  // Расширитель purple цвета над hero — занимает большую отрицательную
  // marginBottom, поэтому visually занимает 0px, но bg покрывает зону bounce
  // когда юзер тянет ScrollView вниз. Без него виден белый кусок над hero.
  bounceExtender: {
    backgroundColor: Colors.bgDeep,
    height: 600,
    marginBottom: -600,
  },

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
  // Hero avatar (показывается на profile-табе вместо маскота — юзер
  // хочет видеть себя на профайле, маскот живёт в своей вкладке).
  heroAvatarWrap: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroAvatarImg: {
    width: '100%',
    height: '100%',
  },
  heroAvatarPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ─── Mascot fullscreen overlay ───────────────────────────────────────
  // Покрывает ВЕСЬ экран на mascot-табе, включая зону под нижним
  // floating tab-bar. Tab-bar — translucent pill сверху purple-фона,
  // так что фиолетовый просвечивает по краям → один цельный фон.
  // Без bottom: 0 был виден кремовый strip Colors.bg между chat-input
  // и tab-bar.
  mascotFullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.bgDeep,
    overflow: 'hidden',
  },
  mascotFullTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 6,
    gap: 8,
  },
  // Каретка кастомизации — тот же frosted-стиль что у settingsBtn:
  // полупрозрачный белый поверх deep-purple даёт эффект "замороженного
  // стекла" без BlurView. Square (rounded) чтобы гармонировать с
  // settings справа.
  mascotCaretBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  mascotFullCenter: {
    // Абсолютное центрирование маскота относительно ВСЕГО экрана
    // (а не остаточного flex-пространства под top-bar'ом). Без этого
    // маскот сидел в "remaining flex" и казался смещённым вверх.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  // Когда customize открыт — маскот опускается ниже и уменьшается,
  // чтобы освободить верхнюю часть экрана для пилюль кастомизации.
  mascotFullCenterShifted: {
    justifyContent: 'flex-end',
    paddingBottom: 200,
  },
  // Компактная inline-кастомизация (живёт сразу под топ-баром).
  compactCustomizeWrap: {
    paddingHorizontal: 12,
    paddingTop: 4,
  },
  compactTabs: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 8,
    flexWrap: 'wrap',
  },
  compactTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  compactTabActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  compactTabText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  compactTabTextActive: {
    color: Colors.accent,
    fontWeight: '800',
  },
  compactRow: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 8,
  },
  compactPill: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  compactPillActive: {
    borderColor: '#FFFFFF',
    borderWidth: 2.5,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  compactColorInner: {
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  compactPillLock: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 2,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  compactPillPrice: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  mascotFullName: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },
  mascotFullHint: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  mascotFullBottomArea: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  chatInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  chatInputPlus: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInputField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 22,
    paddingHorizontal: 14,
    height: 44,
  },
  chatInputPlaceholder: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    flex: 1,
  },
  chatInputMic: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatFabWrap: {
    position: 'absolute',
    right: 18,
    zIndex: 3,
  },
  chatFab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  chatInputSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInputText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
    paddingVertical: 0,
  },
  // Chat mode (Tolan-style: маскот среднего размера слева, баблы справа)
  chatMascotTop: {
    alignItems: 'center',
    paddingTop: 4,
    paddingBottom: 8,
  },
  chatCloseInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.10)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    marginLeft: 16,
    marginBottom: 6,
  },
  chatCloseText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  chatMessagesContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  chatBubbleStobi: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderTopLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  chatBubbleText: {
    color: '#1A1A2E',
    fontSize: 14,
    lineHeight: 19,
  },
  chatBubbleUser: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    backgroundColor: Colors.accent,
    borderRadius: 18,
    borderTopRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 4,
  },
  chatBubbleUserText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 19,
  },
  // Slide-up customize panel
  customizePanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '60%',
    backgroundColor: Colors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 12,
  },
  customizePanelHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.15)',
    alignSelf: 'center',
    marginBottom: 8,
  },

  // Companion-coming card (mascot-таб, самый верх)
  companionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    padding: 16,
    marginTop: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.accent + '33',
  },
  companionIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  companionIconBubble: {
    width: 38,
    height: 38,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companionBadge: {
    backgroundColor: Colors.accent + '22',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  companionBadgeText: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  companionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  companionDesc: {
    color: Colors.text2,
    fontSize: 13,
    lineHeight: 18,
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

  // SafeArea wrapper для tabs на самом верху (над hero и над всем остальным).
  // Тёмный indigo bg, чтобы tabs визуально сливались с фоном hero.
  topTabsSafeArea: {
    backgroundColor: Colors.bgDeep,
  },
  // Main tabs — sit at the very top of the screen ABOVE the hero/diamonds.
  // Pill-стиль с лёгкой тонкой линией снизу для разделения от hero.
  mainTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 8,
    gap: 6,
  },
  mainTab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  mainTabActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  mainTabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mainTabText: {
    fontSize: 13,
    fontWeight: '700',
    // Неактивная вкладка на фиолетовом hero — text2 (средне-серый) почти
    // не читался. Берём полупрозрачный белый — видно но явно тусклее
    // чем активная (которая Colors.accent на белом фоне).
    color: 'rgba(255,255,255,0.6)',
  },
  mainTabTextActive: {
    color: Colors.accent,
    fontWeight: '800',
  },

  // Body
  body: { paddingHorizontal: 28, paddingTop: 20, paddingBottom: 20, backgroundColor: Colors.bg },

  // Pending finds card — приметная карточка с бейджем-counter'ом.
  pendingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1.5,
    borderColor: '#FDE68A',
    marginBottom: 14,
  },
  pendingCardEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  pendingIconBox: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#92400E',
  },
  pendingTitleEmpty: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
  },
  pendingSub: {
    fontSize: 12,
    color: '#92400E',
    opacity: 0.8,
    marginTop: 2,
  },
  pendingSubEmpty: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 2,
  },
  pendingBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pendingBadgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },

  // Стат-блоки — 3 равные колонки. flexBasis:0 + flexGrow:1 в RN иногда
  // не работает корректно если внутри Text без flex'а — первый элемент
  // получал больше места. Явные width:'33%' решают.
  statsRow: { flexDirection: 'row', alignItems: 'stretch' },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 8,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: Colors.text2, marginTop: 3, textAlign: 'center' },


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
  // Зелёная галка в правом верхнем углу earned-ачивки — мгновенно показывает
  // что разблокировано, на фоне dashed-серых locked'ов.
  achievementEarnedBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.surface,
  },
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
  achievementLabelEarned: {
    color: Colors.text,
    fontWeight: '700',
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
  // 3-колоночный grid фото (как на public profile)
  myStonesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  myStonesGridCell: {
    width: '32.4%',
    aspectRatio: 1,
    backgroundColor: Colors.surface,
    borderRadius: 8,
    overflow: 'hidden',
  },
  myStonesGridImg: { width: '100%', height: '100%' },
  myStonesGridPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surface2 },
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

  // Premium compact card (над grid'ом).
  premiumCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(91,79,240,0.25)',
  },
  premiumCompactTitle: { fontSize: 14, fontWeight: '800', color: Colors.text },
  premiumCompactSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },

  // Followers link (single row, opens follows list at tab=followers).
  followingLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 12,
  },
  followingLinkLabel: { fontSize: 14, fontWeight: '700', color: Colors.text },
  publicViewLink: {
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(91,79,240,0.25)',
  },
  publicViewText: { fontSize: 14, fontWeight: '700', color: Colors.accent },
});
