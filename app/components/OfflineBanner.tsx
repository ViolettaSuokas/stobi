import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WifiSlash } from 'phosphor-react-native';
import { useIsOnline } from '../lib/network';
import { useI18n } from '../lib/i18n';

/**
 * Плашка "Нет сети" сверху экрана — появляется при потере соединения,
 * скрывается при восстановлении (с fade). Абсолютно позиционирована,
 * поверх всего контента.
 *
 * Рендерить в _layout.tsx один раз рядом со Stack.
 */
export function OfflineBanner() {
  const online = useIsOnline();
  const { t } = useI18n();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: online ? 0 : 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: online ? -60 : 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [online, opacity, translateY]);

  return (
    <Animated.View
      pointerEvents={online ? 'none' : 'box-none'}
      style={[styles.wrap, { opacity, transform: [{ translateY }] }]}
    >
      <SafeAreaView edges={['top']} pointerEvents="box-none">
        <View
          style={styles.banner}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <WifiSlash size={16} color="#FFFFFF" weight="bold" />
          <Text style={styles.text}>{t('network.offline')}</Text>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  text: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
