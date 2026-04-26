import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Camera,
  MapPin,
  Sparkle,
  CheckCircle,
} from 'phosphor-react-native';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { processPhoto, uploadPhotoToStorage, moderateAndEmbedPhoto } from '../../lib/photo';
import { checkSceneQuality } from '../../lib/scan-quality';
import { sceneQualityError } from '../../lib/scan-errors';
import * as haptics from '../../lib/haptics';
import { CelebrationOverlay, type CelebrationPayload } from '../../components/CelebrationOverlay';
import { Colors } from '../../constants/Colors';
import { getCurrentLocation } from '../../lib/location';
import { earnPoints, REWARD_HIDE, ALL_ITEMS } from '../../lib/points';
import { addUserStone } from '../../lib/user-stones';
// import { checkHideLocationSafe } from '../../lib/safety';
// ↑ disabled — see hide-flow comment ниже у бывшего вызова.
import { moderateMessage } from '../../lib/moderation';
import { SafetyGate, hasAcknowledgedSafety } from '../../components/SafetyGate';
// AgeGate intentionally not imported — Stobi targets a 4+ App Store rating,
// so we no longer block hide/find behind a 13+ year picker. Server-side
// birth_year is now optional (migration 20260422140000 dropped the NOT NULL
// requirement and the trigger accepts NULL).
import { StoneHidden } from '../../lib/analytics';
import { getCurrentUser, type User } from '../../lib/auth';
import { DEMO_SEED_USER_MAP } from '../../lib/activity';
import { StoneMascot } from '../../components/StoneMascot';
import { StoneScanCamera } from '../../components/StoneScanCamera';
import { useModal } from '../../lib/modal';
import { useI18n } from '../../lib/i18n';
import { gatherAchievementStats, checkAchievements, ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { updateChallengeProgress } from '../../lib/daily-challenge';

export default function AddScreen() {
  const insets = useSafeAreaInsets();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [celebration, setCelebration] = useState<CelebrationPayload | null>(null);

  // AI scanner v2: multi-angle capture (2 ракурса painted стороны) для устойчивости AI-матчинга.
  // Каждый снимок обрабатывается параллельно в фоне (upload + edge function),
  // готовые embeddings и photoUrls собираются в массивы и передаются в
  // create_stone RPC одним батчем — сервер усредняет их в один reference.
  type ScanCapture = {
    localUri: string;
    photoUrl?: string;
    embedding?: number[];
    status: 'pending' | 'done' | 'failed';
  };
  // Двухшаговый скан: сначала painted (front) сторона, потом обратная
  // ("переверни камень"). Auto-capture снимает каждую через 3-2-1 после
  // того как камера готова. Стороны разные → embedding средний устойчив
  // к ракурсу, не путает с похожим узором, и юзер не недоумевает зачем
  // 2 фото подряд (между ними явный шаг "переверни").
  const SCAN_STEPS = [
    'Сторона с рисунком',
    'Переверни камень — другая сторона',
  ];
  const SCAN_TOTAL = SCAN_STEPS.length;
  const [scanCaptures, setScanCaptures] = useState<ScanCapture[]>([]);
  const [showScanCamera, setShowScanCamera] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showSafetyGate, setShowSafetyGate] = useState(false);

  // Производные значения для совместимости с существующим create_stone call
  const scanEmbedding = scanCaptures.length > 0
    ? scanCaptures.map((c) => c.embedding).filter((e): e is number[] => Array.isArray(e))
    : null;
  const scanPhotoUrl = scanCaptures[0]?.photoUrl ?? null;
  // Settled = все 2 кадра прошли pipeline (done или failed). Спиннер должен
  // уйти когда settled, иначе timeout/сетевая ошибка → бесконечная "AI
  // анализирует". Раньше зависели только от `every === 'done'` → если хоть
  // один failed, юзер залипал на 45-сек copy навсегда.
  const scanSettled = scanCaptures.length === SCAN_TOTAL
    && scanCaptures.every((c) => c.status !== 'pending');
  const scanAnyFailed = scanCaptures.some((c) => c.status === 'failed');
  const scanAllDone = scanSettled && !scanAnyFailed;

  const modal = useModal();
  const { t } = useI18n();


  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check auth on focus — show placeholder for guests instead of redirecting
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCurrentUser().then((u) => {
        if (active) {
          setUser(u);
          setCheckingAuth(false);
        }
      });
      return () => { active = false; };
    }, []),
  );

  useEffect(() => {
    getCurrentLocation().then((loc) => {
      if (!loc) return;
      setCity(loc.city ?? loc.region);
      setCoords(loc.coords);
    });
  }, []);

  // handleTakePhoto / handlePickFromGallery / handleSelectPhoto removed —
  // hide flow is scanner-only. Manual photo / gallery were a leftover from
  // pre-scanner days and confused users (two photo paths on one screen).

  // AI-scanner для hide flow — показываем live-camera со scan-frame.
  // Каждый из 2 ракурсов обрабатывается в фоне параллельно.
  //
  // SAFETY: first time a user tries to hide a stone, block until they've
  // read + acknowledged the safety rules (hide only in public places, never
  // near schools, etc). This is critical since painted-rocks users are often
  // children and unsafe hiding patterns = child-safety hazard.
  // Intro модал: объясняем юзеру весь scan-flow заранее. Без этого первый
  // раз непонятно: "почему камера сразу открылась? зачем 2 фото? когда
  // переворачивать?". Modal короткий, юзер читает 5 сек и сам жмёт "Начать".
  const showScanIntro = () => {
    modal.show({
      title: 'Сканируем камень',
      message:
        'Возьми камень в руки. Сначала сделаем фото стороны с рисунком, потом перевернёшь — и AI запомнит его, чтобы потом узнать когда найдут.',
      buttons: [
        { label: t('common.cancel') || 'Отмена', style: 'cancel' },
        {
          label: 'Начать',
          onPress: () => {
            setScanCaptures([]);
            setShowScanCamera(true);
          },
        },
      ],
    });
  };

  const handleOpenScanCamera = async () => {
    const acked = await hasAcknowledgedSafety();
    if (!acked) {
      setShowSafetyGate(true);
      return;
    }
    showScanIntro();
  };

  const handleSafetyAcknowledge = () => {
    setShowSafetyGate(false);
    showScanIntro();
  };

  const handleScanCapture = async (uri: string) => {
    // 0. Client-side quality check — не регистрируем стены/темноту/размытость
    //    как reference embedding (иначе future finds будут падать).
    const quality = await checkSceneQuality(uri);
    if (quality.reason !== 'ok') {
      const err = sceneQualityError(quality.reason);
      modal.show({
        title: err.title,
        message: err.tips.join('\n'),
        buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
      });
      return;
    }

    // Сразу добавляем capture в список (pending) — UI обновится с прогрессом.
    const index = scanCaptures.length;
    const processed = await processPhoto(uri);
    if (index === 0) {
      setPhotoUri(processed.uri);         // первое фото идёт в photo area
    }
    setScanCaptures((prev) => [...prev, { localUri: processed.uri, status: 'pending' }]);
    // Камеру НЕ закрываем после последнего capture — ждём пока AI закончит
    // оба, чтобы юзер видел "AI запоминает..." прямо в камере. Закрытие
    // триггерится из useEffect ниже когда scanAllDone.

    // Фоново: upload + edge function. Не блокируем следующий shutter.
    (async () => {
      try {
        const { signedUrl, path } = await uploadPhotoToStorage(processed.uri, 'stone');
        console.log(`[scan] capture[${index}] uploaded path=${path} signedUrl=${signedUrl.slice(0, 120)}...`);
        const moderation = await moderateAndEmbedPhoto(signedUrl, 'stone');
        if (!moderation.safe) {
          setScanCaptures((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], status: 'failed' };
            return next;
          });
          modal.show({
            title: t('find_anywhere.error_nsfw') || 'Фото не прошло проверку',
            message: 'Один из снимков не прошёл проверку. Сфотографируй заново.',
            buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
          });
          return;
        }
        setScanCaptures((prev) => {
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
        console.warn('scan capture process failed', e);
        setScanCaptures((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], status: 'failed' };
          return next;
        });
      } finally {
        // После последнего обработанного — снимаем общий spinner.
        setScanCaptures((prev) => {
          if (prev.every((c) => c.status !== 'pending')) {
            setScanning(false);
          }
          return prev;
        });
      }
    })();
  };

  const handleResetScan = () => {
    setScanCaptures([]);
    setPhotoUri(null);
    setScanning(false);
  };

  // Camera retry: AI упал на одном из снимков → камера показала retry.
  // Сбрасываем все captures и оставляем камеру открытой — countdown
  // перезапустится автоматически (cameraReady остаётся true).
  const handleScanRetry = () => {
    setScanCaptures([]);
    setPhotoUri(null);
  };

  // Auto-close camera когда AI закончил оба снимка успешно. Раньше
  // закрывали сразу после captureN — но тогда AI крутился на отдельном
  // спиннер-экране, и при failure юзер залипал. Теперь весь scan-loop
  // (snap → AI → snap → AI) живёт внутри камеры.
  useEffect(() => {
    if (!showScanCamera) return;
    if (scanCaptures.length === SCAN_TOTAL && scanCaptures.every((c) => c.status === 'done')) {
      setShowScanCamera(false);
      setScanning(false);
    }
  }, [showScanCamera, scanCaptures]);

  const handleSave = async () => {
    // Прячем клавиатуру — иначе после save показывается CelebrationOverlay,
    // а клавиатура от поля "Название" остаётся и закрывает половину экрана,
    // включая кнопку закрытия overlay → юзер залипает.
    Keyboard.dismiss();
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (!trimmedName) {
      Alert.alert(t('add.stone_name'), t('add.name_required'));
      return;
    }
    if (trimmedName.length < 2) {
      Alert.alert(t('add.stone_name'), t('add.name_too_short'));
      return;
    }
    if (trimmedName.length > 80) {
      Alert.alert(t('add.stone_name'), t('add.name_too_long'));
      return;
    }
    if (trimmedDesc.length > 500) {
      Alert.alert(t('add.description'), t('add.description_too_long'));
      return;
    }
    if (!photoUri) {
      Alert.alert(
        t('common.need_photo'),
        t('add.photo_required'),
      );
      return;
    }
    if (!coords) {
      Alert.alert(
        t('common.no_gps'),
        t('add.no_gps'),
      );
      return;
    }

    setSaving(true);
    try {
      // Moderate name + description client-side before we even upload photos.
      // Server trigger stones_moderation enforces the same rules, but catching
      // it early saves the user an upload + gives a readable error.
      const nameCheck = moderateMessage(name.trim());
      if (!nameCheck.ok) {
        setSaving(false);
        Alert.alert(
          t('add.name_rejected_title') || 'Имя нельзя использовать',
          t(`chat.mod_${nameCheck.reason}`) || 'Выбери другое имя камня.',
        );
        return;
      }
      const trimmedDesc = description.trim();
      if (trimmedDesc.length > 0) {
        const descCheck = moderateMessage(trimmedDesc);
        if (!descCheck.ok) {
          setSaving(false);
          Alert.alert(
            t('add.description_rejected_title') || 'Описание нельзя сохранить',
            t(`chat.mod_${descCheck.reason}`) || 'Переформулируй описание.',
          );
          return;
        }
      }

      // Location-safety check был ОТКЛЮЧЁН по запросу пользователя:
      // SafetyGate уже даёт hard-acknowledgement правил перед первой
      // пряткой ("где прятать", "где не прятать"). Overpass-based
      // POI-проверка слишком строгая — блокировала легитимные публичные
      // места (дворы многоквартирных домов, скверы, площадки) когда
      // там нет помеченной OSM-точки рядом. False positive ломал UX.
      // checkHideLocationSafe() оставлен в lib/safety.ts на случай
      // если Apple-ревьюеры потребуют вернуть как advisory-warning.

      // Resolve current user → seed user id mapping (so it shows in МОИ КАМНИ)
      const user = await getCurrentUser();
      const authorUserId = user
        ? DEMO_SEED_USER_MAP[user.email] ?? user.id
        : 'guest';
      const authorName = user?.username ?? t('profile.guest');
      const authorAvatar = user?.avatar ?? '🪨';

      const emoji = '🪨';

      // Small random offset (~30-80m) so stone doesn't hide under user marker
      const offsetCoords = {
        lat: coords.lat + (Math.random() - 0.5) * 0.0012,
        lng: coords.lng + (Math.random() - 0.5) * 0.0012,
      };

      // Если multi-angle скан прошёл — собираем все embeddings + photoUrls
      // и передаём в addUserStone, который вызовет create_stone RPC.
      // Сервер усреднит векторы в один reference vector(768).
      const doneCaptures = scanCaptures.filter((c) => c.status === 'done' && c.embedding && c.photoUrl);
      const embeddingsForRpc = doneCaptures.length >= 1
        ? doneCaptures.map((c) => c.embedding!)
        : null;
      const photoUrlsForRpc = doneCaptures.length >= 1
        ? doneCaptures.map((c) => c.photoUrl!)
        : null;

      const saved = await addUserStone(
        {
          name: name.trim(),
          emoji,
          description: description.trim() || undefined,
          tags: [],
          photoUri: photoUrlsForRpc?.[0] ?? photoUri ?? undefined,
          coords: offsetCoords,
          city: city ?? 'Finland',
          authorUserId,
          authorName,
          authorAvatar,
          isArtist: user?.isArtist,
        },
        embeddingsForRpc && photoUrlsForRpc
          ? { embeddings: embeddingsForRpc, photoUrls: photoUrlsForRpc }
          : {},
      );

      void haptics.success();
      void StoneHidden(saved?.id ?? 'unknown');
      // Award diamonds + track progress (server-audited via earn_points RPC)
      const newBalance = await earnPoints(REWARD_HIDE, 'stone_hide');
      await updateChallengeProgress('hide');
      const achStats = await gatherAchievementStats();
      const unlocked = await checkAchievements(achStats);

      const unlockedCosmetics = unlocked
        .map((id) => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.unlockCosmeticId)
        .filter((id): id is string => !!id)
        .map((id) => ALL_ITEMS.find((it) => it.id === id)?.label)
        .filter((label): label is string => !!label);
      const cosmeticSuffix = unlockedCosmetics.length > 0
        ? ` + ${unlockedCosmetics.join(', ')}`
        : '';
      const achSuffix = unlocked.length > 0
        ? `\n\n🏆 ${t('achievement.unlocked')}${cosmeticSuffix}`
        : '';

      const extras: string[] = [];
      if (unlocked.length > 0) {
        extras.push(`${t('achievement.unlocked')}${cosmeticSuffix}`);
      }
      setCelebration({
        visible: true,
        title: t('add.success_title'),
        reward: 3, // REWARD_HIDE
        balance: newBalance,
        extraLines: extras,
        stoneName: name.trim(),
        stoneCity: city ?? undefined,
        onClose: () => {
          setCelebration(null);
          // На карту, а не router.back() — /add это таб без истории, back
          // не работает, юзер залипает на пустом /add. Карта — естественный
          // следующий шаг (видишь свой только что спрятанный камень).
          router.push('/(tabs)/map');
        },
      });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('add.error'));
    } finally {
      setSaving(false);
    }
  };

  // Guest placeholder — no redirect, no loop
  if (!checkingAuth && !user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back') || 'Назад'}
          >
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('add.title')}</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <StoneMascot size={140} color="#C4B5FD" variant="happy" showSparkles />
          <Text style={{ fontSize: 20, fontWeight: '800', color: Colors.text, marginTop: 16, textAlign: 'center' }}>
            {t('add.guest_title')}
          </Text>
          <Text style={{ fontSize: 14, color: Colors.text2, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {t('add.guest_text')}
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: Colors.accent, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 40, marginTop: 24 }}
            onPress={() => router.push('/register')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('common.register')}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{t('common.register')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Full-screen SafetyGate — only gate left in the chain. AgeGate was
  // removed when we shifted Stobi to a 4+ rating; birth_year is no
  // longer collected up front.
  const safetyGateEl = (
    <SafetyGate
      visible={showSafetyGate}
      onAcknowledge={handleSafetyAcknowledge}
      onClose={() => setShowSafetyGate(false)}
    />
  );

  // Full-screen scan camera as a Modal — must wrap in Modal (not return
  // inline) so it overlays the tab bar. Returning StoneScanCamera as the
  // tab body left the tab navigator's bar covering the shutter button.
  //
  // Шаг считаем по done-count, не по length — иначе после snap'а
  // камера сразу показывает "Photo 2 of 2" хотя photo 1 ещё в AI.
  // Countdown следующего шага залочен через analyzing prop пока
  // предыдущий не settled.
  const doneCount = scanCaptures.filter((c) => c.status === 'done').length;
  const currentScanStep = Math.min(doneCount + 1, SCAN_TOTAL);
  // Статус для камеры берём от последнего capture'а (он сейчас в обработке).
  const lastCapture = scanCaptures[scanCaptures.length - 1];
  const cameraAnalyzing: 'idle' | 'pending' | 'done' | 'failed' =
    !lastCapture ? 'idle' : lastCapture.status === 'pending' ? 'pending' :
    scanAnyFailed ? 'failed' :
    lastCapture.status === 'done' ? 'done' : 'idle';
  // Подпись зависит от того, какую сторону только что сняли.
  const cameraAnalyzingLabel =
    scanCaptures.length === 1
      ? (t('scan.analyzing') || 'AI запоминает рисунок…')
      : (t('scan.analyzing_back') || 'AI анализирует обратную сторону…');
  const scanCameraEl = (
    <Modal
      visible={showScanCamera}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => {
        setShowScanCamera(false);
        setScanCaptures([]);
      }}
    >
      <StoneScanCamera
        title={t('scan.title_hide')}
        subtitle={SCAN_STEPS[scanCaptures.length] ?? t('scan.sub_hide')}
        progress={SCAN_TOTAL > 1 ? {
          current: currentScanStep,
          total: SCAN_TOTAL,
          stepLabel: `Фото ${currentScanStep} из ${SCAN_TOTAL}`,
        } : undefined}
        onCapture={handleScanCapture}
        onCancel={() => {
          setShowScanCamera(false);
          setScanCaptures([]);
        }}
        ctaLabel={t('scan.btn_capture')}
        analyzing={cameraAnalyzing}
        analyzingLabel={cameraAnalyzingLabel}
        onRetry={handleScanRetry}
      />
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {safetyGateEl}
      {scanCameraEl}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back') || 'Назад'}
          >
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('add.title')}</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {/* Single entry point: AI scanner. The old "Take photo" tile
              was removed — it duplicated the scanner and confused users
              who expected scanning to be the only path. Photo preview
              appears here once the scanner has captured + processed. */}
          {scanAllDone && photoUri ? (
            // Scan finished — show captured photo + "rescan" pill.
            <View style={styles.photoArea}>
              <Image source={{ uri: photoUri }} style={styles.photo} />
              <TouchableOpacity
                style={styles.photoChangeBtn}
                onPress={() => {
                  handleResetScan();
                  void handleOpenScanCamera();
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('scan.btn_retake') || 'Переснять'}
              >
                <Camera size={14} color="#FFFFFF" weight="bold" />
                <Text style={styles.photoChangeText}>
                  {t('scan.btn_retake') || 'Переснять'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : scanCaptures.length > 0 ? (
            // AI processing — visible cancel so the user is never stuck.
            <View style={styles.scanProcessing}>
              <ActivityIndicator color={Colors.accent} size="large" />
              <Text style={styles.scanProcessingTitle}>
                {t('scan.processing') || 'AI анализирует...'}
              </Text>
              <Text style={styles.scanProcessingSub}>
                {t('scan.processing_sub') || 'Это займёт до 45 секунд'}
              </Text>
              <TouchableOpacity
                style={styles.scanCancelBtn}
                onPress={handleResetScan}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel') || 'Отмена'}
              >
                <Text style={styles.scanCancelText}>
                  {t('common.cancel') || 'Отмена'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Big primary CTA — the only way to attach a stone photo.
            <TouchableOpacity
              style={styles.scanPrimary}
              onPress={handleOpenScanCamera}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('add.scan_btn') || 'Сканировать камень'}
            >
              <LinearGradient
                colors={['#EEF2FF', '#F5F0FF']}
                style={styles.scanPrimaryInner}
              >
                <View style={styles.photoIconWrap}>
                  <Sparkle size={32} color={Colors.accent} weight="fill" />
                </View>
                <Text style={styles.photoText}>
                  {t('add.scan_btn') || 'Сканировать камень'}
                </Text>
                <Text style={styles.photoSub}>
                  {t('add.scan_btn_sub') || 'Камера сама сделает фото'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Name input */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.stone_name')}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={t('add.name_placeholder')}
                placeholderTextColor={Colors.text2}
                value={name}
                onChangeText={setName}
                maxLength={40}
              />
            </View>
          </View>

          {/* Location */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.location')}</Text>
            <View style={styles.locationCard}>
              <View style={styles.locationIcon}>
                <MapPin size={20} color={Colors.accent} weight="fill" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationName}>
                  {city ?? t('add.detecting_location')}
                </Text>
                {coords ? (
                  <Text style={styles.locationCoords}>
                    {coords.lat.toFixed(4)}° N, {coords.lng.toFixed(4)}° E
                  </Text>
                ) : (
                  <Text style={styles.locationCoords}>{t('add.gps_auto')}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.description')}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                placeholder={t('add.description_placeholder')}
                placeholderTextColor={Colors.text2}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                maxLength={200}
              />
            </View>
          </View>

          {/* Reward hint */}
          <View style={styles.rewardHint}>
            <Sparkle size={16} color={Colors.accent} weight="fill" />
            <Text style={styles.rewardHintText}>
              {t('add.reward_hint')}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom CTA — кнопка ВСЕГДА видна внизу. Activates только когда:
            - скан завершён (photoUri есть)
            - name >= 2 символов
            description опциональный — необязателен. */}
        {/* paddingBottom = inner-tabbar (~70) + safe-area (home indicator).
            Динамически через useSafeAreaInsets — на iPhone с home
            indicator получится ~104, без — ~84. */}
        <View style={[styles.ctaWrap, { paddingBottom: 76 + Math.max(insets.bottom, 14) }]}>
          {(() => {
            const canSave = !!photoUri && name.trim().length >= 2 && !saving;
            return (
              <TouchableOpacity
                style={[styles.saveBtn, !canSave && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!canSave}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('add.save_button')}
                accessibilityState={{ disabled: !canSave, busy: saving }}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>{t('add.save_button')}</Text>
                )}
              </TouchableOpacity>
            );
          })()}
        </View>
      </KeyboardAvoidingView>

      {celebration && <CelebrationOverlay {...celebration} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: {
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

  body: { padding: 20, paddingBottom: 110 },

  // Photo
  photoArea: {
    height: 240,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 22,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoChangeBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(26,26,46,0.75)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  photoChangeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    borderRadius: 22,
  },
  photoIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  photoText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  photoSub: {
    fontSize: 13,
    color: Colors.text2,
  },

  // AI-scanner CTA card (under photo area)
  scanCtaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    borderColor: Colors.accent,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
  },
  scanCtaIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanCtaTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 2,
  },
  scanCtaSub: {
    fontSize: 12,
    color: Colors.text2,
    lineHeight: 16,
  },

  // "AI запомнил" done state
  scanDoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.greenLight,
    borderWidth: 1,
    borderColor: Colors.green,
    borderRadius: 16,
    padding: 14,
    marginTop: 12,
  },
  scanDoneBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanDoneTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 2,
  },
  scanDoneSub: {
    fontSize: 12,
    color: Colors.text2,
    lineHeight: 16,
  },
  scanRetakeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.green,
  },
  scanRetakeText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.green,
  },

  // New scanner-only entry. Replaces the old "take photo" tile.
  scanPrimary: {
    height: 240,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 22,
  },
  scanPrimaryInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    borderRadius: 22,
    paddingHorizontal: 24,
  },

  // Processing state — shows spinner + cancel button so user is never stuck.
  scanProcessing: {
    height: 240,
    borderRadius: 22,
    marginBottom: 22,
    backgroundColor: Colors.accentLight,
    borderWidth: 2,
    borderColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  scanProcessingTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 12,
  },
  scanProcessingSub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
  },
  scanCancelBtn: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scanCancelText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.text,
  },

  section: { marginBottom: 22 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Inputs
  inputWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  input: {
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 12,
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  // Location
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  locationCoords: { fontSize: 12, color: Colors.text2, marginTop: 2 },

  // Reward hint
  rewardHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
  },
  rewardHintText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  rewardHintBold: { fontWeight: '800', color: Colors.accent },

  // CTA — фиксированно внизу. paddingBottom применяется inline через
  // useSafeAreaInsets (см. JSX) — учитывает home indicator + tab bar.
  ctaWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
