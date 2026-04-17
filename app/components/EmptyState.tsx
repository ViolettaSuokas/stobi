import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from './StoneMascot';

/**
 * Пустое состояние — когда список ещё без данных.
 *
 * Дизайн: мескот + заголовок + подсказка + опциональная CTA.
 * Используется на map/chat/profile/achievements вместо просто
 * blank space (было: пользователь видит серую пустоту и не понимает
 * что делать дальше).
 */
export type EmptyStateProps = {
  title: string;
  subtitle?: string;
  mascotVariant?: 'happy' | 'sleeping' | 'wink' | 'sparkle';
  mascotColor?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
  compact?: boolean;
};

export function EmptyState({
  title,
  subtitle,
  mascotVariant = 'happy',
  mascotColor = Colors.accentLight,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <View
      style={[styles.container, compact && styles.containerCompact]}
      accessibilityRole="text"
    >
      <StoneMascot
        size={compact ? 72 : 120}
        color={mascotColor}
        variant={mascotVariant}
      />
      <Text style={[styles.title, compact && styles.titleCompact]}>
        {title}
      </Text>
      {subtitle && (
        <Text style={[styles.subtitle, compact && styles.subtitleCompact]}>
          {subtitle}
        </Text>
      )}
      {action && (
        <TouchableOpacity
          style={styles.cta}
          onPress={action.onPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.ctaText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 16,
  },
  containerCompact: {
    paddingVertical: 24,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginTop: 8,
  },
  titleCompact: { fontSize: 16 },
  subtitle: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  subtitleCompact: { fontSize: 13 },
  cta: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 24,
    marginTop: 8,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
