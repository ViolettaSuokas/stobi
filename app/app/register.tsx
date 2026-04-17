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
  User,
  Envelope,
  Lock,
  WarningCircle,
} from 'phosphor-react-native';
import { router, Link } from 'expo-router';
import { Colors } from '../constants/Colors';
import { register, login, DEMO_ACCOUNTS, configureGoogleSignIn, getGoogleSignin } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { StoneMascot } from '../components/StoneMascot';
import { ArrowRight } from 'phosphor-react-native';
import { useI18n } from '../lib/i18n';
import { FontAwesome } from '@expo/vector-icons';

type Mode = 'buttons' | 'email';

export default function RegisterScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('buttons');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    setError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (trimmedName.length < 2) {
      setError(t('register.name_too_short'));
      return;
    }
    if (trimmedName.length > 32) {
      setError(t('register.name_too_long'));
      return;
    }
    // Простой email-regex: something@something.tld
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(t('register.email_invalid'));
      return;
    }
    if (password.length < 8) {
      setError(t('register.password_too_short'));
      return;
    }

    setLoading(true);
    try {
      await register(trimmedEmail, password, trimmedName);
      router.replace('/map');
    } catch (e: any) {
      setError(e?.message ?? t('register.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase not configured');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const GoogleSignin = getGoogleSignin();
      if (!GoogleSignin) throw new Error(t('stone.error_google'));

      configureGoogleSignIn();
      await GoogleSignin.hasPlayServices();
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo?.data?.idToken ?? userInfo?.idToken;
      if (!idToken) throw new Error(t('stone.error_google_token'));

      const { error: signInError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (signInError) throw signInError;

      router.replace('/map');
    } catch (e: any) {
      if (e?.code !== '-5' && e?.code !== 'SIGN_IN_CANCELLED') {
        setError(e?.message ?? 'Google sign in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase not configured');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const AppleAuthentication = require('expo-apple-authentication');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) {
        throw new Error('No identity token from Apple');
      }
      const { data, error: signInError } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (signInError) throw signInError;

      // Save user's name from Apple (only available on first sign-in)
      if (credential.fullName && data.user) {
        const fullName = [credential.fullName.givenName, credential.fullName.familyName]
          .filter(Boolean)
          .join(' ');
        if (fullName) {
          await supabase.from('profiles').update({ username: fullName }).eq('id', data.user.id);
        }
      }
      router.replace('/map');
    } catch (e: any) {
      if (e?.code !== 'ERR_REQUEST_CANCELED') {
        setError(e?.message ?? 'Apple sign in failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Dark gradient background */}
      <View style={styles.bgFill} />
      <View style={[styles.glow, styles.glowTop]} />
      <View style={[styles.glow, styles.glowBottom]} />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Back button */}
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
              <CaretLeft size={22} color="#FFFFFF" weight="bold" />
            </TouchableOpacity>

            {/* Hero — mascot floating with decorations */}
            <View style={styles.hero}>
              <View style={styles.sparkle1}>
                <Text style={{ fontSize: 18 }}>✨</Text>
              </View>
              <View style={styles.sparkle2}>
                <Text style={{ fontSize: 14 }}>⭐</Text>
              </View>
              <View style={styles.cloud1}>
                <Text style={{ fontSize: 16 }}>☁️</Text>
              </View>
              <View style={styles.cloud2}>
                <Text style={{ fontSize: 12 }}>☁️</Text>
              </View>
              <StoneMascot size={180} color="#C4B5FD" variant="happy" showSparkles />
            </View>

            {/* Title */}
            <Text style={styles.appName}>Stobi</Text>
            <Text style={styles.subtitle}>{t('register.subtitle')}</Text>

              <View style={styles.buttonsWrap}>
                <Text style={styles.signUpLabel}>{t('auth.sign_up')}</Text>

                {/* Apple Sign-In — iOS only */}
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.socialBtn}
                    onPress={handleAppleSignIn}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <FontAwesome name="apple" size={20} color="#FFFFFF" />
                    <Text style={styles.socialText}>{t('auth.apple')}</Text>
                  </TouchableOpacity>
                )}

                {/* Google Sign-In */}
                <TouchableOpacity
                  style={styles.socialBtn}
                  onPress={handleGoogleSignIn}
                  activeOpacity={0.85}
                  disabled={loading}
                >
                  <FontAwesome name="google" size={18} color="#FFFFFF" />
                  <Text style={styles.socialText}>{t('auth.google')}</Text>
                </TouchableOpacity>

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Email</Text>
                  <View style={styles.dividerLine} />
                </View>

                <View style={styles.inputWrap}>
                  <User size={18} color="rgba(255,255,255,0.5)" weight="regular" />
                  <TextInput
                    style={styles.input}
                    placeholder={t('register.name')}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={name}
                    onChangeText={setName}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.inputWrap}>
                  <Envelope size={18} color="rgba(255,255,255,0.5)" weight="regular" />
                  <TextInput
                    style={styles.input}
                    placeholder={t('login.email')}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputWrap}>
                  <Lock size={18} color="rgba(255,255,255,0.5)" weight="regular" />
                  <TextInput
                    style={styles.input}
                    placeholder={t('register.password_hint')}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    autoCapitalize="none"
                  />
                </View>

                {error && (
                  <View style={styles.errorBox}>
                    <WarningCircle size={16} color="#FCA5A5" weight="fill" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.ctaBtn, loading && { opacity: 0.6 }]}
                  onPress={handleRegister}
                  disabled={loading}
                  activeOpacity={0.85}
                >
                  {loading ? (
                    <ActivityIndicator color="#5B4FF0" />
                  ) : (
                    <Text style={styles.ctaText}>{t('register.button')}</Text>
                  )}
                </TouchableOpacity>

                <Link href="/login" asChild>
                  <TouchableOpacity style={styles.linkBtn} activeOpacity={0.7}>
                    <Text style={styles.linkText}>
                      {t('register.has_account')}{' '}
                      <Text style={styles.linkAccent}>{t('common.login')}</Text>
                    </Text>
                  </TouchableOpacity>
                </Link>

                <Text style={styles.legalText}>
                  {t('register.legal_prefix')}{' '}
                  <Text style={styles.legalLink} onPress={() => router.push('/terms')}>
                    {t('register.terms')}
                  </Text>
                  {' '}{t('register.legal_and')}{' '}
                  <Text style={styles.legalLink} onPress={() => router.push('/privacy')}>
                    {t('register.privacy')}
                  </Text>
                </Text>
              </View>

            {/* Dev demo accounts */}
            {__DEV__ && (
              <View style={styles.demoList}>
                <Text style={styles.demoHeader}>DEV: Quick Login</Text>
                {DEMO_ACCOUNTS.map((acc) => (
                  <TouchableOpacity
                    key={acc.email}
                    style={styles.demoBtn}
                    onPress={async () => {
                      try {
                        await login(acc.email, acc.password);
                        router.replace('/map');
                      } catch (e: any) {
                        setError(e?.message ?? t('login.error'));
                      }
                    }}
                    disabled={loading}
                    activeOpacity={0.85}
                  >
                    <Text style={{ fontSize: 20 }}>{acc.emoji}</Text>
                    <Text style={styles.demoLabel}>{acc.label}</Text>
                    <ArrowRight size={16} color="rgba(255,255,255,0.5)" weight="bold" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A1A2E' },
  bgFill: { ...StyleSheet.absoluteFillObject, backgroundColor: '#1A1A2E' },

  glow: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    opacity: 0.25,
  },
  glowTop: { top: -120, right: -80, backgroundColor: '#7C3AED' },
  glowBottom: { bottom: -150, left: -100, backgroundColor: '#5B4FF0' },

  scroll: { padding: 24, paddingTop: 12, paddingBottom: 40 },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  // Hero
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 220,
    marginTop: 10,
  },
  sparkle1: { position: 'absolute', top: 20, left: 40 },
  sparkle2: { position: 'absolute', top: 60, right: 50 },
  cloud1: { position: 'absolute', bottom: 30, left: 30 },
  cloud2: { position: 'absolute', top: 40, right: 30 },

  appName: {
    fontSize: 32,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 30,
    paddingHorizontal: 20,
    lineHeight: 20,
  },

  // Buttons mode
  buttonsWrap: { gap: 14 },

  signUpLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 4,
  },

  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  socialIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  socialText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' },
  dividerText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', fontWeight: '600' },

  emailLink: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  emailLinkText: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },

  // Email form
  backToSocial: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  backToSocialText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
    fontWeight: '600',
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#FFFFFF',
    padding: 0,
  },

  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaText: {
    color: '#5B4FF0',
    fontSize: 16,
    fontWeight: '800',
  },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(220,38,38,0.15)',
    borderRadius: 10,
    padding: 10,
  },
  errorText: { color: '#FCA5A5', fontSize: 13, flex: 1 },

  linkBtn: { alignItems: 'center', paddingVertical: 8 },
  linkText: { fontSize: 13, color: 'rgba(255,255,255,0.5)' },
  linkAccent: { color: '#C4B5FD', fontWeight: '700' },

  legalText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 16,
    paddingHorizontal: 20,
  },
  legalLink: {
    textDecorationLine: 'underline',
    color: 'rgba(255,255,255,0.6)',
  },

  // Dev demo
  demoList: {
    marginTop: 24,
    gap: 8,
  },
  demoHeader: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 4,
  },
  demoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  demoLabel: { flex: 1, fontSize: 13, color: 'rgba(255,255,255,0.6)', fontWeight: '600' },
});
