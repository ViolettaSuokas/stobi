import { memo, useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Colors } from '../constants/Colors';

/**
 * Speech bubble облачко для маскота. Появляется с fade+bounce анимацией.
 * Внизу есть треугольный «хвостик» указывающий на маскота.
 *
 * Pattern: Foku, Duolingo, Headspace — mascot speaks to user, creates
 * эмоциональную связь ("оно живое").
 */
type Props = {
  text: string;
  /** 'top' = указывает вниз (bubble над mascot-ом), 'bottom' = указывает вверх */
  tailSide?: 'top' | 'bottom';
  /** Offset тейла от центра, default 0 */
  tailOffset?: number;
  maxWidth?: number;
  style?: ViewStyle;
};

export const SpeechBubble = memo(function SpeechBubble({
  text,
  tailSide = 'bottom',
  tailOffset = 0,
  maxWidth = 260,
  style,
}: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale, text]);

  const tailStyle = tailSide === 'bottom' ? styles.tailBottom : styles.tailTop;

  return (
    <Animated.View
      style={[styles.wrap, { maxWidth, opacity, transform: [{ scale }] }, style]}
      accessibilityRole="text"
    >
      <View style={styles.bubble}>
        <Text style={styles.text}>{text}</Text>
      </View>
      <View style={[tailStyle, { marginLeft: tailOffset }]} />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
  },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
    borderWidth: 1,
    borderColor: 'rgba(91,79,240,0.08)',
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
    lineHeight: 20,
    textAlign: 'center',
  },
  tailBottom: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#FFFFFF',
    marginTop: -1,
  },
  tailTop: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#FFFFFF',
    marginBottom: -1,
  },
});
