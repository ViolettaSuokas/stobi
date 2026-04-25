// "Нашла камень где-то ещё" — find-anywhere flow.
//
// Сценарий: юзер нашёл камень, пришёл домой, открывает app и хочет
// отметить находку без GPS (GPS уже не рядом с камнем). Решение —
// визуальный AI-скан: фото → CLIP embedding → ANN search по базе →
// top-3 кандидата → юзер выбирает правильный → record_find_v2.
//
// Этапы (внутренние state machines):
//   camera    — показываем CTA "Сфотографировать"
//   uploading — processPhoto + uploadToStorage + edge function call
//   picking   — показываем top-3 матча (если top-1 ≥ 0.82 auto-select)
//   confirming — финальный шаг перед markStoneFoundV2
//   success   — celebration
//   failed    — сообщение + retry

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CaretLeft,
  Camera,
  MagnifyingGlass,
  CheckCircle,
  XCircle,
  Sparkle,
  WarningCircle,
} from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from '../components/StoneMascot';
import { ScanProgress } from '../components/ScanProgress';
import { StoneScanCamera } from '../components/StoneScanCamera';
import { CelebrationOverlay } from '../components/CelebrationOverlay';
import {
  processPhoto,
  moderateAndEmbedPhoto,
  uploadPhotoToStorage,
} from '../lib/photo';
import {
  markStoneFoundV2,
  searchStoneByEmbedding,
  type StoneSearchHit,
} from '../lib/finds';
import { requireAuth } from '../lib/auth-gate';
import { getCurrentLocation } from '../lib/location';
import { useModal } from '../lib/modal';
import { useI18n } from '../lib/i18n';
import * as haptics from '../lib/haptics';
import { checkSceneQuality } from '../lib/scan-quality';
import { translateScanError, sceneQualityError, type FriendlyError } from '../lib/scan-errors';

type Phase = 'idle' | 'camera' | 'processing' | 'picking' | 'claiming' | 'success' | 'failed';

type ProcessedScan = {
  photoUrl: string;                 // signed URL для Edge Function (уже uploaded)
  embedding: number[];
  localUri: string;                 // для превью
  hits: StoneSearchHit[];
};

const AUTO_SELECT_THRESHOLD = 0.82;
// Chaos-test против prod (2026-04-22): baseline similarity между произвольными
// CLIP embeddings ≈ 0.69, между семантически близкими фото без общего объекта
// ≈ 0.75-0.79. Старый порог 0.60 пропускал случайный шум как likely_match.
// 0.75 ставим чуть выше baseline, но ниже разумного совпадения.
const LIKELY_MATCH_THRESHOLD = 0.75;

export default function FindAnywhereScreen() {
  const { t } = useI18n();
  const modal = useModal();

  // Стартуем сразу в камере — как и scan-stone: никаких intro-экранов.
  const [phase, setPhase] = useState<Phase>('camera');
  const [processed, setProcessed] = useState<ProcessedScan | null>(null);
  const [selected, setSelected] = useState<StoneSearchHit | null>(null);
  const [claimResult, setClaimResult] = useState<{
    status: 'verified' | 'pending' | 'rejected';
    reason: string;
    reward: number;
    similarity: number | null;
  } | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);
  // Превью последнего снимка — показываем в error view даже когда
  // processing не дошёл до embedding (network fail, edge function 5xx).
  const [lastScanUri, setLastScanUri] = useState<string | null>(null);

  // Guest check — если не авторизован, вернуть обратно.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await requireAuth(t('find_anywhere.auth_reason') || 'отметить находку');
      if (mounted && !ok) router.back();
    })();
    return () => { mounted = false; };
  }, [t]);

  // ─────────────────────────────────────
  // Step 1: Take photo → upload → embed → search
  // ─────────────────────────────────────

  const handleTakePhoto = async () => {
    if (!(await requireAuth(t('find_anywhere.auth_reason') || 'отметить находку'))) return;
    setFriendlyError(null);
    setPhase('camera');
  };

  const handlePickFromLibrary = async () => {
    if (!(await requireAuth(t('find_anywhere.auth_reason') || 'отметить находку'))) return;

    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      modal.show({
        title: 'Нет доступа к фото',
        message: 'Разреши в Настройки → Stobi → Photos.',
        buttons: [{ label: 'OK', style: 'cancel' }],
      });
      return;
    }

    const pick = await ImagePicker.launchImageLibraryAsync({
      quality: 1,
      allowsEditing: false,
    });
    if (pick.canceled || !pick.assets?.[0]) return;

    await processScan(pick.assets[0].uri);
  };

  const processScan = async (rawUri: string) => {
    setPhase('processing');
    setFriendlyError(null);
    setLastScanUri(rawUri);                 // превью на случай ошибки
    try {
      // 0. Client-side quick quality check (стены/темнота/размытость)
      const quality = await checkSceneQuality(rawUri);
      if (quality.reason !== 'ok') {
        setFriendlyError(sceneQualityError(quality.reason));
        setPhase('failed');
        return;
      }

      // 1. Resize + EXIF strip — find proof tier (1024px / 0.55).
      const processedPhoto = await processPhoto(rawUri, 'proof');

      // 2. Upload to Supabase Storage → signed URL
      const { signedUrl } = await uploadPhotoToStorage(processedPhoto.uri, 'find');

      // 3. Edge Function: NSFW + CLIP embedding
      const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
      if (!moderation.safe) {
        setFriendlyError(translateScanError('nsfw', 'find-anywhere'));
        setPhase('failed');
        return;
      }

      // 4. ANN search top-3, с GPS pre-filter — server сравнивает только
      //    с камнями в радиусе 5км от юзера. Это:
      //    - ускоряет поиск (меньше pool)
      //    - убирает false-positive из других городов / стран
      //    - даёт честный distance_m в результатах
      const userLoc = await getCurrentLocation().catch(() => null);
      const hits = await searchStoneByEmbedding(
        moderation.embedding,
        3,
        userLoc?.coords ?? null,
      );
      if (hits.length === 0 || hits[0].similarity < LIKELY_MATCH_THRESHOLD) {
        setProcessed({
          photoUrl: signedUrl,
          embedding: moderation.embedding,
          localUri: processedPhoto.uri,
          hits,
        });
        setFriendlyError(translateScanError('low_similarity', 'find-anywhere'));
        setPhase('failed');
        return;
      }

      setProcessed({
        photoUrl: signedUrl,
        embedding: moderation.embedding,
        localUri: processedPhoto.uri,
        hits,
      });

      // Auto-select если top-1 ≥ 0.82
      if (hits[0].similarity >= AUTO_SELECT_THRESHOLD) {
        setSelected(hits[0]);
      }
      setPhase('picking');
      void haptics.selection();
    } catch (e: any) {
      console.warn('processScan error', e);
      setFriendlyError(translateScanError(e?.message ?? String(e), 'find-anywhere'));
      setPhase('failed');
    }
  };

  // ─────────────────────────────────────
  // Step 2: Confirm & claim
  // ─────────────────────────────────────

  const handleClaim = async () => {
    if (!processed || !selected) return;
    setPhase('claiming');
    setFriendlyError(null);
    try {
      const result = await markStoneFoundV2({
        stoneId: selected.stoneId,
        photoUrl: processed.photoUrl,
        embedding: processed.embedding,
      });
      if (!result.ok) {
        setFriendlyError(translateScanError(result.detail || result.reason, 'find'));
        setPhase('failed');
        return;
      }
      setClaimResult({
        status: result.status,
        reason: result.reason,
        reward: result.reward,
        similarity: result.similarity,
      });
      setPhase('success');
      void haptics.success();
    } catch (e: any) {
      console.warn('handleClaim error', e);
      setFriendlyError(translateScanError(e?.message ?? String(e), 'find'));
      setPhase('failed');
    }
  };

  // ─────────────────────────────────────
  // Render
  // ─────────────────────────────────────

  // Camera mode — полноэкранная live-камера со scan-frame (как на карте
  // при тапе на stone). Стартуем сразу отсюда, без idle-экрана.
  if (phase === 'camera') {
    return (
      <StoneScanCamera
        title={t('scan.title_find')}
        subtitle={t('scan.sub_find')}
        onCapture={async (uri) => {
          await processScan(uri);
        }}
        onCancel={() => router.back()}
        ctaLabel={t('scan.btn_capture')}
      />
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Назад"
          >
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('find_anywhere.title') || 'Нашла камень'}
          </Text>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        {phase === 'idle' && <IdleView onCamera={handleTakePhoto} onLibrary={handlePickFromLibrary} t={t} />}
        {phase === 'processing' && <ProcessingView />}
        {phase === 'picking' && processed && (
          <PickingView
            hits={processed.hits}
            localUri={processed.localUri}
            selected={selected}
            onSelect={setSelected}
            onClaim={handleClaim}
            t={t}
          />
        )}
        {phase === 'claiming' && <ProcessingView label={t('find_anywhere.claiming') || 'Фиксируем находку...'} />}
        {phase === 'success' && claimResult && claimResult.status === 'pending' && (
          <SuccessView
            result={claimResult}
            stoneName={selected?.name}
            onClose={() => router.back()}
            t={t}
          />
        )}
        {phase === 'failed' && (
          <FriendlyFailView
            error={friendlyError ?? translateScanError('unknown', 'find-anywhere')}
            previewUri={processed?.localUri ?? lastScanUri}
            onRetry={() => {
              setPhase('camera');
              setProcessed(null);
              setSelected(null);
              setFriendlyError(null);
              setLastScanUri(null);
            }}
            onBack={() => router.back()}
            t={t}
          />
        )}
      </ScrollView>

      {/* Verified-путь — конфетти-праздник через CelebrationOverlay.
          Pending всё ещё через SuccessView (он подходит — ожидаем автора). */}
      {phase === 'success' && claimResult && claimResult.status === 'verified' && (
        <CelebrationOverlay
          visible={true}
          title={t('stone.congrats') || 'Ты нашла камень!'}
          reward={claimResult.reward}
          balance={0}
          extraLines={
            claimResult.similarity !== null
              ? [`AI similarity: ${Math.round(claimResult.similarity * 100)}%`]
              : []
          }
          stoneName={selected?.name}
          stoneId={selected?.stoneId}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}

// ─────────────────────────────────────
// Views
// ─────────────────────────────────────

type TFn = (k: string) => string;

function IdleView({ onCamera, onLibrary, t }: { onCamera: () => void; onLibrary: () => void; t: TFn }) {
  return (
    <View style={styles.centerBlock}>
      <StoneMascot size={120} color={Colors.mascot} variant="sparkle" showSparkles />

      <Text style={styles.heroTitle}>
        {t('find_anywhere.hero_title') || 'Сфотографируй найденный камень'}
      </Text>
      <Text style={styles.heroSub}>
        {t('find_anywhere.hero_sub') ||
          'AI узнает его среди всех камней Stobi даже если ты уже дома. Не обязательно быть рядом.'}
      </Text>

      <View style={styles.tipsCard}>
        <TipRow
          icon={<Sparkle size={18} color={Colors.accent} weight="fill" />}
          text={t('find_anywhere.tip_1') || 'Снимай при хорошем свете'}
        />
        <TipRow
          icon={<MagnifyingGlass size={18} color={Colors.accent} weight="fill" />}
          text={t('find_anywhere.tip_2') || 'Камень должен занимать большую часть кадра'}
        />
        <TipRow
          icon={<Camera size={18} color={Colors.accent} weight="fill" />}
          text={t('find_anywhere.tip_3') || 'Фокус на рисунок, без бликов'}
        />
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onCamera} activeOpacity={0.85}>
        <Camera size={20} color="#FFFFFF" weight="fill" />
        <Text style={styles.primaryBtnText}>
          {t('find_anywhere.btn_camera') || 'Открыть камеру'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={onLibrary} activeOpacity={0.7}>
        <Text style={styles.secondaryBtnText}>
          {t('find_anywhere.btn_library') || 'Выбрать из галереи'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function ProcessingView({ label }: { label?: string }) {
  return (
    <View style={styles.centerBlock}>
      <View style={{ marginBottom: 20 }}>
        <StoneMascot size={80} color={Colors.mascot} variant="happy" showSparkles />
      </View>
      <ActivityIndicator size="large" color={Colors.accent} />
      <ScanProgress
        visible
        customMessages={label ? [label, label, label, label, label] : undefined}
      />
    </View>
  );
}

function PickingView({
  hits,
  localUri,
  selected,
  onSelect,
  onClaim,
  t,
}: {
  hits: StoneSearchHit[];
  localUri: string;
  selected: StoneSearchHit | null;
  onSelect: (hit: StoneSearchHit) => void;
  onClaim: () => void;
  t: TFn;
}) {
  const top = hits[0];
  const autoMatched = top.similarity >= AUTO_SELECT_THRESHOLD;

  return (
    <View style={styles.pickContainer}>
      <View style={styles.scanPreviewWrap}>
        <Image source={{ uri: localUri }} style={styles.scanPreview} />
        <View style={styles.scanBadge}>
          <Sparkle size={14} color="#FFFFFF" weight="fill" />
          <Text style={styles.scanBadgeText}>AI-скан</Text>
        </View>
      </View>

      <Text style={styles.pickTitle}>
        {autoMatched
          ? (t('find_anywhere.auto_title') || 'Нашли с высокой уверенностью')
          : (t('find_anywhere.pick_title') || 'Похожие камни — выбери свой')}
      </Text>
      <Text style={styles.pickSub}>
        {autoMatched
          ? (t('find_anywhere.auto_sub') || 'Если это не твой, выбери другой вариант ниже')
          : (t('find_anywhere.pick_sub') || 'AI нашёл несколько похожих — выбери тот, что у тебя в руках')}
      </Text>

      {hits.map((hit) => (
        <CandidateCard
          key={hit.stoneId}
          hit={hit}
          selected={selected?.stoneId === hit.stoneId}
          onPress={() => onSelect(hit)}
        />
      ))}

      <TouchableOpacity
        style={[styles.primaryBtn, !selected && styles.primaryBtnDisabled]}
        onPress={onClaim}
        disabled={!selected}
        activeOpacity={0.85}
      >
        <CheckCircle size={20} color="#FFFFFF" weight="fill" />
        <Text style={styles.primaryBtnText}>
          {selected
            ? (t('find_anywhere.btn_claim') || `Это мой камень (${selected.name})`)
            : (t('find_anywhere.btn_select_first') || 'Выбери камень выше')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function CandidateCard({
  hit,
  selected,
  onPress,
}: {
  hit: StoneSearchHit;
  selected: boolean;
  onPress: () => void;
}) {
  const confidence = Math.round(hit.similarity * 100);
  const confidenceColor =
    hit.similarity >= AUTO_SELECT_THRESHOLD
      ? Colors.green
      : hit.similarity >= LIKELY_MATCH_THRESHOLD
        ? Colors.accent
        : Colors.text2;

  return (
    <TouchableOpacity
      style={[styles.candidateCard, selected && styles.candidateCardSelected]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      {hit.photoUrl ? (
        <Image source={{ uri: hit.photoUrl }} style={styles.candidatePhoto} />
      ) : (
        <View style={[styles.candidatePhoto, styles.candidatePhotoFallback]}>
          <Text style={{ fontSize: 28 }}>🪨</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.candidateName} numberOfLines={1}>
          {hit.name}
        </Text>
        <Text style={styles.candidateCity} numberOfLines={1}>
          {hit.city ?? 'Финляндия'}
        </Text>
        <View style={styles.confidenceRow}>
          <View
            style={[
              styles.confidenceDot,
              { backgroundColor: confidenceColor },
            ]}
          />
          <Text style={[styles.confidenceText, { color: confidenceColor }]}>
            {confidence}% совпадение
          </Text>
        </View>
      </View>
      {selected && (
        <CheckCircle size={24} color={Colors.accent} weight="fill" />
      )}
    </TouchableOpacity>
  );
}

function SuccessView({
  result,
  stoneName,
  onClose,
  t,
}: {
  result: { status: 'verified' | 'pending' | 'rejected'; reason: string; reward: number; similarity: number | null };
  stoneName?: string;
  onClose: () => void;
  t: TFn;
}) {
  const verified = result.status === 'verified';
  return (
    <View style={styles.centerBlock}>
      <View style={{ marginBottom: 16 }}>
        <StoneMascot
          size={120}
          color={verified ? Colors.mascot : '#FDE68A'}
          variant={verified ? 'sparkle' : 'happy'}
          showSparkles={verified}
        />
      </View>
      <Text style={styles.successTitle}>
        {verified
          ? (t('find_anywhere.success_title') || 'Находка засчитана!')
          : (t('find_anywhere.pending_title') || 'Ждём подтверждения автора')}
      </Text>
      <Text style={styles.successSub}>
        {verified
          ? (t('find_anywhere.success_sub') || `${stoneName ?? 'Камень'} — твой! +${result.reward} 💎`)
          : (t('find_anywhere.pending_sub') ||
              'AI не на 100% уверен, но похоже на правду. Автор подтвердит в течение 48 часов — алмазики придут тогда.')}
      </Text>
      {result.similarity !== null && (
        <Text style={styles.similarityText}>
          Совпадение: {Math.round(result.similarity * 100)}%
        </Text>
      )}
      <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>
          {t('common.understood') || 'Понятно'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function FriendlyFailView({
  error,
  previewUri,
  onRetry,
  onBack,
  t,
}: {
  error: FriendlyError;
  previewUri: string | null;
  onRetry: () => void;
  onBack: () => void;
  t: TFn;
}) {
  return (
    <View style={styles.centerBlock}>
      {previewUri ? (
        <View style={[styles.scanPreviewWrap, { borderColor: Colors.coral, marginBottom: 20 }]}>
          <Image source={{ uri: previewUri }} style={styles.scanPreview} />
          <View style={[styles.scanBadge, { backgroundColor: Colors.coral, marginLeft: -28 }]}>
            <WarningCircle size={14} color="#FFFFFF" weight="fill" />
            <Text style={styles.scanBadgeText}>Не то</Text>
          </View>
        </View>
      ) : (
        <View style={{ marginBottom: 16 }}>
          <WarningCircle size={80} color={Colors.coral} weight="fill" />
        </View>
      )}

      <Text style={styles.failTitle}>{error.title}</Text>
      <Text style={styles.failSub}>{error.message}</Text>

      {error.tips.length > 0 && (
        <View style={styles.tipsCard}>
          {error.tips.map((tip, i) => (
            <View key={i} style={styles.tipRow}>
              <Text style={styles.tipBullet}>•</Text>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} activeOpacity={0.85}>
        <Camera size={20} color="#FFFFFF" weight="fill" />
        <Text style={styles.primaryBtnText}>
          {t('find_anywhere.btn_retry') || 'Попробовать ещё раз'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.secondaryBtnText}>
          {t('common.back') || 'Назад'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function TipRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.tipRow}>
      {icon}
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

// ─────────────────────────────────────
// Styles
// ─────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18, fontWeight: '800', color: Colors.text,
  },

  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    flexGrow: 1,
  },

  centerBlock: {
    alignItems: 'center',
    paddingTop: 30,
    paddingBottom: 20,
  },

  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  heroSub: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
    paddingHorizontal: 10,
  },

  tipsCard: {
    width: '100%',
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 24,
  },
  tipRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  tipText: {
    flex: 1,
    fontSize: 14,
    color: Colors.text,
    fontWeight: '600',
    lineHeight: 20,
  },
  tipBullet: {
    fontSize: 18,
    color: Colors.accent,
    fontWeight: '800',
    lineHeight: 20,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    width: '100%',
    marginTop: 8,
  },
  primaryBtnDisabled: {
    backgroundColor: Colors.text2,
    opacity: 0.45,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },

  secondaryBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: {
    color: Colors.text2,
    fontWeight: '600',
    fontSize: 14,
  },

  processingLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 20,
    textAlign: 'center',
  },
  processingSub: {
    fontSize: 13,
    color: Colors.text2,
    marginTop: 6,
  },

  // Picking view
  pickContainer: {
    paddingTop: 10,
    gap: 14,
  },
  scanPreviewWrap: {
    alignSelf: 'center',
    width: 180,
    height: 180,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 3,
    borderColor: Colors.accent,
    position: 'relative',
  },
  scanPreview: {
    width: '100%',
    height: '100%',
  },
  scanBadge: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -35,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scanBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  pickTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  pickSub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    marginBottom: 10,
  },

  candidateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 12,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  candidateCardSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
  },
  candidatePhoto: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
  },
  candidatePhotoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  candidateName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.text,
  },
  candidateCity: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 2,
  },
  confidenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  confidenceDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confidenceText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Success
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSub: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
    paddingHorizontal: 10,
  },
  similarityText: {
    fontSize: 12,
    color: Colors.text2,
    marginBottom: 20,
  },

  // Failed
  failTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  failSub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },
});
