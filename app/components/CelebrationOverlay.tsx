import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { CheckCircle, ShareNetwork, Sparkle } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from './StoneMascot';
import { useI18n } from '../lib/i18n';
import { ShareTapped } from '../lib/analytics';
import { rewardSocialShare } from '../lib/finds';
import * as haptics from '../lib/haptics';

/**
 * Full-screen celebration оверлей для magic moments — находка камня
 * с конфетти, анимированной +reward цифрой и мескотом в sparkle-режиме.
 *
 * Конфетти — pure RN Animated, без внешних библиотек. 30 частиц с
 * рандомным цветом, начальной позицией сверху, физикой падения.
 */

const SCREEN = Dimensions.get('window');
const CONFETTI_COLORS = [
  '#5B4FF0', '#F0ABFC', '#FCD34D', '#86EFAC',
  '#7DD3FC', '#FCA5A5', '#FDBA74', '#A5B4FC',
];

type ConfettiPiece = {
  color: string;
  startX: number;
  endX: number;
  delay: number;
  rotation: number;
};

const CONFETTI_PIECES: ConfettiPiece[] = Array.from({ length: 36 }).map(() => ({
  color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
  startX: Math.random() * SCREEN.width,
  endX: Math.random() * SCREEN.width,
  delay: Math.random() * 600,
  rotation: Math.random() * 360,
}));

export type CelebrationPayload = {
  visible: boolean;
  title: string;           // e.g. "Поздравляем!"
  reward: number;          // сколько 💎
  balance: number;         // итоговый баланс после
  extraLines?: string[];   // ачивки / триал
  stoneId?: string;        // для share
  stoneName?: string;
  stoneCity?: string;
  onClose: () => void;
};

function ConfettiPiece({ piece }: { piece: ConfettiPiece }) {
  const translateY = useRef(new Animated.Value(-40)).current;
  const translateX = useRef(new Animated.Value(piece.startX)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: SCREEN.height + 40,
        duration: 2400 + piece.delay,
        delay: piece.delay,
        easing: Easing.quad,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: piece.endX,
        duration: 2400 + piece.delay,
        delay: piece.delay,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.timing(rotate, {
          toValue: 1,
          duration: 800,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ]).start();
  }, [translateY, translateX, rotate, piece]);

  const spin = rotate.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        styles.confettiPiece,
        {
          backgroundColor: piece.color,
          transform: [
            { translateX },
            { translateY },
            { rotate: spin },
          ],
        },
      ]}
    />
  );
}

export function CelebrationOverlay({
  visible,
  title,
  reward,
  balance,
  extraLines,
  stoneId,
  stoneName,
  stoneCity,
  onClose,
}: CelebrationPayload) {
  const { t } = useI18n();
  const rewardScale = useRef(new Animated.Value(0)).current;
  const mascotScale = useRef(new Animated.Value(0)).current;
  const [shareBonus, setShareBonus] = useState<{ amount: number; balance: number } | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    if (!visible) return;
    rewardScale.setValue(0);
    mascotScale.setValue(0);
    // Haptics burst в такт анимации: big success на появлении,
    // потом light pops как "confetti" звук через haptics.
    void haptics.success();
    setTimeout(() => void haptics.selection(), 350);
    setTimeout(() => void haptics.selection(), 550);
    setTimeout(() => void haptics.tap(), 750);
    Animated.sequence([
      Animated.timing(mascotScale, {
        toValue: 1,
        duration: 400,
        easing: Easing.elastic(1.2),
        useNativeDriver: true,
      }),
      Animated.timing(rewardScale, {
        toValue: 1,
        duration: 500,
        easing: Easing.elastic(1.4),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, rewardScale, mascotScale]);

  const handleShare = async () => {
    if (!stoneId || sharing) return;
    setSharing(true);
    void ShareTapped('stone', stoneId);
    const url = `https://stobi.app/stone/${stoneId}`;
    const message = t('stone.share_message')
      .replace('{name}', stoneName ?? 'stone')
      .replace('{city}', stoneCity ?? 'Finland');
    try {
      const result = await Share.share({
        message: `${message}\n${url}`,
        url,
        title: t('stone.share_title'),
      });
      // Начисляем bonus только если действительно поделились
      // (не dismiss или cancel — на iOS Share.share возвращает action).
      if (result.action === Share.sharedAction) {
        const bonus = await rewardSocialShare(stoneId);
        if (bonus.rewarded && bonus.amount) {
          setShareBonus({ amount: bonus.amount, balance: bonus.balance });
          void haptics.success();
        }
      }
    } catch (e) {
      console.warn('share failed', e);
    } finally {
      setSharing(false);
    }
  };

  if (!visible) return null;

  return (
    <View style={styles.fill} pointerEvents="auto">
      <LinearGradient
        colors={['#7C3AED', '#5B4FF0', '#4F46E5']}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Confetti layer */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        {CONFETTI_PIECES.map((piece, i) => (
          <ConfettiPiece key={i} piece={piece} />
        ))}
      </View>

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <Animated.View style={{ transform: [{ scale: mascotScale }] }}>
            <StoneMascot size={160} color="#FCD34D" variant="sparkle" showSparkles />
          </Animated.View>

          <Text style={styles.title}>{title}</Text>

          <Animated.View style={[styles.rewardPill, { transform: [{ scale: rewardScale }] }]}>
            <Text style={styles.rewardNumber}>+{reward}</Text>
            <Text style={styles.rewardDiamond}>💎</Text>
          </Animated.View>

          <Text style={styles.balance}>
            {t('celebration.total')}: {balance} 💎
          </Text>

          {extraLines && extraLines.length > 0 && (
            <View style={styles.extras}>
              {extraLines.map((line, i) => (
                <View key={i} style={styles.extraRow}>
                  <CheckCircle size={16} color="#FCD34D" weight="fill" />
                  <Text style={styles.extraText}>{line}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Share-bonus CTA: до шейра — предложение, после — подтверждение. */}
          {stoneId && !shareBonus && (
            <View style={styles.shareBonusCard}>
              <View style={styles.shareBonusBadge}>
                <Sparkle size={14} color="#FFFFFF" weight="fill" />
                <Text style={styles.shareBonusBadgeText}>+5 💎</Text>
              </View>
              <Text style={styles.shareBonusText}>
                {t('celebration.share_offer') || 'Поделись находкой в соцсетях — получи ещё +5 алмазиков'}
              </Text>
            </View>
          )}
          {shareBonus && (
            <View style={styles.shareBonusCard}>
              <View style={[styles.shareBonusBadge, { backgroundColor: Colors.green }]}>
                <CheckCircle size={14} color="#FFFFFF" weight="fill" />
                <Text style={styles.shareBonusBadgeText}>+{shareBonus.amount} 💎</Text>
              </View>
              <Text style={styles.shareBonusText}>
                {t('celebration.share_thanks') || 'Спасибо! Бонус начислен'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.ctaRow}>
          {stoneId && (
            <TouchableOpacity
              style={styles.shareBtn}
              onPress={handleShare}
              activeOpacity={0.85}
              disabled={sharing}
              accessibilityRole="button"
              accessibilityLabel={t('stone.share')}
            >
              <ShareNetwork size={20} color="#FFFFFF" weight="bold" />
              <Text style={styles.shareText}>
                {shareBonus
                  ? (t('celebration.share_again') || 'Поделиться ещё')
                  : `${t('stone.share')} +5 💎`}
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.closeBtn, !stoneId && { flex: 1 }]}
            onPress={onClose}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.closeText}>{t('common.nice')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
  },
  safe: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  rewardPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 12,
    gap: 8,
    borderWidth: 2,
    borderColor: '#FCD34D',
  },
  rewardNumber: {
    fontSize: 44,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  rewardDiamond: {
    fontSize: 36,
  },
  balance: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
    fontWeight: '600',
  },
  extras: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    gap: 8,
  },
  extraRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  extraText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },

  // Share-bonus — "поделись и получи +2 💎" CTA на оверлее
  shareBonusCard: {
    marginTop: 16,
    marginBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  shareBonusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#FCD34D',
  },
  shareBonusBadgeText: {
    color: '#1A1A2E',
    fontSize: 13,
    fontWeight: '800',
  },
  shareBonusText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },

  ctaRow: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 8,
  },
  shareBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 18,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  closeBtn: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 16,
    alignItems: 'center',
  },
  closeText: {
    color: '#4F46E5',
    fontSize: 16,
    fontWeight: '800',
  },
  confettiPiece: {
    position: 'absolute',
    width: 10,
    height: 16,
    borderRadius: 2,
  },
});
