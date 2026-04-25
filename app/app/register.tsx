import { useState, useEffect } from 'react';
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
  Alert,
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
import Constants from 'expo-constants';
import { Colors } from '../constants/Colors';
import { register, configureGoogleSignIn, getGoogleSignin } from '../lib/auth';

// Google Sign-In requires a native module not bundled in Expo Go.
// Hide the button there to avoid TurboModule invariant violations.
const isExpoGo = Constants.appOwnership === 'expo';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { StoneMascot } from '../components/StoneMascot';
import { ArrowRight, Gift } from 'phosphor-react-native';
import { useI18n } from '../lib/i18n';
import { AppleLogo, GoogleLogo } from 'phosphor-react-native';
import { Registered } from '../lib/analytics';
import { applyPendingReferralCode, getPendingReferralCode, redeemReferralCode } from '../lib/referral';

type Mode = 'buttons' | 'email';

export default function RegisterScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('buttons');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  // Возраст — спрашиваем "сколько тебе лет" а не "год рождения" (детям
  // первое в разы понятнее). На сервер всё равно сохраняем birth_year =
  // currentYear - age (COPPA work на уровне года, точная дата не нужна).
  const [ageInput, setAgeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Pre-fill invite code from deep-link (stobi.app/invite/XXX → AsyncStorage)
  useEffect(() => {
    getPendingReferralCode().then((code) => {
      if (code) setInviteCode(code);
    });
  }, []);

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
    // Stricter regex: local-part chars + domain.TLD (минимум 2 chars).
    // Пропускает 99% валидных email, отклоняет `a@b.x`, whitespace, unicode-mess.
    if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(trimmedEmail)) {
      setError(t('register.email_invalid'));
      return;
    }
    const yearNum = validateAge();
    if (yearNum === null) return;
    if (password.length < 8) {
      setError(t('register.password_too_short'));
      return;
    }

    setLoading(true);
    try {
      await register(trimmedEmail, password, trimmedName);
      void Registered('email');
      // Save birth_year right after register — иначе server RPC's
      // не работают (create_stone, record_find_v2 require birth_year).
      try {
        const { data: { user: newUser } } = await supabase.auth.getUser();
        if (newUser) {
          await supabase.from('profiles').update({ birth_year: yearNum }).eq('id', newUser.id);
        }
      } catch (e) {
        console.warn('failed to save birth_year', e);
      }
      // Применяем invite code (из поля или pending deep-link)
      const codeToApply = inviteCode.trim().toUpperCase();
      if (codeToApply) {
        const result = await redeemReferralCode(codeToApply);
        if (result.ok) {
          // Показываем небольшой toast о бонусе через Alert
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
        }
        // Если не ok — просто молча игнорируем (invalid code не блокирует регистрацию)
      } else {
        // Не "void" — реально awaitим, чтобы показать тост о +50💎
        // (раньше fire-and-forget терял feedback). applyPendingReferralCode
        // тихо вернёт null если кода нет — это нормально.
        const result = await applyPendingReferralCode();
        if (result?.ok) {
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
        }
      }
      // Welcome alert — ранее юзер просто оказывался на карте без
      // feedback о успешной регистрации. Покажем короткое приветствие
      // и упомянем welcome-бонус что начисляется welcome_bonus-триггером.
      Alert.alert(
        t('register.welcome_title') || 'Добро пожаловать!',
        t('register.welcome_text') ||
          `Ты зарегистрирован${trimmedName ? `, ${trimmedName}` : ''}. Начислили 20💎 на старт — используй их чтобы открыть камни или украсить персонажа.`,
        [{ text: t('common.ok') || 'OK', onPress: () => router.replace('/map') }],
      );
    } catch (e: any) {
      // Дружественные ошибки + переход в /login если аккаунт уже есть.
      const msg = String(e?.message ?? '').toLowerCase();
      if (msg.includes('already registered') || msg.includes('user already') || msg.includes('duplicate')) {
        Alert.alert(
          t('register.email_taken_title') || 'Email уже зарегистрирован',
          t('register.email_taken_text') ||
            'На этот email уже есть аккаунт. Хочешь войти?',
          [
            { text: t('common.cancel') || 'Отмена', style: 'cancel' },
            {
              text: t('common.login') || 'Войти',
              onPress: () => router.replace('/login'),
            },
          ],
        );
      } else {
        setError(e?.message ?? t('register.error'));
      }
    } finally {
      setLoading(false);
    }
  };

  // Простая валидация возраста: ≥13 → ok, иначе блок без обхода.
  // Industry-standard pattern (Snapchat/Instagram/Discord/Reddit) — никакого
  // over-engineering с persistent rejection. Если юзер врёт — "no actual
  // knowledge" доктрина FTC прикрывает: мы спросили честно, поверили на слово.
  // Для родителей с детьми <13 — играют вместе на родительском аккаунте.
  const validateAge = (): number | null => {
    const ageNum = parseInt(ageInput.trim(), 10);
    if (!Number.isFinite(ageNum) || ageNum <= 0 || ageNum > 130) {
      setError(t('register.age_invalid') || 'Сколько тебе лет?');
      return null;
    }
    if (ageNum < 13) {
      setError(
        t('register.age_under_13') ||
          'Stobi доступен с 13 лет. Если тебе младше — играй с родителем на его телефоне.',
      );
      return null;
    }
    return new Date().getFullYear() - ageNum;
  };

  const handleGoogleSignIn = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase not configured');
      return;
    }
    // Expo Go не содержит native-модуль @react-native-google-signin —
    // вызов падает с Invariant Violation (красный экран). Показываем
    // alert вместо краша. В dev-build / production работает нормально.
    if (isExpoGo) {
      setError('Google Sign-In доступен только в установленной версии приложения. В Expo Go используй Apple или Email.');
      return;
    }
    const yearNum = validateAge();
    if (yearNum === null) return;
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

      const { data, error: signInError } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (signInError) throw signInError;

      // Save birth_year right after auth (Google не передаёт год сам).
      if (data.user) {
        await supabase.from('profiles').update({ birth_year: yearNum }).eq('id', data.user.id);
      }

      // Apply referral code — раньше пропускалось в Google-флоу (только
      // Apple/email применяли). Без этого юзер открыл deep-link с invite,
      // зарегился через Google → 50💎 ему и пригласившему теряются.
      // applyPendingReferralCode идемпотентен (already_redeemed → silent).
      const inviteFromField = inviteCode.trim().toUpperCase();
      if (inviteFromField) {
        const result = await redeemReferralCode(inviteFromField);
        if (result.ok) {
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
        }
      } else {
        const result = await applyPendingReferralCode();
        if (result?.ok) {
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
        }
      }

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
    const yearNum = validateAge();
    if (yearNum === null) return;
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
      // + birth_year (Apple sign-in не передаёт год). Один UPDATE экономит
      // round-trip, плюс гарантирует что если username не пришёл — год всё
      // равно записан (раньше профиль оставался без birth_year → COPPA gate).
      if (data.user) {
        const updates: Record<string, unknown> = { birth_year: yearNum };
        if (credential.fullName) {
          const fullName = [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(' ');
          if (fullName) updates.username = fullName;
        }
        await supabase.from('profiles').update(updates).eq('id', data.user.id);
      }
      // Apply referral code — раньше для Apple sign-in этот шаг был пропущен
      // (есть только в email-flow). Нужен и здесь — иначе у юзера, который
      // открыл deep-link с invite-кодом и зарегился через Apple, бонусы
      // (50💎 ему + 50💎 пригласившему) терялись. applyPendingReferralCode
      // идемпотентен — если уже redeemed, server вернёт already_redeemed
      // и мы тихо игнорируем (см. redeemReferralCode catch).
      const inviteFromField = inviteCode.trim().toUpperCase();
      if (inviteFromField) {
        const result = await redeemReferralCode(inviteFromField);
        if (result.ok) {
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
        }
      } else {
        const result = await applyPendingReferralCode();
        if (result?.ok) {
          setTimeout(() => {
            Alert.alert(
              t('referral.bonus_applied_title'),
              t('referral.bonus_applied_text').replace('{amount}', String(result.bonus)),
            );
          }, 500);
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
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel={t('common.back')}>
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

                {/* Год рождения — ВЫШЕ всех методов sign-in (Apple/Google
                    тоже его требуют). Раньше поле стояло внизу формы и
                    юзер тапая Apple silently fail'ил с "введи год". */}
                <View style={styles.inputWrap}>
                  <User size={18} color="rgba(255,255,255,0.5)" weight="regular" />
                  <TextInput
                    style={styles.input}
                    placeholder={t('register.age_hint_placeholder') || 'Сколько тебе лет?'}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={ageInput}
                    onChangeText={(text) => setAgeInput(text.replace(/\D/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    maxLength={3}
                  />
                </View>

                {/* Apple Sign-In — iOS only */}
                {Platform.OS === 'ios' && (
                  <TouchableOpacity
                    style={styles.socialBtn}
                    onPress={handleAppleSignIn}
                    activeOpacity={0.85}
                    disabled={loading}
                  >
                    <AppleLogo size={20} color="#FFFFFF" weight="fill" />
                    <Text style={styles.socialText}>{t('auth.apple')}</Text>
                  </TouchableOpacity>
                )}

                {/* Google Sign-In — в Expo Go показывает alert вместо краша */}
                <TouchableOpacity
                  style={styles.socialBtn}
                  onPress={handleGoogleSignIn}
                  activeOpacity={0.85}
                  disabled={loading}
                >
                  <GoogleLogo size={18} color="#FFFFFF" weight="bold" />
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

                {/* Invite code (optional) — +50 💎 bonus for both */}
                <View style={styles.inputWrap}>
                  <Gift size={18} color="rgba(255,255,255,0.5)" weight="regular" />
                  <TextInput
                    style={styles.input}
                    placeholder={t('register.invite_code_hint')}
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    value={inviteCode}
                    onChangeText={(text) => setInviteCode(text.toUpperCase())}
                    autoCapitalize="characters"
                    autoCorrect={false}
                  />
                </View>

                {/* Birth year поле перенесено наверх формы (выше Apple/Google),
                    дубликат удалён. */}

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

            {/* Dev demo accounts removed — мешали реальному testing flow.
                Демо-юзеры (demo@stobi.app, anna@stobi.app) всё ещё в БД
                для seeded-data, но quick-login кнопок больше нет. */}
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

  ageGate: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginTop: 4,
    marginBottom: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  checkboxTick: { color: '#5B4FF0', fontSize: 14, fontWeight: '900' },
  ageGateText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.85)',
  },
  ageGateHint: {
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(255,255,255,0.55)',
    paddingHorizontal: 4,
    marginBottom: 4,
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
