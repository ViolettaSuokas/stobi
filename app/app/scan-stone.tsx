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

import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  CaretLeft,
  Camera,
  CheckCircle,
  Sparkle,
  Info,
  WarningCircle,
} from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from '../components/StoneMascot';
import {
  processPhoto,
  moderateAndEmbedPhoto,
  uploadPhotoToStorage,
} from '../lib/photo';
import { markStoneFoundV2 } from '../lib/finds';
import { getCurrentLocation } from '../lib/location';
import { requireAuth } from '../lib/auth-gate';
import { useModal } from '../lib/modal';
import { useI18n } from '../lib/i18n';
import * as haptics from '../lib/haptics';

type Phase = 'idle' | 'scanning' | 'claiming' | 'success' | 'pending' | 'rejected' | 'error';

export default function ScanStoneScreen() {
  const { t } = useI18n();
  const modal = useModal();
  const params = useLocalSearchParams();
  const stoneId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [phase, setPhase] = useState<Phase>('idle');
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: 'verified' | 'pending' | 'rejected';
    reason: string;
    reward: number;
    similarity: number | null;
    balance: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpenCamera = async () => {
    if (!stoneId) return;
    if (!(await requireAuth(t('find_anywhere.auth_reason')))) return;

    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      modal.show({
        title: t('scan.no_permission_title'),
        message: t('scan.no_permission_text'),
        buttons: [{ label: t('common.understood'), style: 'cancel' }],
      });
      return;
    }

    const pick = await ImagePicker.launchCameraAsync({
      quality: 1,
      allowsEditing: false,
    });
    if (pick.canceled || !pick.assets?.[0]) return;

    setPreviewUri(pick.assets[0].uri);
    setPhase('scanning');
    setError(null);

    try {
      // 1. Process (resize, EXIF strip)
      const processed = await processPhoto(pick.assets[0].uri);

      // 2. Upload to storage
      const { signedUrl } = await uploadPhotoToStorage(processed.uri, 'find');

      // 3. NSFW + CLIP embedding
      const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
      if (!moderation.safe) {
        setError(t('find_anywhere.error_nsfw'));
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
        setError(claim.detail || claim.reason);
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
        setPhase('rejected');
      }
    } catch (e: any) {
      console.warn('scan-stone error', e);
      setError(e?.message ?? String(e));
      setPhase('error');
    }
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
        {phase === 'idle' && (
          <View style={styles.centerBlock}>
            <View style={styles.mascotRing}>
              <StoneMascot size={130} color={Colors.mascot} variant="sparkle" showSparkles />
            </View>

            <Text style={styles.heroTitle}>{t('scan.title_find')}</Text>
            <Text style={styles.heroSub}>{t('scan.sub_find')}</Text>

            <View style={styles.tipsCard}>
              <TipRow emoji="💡" text={t('find_anywhere.tip_1')} />
              <TipRow emoji="🔍" text={t('find_anywhere.tip_2')} />
              <TipRow emoji="📸" text={t('find_anywhere.tip_3')} />
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleOpenCamera} activeOpacity={0.85}>
              <Camera size={20} color="#FFFFFF" weight="fill" />
              <Text style={styles.primaryBtnText}>{t('scan.btn_capture')}</Text>
            </TouchableOpacity>
          </View>
        )}

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

        {phase === 'success' && result && (
          <View style={styles.centerBlock}>
            <View style={styles.mascotRing}>
              <StoneMascot size={140} color={Colors.mascot} variant="sparkle" showSparkles />
            </View>
            <Text style={styles.successTitle}>{t('find_anywhere.success_title')}</Text>
            <Text style={styles.successSub}>
              {t('find_anywhere.success_sub')}  +{result.reward} 💎
            </Text>
            {result.similarity !== null && (
              <Text style={styles.similarityText}>
                AI: {Math.round(result.similarity * 100)}%
              </Text>
            )}
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t('common.understood')}</Text>
            </TouchableOpacity>
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

        {phase === 'rejected' && (
          <View style={styles.centerBlock}>
            <View style={{ marginBottom: 16 }}>
              <WarningCircle size={80} color={Colors.coral} weight="fill" />
            </View>
            <Text style={styles.failTitle}>
              {error ?? 'AI не узнал этот камень'}
            </Text>
            <Text style={styles.failSub}>
              {t('find_anywhere.fail_sub')}
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setPhase('idle');
                setPreviewUri(null);
                setError(null);
                setResult(null);
              }}
              activeOpacity={0.85}
            >
              <Camera size={20} color="#FFFFFF" weight="fill" />
              <Text style={styles.primaryBtnText}>{t('find_anywhere.btn_retry')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.back()} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>{t('common.back')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.centerBlock}>
            <WarningCircle size={80} color={Colors.coral} weight="fill" />
            <Text style={styles.failTitle}>{t('find_anywhere.fail_title')}</Text>
            <Text style={styles.failSub}>{error ?? ''}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                setPhase('idle');
                setPreviewUri(null);
                setError(null);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('find_anywhere.btn_retry')}</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  tipRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tipText: { flex: 1, fontSize: 14, color: Colors.text, fontWeight: '600' },

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
