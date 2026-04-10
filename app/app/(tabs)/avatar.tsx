import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEffect, useRef } from 'react';
import { Colors } from '../../constants/Colors';

const COLORS = [
  { id: '1', from: '#C4B5FD', to: '#7C6AF5', active: true },
  { id: '2', from: '#F9A8D4', to: '#DB2777' },
  { id: '3', from: '#BBF7D0', to: '#16A34A' },
  { id: '4', from: '#FED7AA', to: '#EA580C' },
  { id: '5', from: '#BFDBFE', to: '#3B82F6' },
  { id: '6', from: '#FDE68A', to: '#EAB308' },
  { id: '7', from: '#A7F3D0', to: '#059669' },
  { id: '8', from: '#FECACA', to: '#DC2626' },
];

const PATTERNS = [
  { emoji: '🌸', locked: false, active: true },
  { emoji: '⭐', locked: false },
  { emoji: '🌊', locked: false },
  { emoji: '🦋', locked: false },
  { emoji: '🌿', locked: false },
  { emoji: '🔮', locked: true },
  { emoji: '🐉', locked: true },
  { emoji: '💎', locked: true },
];

const ACHIEVEMENTS = [
  { emoji: '🥚', label: 'Первый камень', earned: true },
  { emoji: '🔟', label: '10 находок', earned: true },
  { emoji: '🌍', label: 'Путешественник', earned: true },
  { emoji: '🏆', label: '50 находок', earned: false },
  { emoji: '💫', label: 'Художник', earned: false },
  { emoji: '🌟', label: 'Легенда', earned: false },
];

export default function AvatarScreen() {
  const floatAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -10, duration: 1500, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Мой камень</Text>
        <View style={styles.levelChip}>
          <Text style={styles.levelText}>✨ Lv.12</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Stone canvas */}
        <View style={styles.canvasArea}>
          <Animated.View style={[styles.stoneWrap, { transform: [{ translateY: floatAnim }] }]}>
            <View style={styles.stoneBody}>
              <View style={styles.stoneShine} />
              <View style={styles.stoneRing1} />
              <View style={styles.stoneRing2} />
              <Text style={styles.stoneDecor}>🌸</Text>
            </View>
          </Animated.View>
          <View style={styles.shadowEllipse} />

          <View style={styles.levelBadge}>
            <Text style={styles.levelBadgeText}>✨ Level 12</Text>
          </View>

          <View style={styles.xpMini}>
            <View style={styles.xpMiniLabel}>
              <Text style={styles.xpMiniText}>XP: 187/250</Text>
              <Text style={styles.xpMiniText}>→ Level 13</Text>
            </View>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: '75%' }]} />
            </View>
          </View>
        </View>

        <View style={styles.body}>
          {/* Colors */}
          <Text style={styles.sectionTitle}>ЦВЕТ КАМНЯ</Text>
          <View style={styles.colorGrid}>
            {COLORS.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.colorSwatch, c.active && styles.colorSwatchActive]}
                activeOpacity={0.8}
              >
                <View style={[styles.colorInner, { backgroundColor: c.from }]} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Patterns */}
          <Text style={styles.sectionTitle}>УКРАШЕНИЕ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.patternsRow}>
            {PATTERNS.map((p, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.patternCard, p.active && styles.patternCardActive, p.locked && styles.patternCardLocked]}
                activeOpacity={p.locked ? 1 : 0.7}
              >
                <Text style={styles.patternEmoji}>{p.emoji}</Text>
                {p.locked && <Text style={styles.lockIcon}>🔒</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Achievements */}
          <Text style={styles.sectionTitle}>ДОСТИЖЕНИЯ</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.achievementsRow}>
            {ACHIEVEMENTS.map((a, i) => (
              <View key={i} style={styles.achievement}>
                <View style={[styles.achievementIcon, !a.earned && styles.achievementIconLocked]}>
                  <Text style={styles.achievementEmoji}>{a.emoji}</Text>
                </View>
                <Text style={styles.achievementLabel}>{a.label}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Premium */}
          <TouchableOpacity style={styles.premiumCard} activeOpacity={0.85}>
            <Text style={styles.premiumEmoji}>💎</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>Разблокируй Premium</Text>
              <Text style={styles.premiumSub}>Редкие скины и точный радиус · 3,99€/мес</Text>
            </View>
          </TouchableOpacity>

          <View style={{ height: 20 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14,
  },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text },
  levelChip: { backgroundColor: Colors.accentLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  levelText: { fontSize: 13, fontWeight: '700', color: Colors.accent },

  canvasArea: {
    marginHorizontal: 20,
    height: 230,
    backgroundColor: '#EEF2FF',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1, borderColor: '#DDD6FE',
    overflow: 'hidden',
    position: 'relative',
  },
  stoneWrap: { alignItems: 'center' },
  stoneBody: {
    width: 130, height: 130,
    borderRadius: 65,
    backgroundColor: '#7C6AF5',
    alignItems: 'center', justifyContent: 'center',
    position: 'relative',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4,
    shadowRadius: 20,
    elevation: 10,
  },
  stoneShine: {
    position: 'absolute',
    width: 60, height: 50,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.3)',
    top: 18, left: 18,
  },
  stoneRing1: {
    position: 'absolute',
    width: 80, height: 80,
    borderRadius: 40,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  stoneRing2: {
    position: 'absolute',
    width: 110, height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  stoneDecor: { fontSize: 40, zIndex: 1 },
  shadowEllipse: {
    position: 'absolute',
    bottom: 18,
    width: 90, height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(91,79,240,0.2)',
  },
  levelBadge: {
    position: 'absolute',
    top: 14, right: 14,
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  levelBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  xpMini: { position: 'absolute', bottom: 14, left: 14, right: 14 },
  xpMiniLabel: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  xpMiniText: { fontSize: 10, color: Colors.text2 },
  xpTrack: { height: 5, backgroundColor: 'rgba(91,79,240,0.15)', borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 3 },

  body: { padding: 20 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.text2, letterSpacing: 1, marginBottom: 12, marginTop: 20 },

  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: {
    width: 40, height: 40, borderRadius: 12,
    borderWidth: 2, borderColor: 'transparent',
    overflow: 'hidden',
  },
  colorSwatchActive: { borderColor: Colors.accent },
  colorInner: { flex: 1 },

  patternsRow: { marginBottom: 4 },
  patternCard: {
    width: 66, height: 66,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
    position: 'relative',
  },
  patternCardActive: { borderColor: Colors.accent },
  patternCardLocked: { opacity: 0.45 },
  patternEmoji: { fontSize: 30 },
  lockIcon: { position: 'absolute', bottom: 4, right: 4, fontSize: 11 },

  achievementsRow: { marginBottom: 4 },
  achievement: { alignItems: 'center', marginRight: 14, width: 56 },
  achievementIcon: {
    width: 52, height: 52,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  achievementIconLocked: { opacity: 0.4, borderStyle: 'dashed' },
  achievementEmoji: { fontSize: 26 },
  achievementLabel: { fontSize: 10, color: Colors.text2, textAlign: 'center', marginTop: 5, lineHeight: 13 },

  premiumCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.accent,
    borderRadius: 18, padding: 18, marginTop: 24,
  },
  premiumEmoji: { fontSize: 28 },
  premiumTitle: { fontSize: 15, fontWeight: '800', color: '#fff' },
  premiumSub: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: 3 },
});
