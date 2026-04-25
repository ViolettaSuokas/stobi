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
  Modal,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CaretDown,
  MapPin,
  CheckCircle,
  Footprints,
  Eye,
  ShareNetwork,
  Flag,
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
import { getPoints, spendPoints, ALL_ITEMS } from '../../lib/points';
import {
  hasFoundStone,
  markStoneFoundV2,
  getFindsToday,
  getFindsOfAuthorToday,
  isAuthorLimitReached,
  reportStoneMissing,
  authorConfirmStone,
} from '../../lib/finds';
import { requireAuth } from '../../lib/auth-gate';
import { getCurrentUser } from '../../lib/auth';
import { deleteUserStone, editUserStone, CannotDeleteFoundStoneError } from '../../lib/user-stones';
import { activateTrial, DAILY_CHALLENGE_GOAL } from '../../lib/premium-trial';
import { DEMO_SEED_USER_MAP } from '../../lib/activity';
import * as ImagePicker from 'expo-image-picker';
import { processPhoto, uploadPhotoToStorage, moderateAndEmbedPhoto } from '../../lib/photo';
import { StoneScanCamera } from '../../components/StoneScanCamera';
import { checkSceneQuality } from '../../lib/scan-quality';
import { sceneQualityError } from '../../lib/scan-errors';
import * as haptics from '../../lib/haptics';
import { ShareTapped, StoneTapped, FirstFindCelebrated, StoneFound } from '../../lib/analytics';
import { CelebrationOverlay, type CelebrationPayload } from '../../components/CelebrationOverlay';
import { SafeImage } from '../../components/SafeImage';
import { PencilSimple, Trash } from 'phosphor-react-native';
import { ReportSheet } from '../../components/ReportSheet';
import { useModal } from '../../lib/modal';
import { useI18n } from '../../lib/i18n';
import { StoneMascot } from '../../components/StoneMascot';
import { gatherAchievementStats, checkAchievements, ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { updateChallengeProgress } from '../../lib/daily-challenge';
import { isStoneRevealed, revealStone } from '../../lib/reveals';
import { getTrialInfo } from '../../lib/premium-trial';

const { width } = Dimensions.get('window');
const HERO_HEIGHT = width * 0.95;

/**
 * Усредняет N embedding'ов и нормализует в unit-vector.
 * Зеркало server-side l2_normalize в create_stone — pgvector cosine
 * distance корректна только на единичных векторах, иначе яркое фото
 * с большей magnitude доминирует над тусклым при усреднении.
 */
function averageEmbeddings(embs: number[][]): number[] {
  if (embs.length === 0) throw new Error('embeddings empty');
  const len = embs[0].length;
  const out = new Array<number>(len).fill(0);
  for (const e of embs) {
    for (let i = 0; i < len; i++) out[i] += e[i];
  }
  for (let i = 0; i < len; i++) out[i] /= embs.length;
  let mag = 0;
  for (let i = 0; i < len; i++) mag += out[i] * out[i];
  mag = Math.sqrt(mag);
  if (mag > 0 && Number.isFinite(mag)) {
    for (let i = 0; i < len; i++) out[i] /= mag;
  }
  return out;
}

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

  // AI find scanner state — открывается по тапу "Я нашла этот камень".
  // Раньше просто ImagePicker + GPS<30м, теперь 2-х сторонний scan→embed→
  // average→server cosine. Зеркало hide flow для более устойчивого матча.
  const [showFindCamera, setShowFindCamera] = useState(false);
  type FindCapture = {
    localUri: string;
    photoUrl?: string;
    embedding?: number[];
    status: 'pending' | 'done' | 'failed';
  };
  const [findCaptures, setFindCaptures] = useState<FindCapture[]>([]);
  const FIND_TOTAL = 2;
  const FIND_STEPS = [
    'Сторона с рисунком',
    'Переверни камень — другая сторона',
  ];

  // Celebration overlay for stone find
  const [celebration, setCelebration] = useState<CelebrationPayload | null>(null);

  // "Камня здесь нет" report flow (migration 017)
  const [reportingMissing, setReportingMissing] = useState(false);
  const [reportCount, setReportCount] = useState<number>(0);

  // Universal "pожаловаться на контент" sheet (nsfw / harassment / etc).
  // Separate from "stone missing" — that's geo-freshness, this is abuse.
  const [showReportSheet, setShowReportSheet] = useState(false);
  const [authorConfirming, setAuthorConfirming] = useState(false);

  // 1-hour lock on freshly-hidden stones (anti-self-find farming).
  // Server enforces this in record_find RPC, but UI shouldn't even offer
  // the button. Tick every 15s to update the remaining countdown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15 * 1000);
    return () => clearInterval(interval);
  }, []);
  // Fresh-lock полностью удалён в миграции 20260425130000 — UX-цена
  // (легит-находки через 5-30 минут после hide блокировались) перевешивала
  // анти-фрод бонус. Защита держится на daily/author/own/AI-similarity.
  // Оставляем 0 чтобы render-ветка "isFresh" гарантированно не показывалась.
  const lockRemainingMs = 0;
  const isFresh = lockRemainingMs > 0;
  const lockMinutes = Math.ceil(lockRemainingMs / 60000);

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

      // Own stones are always revealed. Three ways to detect ownership:
      //   1. stone.authorId matches current user (most reliable for DB stones)
      //   2. activity feed hide event's userId matches (for demo seed users)
      //   3. local user-stone flag (fallback)
      const user = await getCurrentUser();
      if (user) {
        const seedId = DEMO_SEED_USER_MAP[user.email] ?? user.id;
        const matchByAuthor = !!(found?.authorId && (found.authorId === user.id || found.authorId === seedId));
        const matchByHideEvent = stoneHistory.length > 0
          && [...stoneHistory].reverse().find((a) => a.type === 'hide')
          && ([...stoneHistory].reverse().find((a) => a.type === 'hide')!.userId === seedId
              || [...stoneHistory].reverse().find((a) => a.type === 'hide')!.userId === user.id);
        if (matchByAuthor || matchByHideEvent) {
          setIsOwnStone(true);
          setRevealed(true);
        }
      }

      // Premium users see all details
      const trial = await getTrialInfo();
      if (trial.active) setRevealed(true);

      // Count of "камня здесь нет" репортов за последние 90 дней
      // — показываем автору как banner и всем как прозрачный counter.
      if (stoneId) {
        try {
          const { supabase, isSupabaseConfigured } = await import('../../lib/supabase');
          if (isSupabaseConfigured()) {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            const { count } = await supabase
              .from('stone_reports')
              .select('*', { count: 'exact', head: true })
              .eq('stone_id', stoneId)
              .gte('created_at', ninetyDaysAgo);
            if (!cancelled && count !== null) setReportCount(count);
          }
        } catch (e) {
          console.warn('load report count', e);
        }
      }

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
      quality: 1,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0] && stoneId) {
      const processed = await processPhoto(result.assets[0].uri);
      await editUserStone(stoneId, { photoUri: processed.uri });
      router.dismiss();
      router.replace('/(tabs)/map');
    }
  };

  const handleDeleteStone = () => {
    Alert.alert(
      t('stone.delete_title'),
      t('stone.delete_confirm').replace('{name}', stone?.name ?? ''),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!stoneId) return;
            try {
              await deleteUserStone(stoneId);
              router.dismiss();
              router.replace('/(tabs)/map');
            } catch (e) {
              if (e instanceof CannotDeleteFoundStoneError) {
                Alert.alert(
                  'Нельзя удалить',
                  'Этот камень уже кто-то нашёл. Удаление сотрёт у них запись находки и +💎. Камень останется на карте.',
                );
              } else {
                Alert.alert(t('common.error') || 'Ошибка', String(e));
              }
            }
          },
        },
      ],
    );
  };

  const handleShare = async () => {
    if (!stone || !stoneId) return;
    void ShareTapped('stone', stoneId);
    const url = `https://stobi.app/stone/${stoneId}`;
    const message = t('stone.share_message')
      .replace('{name}', stone.name)
      .replace('{city}', stone.city ?? 'Finland');
    try {
      await Share.share({
        message: `${message}\n${url}`,
        url, // iOS учитывает отдельно, Android игнорит
        title: t('stone.share_title'),
      });
    } catch (e) {
      console.warn('share failed', e);
    }
  };

  const handleFound = async () => {
    console.log('[stone-detail] handleFound tapped', { stoneId, alreadyFound, claiming, isOwnStone });
    if (!stoneId || alreadyFound || claiming) {
      console.log('[stone-detail] handleFound early-return');
      return;
    }
    if (isOwnStone) {
      Alert.alert(t('stone.own_stone'), t('stone.cant_find_own'));
      return;
    }

    // Anti-fraud: max 2 stones per author per day
    if (stone?.authorId) {
      const authorFinds = await getFindsOfAuthorToday(stone.authorId);
      if (isAuthorLimitReached(authorFinds)) {
        Alert.alert(t('stone.author_limit_title'), t('stone.author_limit_text'));
        return;
      }
    }

    const authed = await requireAuth('отметить находку');
    console.log('[stone-detail] handleFound authed=', authed);
    if (!authed) return;

    // Intro: используем native Alert.alert вместо useModal, потому что
    // stone/[id] открывается как stack modal (presentation:'modal' в
    // _layout.tsx). Глобальный ModalProvider живёт в корне tree — на iOS
    // его кастомный Modal не показывается поверх native stack modal'а
    // даже с overFullScreen. Native Alert.alert работает всегда.
    console.log('[stone-detail] showing intro alert');
    Alert.alert(
      'Сканируем камень',
      'Возьми камень в руки. Сначала сделаем фото стороны с рисунком, потом перевернём — и AI сверит с эталоном.',
      [
        { text: t('common.cancel') || 'Отмена', style: 'cancel' },
        {
          text: 'Начать',
          onPress: () => {
            console.log('[stone-detail] intro Начать tapped');
            setFindCaptures([]);
            setShowFindCamera(true);
          },
        },
      ],
    );
  };

  // Вызывается из StoneScanCamera после каждого snap'а (2 раза за скан).
  // Накапливаем capture в массив, фоном грузим + считаем embedding.
  // Когда оба done — вычисляем средний embedding и вызываем markStoneFoundV2.
  const handleFindCapture = async (uri: string) => {
    if (!stoneId) return;

    const quality = await checkSceneQuality(uri);
    if (quality.reason !== 'ok') {
      const err = sceneQualityError(quality.reason);
      Alert.alert(err.title, err.tips.join('\n'));
      return;
    }

    const index = findCaptures.length;
    // 'proof' tier: 1024px / q=0.55 → ~80 КБ вместо 250 КБ (reference).
    // Достаточно для AI-embedding'а, юзер всё равно фото не разглядывает.
    const processed = await processPhoto(uri, 'proof');
    setFindCaptures((prev) => [...prev, { localUri: processed.uri, status: 'pending' }]);

    // Фоновая обработка — параллельно для обеих сторон.
    (async () => {
      try {
        const { signedUrl } = await uploadPhotoToStorage(processed.uri, 'find');
        const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
        if (!moderation.safe) {
          setFindCaptures((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], status: 'failed' };
            return next;
          });
          Alert.alert(
            t('find_anywhere.error_nsfw') || 'Фото не прошло проверку',
            'Попробуй другое фото камня.',
          );
          return;
        }
        setFindCaptures((prev) => {
          const next = [...prev];
          next[index] = {
            ...next[index],
            photoUrl: signedUrl,
            embedding: moderation.embedding,
            status: 'done',
          };
          return next;
        });
      } catch (e: any) {
        console.warn('find capture process failed', e);
        setFindCaptures((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], status: 'failed' };
          return next;
        });
      }
    })();
  };

  // Когда оба capture'а 'done' — закрываем камеру, усредняем embedding'и
  // и отправляем на сервер. Зеркало того что create_stone делает на сервере
  // (server averages multi-angle hide embeddings перед сохранением).
  useEffect(() => {
    if (!showFindCamera || !stoneId) return;
    if (findCaptures.length !== FIND_TOTAL) return;
    if (!findCaptures.every((c) => c.status === 'done')) return;

    setShowFindCamera(false);
    void submitFind();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findCaptures, showFindCamera]);

  const submitFind = async () => {
    console.log('[stone-detail] submitFind start', { stoneId, captures: findCaptures.length });
    if (!stoneId) return;
    const dones = findCaptures.filter((c) => c.status === 'done' && c.embedding && c.photoUrl);
    console.log('[stone-detail] submitFind dones=', dones.length);
    if (dones.length === 0) return;

    setClaiming(true);
    try {
      const avgEmbedding = averageEmbeddings(dones.map((c) => c.embedding!));
      const userLocation = await getCurrentLocation().catch(() => null);
      console.log('[stone-detail] submitFind calling markStoneFoundV2', {
        stoneId,
        photoUrlPrefix: dones[0].photoUrl!.slice(0, 80),
        embDim: avgEmbedding.length,
        gps: userLocation?.coords ?? null,
      });

      const findRes = await markStoneFoundV2({
        stoneId,
        photoUrl: dones[0].photoUrl!,
        embedding: avgEmbedding,
        lat: userLocation?.coords.lat ?? null,
        lng: userLocation?.coords.lng ?? null,
      });
      console.log('[stone-detail] submitFind result=', findRes);

      if (!findRes.ok) {
        setClaiming(false);
        void haptics.warn();
        Alert.alert(t('common.error'), findRes.detail || findRes.reason);
        return;
      }

      // Server вернул decision: verified | pending | rejected | already_found
      if (findRes.status === 'rejected') {
        setClaiming(false);
        void haptics.warn();
        const simPct = findRes.similarity != null
          ? ` (${Math.round(findRes.similarity * 100)}%)`
          : '';
        const msgKey =
          findRes.reason === 'low_similarity'
            ? `Это не похоже на этот камень${simPct}. Попробуй сделать фото чётче или с другой стороны.`
          : findRes.reason === 'cannot_find_own_stone' ? t('stone.cannot_find_own')
          : findRes.reason === 'stone_too_fresh' ? t('stone.too_fresh')
          : findRes.reason === 'author_daily_limit' ? t('stone.author_limit')
          : findRes.reason === 'daily_find_limit' ? 'Лимит находок на сегодня'
          : t('common.error');
        Alert.alert(t('common.error'), msgKey);
        return;
      }

      if (findRes.status === 'pending') {
        setClaiming(false);
        Alert.alert(
          'Отправлено автору',
          'Похоже на этот камень, но не на 100%. Автору отправлено на подтверждение, как только подтвердит — начислим 💎.',
        );
        return;
      }

      // Verified — celebrate.
      void haptics.success();
      setAlreadyFound(true);
      const newBalance = findRes.balance ?? (await getPoints());
      const reward = findRes.reward;
      void StoneFound(stoneId, reward);

      // Check daily challenge: 5 finds → 7-day premium trial
      const todayFinds = await getFindsToday();

      // Analytics: track first-find celebration для funnel
      // (самый важный magic moment — если юзер сюда дошёл, retention 70%+)
      const isFirstFind = (await getFindsToday()) === 1;
      if (isFirstFind) {
        void FirstFindCelebrated();
      }
      let trialActivated = false;
      if (todayFinds >= DAILY_CHALLENGE_GOAL) {
        const trialInfo = await activateTrial();
        trialActivated = trialInfo.active;
      }

      // Track challenge + achievements
      await updateChallengeProgress('find');
      const achStats = await gatherAchievementStats();
      const unlocked = await checkAchievements(achStats);

      // Build extras (achievements + trial)
      const extras: string[] = [];
      if (trialActivated) {
        extras.push(t('trial.activated_message'));
      }
      if (unlocked.length > 0) {
        const unlockedCosmetics = unlocked
          .map((id) => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.unlockCosmeticId)
          .filter((id): id is string => !!id)
          .map((id) => ALL_ITEMS.find((it) => it.id === id)?.label)
          .filter((label): label is string => !!label);
        const cosmeticSuffix = unlockedCosmetics.length > 0
          ? ` + ${unlockedCosmetics.join(', ')}`
          : '';
        extras.push(`${t('achievement.unlocked')}${cosmeticSuffix}`);
      }

      setCelebration({
        visible: true,
        title: trialActivated ? t('trial.activated_title') : t('stone.congrats'),
        reward,
        balance: newBalance,
        extraLines: extras,
        stoneId,
        stoneName: stone?.name,
        stoneCity: stone?.city ?? undefined,
        onClose: () => {
          setCelebration(null);
          router.dismiss();
          router.replace('/(tabs)/map');
        },
      });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? '');
    } finally {
      setClaiming(false);
    }
  };

  // ───────────────────────────────
  // "Камня здесь нет" report (migration 017)
  // ───────────────────────────────
  const handleReportMissing = async () => {
    if (!stone || !stoneId) return;
    if (!(await requireAuth(t('stone.report_auth') || 'отметить что камня нет'))) return;

    modal.show({
      title: t('stone.report_title') || 'Камня здесь нет?',
      message:
        t('stone.report_text') ||
        'Подойди к точке на карте. Если реально ничего не нашли, мы запишем твой репорт. После нескольких подтверждений от разных юзеров камень уедет с карты.',
      buttons: [
        { label: t('common.cancel') || 'Отмена', style: 'cancel' },
        {
          label: t('stone.report_confirm') || 'Да, камня здесь нет',
          style: 'destructive',
          onPress: async () => {
            setReportingMissing(true);
            try {
              const loc = await getCurrentLocation();
              if (!loc) {
                Alert.alert(
                  t('common.error') || 'Ошибка',
                  'Нужен доступ к GPS чтобы подтвердить что ты рядом',
                );
                return;
              }
              const res = await reportStoneMissing(
                stoneId,
                loc.coords.lat,
                loc.coords.lng,
              );
              if (res.ok) {
                void haptics.success();
                setReportCount((n) => n + 1);
                modal.show({
                  title: t('stone.report_thanks') || 'Спасибо!',
                  message:
                    t('stone.report_thanks_text') ||
                    'Если ещё несколько людей подтвердят, камень уедет с карты.',
                  buttons: [{ label: t('common.understood') || 'Понятно', style: 'cancel' }],
                });
              } else {
                Alert.alert(
                  t('common.error') || 'Ошибка',
                  res.error ?? 'Не получилось',
                );
              }
            } finally {
              setReportingMissing(false);
            }
          },
        },
      ],
    });
  };

  const handleAuthorConfirm = async () => {
    if (!stone || !stoneId) return;
    setAuthorConfirming(true);
    try {
      const loc = await getCurrentLocation();
      if (!loc) {
        Alert.alert(
          t('common.error') || 'Ошибка',
          'Нужен GPS чтобы подтвердить что камень на месте',
        );
        return;
      }
      const res = await authorConfirmStone(stoneId, loc.coords.lat, loc.coords.lng);
      if (res.ok) {
        void haptics.success();
        setReportCount(0);
        modal.show({
          title: t('stone.author_confirmed') || 'Камень оживлён',
          message:
            (t('stone.author_confirmed_text') ||
              'Репорты сброшены, камень снова на карте.') +
            ` (${res.reportsCleared ?? 0})`,
          buttons: [{ label: t('common.understood') || 'Понятно', style: 'cancel' }],
        });
      } else {
        Alert.alert(t('common.error') || 'Ошибка', res.error ?? 'Не получилось');
      }
    } finally {
      setAuthorConfirming(false);
    }
  };

  // Pick the best photo: prefer stone's own photo_url (set when hidden),
  // потом activity history (для legacy / cross-references), потом bundled
  // photo key (демо-камни). Раньше брали ТОЛЬКО из history, и если истории
  // ещё нет (свежий камень или у finder'а нет cached activities) →
  // юзер видел серый-каменный fallback вместо реального фото автора.
  const actWithPhoto = history.find((a) => a.photoUri || a.photo);
  const heroPhotoUri = stone?.photoUri ?? actWithPhoto?.photoUri;
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
            <SafeImage source={{ uri: heroPhotoUri }} style={styles.heroImage} fallbackIconSize={64} />
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
              accessibilityRole="button"
              accessibilityLabel={t('common.back')}
            >
              <CaretDown size={22} color={Colors.text} weight="bold" />
            </TouchableOpacity>
            {stone && !isOwnStone && (
              <TouchableOpacity
                style={styles.heroBtn}
                onPress={() => setShowReportSheet(true)}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('report.title') || 'Пожаловаться'}
              >
                <Flag size={20} color={Colors.text} weight="bold" />
              </TouchableOpacity>
            )}
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
            <Text style={styles.stoneName} numberOfLines={2}>
              {stone.name}
            </Text>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaItem}>
              <MapPin size={13} color={Colors.accent} weight="fill" />
              <Text style={styles.metaText}>{stone.distance} {t('stone.distance_from')}</Text>
            </View>
            <View style={styles.metaDot} />
            <View style={styles.metaItem}>
              <Eye size={13} color={Colors.text2} weight="regular" />
              <Text style={styles.metaText}>
                {findCount} {pluralize(findCount, 'находка', 'находки', 'находок')}
              </Text>
            </View>
          </View>

          {/* Freshness — last successful find / author confirm.
              Зелёный если < 7 дней, обычный серый иначе. Не показываем
              если нет данных (старые seed-камни). */}
          {stone.lastConfirmedAt && (() => {
            const ms = Date.parse(stone.lastConfirmedAt);
            if (!Number.isFinite(ms)) return null;
            const daysAgo = Math.floor((Date.now() - ms) / (24 * 3600 * 1000));
            const fresh = daysAgo < 7;
            const label = daysAgo < 1
              ? (t('stone.confirmed_today') || 'Подтверждён сегодня')
              : daysAgo < 7
                ? (t('stone.confirmed_recent') || `Подтверждён ${daysAgo} ${pluralize(daysAgo, 'день', 'дня', 'дней')} назад`)
                : (t('stone.confirmed_stale') || `Давно не подтверждался (${daysAgo} дн)`);
            return (
              <View style={[styles.freshnessPill, fresh && styles.freshnessPillFresh]}>
                <View style={[styles.freshnessDot, { backgroundColor: fresh ? Colors.green : Colors.text2 }]} />
                <Text style={[styles.freshnessText, fresh && { color: Colors.green }]}>{label}</Text>
              </View>
            );
          })()}

          {/* Author revive banner — shown when stone has pending reports */}
          {isOwnStone && reportCount > 0 && (
            <View style={styles.reportBanner}>
              <Text style={styles.reportBannerEmoji}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.reportBannerTitle}>
                  {t('stone.author_banner_title') || `${reportCount} юзер${reportCount === 1 ? '' : 'а'} сообщили что камня нет`}
                </Text>
                <Text style={styles.reportBannerSub}>
                  {t('stone.author_banner_sub') ||
                    'Подойди к камню и подтверди — репорты сбросятся, камень останется на карте.'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.reportBannerBtn}
                onPress={handleAuthorConfirm}
                disabled={authorConfirming}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('stone.author_banner_btn') || 'Камень на месте'}
              >
                {authorConfirming ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.reportBannerBtnText}>
                    {t('stone.author_banner_btn') || 'Он там'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          )}

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
              accessibilityRole="button"
              accessibilityLabel={t('stone.edit_name')}
            >
              <PencilSimple size={18} color={Colors.accent} weight="bold" />
              <Text style={styles.ownActionText}>{t('stone.edit_name')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ownActionBtn}
              onPress={handleEditPhoto}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('stone.edit_photo')}
            >
              <PencilSimple size={18} color={Colors.accent} weight="bold" />
              <Text style={styles.ownActionText}>{t('stone.edit_photo')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.ownActionBtn, { borderColor: '#FCA5A5' }]}
              onPress={handleDeleteStone}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('common.delete')}
              accessibilityHint={t('stone.delete_hint')}
            >
              <Trash size={18} color="#DC2626" weight="bold" />
              <Text style={[styles.ownActionText, { color: '#DC2626' }]}>{t('common.delete')}</Text>
            </TouchableOpacity>
          </View>
        ) : alreadyFound ? (
          <View style={styles.foundRow}>
            <View style={[styles.findBtn, styles.findBtnDone, { flex: 1 }]}>
              <CheckCircle size={20} color={Colors.green} weight="fill" />
              <Text style={[styles.findBtnText, { color: Colors.green }]}>
                {t('stone.already_found')}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.shareBtn}
              activeOpacity={0.85}
              onPress={handleShare}
              accessibilityRole="button"
              accessibilityLabel={t('stone.share')}
            >
              <ShareNetwork size={22} color={Colors.accent} weight="bold" />
            </TouchableOpacity>
          </View>
        ) : isFresh ? (
          <View style={[styles.findBtn, styles.findBtnLocked]}>
            <Text style={[styles.findBtnText, { color: Colors.text2 }]}>
              {t('stone.lock_countdown').replace('{min}', String(lockMinutes))}
            </Text>
          </View>
        ) : (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.findBtn, { flex: 1 }]}
              activeOpacity={0.85}
              onPress={handleFound}
              disabled={claiming}
              accessibilityRole="button"
              accessibilityLabel={t('stone.found_button')}
              accessibilityState={{ disabled: claiming, busy: claiming }}
            >
              {claiming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.findBtnText}>{t('stone.found_button')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.reportMissingBtn}
              onPress={handleReportMissing}
              disabled={reportingMissing}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('stone.report_btn') || 'Камня здесь нет'}
              accessibilityHint={t('stone.report_btn_hint') || 'Сообщить что камня на месте нет'}
            >
              {reportingMissing ? (
                <ActivityIndicator color={Colors.text2} />
              ) : (
                <Text style={styles.reportMissingBtnText}>🫥</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>

      {/* AI find scanner — 2-х сторонний скан зеркально hide flow.
          Прогресс берём по done-count, чтобы countdown следующего шага не
          стартовал пока AI не закончил предыдущий (см. analyzing prop). */}
      {(() => {
        const findDoneCount = findCaptures.filter((c) => c.status === 'done').length;
        const findCurrentStep = Math.min(findDoneCount + 1, FIND_TOTAL);
        const lastFind = findCaptures[findCaptures.length - 1];
        const findAnyFailed = findCaptures.some((c) => c.status === 'failed');
        const findAnalyzing: 'idle' | 'pending' | 'done' | 'failed' =
          !lastFind ? 'idle' :
          lastFind.status === 'pending' ? 'pending' :
          findAnyFailed ? 'failed' :
          lastFind.status === 'done' ? 'done' : 'idle';
        const findAnalyzingLabel = findCaptures.length === 1
          ? 'AI запоминает рисунок…'
          : 'AI анализирует обратную сторону…';
        return (
          <Modal
            visible={showFindCamera}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => {
              setShowFindCamera(false);
              setFindCaptures([]);
            }}
          >
            <StoneScanCamera
              title={t('scan.title_find')}
              subtitle={FIND_STEPS[findCaptures.length] ?? t('scan.sub_find')}
              progress={{
                current: findCurrentStep,
                total: FIND_TOTAL,
                stepLabel: `Фото ${findCurrentStep} из ${FIND_TOTAL}`,
              }}
              onCapture={handleFindCapture}
              onCancel={() => {
                setShowFindCamera(false);
                setFindCaptures([]);
              }}
              ctaLabel={t('scan.btn_capture')}
              analyzing={findAnalyzing}
              analyzingLabel={findAnalyzingLabel}
              onRetry={() => setFindCaptures([])}
            />
          </Modal>
        );
      })()}

      {/* Claiming overlay — пока AI обрабатывает фото после snap'а. */}
      {claiming && (
        <View style={StyleSheet.absoluteFill}>
          <View style={styles.claimingOverlay}>
            <ActivityIndicator color={Colors.accent} size="large" />
            <Text style={styles.claimingText}>
              {t('scan.processing') || 'AI проверяет…'}
            </Text>
          </View>
        </View>
      )}

      {/* Celebration overlay — показывается после успешной находки */}
      {celebration && <CelebrationOverlay {...celebration} />}

      {/* Universal report sheet. Only for stones we don't own. Handles
          nsfw / harassment / unsafe_location / spam / child_safety. */}
      {stone && !isOwnStone && (
        <ReportSheet
          visible={showReportSheet}
          targetType="stone"
          targetId={stone.id}
          authorId={stone.authorId ?? undefined}
          onClose={() => setShowReportSheet(false)}
          onDone={(result) => {
            setShowReportSheet(false);
            modal.show({
              title: t('report.sent_title') || 'Спасибо',
              message: result === 'duplicate'
                ? (t('report.duplicate') || 'Ты уже жаловался на это.')
                : (t('report.sent_text') || 'Жалоба отправлена.'),
              buttons: [{ label: t('common.ok') || 'OK' }],
            });
          }}
        />
      )}
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

  // AI find: фуллскрин loading пока сервер сравнивает embedding
  claimingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(18,16,39,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  claimingText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },

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

  // Freshness pill (last_confirmed_at)
  freshnessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: Colors.surface2,
    marginTop: -10,
    marginBottom: 14,
  },
  freshnessPillFresh: {
    backgroundColor: Colors.greenLight,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text2,
  },
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
  findBtnLocked: {
    backgroundColor: Colors.surface2,
    shadowOpacity: 0,
  },
  findBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },

  // Row with "Я нашёл" + "Камня нет" side-by-side
  actionRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
  },
  reportMissingBtn: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  reportMissingBtnText: {
    fontSize: 22,
  },

  // Author revive banner (when юзеры репортнули что камня нет)
  reportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.warningBg,
    borderRadius: 14,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Colors.warningBorder,
  },
  reportBannerEmoji: {
    fontSize: 22,
  },
  reportBannerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.text,
  },
  reportBannerSub: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 3,
    lineHeight: 16,
  },
  reportBannerBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  reportBannerBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },

  // Share button — next to "already_found" pill
  foundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  shareBtn: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: Colors.accent,
  },

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
