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
import { Envelope, WarningCircle, CaretLeft, CheckCircle } from 'phosphor-react-native';
import { router } from 'expo-router';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { StoneMascot } from '../components/StoneMascot';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { PasswordResetRequested } from '../lib/analytics';

export default function ForgotPasswordScreen() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmed)) {
      setError(t('register.email_invalid'));
      return;
    }

    if (!isSupabaseConfigured()) {
      setError(t('forgot.error_unavailable'));
      return;
    }

    setLoading(true);
    try {
      // Supabase reset email sends a magic link to stobi:// deep-link scheme.
      // Apple / Google rely on a redirect URL → here we just use the scheme.
      const { error: rpcError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: 'stobi://reset-password',
      });
      if (rpcError) throw rpcError;
      void PasswordResetRequested(trimmed);
      setSent(true);
    } catch (e: any) {
      setError(e?.message ?? t('forgot.error'));
    } finally {
      setLoading(false);
    }
  };

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
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.mascotWrap}>
            <StoneMascot size={96} color={Colors.accentLight} variant="sleeping" />
          </View>

          {sent ? (
            <View style={styles.successWrap}>
              <CheckCircle size={48} color={Colors.green} weight="fill" />
              <Text style={styles.title}>{t('forgot.sent_title')}</Text>
              <Text style={styles.subtitle}>
                {t('forgot.sent_text').replace('{email}', email.trim())}
              </Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.85}
                onPress={() => router.replace('/login')}
              >
                <Text style={styles.primaryBtnText}>{t('forgot.back_to_login')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.title}>{t('forgot.title')}</Text>
              <Text style={styles.subtitle}>{t('forgot.subtitle')}</Text>

              {error && (
                <View style={styles.errorBox}>
                  <WarningCircle size={16} color="#DC2626" weight="fill" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.inputWrap}>
                <Envelope size={18} color={Colors.text2} weight="regular" />
                <TextInput
                  style={styles.input}
                  placeholder={t('login.email')}
                  placeholderTextColor={Colors.text2}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  editable={!loading}
                />
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                activeOpacity={0.85}
                onPress={handleSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryBtnText}>{t('forgot.send_button')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 16 },
  backText: { fontSize: 15, fontWeight: '600', color: Colors.text },
  scroll: { padding: 24, paddingTop: 32, paddingBottom: 48 },
  mascotWrap: { alignItems: 'center', marginBottom: 24 },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  input: { flex: 1, fontSize: 15, color: Colors.text },
  primaryBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { fontSize: 13, color: '#DC2626', flex: 1 },
  successWrap: {
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
});
