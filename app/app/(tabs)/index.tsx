import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors } from '../../constants/Colors';

const { width } = Dimensions.get('window');

const MOCK_STONES = [
  { id: '1', emoji: '🌸', name: 'Весенняя сакура', distance: '320м', color1: '#DDD6FE', color2: '#7C6AF5', x: 0.38, y: 0.42 },
  { id: '2', emoji: '🦋', name: 'Синяя бабочка', distance: '480м', color1: '#BFDBFE', color2: '#3B82F6', x: 0.62, y: 0.52 },
  { id: '3', emoji: '🌊', name: 'Морской закат', distance: '750м', color1: '#BBF7D0', color2: '#16A34A', x: 0.28, y: 0.60 },
  { id: '4', emoji: '🔮', name: 'Магический шар', distance: '1.1км', color1: '#FDE68A', color2: '#EA580C', x: 0.58, y: 0.70 },
];

const FILTERS = ['Все', '🌸 Природа', '🦋 Животные', '🔮 Магия', '⭐ Художники'];

export default function MapScreen() {
  return (
    <View style={styles.container}>
      {/* Fake map */}
      <View style={styles.mapArea}>
        <View style={styles.mapBg} />

        {/* Map roads simulation */}
        <View style={[styles.road, styles.roadH, { top: '25%' }]} />
        <View style={[styles.road, styles.roadH, { top: '50%' }]} />
        <View style={[styles.road, styles.roadH, { top: '72%' }]} />
        <View style={[styles.road, styles.roadV, { left: '22%' }]} />
        <View style={[styles.road, styles.roadV, { left: '55%' }]} />
        <View style={[styles.road, styles.roadV, { left: '82%' }]} />

        {/* Park blocks */}
        <View style={[styles.park, { top: '27%', left: '25%', width: 90, height: 70 }]} />
        <View style={[styles.lake, { top: '52%', left: '57%', width: 80, height: 90, borderRadius: 40 }]} />

        {/* Radius circles */}
        <View style={styles.radiusOuter} />
        <View style={styles.radiusInner} />

        {/* User dot */}
        <View style={styles.userDotWrap}>
          <View style={styles.userDotPulse} />
          <View style={styles.userDot} />
        </View>

        {/* Stone pins */}
        {MOCK_STONES.map((stone) => (
          <TouchableOpacity
            key={stone.id}
            style={[styles.pinWrap, { left: `${stone.x * 100}%`, top: `${stone.y * 100}%` }]}
            onPress={() => router.push(`/stone/${stone.id}`)}
            activeOpacity={0.8}
          >
            <View style={[styles.pinBubble, { borderColor: stone.color2 }]}>
              <View style={[styles.pinEmoji, { backgroundColor: stone.color1 }]}>
                <Text style={styles.pinEmojiText}>{stone.emoji}</Text>
              </View>
            </View>
            <View style={[styles.pinTail, { borderTopColor: stone.color2 }]} />
          </TouchableOpacity>
        ))}

        {/* Search bar */}
        <SafeAreaView style={styles.topOverlay} edges={['top']}>
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color={Colors.text2} />
              <Text style={styles.searchPlaceholder}>Поиск по карте...</Text>
            </View>
            <TouchableOpacity style={styles.iconBtn}>
              <Ionicons name="options-outline" size={20} color={Colors.text2} />
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Bottom overlay */}
        <View style={styles.bottomOverlay}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersRow}
          >
            {FILTERS.map((f, i) => (
              <TouchableOpacity
                key={f}
                style={[styles.chip, i === 0 && styles.chipActive]}
              >
                <Text style={[styles.chipText, i === 0 && styles.chipTextActive]}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.countCard}>
            <View style={styles.countPill}>
              <Text style={styles.countNum}>7</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.countTitle}>камней рядом</Text>
              <Text style={styles.countSub}>в радиусе ~500м · Vantaa</Text>
            </View>
            <TouchableOpacity onPress={() => router.push('/feed')}>
              <Text style={styles.countLink}>Смотреть →</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  mapArea: { flex: 1, position: 'relative', overflow: 'hidden' },
  mapBg: { ...StyleSheet.absoluteFillObject, backgroundColor: '#EAE8F4' },

  road: { position: 'absolute', backgroundColor: '#F5F3FF' },
  roadH: { left: 0, right: 0, height: 10 },
  roadV: { top: 0, bottom: 0, width: 10 },

  park: { position: 'absolute', backgroundColor: '#D1FAE5', borderRadius: 12, opacity: 0.9 },
  lake: { position: 'absolute', backgroundColor: '#DBEAFE', opacity: 0.9 },

  radiusOuter: {
    position: 'absolute',
    width: 280, height: 280,
    borderRadius: 140,
    borderWidth: 1.5,
    borderColor: 'rgba(91,79,240,0.2)',
    borderStyle: 'dashed',
    left: '50%', top: '55%',
    marginLeft: -140, marginTop: -140,
  },
  radiusInner: {
    position: 'absolute',
    width: 180, height: 180,
    borderRadius: 90,
    borderWidth: 1.5,
    borderColor: 'rgba(91,79,240,0.35)',
    borderStyle: 'dashed',
    left: '50%', top: '55%',
    marginLeft: -90, marginTop: -90,
  },

  userDotWrap: {
    position: 'absolute',
    left: '50%', top: '55%',
    marginLeft: -8, marginTop: -8,
  },
  userDot: {
    width: 16, height: 16,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    borderWidth: 3,
    borderColor: '#fff',
  },
  userDotPulse: {
    position: 'absolute',
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(91,79,240,0.2)',
    top: -8, left: -8,
  },

  pinWrap: { position: 'absolute', alignItems: 'center', transform: [{ translateX: -24 }, { translateY: -56 }] },
  pinBubble: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderRadius: 14,
    padding: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
  pinEmoji: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pinEmojiText: { fontSize: 20 },
  pinTail: {
    width: 0, height: 0,
    borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    marginTop: -1,
  },

  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  searchRow: { flexDirection: 'row', gap: 10, padding: 16 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  searchPlaceholder: { color: Colors.text2, fontSize: 14 },
  iconBtn: {
    width: 46, height: 46,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },

  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, zIndex: 10 },
  filtersRow: { gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.text2 },
  chipTextActive: { color: '#fff' },

  countCard: {
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  countPill: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    width: 44, height: 44,
    alignItems: 'center', justifyContent: 'center',
  },
  countNum: { color: '#fff', fontSize: 20, fontWeight: '800' },
  countTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  countSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  countLink: { fontSize: 12, color: Colors.accent2, fontWeight: '600' },
});
