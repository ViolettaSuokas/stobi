import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors } from '../../constants/Colors';

const MY_STONES = [
  { id: '1', emoji: '🌸', color: '#DDD6FE', location: 'Tikkurila' },
  { id: '2', emoji: '🌊', color: '#BFDBFE', location: 'Myyrmäki' },
  { id: '3', emoji: '🌲', color: '#BBF7D0', location: 'Rekola' },
  { id: '4', emoji: '🦋', color: '#DDD6FE', location: 'Hakunila' },
  { id: '5', emoji: '🔥', color: '#FED7AA', location: 'Koivukylä' },
];

export default function ProfileScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Cover */}
        <View style={styles.cover}>
          <View style={styles.coverPattern} />
        </View>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarWrap}>
            <View style={styles.avatar}>
              <Text style={{ fontSize: 32 }}>🦋</Text>
            </View>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>12</Text>
            </View>
          </View>
          <TouchableOpacity style={styles.editBtn}>
            <Ionicons name="pencil-outline" size={16} color={Colors.accent} />
            <Text style={styles.editText}>Изменить</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.body}>
          <Text style={styles.name}>Aleksi Korhonen</Text>
          <Text style={styles.bio}>Люблю прятать камни в лесах Вантаа 🌲 #FinStones</Text>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: Colors.accent }]}>23</Text>
              <Text style={styles.statLabel}>Спрятано</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: Colors.green }]}>41</Text>
              <Text style={styles.statLabel}>Найдено</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statNum, { color: Colors.orange }]}>187</Text>
              <Text style={styles.statLabel}>XP</Text>
            </View>
          </View>

          {/* XP bar */}
          <View style={styles.xpSection}>
            <View style={styles.xpLabelRow}>
              <Text style={styles.xpLabel}>Уровень 12</Text>
              <Text style={styles.xpLabel}>187 / 250 XP</Text>
            </View>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: '75%' }]} />
            </View>
          </View>

          {/* My stones */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>МОИ КАМНИ</Text>
            <View style={styles.stonesGrid}>
              {MY_STONES.map((stone) => (
                <TouchableOpacity
                  key={stone.id}
                  style={[styles.stoneThumb, { backgroundColor: stone.color }]}
                  onPress={() => router.push(`/stone/${stone.id}`)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.stoneThumbEmoji}>{stone.emoji}</Text>
                  <View style={styles.stoneThumbOverlay}>
                    <Text style={styles.stoneThumbLocation}>{stone.location}</Text>
                  </View>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.stoneAddThumb} activeOpacity={0.7}>
                <Ionicons name="add" size={28} color={Colors.text2} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Become artist */}
          <TouchableOpacity style={styles.artistCard} activeOpacity={0.85}>
            <View style={styles.artistCardIcon}>
              <Text style={{ fontSize: 24 }}>🎨</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.artistCardTitle}>Стать Verified Artist</Text>
              <Text style={styles.artistCardSub}>Продвигай свои камни · 9,99€/мес</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.accent} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  cover: {
    height: 130,
    backgroundColor: Colors.accent,
    overflow: 'hidden',
    position: 'relative',
  },
  coverPattern: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    opacity: 0.2,
  },
  avatarSection: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginTop: -36,
    marginBottom: 4,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 72, height: 72,
    borderRadius: 22,
    backgroundColor: Colors.accentLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: Colors.bg,
  },
  levelBadge: {
    position: 'absolute',
    bottom: -4, right: -4,
    backgroundColor: Colors.green,
    borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 2, borderColor: Colors.bg,
  },
  levelText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: Colors.surface,
    marginBottom: 6,
  },
  editText: { fontSize: 13, fontWeight: '600', color: Colors.accent },

  body: { padding: 20 },
  name: { fontSize: 22, fontWeight: '800', color: Colors.text },
  bio: { fontSize: 13, color: Colors.text2, marginTop: 5, lineHeight: 20 },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: 18 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statNum: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 11, color: Colors.text2, marginTop: 3 },

  xpSection: { marginTop: 16 },
  xpLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  xpLabel: { fontSize: 12, color: Colors.text2 },
  xpTrack: { height: 6, backgroundColor: Colors.surface2, borderRadius: 3, overflow: 'hidden' },
  xpFill: { height: '100%', backgroundColor: Colors.accent, borderRadius: 3 },

  section: { marginTop: 24 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.text2, letterSpacing: 1, marginBottom: 14 },

  stonesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stoneThumb: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  stoneThumbEmoji: { fontSize: 32 },
  stoneThumbOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    paddingVertical: 5, paddingHorizontal: 6,
  },
  stoneThumbLocation: { fontSize: 10, color: '#fff', fontWeight: '600' },
  stoneAddThumb: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.border,
    borderStyle: 'dashed',
    backgroundColor: Colors.surface,
  },

  artistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderRadius: 16,
    padding: 16,
    marginTop: 20,
    borderWidth: 1, borderColor: '#DDD6FE',
  },
  artistCardIcon: {
    width: 44, height: 44,
    backgroundColor: '#fff',
    borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
  },
  artistCardTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  artistCardSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
});
