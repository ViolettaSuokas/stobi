import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CaretLeft,
  Bug,
  Lightbulb,
  Heart,
  DotsThree,
  CheckCircle,
  Envelope,
} from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { submitFeedback, type FeedbackCategory } from '../lib/feedback';
import { StoneMascot } from '../components/StoneMascot';
import * as haptics from '../lib/haptics';

const CATEGORIES: { id: FeedbackCategory; Icon: any; color: string; labelKey: string }[] = [
  { id: 'bug',    Icon: Bug,        color: '#DC2626', labelKey: 'feedback.cat_bug' },
  { id: 'idea',   Icon: Lightbulb,  color: '#F59E0B', labelKey: 'feedback.cat_idea' },
  { id: 'praise', Icon: Heart,      color: '#F0ABFC', labelKey: 'feedback.cat_praise' },
  { id: 'other',  Icon: DotsThree,  color: Colors.text2, labelKey: 'feedback.cat_other' },
];

export default function FeedbackScreen() {
  const { t } = useI18n();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!category) {
      setError(t('feedback.category_required'));
      return;
    }
    const trimmed = message.trim();
    if (trimmed.length < 5) {
      setError(t('feedback.message_too_short'));
      return;
    }
    if (trimmed.length > 2000) {
      setError(t('feedback.message_too_long'));
      return;
    }
    setLoading(true);
    const ok = await submitFeedback({ category, message: trimmed, contactEmail: email.trim() || undefined });
    setLoading(false);
    if (ok) {
      void haptics.success();
      setSent(true);
    } else {
      void haptics.error();
      setError(t('feedback.error'));
    }
  };

  if (sent) {
    return (
      <View style={styles.container}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <View style={styles.successWrap} accessibilityLiveRegion="polite">
            <StoneMascot size={120} color={Colors.green} variant="happy" showSparkles />
            <CheckCircle size={40} color={Colors.green} weight="fill" style={{ marginTop: 16 }} />
            <Text style={styles.successTitle}>{t('feedback.sent_title')}</Text>
            <Text style={styles.successSub}>{t('feedback.sent_text')}</Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => router.back()}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>{t('common.nice')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel={t('common.back')}>
          <CaretLeft size={22} color={Colors.text} weight="bold" />
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </SafeAreaView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 40}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>{t('feedback.title')}</Text>
          <Text style={styles.subtitle}>{t('feedback.subtitle')}</Text>

          {/* Category picker */}
          <Text style={styles.sectionLabel}>{t('feedback.category_label')}</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.catCard, active && { borderColor: cat.color, backgroundColor: `${cat.color}15` }]}
                  onPress={() => {
                    setCategory(cat.id);
                    void haptics.selection();
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={t(cat.labelKey)}
                >
                  <cat.Icon size={22} color={active ? cat.color : Colors.text2} weight={active ? 'fill' : 'regular'} />
                  <Text style={[styles.catLabel, active && { color: cat.color, fontWeight: '800' }]}>
                    {t(cat.labelKey)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Message */}
          <Text style={styles.sectionLabel}>{t('feedback.message_label')}</Text>
          <TextInput
            style={styles.textarea}
            placeholder={t('feedback.message_placeholder')}
            placeholderTextColor={Colors.text2}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={2000}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{message.length}/2000</Text>

          {/* Email (optional) */}
          <Text style={styles.sectionLabel}>{t('feedback.email_label')}</Text>
          <View style={styles.emailWrap}>
            <Envelope size={18} color={Colors.text2} weight="regular" />
            <TextInput
              style={styles.emailInput}
              placeholder={t('feedback.email_placeholder')}
              placeholderTextColor={Colors.text2}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.primaryBtn}
            activeOpacity={0.85}
            onPress={handleSubmit}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={t('feedback.send')}
            accessibilityState={{ disabled: loading, busy: loading }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('feedback.send')}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  scroll: { padding: 20, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text, marginBottom: 6 },
  subtitle: { fontSize: 14, color: Colors.text2, lineHeight: 20, marginBottom: 24 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 0.5,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catCard: {
    flexGrow: 1,
    minWidth: '46%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  catLabel: { fontSize: 14, fontWeight: '600', color: Colors.text },
  textarea: {
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    minHeight: 140,
  },
  counter: {
    fontSize: 11,
    color: Colors.text2,
    textAlign: 'right',
    marginTop: 4,
  },
  emailWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emailInput: { flex: 1, fontSize: 15, color: Colors.text },
  errorBox: {
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
  },
  errorText: { fontSize: 13, color: '#DC2626' },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  successTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
    marginTop: 8,
  },
  successSub: {
    fontSize: 14,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
});
