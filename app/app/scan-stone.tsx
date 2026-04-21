// Scan-stone screen — AI-first find flow для конкретного камня.
//
// Открывается при тапе на маркер камня на карте:
//   Map tap → router.push(`/scan-stone?id=<stoneId>`) → эта страница
//   сразу показывает "Поднеси камень к камере" + открывает камеру.
//
// В отличие от find-anywhere (top-3 search), здесь stoneId уже известен
// — просто подтверждаем через AI + GPS что это тот самый.
//
// States: idle → scanning → claiming → success | pending | rejected

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
import { router, useLocalSearchParams } from 'expo-router';
import {
  CaretLeft,
  Camera,
  Sparkle,
  Info,
  WarningCircle,
} from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from '../components/StoneMascot';
import { StoneScanCamera } from '../components/StoneScanCamera';
import { CelebrationOverlay, type CelebrationPayload } from '../components/CelebrationOverlay';
import {
  processPhoto,
  moderateAndEmbedPhoto,
  uploadPhotoToStorage,
} from '../lib/photo';
import { markStoneFoundV2 } from '../lib/finds';
import { getCurrentLocation } from '../lib/location';
import { requireAuth } from '../lib/auth-gate';
import { useI18n } from '../lib/i18n';
import * as haptics from '../lib/haptics';
import { checkSceneQuality } from '../lib/scan-quality';
import { translateScanError, sceneQualityError, type FriendlyError } from '../lib/scan-errors';

type Phase = 'camera' | 'scanning' | 'claiming' | 'success' | 'pending' | 'rejected' | 'error';

export default function ScanStoneScreen() {
  const { t } = useI18n();
  const params = useLocalSearchParams();
  const stoneId = Array.isArray(params.id) ? params.id[0] : params.id;

  // Стартуем сразу в камере — никаких дополнительных экранов.
  const [phase, setPhase] = useState<Phase>('camera');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: 'verified' | 'pending' | 'rejected';
    reason: string;
    reward: number;
    similarity: number | null;
    balance: number | null;
  } | null>(null);
  const [friendlyError, setFriendlyError] = useState<FriendlyError | null>(null);

  // Auth gate (one-shot на mount). Если guest — router.back + модалка.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const ok = await requireAuth(t('find_anywhere.auth_reason'));
      if (mounted && !ok) router.back();
    })();
    return () => { mounted = false; };
  }, [t]);

  const handleCapture = async (uri: string) => {
    if (!stoneId) return;

    setPreviewUri(uri);
    setPhase('scanning');
    setFriendlyError(null);

    try {
      // 0. Client-side quick quality check — отсекаем явные стены/темноту
      //    до того как потратим серверные вызовы.
      const quality = await checkSceneQuality(uri);
      if (quality.reason !== 'ok') {
        setFriendlyError(sceneQualityError(quality.reason));
        setPhase('rejected');
        return;
      }

      // 1. Process (resize, EXIF strip)
      const processed = await processPhoto(uri);

      // 2. Upload to storage
      const { signedUrl } = await uploadPhotoToStorage(processed.uri, 'find');

      // 3. NSFW + CLIP embedding
      const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
      if (!moderation.safe) {
        setFriendlyError(translateScanError('nsfw'));
        setPhase('rejected');
        return;
      }

      // 4. Try to include GPS (non-blocking — для boost'а similarity threshold)
      let gps: { lat: number; lng: number } | null = null;
      try {
        const loc = await getCurrentLocation();
        if (loc) gps = loc.coords;
      } catch {
        // GPS недоступен — не проблема, AI решит
      }

      setPhase('claiming');
      const claim = await markStoneFoundV2({
        stoneId,
        photoUrl: signedUrl,
        embedding: moderation.embedding,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
      });

      if (!claim.ok) {
        setFriendlyError(translateScanError(claim.detail || claim.reason));
        setPhase('error');
        return;
      }

      setResult({
        status: claim.status,
        reason: claim.reason,
        reward: claim.reward,
        similarity: claim.similarity,
        balance: claim.balance,
      });

      if (claim.status === 'verified') {
        setPhase('success');
        void haptics.success();
      } else if (claim.status === 'pending') {
        setPhase('pending');
      } else {
        // RPC вернул rejected — скорее всего low_similarity
        setFriendlyError(translateScanError(claim.reason, 'find'));
        setPhase('rejected');
      }
    } catch (e: any) {
      console.warn('scan-stone error', e);
      setFriendlyError(translateScanError(e?.message ?? String(e), 'find'));
      setPhase('error');
    }
  };

  const handleRetry = () => {
    setPhase('camera');
    setPreviewUri(null);
    setFriendlyError(null);
    setResult(null);
  };

  // ─────────────────────────────────
  // Render
  // ─────────────────────────────────

  if (!stoneId) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.errorText}>Stone ID missing</Text>
      </View>
    );
  }

  // Camera mode — live-preview со сканер-рамкой
  if (phase === 'camera') {
    return (
      <StoneScanCamera
        title={t('scan.title_find')}
        subtitle={t('scan.sub_find')}
        onCapture={handleCapture}
        onCancel={() => router.back()}
        ctaLabel={t('scan.btn_capture')}
      />
    );
  }

  // Результаты — обычный экран с хедером и контентом
  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('scan.title_find')}</Text>
          <TouchableOpacity
            onPress={() => router.replace(`/stone/${stoneId}` as any)}
            style={styles.backBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.info') || 'Подробнее'}
          >
            <Info size={22} color={Colors.text2} weight="regular" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerStyle={styles.scroll}>
        {(phase === 'scanning' || phase === 'claiming') && (
          <View style={styles.centerBlock}>
            {previewUri && (
              <View style={styles.scanPreviewWrap}>
                <Image source={{ uri: previewUri }} style={styles.scanPreview} />
                <View style={styles.scanBadge}>
                  <Sparkle size={14} color="#FFFFFF" weight="fill" />
                  <Text style={styles.scanBadgeText}>AI</Text>
                </View>
              </View>
            )}
            <ActivityIndicator size="large" color={Colors.accent} style={{ marginTop: 20 }} />
            <Text style={styles.processingLabel}>
              {phase === 'scanning'
                ? t('scan.processing')
                : t('find_anywhere.claiming')}
            </Text>
          </View>
        )}

        {phase === 'pending' && result && (
          <View style={styles.centerBlock}>
            <View style={{ marginBottom: 16 }}>
              <StoneMascot size={130} color="#FDE68A" variant="happy" showSparkles={false} />
            </View>
            <Text style={styles.successTitle}>{t('find_anywhere.pending_title')}</Text>
            <Text style={styles.successSub}>{t('find_anywhere.pending_sub')}</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t('common.understood')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {(phase === 'rejected' || phase === 'error') && (
          <FriendlyErrorView
            error={friendlyError ?? translateScanError('unknown', 'find')}
            previewUri={previewUri}
            onRetry={handleRetry}
            onBack={() => router.back()}
            t={t}
          />
        )}
      </ScrollView>

      {/* Celebration — конфетти, маскот, haptics — полноэкранный overlay
          когда AI подтвердил находку. */}
      {phase === 'success' && result && (
        <CelebrationOverlay
          visible={true}
          title={t('stone.congrats') || 'Ты нашёл камень!'}
          reward={result.reward}
          balance={result.balance ?? 0}
          extraLines={
            result.similarity !== null
              ? [`AI similarity: ${Math.round(result.similarity * 100)}%`]
              : []
          }
          stoneId={stoneId}
          onClose={() => router.back()}
        />
      )}
    </View>
  );
}

function TipRow({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.tipRow}>
      <Text style={{ fontSize: 18 }}>{emoji}</Text>
      <Text style={styles.tipText}>{text}</Text>
    </View>
  );
}

function FriendlyErrorView({
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
  t: (k: string) => string;
}) {
  return (
    <View style={styles.centerBlock}>
      {previewUri && (
        <View style={[styles.scanPreviewWrap, { borderColor: Colors.coral, marginBottom: 20 }]}>
          <Image source={{ uri: previewUri }} style={styles.scanPreview} />
          <View style={[styles.scanBadge, { backgroundColor: Colors.coral, marginLeft: -28 }]}>
            <WarningCircle size={14} color="#FFFFFF" weight="fill" />
            <Text style={styles.scanBadgeText}>Не то</Text>
          </View>
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
        <Text style={styles.primaryBtnText}>{t('find_anywhere.btn_retry')}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.secondaryBtn} onPress={onBack} activeOpacity={0.7}>
        <Text style={styles.secondaryBtnText}>{t('common.back')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─────────────────────────────────
// Styles
// ─────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },

  scroll: { paddingHorizontal: 20, paddingBottom: 40, flexGrow: 1 },

  centerBlock: { alignItems: 'center', paddingTop: 24, paddingBottom: 20 },

  mascotRing: {
    padding: 20,
    borderRadius: 80,
    backgroundColor: Colors.accentLight,
    marginBottom: 16,
  },

  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  heroSub: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
    paddingHorizontal: 20,
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
  tipRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  tipText: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '600', lineHeight: 20 },
  tipBullet: { fontSize: 18, color: Colors.accent, fontWeight: '800', lineHeight: 20 },

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
  primaryBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },

  secondaryBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  secondaryBtnText: { color: Colors.text2, fontWeight: '600', fontSize: 14 },

  // Preview during scanning
  scanPreviewWrap: {
    width: 200,
    height: 200,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: Colors.accent,
    position: 'relative',
  },
  scanPreview: { width: '100%', height: '100%' },
  scanBadge: {
    position: 'absolute',
    bottom: 8,
    left: '50%',
    marginLeft: -24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  scanBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },

  processingLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginTop: 16,
    textAlign: 'center',
  },

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
    marginBottom: 12,
    paddingHorizontal: 10,
  },
  similarityText: {
    fontSize: 12,
    color: Colors.text2,
    marginBottom: 20,
  },

  failTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  failSub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
    paddingHorizontal: 10,
  },

  errorText: {
    fontSize: 14,
    color: Colors.coral,
  },
});
