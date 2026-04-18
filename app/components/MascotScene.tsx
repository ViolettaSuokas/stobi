import { memo, useEffect, useRef, useState, useCallback } from 'react';
import { Animated, StyleSheet, View, Text, Easing } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/Colors';
import { StoneMascot, type MascotShape } from './StoneMascot';
import { SpeechBubble } from './SpeechBubble';
import { useI18n } from '../lib/i18n';
import { pickMascotMessage, getGreetingKey, type MascotContext } from '../lib/mascot-messages';
import { getFoundStoneIds, getFindsToday } from '../lib/finds';
import { getTodayChallenge } from '../lib/daily-challenge';
import { checkPremiumStatus } from '../lib/purchases';

/**
 * Сцена с живым маскотом — заменяет плоский рендер StoneMascot на
 * профиле. Включает:
 *   - Изогнутый фон с градиентом (лавандовый → белый)
 *   - Плавающую анимацию маскота (bob up/down 2 сек)
 *   - Sparkle-частицы вокруг (static)
 *   - Мягкая овальная тень снизу
 *   - Speech bubble с контекстным сообщением
 *   - Time-based greeting ("Доброе утро, {name}!")
 *
 * Всё в RN-примитивах без внешних SVG.
 */

type Props = {
  size?: number;
  color?: string;
  shape?: MascotShape;
  decor?: 'none' | 'flower' | 'leaf' | 'cat-ears' | 'glasses' | 'crown';
  /** User-related context (mascot loads activity stats itself) */
  userName?: string | null;
  mascotName?: string | null;
  /** Отключить speech bubble (если маскот в целях customization preview) */
  hideSpeech?: boolean;
};

export const MascotScene = memo(function MascotScene({
  size = 140,
  color,
  shape,
  decor,
  userName,
  mascotName,
  hideSpeech = false,
}: Props) {
  const { t } = useI18n();
  const bob = useRef(new Animated.Value(0)).current;

  // Контекст для выбора сообщения — загружается при focus-е экрана.
  const [activityCtx, setActivityCtx] = useState<{
    streakDays: number;
    findsToday: number;
    totalFinds: number;
    isPremium: boolean;
  }>({ streakDays: 0, findsToday: 0, totalFinds: 0, isPremium: false });

  const loadActivity = useCallback(async () => {
    const [findsTodayVal, foundIds, challenge, premium] = await Promise.all([
      getFindsToday(),
      getFoundStoneIds(),
      getTodayChallenge(),
      checkPremiumStatus(),
    ]);
    setActivityCtx({
      streakDays: challenge.streakCount,
      findsToday: findsTodayVal,
      totalFinds: foundIds.length,
      isPremium: premium,
    });
  }, []);

  useEffect(() => { void loadActivity(); }, [loadActivity]);
  useFocusEffect(useCallback(() => { void loadActivity(); }, [loadActivity]));

  // Bob анимация — лёгкое покачивание ±6px каждые 2.4s
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  const translateY = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -6],
  });

  // Размер shadow сжимается когда маскот "летит" вверх — добавляет 3D-feel
  const shadowScale = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.85],
  });
  const shadowOpacity = bob.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.15],
  });

  // Час — для time-based greeting. Обновляется при focus экрана.
  const [hour, setHour] = useState(new Date().getHours());
  useFocusEffect(useCallback(() => {
    setHour(new Date().getHours());
  }, []));

  const ctx: MascotContext = {
    hour,
    streakDays: activityCtx.streakDays,
    findsToday: activityCtx.findsToday,
    totalFinds: activityCtx.totalFinds,
    userName: userName ?? null,
    mascotName: mascotName ?? null,
    isPremium: activityCtx.isPremium,
  };
  const message = pickMascotMessage(ctx);
  const messageText = t(message.key)
    .replace('{name}', userName ?? '')
    .replace('{mascot}', mascotName ?? t('profile.character_name_default'))
    .replace('{finds}', String(activityCtx.findsToday))
    .replace('{streak}', String(activityCtx.streakDays));

  const greetingText = userName
    ? t(getGreetingKey(hour)).replace('{name}', userName).replace(', !', '!')
    : '';

  return (
    <View style={styles.wrap}>
      {/* Curved gradient background */}
      <LinearGradient
        colors={[Colors.accentLight, 'rgba(240,230,255,0)']}
        style={styles.bgCurve}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Sparkle decorations — static positions around mascot */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.sparkle, { top: 20, left: 30 }]} />
        <View style={[styles.sparkleSmall, { top: 50, right: 40 }]} />
        <View style={[styles.sparkle, { top: 90, right: 20 }]} />
        <View style={[styles.sparkleSmall, { bottom: 70, left: 35 }]} />
        <View style={[styles.sparkleSmall, { bottom: 40, right: 55 }]} />
      </View>

      {/* Greeting */}
      {!hideSpeech && greetingText.trim().length > 0 && (
        <Text style={styles.greeting}>{greetingText}</Text>
      )}

      {/* Speech bubble */}
      {!hideSpeech && (
        <SpeechBubble
          text={messageText}
          tailSide="bottom"
          tailOffset={0}
          maxWidth={Math.max(220, size * 1.6)}
          style={{ marginBottom: 8 }}
        />
      )}

      {/* Mascot + shadow */}
      <View style={styles.mascotStage}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <StoneMascot
            size={size}
            color={color}
            variant={message.variant}
            shape={shape}
            decor={decor}
            showSparkles={false /* свои sparkles из scene */}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.shadow,
            {
              width: size * 0.7,
              transform: [{ scaleX: shadowScale }],
              opacity: shadowOpacity,
            },
          ]}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 8,
    position: 'relative',
  },
  bgCurve: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    borderBottomLeftRadius: 180,
    borderBottomRightRadius: 180,
  },
  greeting: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.accent,
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  mascotStage: {
    alignItems: 'center',
    marginTop: 4,
  },
  shadow: {
    height: 10,
    backgroundColor: '#000000',
    borderRadius: 999,
    marginTop: -8,
    opacity: 0.2,
  },
  sparkle: {
    position: 'absolute',
    width: 6,
    height: 6,
    backgroundColor: '#FCD34D',
    borderRadius: 3,
    transform: [{ rotate: '45deg' }],
  },
  sparkleSmall: {
    position: 'absolute',
    width: 4,
    height: 4,
    backgroundColor: Colors.accent,
    borderRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
});
