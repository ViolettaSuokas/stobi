import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/Colors';

type Props = {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: ViewStyle;
};

/**
 * Skeleton placeholder с shimmer-эффектом — скользящий градиент слева
 * направо по базовой плашке. Ощущается активнее, чем просто opacity fade.
 *
 * Реализация: base-плашка (серый прямоугольник) + абсолютный
 * LinearGradient который ездит по translateX от -1.5× до +1.5× ширины.
 */
export function Skeleton({ width, height, borderRadius = 8, style }: Props) {
  const translate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(translate, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [translate]);

  // Если width числовой — двигаем в пределах [-2*width, +2*width]
  const parsedWidth = typeof width === 'number' ? width : 200;
  const translateX = translate.interpolate({
    inputRange: [0, 1],
    outputRange: [-parsedWidth * 1.5, parsedWidth * 1.5],
  });

  return (
    <View
      style={[
        styles.base,
        { width: width as any, height, borderRadius, overflow: 'hidden' },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { transform: [{ translateX }] },
        ]}
      >
        <LinearGradient
          colors={[
            'rgba(255,255,255,0)',
            'rgba(255,255,255,0.6)',
            'rgba(255,255,255,0)',
          ]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
    </View>
  );
}

export function SkeletonRow({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={40} height={40} borderRadius={20} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="90%" height={12} />
          </View>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.surface2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
});
