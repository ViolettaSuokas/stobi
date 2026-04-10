import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors } from '../../constants/Colors';

const STONES = [
  { id: '1', emoji: '🌸', name: 'Весенняя сакура', author: 'Maija Korhonen', verified: true, location: 'Tikkurila park', distance: '320м', color1: '#DDD6FE', color2: '#7C6AF5', time: '2ч назад' },
  { id: '2', emoji: '🌊', name: 'Морской закат', author: 'Elina V.', verified: false, location: 'Myyrmäki', distance: '480м', color1: '#BFDBFE', color2: '#3B82F6', time: 'вчера' },
  { id: '3', emoji: '🦋', name: 'Фиолетовая бабочка', author: 'Sanna M.', verified: false, location: 'Hakunila', distance: '1.2км', color1: '#DDD6FE', color2: '#A78BFA', time: '5ч назад' },
  { id: '4', emoji: '🌲', name: 'Лесная сова', author: 'Pekka J.', verified: false, location: 'Rekola forest', distance: '1.8км', color1: '#BBF7D0', color2: '#16A34A', time: '1д назад' },
  { id: '5', emoji: '🔥', name: 'Огненный дракон', author: 'Kirsi L.', verified: true, location: 'Koivukylä', distance: '2.1км', color1: '#FED7AA', color2: '#EA580C', time: '3ч назад' },
  { id: '6', emoji: '🌙', name: 'Лунная фея', author: 'Anna K.', verified: false, location: 'Tammisto', distance: '2.8км', color1: '#FDE68A', color2: '#EAB308', time: '6ч назад' },
];

const TABS = ['Рядом', 'Свежие', 'Художники', 'Популярные'];

export default function FeedScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Лента</Text>
        <Text style={styles.location}>📍 Vantaa</Text>
      </View>

      <View style={styles.tabsRow}>
        {TABS.map((t, i) => (
          <TouchableOpacity key={t} style={[styles.tab, i === 0 && styles.tabActive]}>
            <Text style={[styles.tabText, i === 0 && styles.tabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={STONES}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.item}
            onPress={() => router.push(`/stone/${item.id}`)}
            activeOpacity={0.7}
          >
            <View style={[styles.stoneImg, { backgroundColor: item.color1 }]}>
              <Text style={styles.stoneEmoji}>{item.emoji}</Text>
            </View>
            <View style={styles.stoneInfo}>
              <Text style={styles.stoneName}>{item.name}</Text>
              <View style={styles.authorRow}>
                <Text style={styles.authorName}>{item.author}</Text>
                {item.verified && (
                  <View style={styles.verifiedBadge}>
                    <Text style={styles.verifiedText}>✓</Text>
                  </View>
                )}
              </View>
              <View style={styles.locationRow}>
                <Ionicons name="location-outline" size={11} color={Colors.accent2} />
                <Text style={styles.locationText}>{item.location}</Text>
                <Text style={styles.timeText}> · {item.time}</Text>
              </View>
            </View>
            <View style={styles.distanceBadge}>
              <Text style={styles.distanceText}>{item.distance}</Text>
            </View>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
  },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text },
  location: { fontSize: 13, color: Colors.text2, fontWeight: '500' },

  tabsRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 14 },
  tab: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface2,
    borderWidth: 1, borderColor: Colors.border,
  },
  tabActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.text2 },
  tabTextActive: { color: '#fff' },

  list: { paddingBottom: 20 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
  },
  stoneImg: {
    width: 58, height: 58,
    borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  stoneEmoji: { fontSize: 28 },
  stoneInfo: { flex: 1 },
  stoneName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  authorName: { fontSize: 13, color: Colors.text2 },
  verifiedBadge: {
    backgroundColor: Colors.accent,
    borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  verifiedText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  locationText: { fontSize: 12, color: Colors.accent2 },
  timeText: { fontSize: 12, color: Colors.text2 },
  distanceBadge: {
    backgroundColor: Colors.greenLight,
    borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  distanceText: { fontSize: 12, fontWeight: '700', color: Colors.green },
  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 92 },
});
