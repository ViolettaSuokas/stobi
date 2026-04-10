import { View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Colors } from '../../constants/Colors';

const TAGS = ['🌸 Природа', '🦋 Животные', '🔮 Магия', '🌊 Море', '🌲 Лес', '🎨 Абстракция', '✨ Мандала'];

export default function AddScreen() {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="close" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Добавить камень</Text>
        <TouchableOpacity style={styles.saveBtn}>
          <Text style={styles.saveBtnText}>Сохранить</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        {/* Photo area */}
        <TouchableOpacity style={styles.photoArea} activeOpacity={0.8}>
          <Ionicons name="camera-outline" size={40} color={Colors.text2} />
          <Text style={styles.photoText}>Сфотографировать камень</Text>
          <Text style={styles.photoSub}>или выбрать из галереи</Text>
        </TouchableOpacity>

        {/* Location */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ГЕОЛОКАЦИЯ</Text>
          <View style={styles.locationCard}>
            <View style={styles.locationIcon}>
              <Ionicons name="location" size={20} color={Colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.locationName}>Tikkurila park</Text>
              <Text style={styles.locationCoords}>60.2925° N, 25.0446° E</Text>
            </View>
            <TouchableOpacity style={styles.locationEditBtn}>
              <Ionicons name="map-outline" size={18} color={Colors.accent} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Description */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ОПИСАНИЕ</Text>
          <TextInput
            style={styles.input}
            placeholder="Расскажи что-нибудь об этом камне..."
            placeholderTextColor={Colors.text2}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Tags */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>ТЕГИ</Text>
          <View style={styles.tagsWrap}>
            {TAGS.map((tag, i) => (
              <TouchableOpacity
                key={tag}
                style={[styles.tagChip, i === 0 && styles.tagChipActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.tagText, i === 0 && styles.tagTextActive]}>{tag}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* XP hint */}
        <View style={styles.xpHint}>
          <Text style={styles.xpHintEmoji}>✨</Text>
          <Text style={styles.xpHintText}>+10 XP за спрятанный камень</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.text },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  body: { padding: 20, paddingBottom: 40 },

  photoArea: {
    height: 200,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    gap: 8,
    marginBottom: 24,
  },
  photoText: { fontSize: 16, fontWeight: '600', color: Colors.text2 },
  photoSub: { fontSize: 13, color: Colors.text2 },

  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.text2, letterSpacing: 1, marginBottom: 10 },

  locationCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  locationIcon: {
    width: 38, height: 38,
    backgroundColor: Colors.accentLight,
    borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  locationName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  locationCoords: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  locationEditBtn: {
    width: 36, height: 36,
    backgroundColor: Colors.surface2,
    borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },

  input: {
    backgroundColor: Colors.surface,
    borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
    fontSize: 14, color: Colors.text,
    textAlignVertical: 'top',
    minHeight: 80,
  },

  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
  },
  tagChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tagText: { fontSize: 13, fontWeight: '600', color: Colors.text2 },
  tagTextActive: { color: '#fff' },

  xpHint: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.accentLight,
    borderRadius: 12, padding: 14,
  },
  xpHintEmoji: { fontSize: 20 },
  xpHintText: { fontSize: 14, fontWeight: '600', color: Colors.accent },
});
