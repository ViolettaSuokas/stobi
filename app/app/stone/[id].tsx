import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Colors } from '../../constants/Colors';

const JOURNEY = [
  { icon: '🙈', action: 'Спрятан — Maija', meta: '28 марта · Tikkurila park', type: 'hide' },
  { icon: '👀', action: 'Найден — Aleksi K.', meta: '30 марта · 200м отсюда', type: 'find' },
  { icon: '📌', action: 'Спрятан снова — Aleksi', meta: '2 апреля · Сейчас здесь', type: 'hide2' },
];

export default function StoneDetailScreen() {
  const { id } = useLocalSearchParams();

  return (
    <View style={styles.container}>
      {/* Hero image */}
      <View style={styles.heroArea}>
        <View style={styles.heroGrad}>
          <Text style={styles.heroEmoji}>🌸</Text>
        </View>
        <SafeAreaView style={styles.heroButtons} edges={['top']}>
          <TouchableOpacity style={styles.heroBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-down" size={22} color={Colors.text} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.heroBtn}>
            <Ionicons name="share-outline" size={22} color={Colors.text} />
          </TouchableOpacity>
        </SafeAreaView>
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        <Text style={styles.stoneName}>Весенняя сакура</Text>
        <View style={styles.metaRow}>
          <Ionicons name="location-outline" size={13} color={Colors.accent2} />
          <Text style={styles.metaText}>Tikkurila park · 320м от вас</Text>
          <View style={styles.foundBadge}>
            <Text style={styles.foundBadgeText}>Найден 3 раза</Text>
          </View>
        </View>

        {/* Artist */}
        <TouchableOpacity style={styles.artistCard} activeOpacity={0.8}>
          <View style={styles.artistAvatar}>
            <Text style={{ fontSize: 22 }}>🎨</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.artistName}>Maija Korhonen</Text>
            <Text style={styles.artistSub}>47 расписных камней</Text>
          </View>
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedText}>✓ Verified</Text>
          </View>
        </TouchableOpacity>

        {/* Journey */}
        <Text style={styles.sectionTitle}>ПУТЕШЕСТВИЕ КАМНЯ</Text>
        {JOURNEY.map((step, i) => (
          <View key={i} style={styles.journeyStep}>
            <View style={[
              styles.journeyDot,
              step.type === 'find' && styles.journeyDotFind,
              step.type === 'hide2' && styles.journeyDotHide2,
            ]}>
              <Text>{step.icon}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.journeyAction}>{step.action}</Text>
              <Text style={styles.journeyMeta}>{step.meta}</Text>
            </View>
            {i < JOURNEY.length - 1 && <View style={styles.journeyLine} />}
          </View>
        ))}

        {/* Tags */}
        <View style={styles.tagsRow}>
          {['🌸 Природа', '🎨 Акварель', '⭐ Избранное'].map(tag => (
            <View key={tag} style={styles.tag}>
              <Text style={styles.tagText}>{tag}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity
          style={styles.findBtn}
          activeOpacity={0.85}
          onPress={() => Alert.alert('🎉 Отлично!', 'Ты нашёл этот камень! +15 XP')}
        >
          <Text style={styles.findBtnText}>🎉 Я нашёл этот камень!</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  heroArea: { height: 280, position: 'relative' },
  heroGrad: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.accentLight,
    alignItems: 'center', justifyContent: 'center',
  },
  heroEmoji: { fontSize: 100 },
  heroButtons: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  heroBtn: {
    width: 42, height: 42,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },

  body: { flex: 1, padding: 20 },
  stoneName: { fontSize: 24, fontWeight: '800', color: Colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, marginBottom: 18 },
  metaText: { fontSize: 13, color: Colors.text2, flex: 1 },
  foundBadge: { backgroundColor: Colors.greenLight, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  foundBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.green },

  artistCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 24,
  },
  artistAvatar: {
    width: 44, height: 44,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  artistName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  artistSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  verifiedBadge: { backgroundColor: Colors.accent, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  verifiedText: { color: '#fff', fontSize: 11, fontWeight: '700' },

  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.text2, letterSpacing: 1, marginBottom: 14 },

  journeyStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16, position: 'relative' },
  journeyDot: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  journeyDotFind: { backgroundColor: Colors.greenLight },
  journeyDotHide2: { backgroundColor: Colors.orangeLight },
  journeyLine: {
    position: 'absolute', left: 17, top: 40,
    width: 2, height: 14,
    backgroundColor: Colors.border,
  },
  journeyAction: { fontSize: 14, fontWeight: '600', color: Colors.text },
  journeyMeta: { fontSize: 12, color: Colors.text2, marginTop: 3 },

  tagsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginVertical: 20 },
  tag: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tagText: { fontSize: 12, fontWeight: '600', color: Colors.text2 },

  findBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 18, padding: 18,
    alignItems: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  findBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
});
