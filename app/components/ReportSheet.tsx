// Universal report bottom sheet — used for stones, users, messages, photos.
// Picks a category + optional note, then posts via file_content_report RPC.
//
// Designed to be openable from anywhere (stone detail menu, chat message
// long-press, any "three dots" menu). Keep this component dumb — callers
// supply targetType + targetId; we handle categories / i18n / network.

import { useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Warning, Shield, Prohibit, MapPin, Hand, Question } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { fileContentReport, type ReportCategory, type ReportTargetType } from '../lib/reports';

type Props = {
  visible: boolean;
  targetType: ReportTargetType;
  targetId: string;
  onClose: () => void;
  onDone?: (result: 'sent' | 'duplicate') => void;
};

// Categories shown in UI. Order matters: most-severe first so a careless
// tap defaults towards a safer bucket rather than "other".
const CATEGORIES: { key: ReportCategory; icon: (color: string) => ReactNode; tkey: string; fallback: string }[] = [
  {
    key: 'child_safety',
    icon: (c) => <Shield size={20} color={c} weight="fill" />,
    tkey: 'report.cat_child_safety',
    fallback: 'Угроза ребёнку / груминг',
  },
  {
    key: 'nsfw',
    icon: (c) => <Prohibit size={20} color={c} weight="fill" />,
    tkey: 'report.cat_nsfw',
    fallback: 'Взрослый / сексуальный контент',
  },
  {
    key: 'harassment',
    icon: (c) => <Hand size={20} color={c} weight="fill" />,
    tkey: 'report.cat_harassment',
    fallback: 'Травля / угрозы / ненависть',
  },
  {
    key: 'unsafe_location',
    icon: (c) => <MapPin size={20} color={c} weight="fill" />,
    tkey: 'report.cat_unsafe_location',
    fallback: 'Опасное место (школа, частная территория)',
  },
  {
    key: 'spam',
    icon: (c) => <Warning size={20} color={c} weight="fill" />,
    tkey: 'report.cat_spam',
    fallback: 'Спам / реклама',
  },
  {
    key: 'other',
    icon: (c) => <Question size={20} color={c} weight="fill" />,
    tkey: 'report.cat_other',
    fallback: 'Другое',
  },
];

export function ReportSheet({ visible, targetType, targetId, onClose, onDone }: Props) {
  const { t } = useI18n();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setCategory(null);
    setReason('');
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!category) return;
    setSubmitting(true);
    setError(null);
    const res = await fileContentReport({
      targetType,
      targetId,
      category,
      reason: reason.trim() || undefined,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDone?.(res.deduped ? 'duplicate' : 'sent');
    reset();
    onClose();
  };

  const canSubmit =
    !!category &&
    !submitting &&
    (category !== 'other' || reason.trim().length >= 5);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title}>
            {t('report.title') || 'Пожаловаться'}
          </Text>
          <TouchableOpacity
            onPress={handleClose}
            style={styles.closeBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.close') || 'Закрыть'}
          >
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.subtitle}>
              {t('report.subtitle') || 'Что не так? Модерация проверит.'}
            </Text>

            <View style={styles.list}>
              {CATEGORIES.map((c) => {
                const selected = c.key === category;
                const color = selected ? Colors.accent : Colors.text2;
                return (
                  <TouchableOpacity
                    key={c.key}
                    style={[styles.row, selected && styles.rowSelected]}
                    activeOpacity={0.7}
                    onPress={() => setCategory(c.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={t(c.tkey) || c.fallback}
                  >
                    <View style={styles.rowIcon}>{c.icon(color)}</View>
                    <Text style={[styles.rowText, selected && styles.rowTextSelected]}>
                      {t(c.tkey) || c.fallback}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {category && (
              <View style={styles.noteBox}>
                <Text style={styles.noteLabel}>
                  {category === 'other'
                    ? (t('report.note_required') || 'Опиши что случилось *')
                    : (t('report.note_optional') || 'Комментарий (опционально)')}
                </Text>
                <TextInput
                  style={styles.noteInput}
                  value={reason}
                  onChangeText={setReason}
                  placeholder={t('report.note_placeholder') || 'Что увидел…'}
                  placeholderTextColor={Colors.text2}
                  multiline
                  numberOfLines={4}
                  maxLength={500}
                  accessibilityLabel={t('report.note_label') || 'Комментарий к жалобе'}
                />
                <Text style={styles.noteCount}>{reason.length}/500</Text>
              </View>
            )}

            {category === 'child_safety' && (
              <View style={styles.emergencyBox}>
                <Text style={styles.emergencyText}>
                  {t('report.emergency_note') ||
                    'Если ребёнок в непосредственной опасности — звони 112. Мы сообщим властям.'}
                </Text>
              </View>
            )}

            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>
        </KeyboardAvoidingView>

        <SafeAreaView edges={['bottom']} style={styles.footerWrap}>
          <TouchableOpacity
            style={[styles.submit, !canSubmit && styles.submitDisabled]}
            disabled={!canSubmit}
            onPress={handleSubmit}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('report.submit') || 'Отправить'}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>
                {t('report.submit') || 'Отправить'}
              </Text>
            )}
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: { fontSize: 18, fontWeight: '700', color: Colors.text },
  closeBtn: { padding: 6 },
  scroll: { padding: 20, paddingBottom: 40 },
  subtitle: { fontSize: 14, color: Colors.text2, marginBottom: 16 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rowSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
  },
  rowIcon: { width: 28, alignItems: 'center' },
  rowText: { flex: 1, fontSize: 15, color: Colors.text, fontWeight: '500' },
  rowTextSelected: { color: Colors.accent, fontWeight: '700' },
  noteBox: { marginTop: 20 },
  noteLabel: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 6 },
  noteInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    minHeight: 90,
    textAlignVertical: 'top',
  },
  noteCount: {
    fontSize: 11,
    color: Colors.text2,
    textAlign: 'right',
    marginTop: 4,
  },
  emergencyBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(220,38,38,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.2)',
  },
  emergencyText: { fontSize: 13, color: '#7F1D1D', lineHeight: 18 },
  errorText: { marginTop: 16, color: '#DC2626', fontSize: 13 },
  footerWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  submit: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
