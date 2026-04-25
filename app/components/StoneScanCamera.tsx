// StoneScanCamera — live-camera с AR-style overlay для сканирования камня.
//
// UX:
//   - Full-screen preview через expo-camera
//   - В центре — прозрачная квадратная рамка (scan region) со скруглёнными
//     углами, вокруг затемнение overflow'ом (dim corners)
//   - Инструкция сверху: "Поднеси камень в рамку"
//   - Круглая shutter-кнопка внизу
//   - Close ✕ в левом верхнем углу
//
// Используется в:
//   - app/scan-stone.tsx — find flow для конкретного камня
//   - app/(tabs)/add.tsx — hide flow (регистрация эталона)
//   - app/find-anywhere.tsx — find-anywhere (scan → top-3)
//
// Props:
//   title       — текст сверху (по умолчанию берётся из i18n)
//   subtitle    — подпись меньшим шрифтом
//   onCapture(uri) — колбэк после снимка (photo.uri)
//   onCancel()  — юзер нажал крестик

import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Animated,
  Easing,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { X, Camera as CameraIcon } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';

const { width, height } = Dimensions.get('window');
const FRAME_SIZE = Math.min(width, height) * 0.72;
const FRAME_Y = (height - FRAME_SIZE) * 0.36;

type Props = {
  title?: string;
  subtitle?: string;
  onCapture: (uri: string) => void;
  onCancel: () => void;
  ctaLabel?: string;
  /** Для multi-angle потока в hide: "Фото 1 из 2" и подсказка этапа. */
  progress?: { current: number; total: number; stepLabel?: string };
  /**
   * Auto-capture: камера автоматически делает снимок через 2.5 сек после того
   * как preview готов (camera-ready event). Юзер видит short countdown
   * "3...2...1" в области под рамкой и не должен ничего нажимать.
   * Default: true (это сканер, а не ручная фото-кнопка).
   *
   * Manual fallback shutter скрыт по умолчанию когда auto, но появляется
   * через 6 секунд если auto-capture не сработал (sanity escape hatch).
   */
  autoCapture?: boolean;
  /**
   * Статус AI-обработки последнего сделанного снимка (multi-step flow).
   * Камера блокирует следующий countdown пока 'pending', чтобы юзер видел
   * процесс анализа прямо тут, а не на отдельном спиннер-экране после.
   * 'failed' → показываем retry button. 'done'/undefined → нормальный flow.
   */
  analyzing?: 'idle' | 'pending' | 'done' | 'failed';
  /** Подпись для overlay "AI запоминает..." (зависит от шага). */
  analyzingLabel?: string;
  /** Юзер тапнул retry после неудачного анализа — родитель сбрасывает captures. */
  onRetry?: () => void;
};

export function StoneScanCamera({
  title,
  subtitle,
  onCapture,
  onCancel,
  ctaLabel,
  progress,
  autoCapture = true,
  analyzing,
  analyzingLabel,
  onRetry,
}: Props) {
  const { t } = useI18n();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  // Auto-capture countdown: 3 -> 2 -> 1 -> snap. Started после tap "Готов".
  const [countdown, setCountdown] = useState<number | null>(null);
  const [showFallbackShutter, setShowFallbackShutter] = useState(false);
  // Юзер должен тапнуть "Готов" перед каждым шагом — иначе камера сама
  // снимает через 3 сек и не успеваешь поднести камень. Сбрасывается на
  // каждый новый шаг (см. useEffect).
  const [awaitingReady, setAwaitingReady] = useState(true);

  // Animated scan-line bouncing vertically inside frame
  const scanLineY = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineY, {
          toValue: FRAME_SIZE - 8,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanLineY, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [scanLineY]);

  // Auto-request permission on mount
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handleShutter = async () => {
    if (capturing || !cameraRef.current) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        skipProcessing: false,
        exif: false,
      });
      if (photo?.uri) onCapture(photo.uri);
    } catch (e) {
      console.warn('takePictureAsync failed', e);
    } finally {
      setCapturing(false);
    }
  };

  // Auto-capture: после camera-ready event запускаем countdown 3-2-1, потом snap.
  // Юзер ничего не нажимает — камера сама фоткает.
  //
  // Перезапускается на смену шага (progress.current) — чтобы во flow
  // "переверни камень" второй снимок тоже стартанул автоматически. Между
  // шагами даём 1.5с задержку чтобы юзер успел прочитать новую инструкцию
  // перед countdown.
  const stepKey = progress?.current ?? 1;
  // На каждый новый шаг — снова ждём "Готов" от юзера (не само-стрельба).
  useEffect(() => {
    setAwaitingReady(true);
  }, [stepKey]);
  // На сброс analyzing 'failed' → 'idle' (после retry) тоже ждём готовности.
  useEffect(() => {
    if (analyzing === 'idle' || analyzing === 'done') setAwaitingReady(true);
  }, [analyzing]);
  useEffect(() => {
    if (!autoCapture || !cameraReady || capturing) return;
    // Не запускаем countdown следующего шага пока AI ещё думает над предыдущим
    // фото или вернул ошибку — иначе юзер успеет снять обратную сторону до
    // того как первая проанализирована, и UI скачет. Родитель сам инкрементит
    // progress.current когда status='done', тогда useEffect перезапустится.
    if (analyzing === 'pending' || analyzing === 'failed') return;
    // Ждём явный "Готов" — без этого 3-сек countdown стартовал на cameraReady,
    // юзер не успевал поднести камень в кадр.
    if (awaitingReady) return;
    const startDelay = 0;
    setShowFallbackShutter(false);
    const startTick = setTimeout(() => {
      setCountdown(3);
    }, startDelay);
    const tick2 = setTimeout(() => setCountdown(2), startDelay + 1000);
    const tick1 = setTimeout(() => setCountdown(1), startDelay + 2000);
    const snap = setTimeout(() => {
      setCountdown(null);
      void handleShutter();
    }, startDelay + 3000);
    // Sanity escape hatch: если takePictureAsync не вернулся за 6с, показываем
    // ручную shutter-кнопку чтобы юзер мог сам снять или отменить.
    const fallback = setTimeout(() => setShowFallbackShutter(true), startDelay + 6500);
    return () => {
      clearTimeout(startTick);
      clearTimeout(tick2);
      clearTimeout(tick1);
      clearTimeout(snap);
      clearTimeout(fallback);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCapture, cameraReady, stepKey, analyzing, awaitingReady]);

  // Permission states
  if (!permission) {
    return <View style={styles.container} />; // loading
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.permBlock]}>
        <SafeAreaView style={styles.permWrap} edges={['top']}>
          <TouchableOpacity style={styles.closeBtn} onPress={onCancel}>
            <X size={24} color="#FFFFFF" weight="bold" />
          </TouchableOpacity>
          <View style={styles.permCard}>
            <Text style={styles.permTitle}>
              {t('scan.no_permission_title') || 'Нужен доступ к камере'}
            </Text>
            <Text style={styles.permText}>
              {t('scan.no_permission_text') || 'Разреши в Настройки → Stobi → Camera'}
            </Text>
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>{t('common.understood') || 'OK'}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        autofocus="on"
        onCameraReady={() => setCameraReady(true)}
      />

      {/* Overlay layer with scan frame */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top instruction */}
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onCancel}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back') || 'Back'}
          >
            <X size={22} color="#FFFFFF" weight="bold" />
          </TouchableOpacity>

          <View style={styles.instructionCard}>
            {progress && progress.total > 1 && (
              <View style={styles.progressWrap}>
                <View style={styles.progressPips}>
                  {Array.from({ length: progress.total }).map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.progressPip,
                        i < progress.current - 1 && styles.progressPipDone,
                        i === progress.current - 1 && styles.progressPipActive,
                      ]}
                    />
                  ))}
                </View>
                <Text style={styles.progressText}>
                  {progress.stepLabel ?? `Фото ${progress.current} из ${progress.total}`}
                </Text>
              </View>
            )}
            <Text style={styles.instructionTitle}>
              {title ?? t('scan.title_find') ?? 'Поднеси камень к камере'}
            </Text>
            {subtitle !== '' && (
              <Text style={styles.instructionSub}>
                {subtitle ?? t('scan.sub_find') ?? 'AI проверит что это тот самый'}
              </Text>
            )}
          </View>
        </SafeAreaView>

        {/* Darkened mask with transparent frame in center.
            Achieved via four positioned overlays (top/bottom/left/right of frame)
            since react-native не умеет inverse clip-path без SVG masks. */}
        <View style={styles.maskTop} />
        <View style={styles.maskBottom} />
        <View style={styles.maskLeft} />
        <View style={styles.maskRight} />

        {/* Frame with corners */}
        <View style={styles.frame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />

          {/* Scan line */}
          <Animated.View
            style={[
              styles.scanLine,
              { transform: [{ translateY: scanLineY }] },
            ]}
          />
        </View>

        {/* Bottom bar: AI overlay (analyzing/failed) > countdown > shutter. */}
        <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
          {analyzing === 'pending' ? (
            // AI анализирует только что сделанный снимок — большая кнопка
            // со спиннером + явный label. Countdown следующего шага залочен
            // (см. useEffect выше) пока сюда не придёт 'done'.
            <View style={styles.countdownRing}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          ) : analyzing === 'failed' ? (
            // AI/upload упал → юзер не должен залипать. Кнопка retry и крест.
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={onRetry}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('scan.btn_retry_scan') || 'Попробовать заново'}
            >
              <Text style={styles.retryBtnText}>
                {t('scan.btn_retry_scan') || 'Попробовать заново'}
              </Text>
            </TouchableOpacity>
          ) : autoCapture && awaitingReady && cameraReady ? (
            // Юзер должен подтвердить готовность к снимку — иначе раньше
            // countdown стартовал на cameraReady, не успевал поднести камень.
            <TouchableOpacity
              style={styles.retryBtn}
              onPress={() => setAwaitingReady(false)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('scan.btn_ready') || 'Готов!'}
            >
              <Text style={styles.retryBtnText}>
                {t('scan.btn_ready') || 'Готов!'}
              </Text>
            </TouchableOpacity>
          ) : autoCapture && countdown !== null ? (
            <View style={styles.countdownRing}>
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          ) : autoCapture && capturing ? (
            <View style={styles.countdownRing}>
              <ActivityIndicator color="#FFFFFF" size="large" />
            </View>
          ) : (autoCapture && !showFallbackShutter && cameraReady) ? (
            <View style={[styles.countdownRing, { opacity: 0.4 }]} />
          ) : (
            <TouchableOpacity
              style={[styles.shutter, capturing && styles.shutterBusy]}
              onPress={handleShutter}
              disabled={capturing}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={ctaLabel ?? t('scan.btn_capture') ?? 'Scan'}
            >
              <View style={styles.shutterInner}>
                <CameraIcon size={28} color="#1A1A2E" weight="fill" />
              </View>
            </TouchableOpacity>
          )}
          <Text style={styles.shutterHint}>
            {analyzing === 'pending'
              ? (analyzingLabel || t('scan.analyzing') || 'AI запоминает рисунок…')
              : analyzing === 'failed'
                ? (t('scan.failed_title') || 'Не удалось обработать')
                : awaitingReady && autoCapture && cameraReady
                  // Подсказка перед "Готов" — что именно должен показать.
                  ? (subtitle ? `Поднеси: ${subtitle}` : (t('scan.hold_steady') || 'Поднеси камень'))
                  : capturing
                    ? (t('scan.processing') || 'Снимаю…')
                    : (autoCapture && countdown !== null)
                      ? (t('scan.hold_steady') || 'Держи камень в рамке')
                      : (ctaLabel ?? t('scan.btn_capture') ?? 'Сканировать')}
          </Text>
        </SafeAreaView>
      </View>
    </View>
  );
}

// ─────────────────────────────────
// Styles
// ─────────────────────────────────
const FRAME_LEFT = (width - FRAME_SIZE) / 2;
const FRAME_RIGHT = FRAME_LEFT + FRAME_SIZE;
const FRAME_BOTTOM = FRAME_Y + FRAME_SIZE;

const MASK_COLOR = 'rgba(18, 16, 39, 0.72)';
const ACCENT = Colors.accent;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },

  // Permission screen (when denied)
  permBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  permWrap: {
    flex: 1,
    width: '100%',
  },
  permCard: {
    marginHorizontal: 24,
    marginTop: 80,
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 20,
  },
  permTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  permText: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  permBtn: {
    backgroundColor: ACCENT,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  permBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },

  // Top bar
  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  closeBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  instructionCard: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignSelf: 'center',
    maxWidth: '92%',
  },
  progressWrap: {
    alignItems: 'center',
    marginBottom: 8,
  },
  progressPips: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  progressPip: {
    width: 22,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  progressPipActive: {
    backgroundColor: ACCENT,
  },
  progressPipDone: {
    backgroundColor: '#FFFFFF',
  },
  progressText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  instructionTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  instructionSub: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },

  // Darken masks (4 pieces around frame)
  maskTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: FRAME_Y,
    backgroundColor: MASK_COLOR,
  },
  maskBottom: {
    position: 'absolute',
    top: FRAME_BOTTOM,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: MASK_COLOR,
  },
  maskLeft: {
    position: 'absolute',
    top: FRAME_Y,
    left: 0,
    width: FRAME_LEFT,
    height: FRAME_SIZE,
    backgroundColor: MASK_COLOR,
  },
  maskRight: {
    position: 'absolute',
    top: FRAME_Y,
    left: FRAME_RIGHT,
    right: 0,
    height: FRAME_SIZE,
    backgroundColor: MASK_COLOR,
  },

  // Frame
  frame: {
    position: 'absolute',
    top: FRAME_Y,
    left: FRAME_LEFT,
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    overflow: 'hidden',
  },
  corner: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderColor: ACCENT,
  },
  cornerTL: {
    top: 0, left: 0,
    borderTopWidth: 4, borderLeftWidth: 4,
    borderTopLeftRadius: 18,
  },
  cornerTR: {
    top: 0, right: 0,
    borderTopWidth: 4, borderRightWidth: 4,
    borderTopRightRadius: 18,
  },
  cornerBL: {
    bottom: 0, left: 0,
    borderBottomWidth: 4, borderLeftWidth: 4,
    borderBottomLeftRadius: 18,
  },
  cornerBR: {
    bottom: 0, right: 0,
    borderBottomWidth: 4, borderRightWidth: 4,
    borderBottomRightRadius: 18,
  },
  scanLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 3,
    borderRadius: 2,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },

  // Bottom shutter bar
  bottomBar: {
    position: 'absolute',
    left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    paddingBottom: 16,
    paddingTop: 16,
    gap: 10,
  },
  shutter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },
  shutterBusy: {
    opacity: 0.5,
  },
  countdownRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.95)',
    backgroundColor: 'rgba(91,79,240,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },
  countdownText: {
    color: '#FFFFFF',
    fontSize: 44,
    fontWeight: '900',
    textAlign: 'center',
  },
  shutterInner: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterHint: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  retryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 16,
    borderRadius: 28,
    backgroundColor: ACCENT,
    minWidth: 240,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
});
