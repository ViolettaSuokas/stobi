import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { Redirect } from 'expo-router';
import { Colors } from '../constants/Colors';
import { hasSeenOnboarding, getCurrentUser } from '../lib/auth';
import { StoneMascot, type MascotVariant } from '../components/StoneMascot';

type Destination = '/onboarding' | '/(tabs)/map';

// Cycled palette while the splash is showing.
// Lavender first → matches the static OS splash → smooth transition.
const SPLASH_COLORS = [
  '#C4B5FD', // lavender (default — start here)
  '#A5B4FC', // periwinkle
  '#F0ABFC', // pink
  '#FCA5A5', // coral
  '#FCD34D', // amber
  '#86EFAC', // mint
  '#7DD3FC', // sky
  '#FDBA74', // peach
];

const SPLASH_VARIANTS: MascotVariant[] = [
  'happy',
  'wink',
  'happy',
  'sparkle',
  'sleeping',
];

// Make sure the user sees the animation even if data loads instantly
const SPLASH_MIN_DURATION = 2600;
const COLOR_INTERVAL = 500;
const VARIANT_INTERVAL = 750;

export default function Index() {
  const [destination, setDestination] = useState<Destination | null>(null);
  const [colorIdx, setColorIdx] = useState(0);
  const [variantIdx, setVariantIdx] = useState(0);

  // Cycle through colors
  useEffect(() => {
    const id = setInterval(() => {
      setColorIdx((i) => (i + 1) % SPLASH_COLORS.length);
    }, COLOR_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Cycle through face variants (slightly slower than colors)
  useEffect(() => {
    const id = setInterval(() => {
      setVariantIdx((i) => (i + 1) % SPLASH_VARIANTS.length);
    }, VARIANT_INTERVAL);
    return () => clearInterval(id);
  }, []);

  // Resolve destination + enforce minimum splash duration.
  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    (async () => {
      // Маршрутизация на старте:
      //  - залогинен → сразу /map
      //  - не залогинен → /onboarding (там есть Skip если seen=true)
      // Раньше: если seen → /map даже без auth → юзер удалил аккаунт, в
      // следующий запуск попадал на карту минуя регистрацию.
      let dest: Destination = '/onboarding';
      try {
        const user = await getCurrentUser();
        if (user) {
          dest = '/(tabs)/map';
        } else {
          // Always onboarding for non-auth — Skip кнопка покажется только
          // тем кто уже видел онбординг раньше (см. seenBefore в onboarding.tsx).
          dest = '/onboarding';
        }
      } catch {
        // Network issue — на /onboarding и пусть юзер залогинится оттуда.
      }

      const elapsed = Date.now() - start;
      const wait = Math.max(0, SPLASH_MIN_DURATION - elapsed);
      setTimeout(() => {
        if (!cancelled) setDestination(dest);
      }, wait);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!destination) {
    return (
      <View style={styles.splash}>
        <StatusBar barStyle="dark-content" />

        {/* Soft purple glow behind mascot — matches the static OS splash */}
        <View style={styles.glow} />

        <View style={styles.content}>
          <View style={styles.mascotWrap}>
            <StoneMascot
              size={220}
              color={SPLASH_COLORS[colorIdx]}
              variant={SPLASH_VARIANTS[variantIdx]}
              showSparkles
            />
          </View>

          <Text style={styles.brand}>Stobi</Text>
        </View>
      </View>
    );
  }

  return <Redirect href={destination} />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 600,
    height: 600,
    borderRadius: 300,
    backgroundColor: '#A78BFA',
    opacity: 0.18,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mascotWrap: {
    width: 260,
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  brand: {
    fontSize: 56,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1.5,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(91,79,240,0.25)',
  },
  dotActive: {
    backgroundColor: Colors.accent,
    width: 24,
  },
});
