// Mandatory safety screen shown before the user's first hide. Acknowledgement
// is persisted so we don't pester the user on every open, but the rules are
// always accessible from Settings.
//
// Design: full-screen modal (not just a toast) because kids/parents *must*
// read this before putting a stone into the world.

import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle, X, Warning, Heart, MapPin, Users } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';

const ACK_KEY = 'stobi:safety_acknowledged_v1';

export async function hasAcknowledgedSafety(): Promise<boolean> {
  const v = await AsyncStorage.getItem(ACK_KEY);
  return v === '1';
}

export async function resetSafetyAck(): Promise<void> {
  await AsyncStorage.removeItem(ACK_KEY);
}

type Props = {
  visible: boolean;
  onAcknowledge: () => void;
  onClose: () => void;
  // Re-opens the same content from Settings as a reference. Hides the
  // checkbox/continue CTA — the user already acknowledged once, they're
  // just reviewing. Close button in the header is the only way out.
  readOnly?: boolean;
};

export function SafetyGate({ visible, onAcknowledge, onClose, readOnly = false }: Props) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (visible) setChecked(false);
  }, [visible]);

  const handleConfirm = async () => {
    if (!checked) return;
    await AsyncStorage.setItem(ACK_KEY, '1');
    onAcknowledge();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <View style={styles.container}>
        <SafeAreaView edges={['top']}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
              <X size={22} color={Colors.text} weight="bold" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>
              {t('safety.gate_title') || 'Правила безопасности'}
            </Text>
            <View style={{ width: 40 }} />
          </View>
        </SafeAreaView>

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
              text={t('safety.gate_bad_2') || 'Возле школ и детских садов (это защита от взрослых с плохими намерениями)'}
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

          {!readOnly && (
            <>
              <TouchableOpacity
                style={styles.checkboxRow}
                onPress={() => setChecked(!checked)}
                activeOpacity={0.7}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                  {checked && <CheckCircle size={18} color="#FFFFFF" weight="fill" />}
                </View>
                <Text style={styles.checkboxLabel}>
                  {t('safety.gate_ack') || 'Я понимаю правила и буду прятать только в безопасных публичных местах'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.cta, !checked && styles.ctaDisabled]}
                onPress={handleConfirm}
                disabled={!checked}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={t('safety.gate_continue') || 'Продолжить'}
              >
                <Text style={styles.ctaText}>
                  {t('safety.gate_continue') || 'Продолжить'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
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
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 24, paddingBottom: 64 },
  heroIcon: { alignItems: 'center', marginBottom: 16 },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  heroSub: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },

  sectionGood: {
    backgroundColor: 'rgba(16,185,129,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16,185,129,0.2)',
  },
  sectionBad: {
    backgroundColor: 'rgba(220,38,38,0.06)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.2)',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleGood: { fontSize: 15, fontWeight: '700', color: '#065F46' },
  sectionTitleBad: { fontSize: 15, fontWeight: '700', color: '#991B1B' },
  rule: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
  },
  ruleIcon: { width: 24, paddingTop: 2, alignItems: 'center' },
  ruleText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },
  ruleTextBad: { color: '#7F1D1D' },

  sectionKids: {
    backgroundColor: 'rgba(245,158,11,0.08)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  kidsTitle: { fontSize: 15, fontWeight: '700', color: '#92400E', marginBottom: 6 },
  kidsText: { fontSize: 14, color: '#78350F', lineHeight: 20 },

  sectionReport: {
    backgroundColor: Colors.surface2,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  reportTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 6 },
  reportText: { fontSize: 14, color: Colors.text2, lineHeight: 20 },

  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    padding: 12,
    backgroundColor: Colors.surface2,
    borderRadius: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkboxLabel: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20, fontWeight: '500' },

  cta: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
