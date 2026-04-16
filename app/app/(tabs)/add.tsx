import { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  Camera,
  MapPin,
  Sparkle,
} from 'phosphor-react-native';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/Colors';
import { getCurrentLocation } from '../../lib/location';
import { earnPoints, REWARD_HIDE, ALL_ITEMS } from '../../lib/points';
import { addUserStone } from '../../lib/user-stones';
import { getCurrentUser } from '../../lib/auth';
import { DEMO_SEED_USER_MAP } from '../../lib/activity';
import { StoneMascot } from '../../components/StoneMascot';
import { useModal } from '../../lib/modal';
import { useI18n } from '../../lib/i18n';
import { gatherAchievementStats, checkAchievements, ACHIEVEMENT_DEFS } from '../../lib/achievements';
import { updateChallengeProgress } from '../../lib/daily-challenge';

export default function AddScreen() {
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const modal = useModal();
  const { t } = useI18n();


  const [user, setUser] = useState<any>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // Check auth on focus — show placeholder for guests instead of redirecting
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getCurrentUser().then((u) => {
        if (active) {
          setUser(u);
          setCheckingAuth(false);
        }
      });
      return () => { active = false; };
    }, []),
  );

  useEffect(() => {
    getCurrentLocation().then((loc) => {
      if (!loc) return;
      setCity(loc.city ?? loc.region);
      setCoords(loc.coords);
    });
  }, []);

  const handleTakePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('add.camera_needed'), t('add.camera_settings'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handlePickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('add.photos_needed'), t('add.photos_settings'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 0.8,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSelectPhoto = () => {
    modal.show({
      title: t('add.photo_title'),
      message: t('add.photo_how'),
      buttons: [
        { label: t('add.take_photo'), onPress: handleTakePhoto },
        { label: t('add.from_gallery'), onPress: handlePickFromGallery },
        { label: t('common.cancel'), style: 'cancel' },
      ],
    });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert(t('add.stone_name'), t('add.name_required'));
      return;
    }
    if (!photoUri) {
      Alert.alert(
        t('common.need_photo'),
        t('add.photo_required'),
      );
      return;
    }
    if (!coords) {
      Alert.alert(
        t('common.no_gps'),
        t('add.no_gps'),
      );
      return;
    }

    setSaving(true);
    try {
      // Resolve current user → seed user id mapping (so it shows in МОИ КАМНИ)
      const user = await getCurrentUser();
      const authorUserId = user
        ? DEMO_SEED_USER_MAP[user.email] ?? user.id
        : 'guest';
      const authorName = user?.username ?? t('profile.guest');
      const authorAvatar = user?.avatar ?? '🪨';

      const emoji = '🪨';

      // Small random offset (~30-80m) so stone doesn't hide under user marker
      const offsetCoords = {
        lat: coords.lat + (Math.random() - 0.5) * 0.0012,
        lng: coords.lng + (Math.random() - 0.5) * 0.0012,
      };

      // Persist the stone — appears on map + profile after this
      await addUserStone({
        name: name.trim(),
        emoji,
        description: description.trim() || undefined,
        tags: [],
        photoUri: photoUri ?? undefined,
        coords: offsetCoords,
        city: city ?? 'Finland',
        authorUserId,
        authorName,
        authorAvatar,
        isArtist: user?.isArtist,
      });

      // Award diamonds + track progress
      const newBalance = await earnPoints(REWARD_HIDE);
      await updateChallengeProgress('hide');
      const achStats = await gatherAchievementStats();
      const unlocked = await checkAchievements(achStats);

      const unlockedCosmetics = unlocked
        .map((id) => ACHIEVEMENT_DEFS.find((d) => d.id === id)?.unlockCosmeticId)
        .filter((id): id is string => !!id)
        .map((id) => ALL_ITEMS.find((it) => it.id === id)?.label)
        .filter((label): label is string => !!label);
      const cosmeticSuffix = unlockedCosmetics.length > 0
        ? ` + ${unlockedCosmetics.join(', ')}`
        : '';
      const achSuffix = unlocked.length > 0
        ? `\n\n🏆 ${t('achievement.unlocked')}${cosmeticSuffix}`
        : '';

      modal.show({
        illustration: (
          <StoneMascot size={140} color="#86EFAC" variant="happy" decor="flower" showSparkles />
        ),
        title: t('add.success_title'),
        message: `"${name.trim()}" теперь на карте.\n\n+3 💎 · Теперь у тебя ${newBalance} 💎${achSuffix}`,
        buttons: [{ label: t('common.nice'), onPress: () => router.back() }],
      });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? t('add.error'));
    } finally {
      setSaving(false);
    }
  };

  // Guest placeholder — no redirect, no loop
  if (!checkingAuth && !user) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('add.title')}</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <StoneMascot size={140} color="#C4B5FD" variant="happy" showSparkles />
          <Text style={{ fontSize: 20, fontWeight: '800', color: Colors.text, marginTop: 16, textAlign: 'center' }}>
            {t('add.guest_title')}
          </Text>
          <Text style={{ fontSize: 14, color: Colors.text2, marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
            {t('add.guest_text')}
          </Text>
          <TouchableOpacity
            style={{ backgroundColor: Colors.accent, borderRadius: 18, paddingVertical: 16, paddingHorizontal: 40, marginTop: 24 }}
            onPress={() => router.push('/register')}
            activeOpacity={0.85}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>{t('common.register')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.headerBtn}
            activeOpacity={0.7}
          >
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('add.title')}</Text>
          <View style={styles.headerBtn} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          {/* Photo area */}
          <TouchableOpacity
            style={styles.photoArea}
            onPress={handleSelectPhoto}
            activeOpacity={0.85}
          >
            {photoUri ? (
              <>
                <Image source={{ uri: photoUri }} style={styles.photo} />
                <View style={styles.photoChangeBtn}>
                  <Camera size={14} color="#FFFFFF" weight="bold" />
                  <Text style={styles.photoChangeText}>{t('add.change_photo')}</Text>
                </View>
              </>
            ) : (
              <LinearGradient
                colors={['#EEF2FF', '#F5F0FF']}
                style={styles.photoPlaceholder}
              >
                <View style={styles.photoIconWrap}>
                  <Camera size={36} color={Colors.accent} weight="regular" />
                </View>
                <Text style={styles.photoText}>{t('add.photo_button')}</Text>
                <Text style={styles.photoSub}>{t('add.photo_tap')}</Text>
              </LinearGradient>
            )}
          </TouchableOpacity>

          {/* Name input */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.stone_name')}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={styles.input}
                placeholder={t('add.name_placeholder')}
                placeholderTextColor={Colors.text2}
                value={name}
                onChangeText={setName}
                maxLength={40}
              />
            </View>
          </View>

          {/* Location */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.location')}</Text>
            <View style={styles.locationCard}>
              <View style={styles.locationIcon}>
                <MapPin size={20} color={Colors.accent} weight="fill" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.locationName}>
                  {city ?? t('add.detecting_location')}
                </Text>
                {coords ? (
                  <Text style={styles.locationCoords}>
                    {coords.lat.toFixed(4)}° N, {coords.lng.toFixed(4)}° E
                  </Text>
                ) : (
                  <Text style={styles.locationCoords}>{t('add.gps_auto')}</Text>
                )}
              </View>
            </View>
          </View>

          {/* Description */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('add.description')}</Text>
            <View style={styles.inputWrap}>
              <TextInput
                style={[styles.input, styles.inputMulti]}
                placeholder={t('add.description_placeholder')}
                placeholderTextColor={Colors.text2}
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={3}
                maxLength={200}
              />
            </View>
          </View>

          {/* Reward hint */}
          <View style={styles.rewardHint}>
            <Sparkle size={16} color={Colors.accent} weight="fill" />
            <Text style={styles.rewardHintText}>
              {t('add.reward_hint')}
            </Text>
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <SafeAreaView style={styles.ctaWrap} edges={['bottom']}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveBtnText}>{t('add.save_button')}</Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: Colors.text,
  },

  body: { padding: 20, paddingBottom: 110 },

  // Photo
  photoArea: {
    height: 240,
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 22,
    position: 'relative',
  },
  photo: {
    width: '100%',
    height: '100%',
  },
  photoChangeBtn: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(26,26,46,0.75)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  photoChangeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#DDD6FE',
    borderStyle: 'dashed',
    borderRadius: 22,
  },
  photoIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  photoText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  photoSub: {
    fontSize: 13,
    color: Colors.text2,
  },

  section: { marginBottom: 22 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
    marginBottom: 10,
  },

  // Inputs
  inputWrap: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  input: {
    fontSize: 15,
    color: Colors.text,
    paddingVertical: 12,
  },
  inputMulti: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  // Location
  locationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  locationCoords: { fontSize: 12, color: Colors.text2, marginTop: 2 },

  // Reward hint
  rewardHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 12,
    marginTop: 4,
  },
  rewardHintText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
  },
  rewardHintBold: { fontWeight: '800', color: Colors.accent },

  // CTA
  ctaWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: Colors.bg,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
