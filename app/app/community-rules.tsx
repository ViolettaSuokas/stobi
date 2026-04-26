// Community rules — read-only screen для Settings.
// Показывает те же правила что и SafetyGate (mandatory gate перед
// первой пряткой), но как обычный Stack-modal с унифицированной
// шапкой как у diamond-history / notifications.
//
// Mandatory-gate flow (компонент SafetyGate) остаётся отдельно — он
// модалит fullScreen с обязательным checkbox'ом.

import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { CheckCircle, X, CaretLeft, Warning, Heart, MapPin, Users } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';

export default function CommunityRulesScreen() {
  const { t } = useI18n();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <CaretLeft size={22} color={Colors.text} weight="bold" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('safety.gate_title') || 'Правила безопасности'}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroIcon}>
          <Heart size={48} color={Colors.accent} weight="duotone" />
        </View>
        <Text style={styles.heroTitle}>
          {t('safety.gate_hero') || 'Stobi — для детей и семей'}
        </Text>
        <Text style={styles.heroSub}>
          {t('safety.gate_intro') ||
            'Камни часто находят дети. Прочитай правила — это важно для их безопасности.'}
        </Text>

        <View style={styles.sectionGood}>
          <View style={styles.sectionHeader}>
            <CheckCircle size={20} color="#10B981" weight="fill" />
            <Text style={styles.sectionTitleGood}>
              {t('safety.gate_good_title') || 'Где прятать'}
            </Text>
          </View>
          <Rule
            icon={<MapPin size={18} color={Colors.text2} />}
            text={t('safety.gate_good_1') || 'В публичных местах: парки, площадки, библиотеки, скамейки'}
          />
          <Rule
            icon={<Users size={18} color={Colors.text2} />}
            text={t('safety.gate_good_2') || 'Где проходит много людей — там спокойно искать и взрослым, и детям'}
          />
          <Rule
            icon={<MapPin size={18} color={Colors.text2} />}
            text={t('safety.gate_good_3') || 'На виду: на скамейке, у дерева, у тропинки'}
          />
        </View>

        <View style={styles.sectionBad}>
          <View style={styles.sectionHeader}>
            <Warning size={20} color="#DC2626" weight="fill" />
            <Text style={styles.sectionTitleBad}>
              {t('safety.gate_bad_title') || 'Никогда не прячь'}
            </Text>
          </View>
          <Rule
            icon={<X size={18} color="#DC2626" />}
            text={t('safety.gate_bad_1') || 'На частной территории (чужой двор, подъезд)'}
            bad
          />
          <Rule
            icon={<X size={18} color="#DC2626" />}
            text={t('safety.gate_bad_3') || 'В лесу или уединённых местах, где нет людей'}
            bad
          />
          <Rule
            icon={<X size={18} color="#DC2626" />}
            text={t('safety.gate_bad_4') || 'В местах где небезопасно оказаться одному ребёнку'}
            bad
          />
        </View>

        <View style={styles.sectionKids}>
          <Text style={styles.kidsTitle}>
            {t('safety.gate_kids_title') || '👶 Если ты ребёнок'}
          </Text>
          <Text style={styles.kidsText}>
            {t('safety.gate_kids_text') ||
              'Ищи камни только с взрослым. Никогда не договаривайся встречаться с незнакомыми через чат. Если что-то пугает — расскажи родителям.'}
          </Text>
        </View>

        <View style={styles.sectionReport}>
          <Text style={styles.reportTitle}>
            {t('safety.gate_report_title') || '🚨 Видишь небезопасное?'}
          </Text>
          <Text style={styles.reportText}>
            {t('safety.gate_report_text') ||
              'Жми "Пожаловаться" на любом камне, сообщении или юзере. Модерация проверит в течение часа.'}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Rule({ icon, text, bad }: { icon: React.ReactNode; text: string; bad?: boolean }) {
  return (
    <View style={styles.rule}>
      <View style={styles.ruleIcon}>{icon}</View>
      <Text style={[styles.ruleText, bad && styles.ruleTextBad]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: Colors.text },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
  },
  heroTitle: { fontSize: 22, fontWeight: '900', color: Colors.text, textAlign: 'center', marginTop: 16 },
  heroSub: { fontSize: 14, color: Colors.text2, textAlign: 'center', marginTop: 6, marginBottom: 22, paddingHorizontal: 12, lineHeight: 20 },
  sectionGood: {
    backgroundColor: '#ECFDF5',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  sectionBad: {
    backgroundColor: '#FEF2F2',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitleGood: { fontSize: 15, fontWeight: '800', color: '#065F46' },
  sectionTitleBad: { fontSize: 15, fontWeight: '800', color: '#991B1B' },
  rule: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  ruleIcon: { width: 22, alignItems: 'center', marginTop: 2 },
  ruleText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },
  ruleTextBad: { color: '#7F1D1D' },
  sectionKids: {
    backgroundColor: '#FEF3C7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  kidsTitle: { fontSize: 15, fontWeight: '800', color: '#92400E', marginBottom: 6 },
  kidsText: { fontSize: 14, color: '#92400E', lineHeight: 20 },
  sectionReport: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reportTitle: { fontSize: 15, fontWeight: '800', color: Colors.text, marginBottom: 6 },
  reportText: { fontSize: 14, color: Colors.text2, lineHeight: 20 },
});
