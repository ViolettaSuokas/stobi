import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Linking,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CaretLeft,
  CaretRight,
  Bell,
  Globe,
  CreditCard,
  Shield,
  Info,
  Trash,
  SignOut,
  DownloadSimple,
  Heart,
} from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { getCurrentUser, logout, deleteAccount, exportMyData, type User } from '../lib/auth';
import { useI18n, LANGUAGE_NAMES, type Lang } from '../lib/i18n';
import { useModal } from '../lib/modal';
import { LanguageChanged, LoggedOut, AccountDeleted } from '../lib/analytics';
import { SafetyGate, resetSafetyAck } from '../components/SafetyGate';
import { resetOnboarding } from '../lib/auth';

const NOTIF_KEYS = {
  push: 'stobi:notif:push',
  email: 'stobi:notif:email',
  chat: 'stobi:notif:chat',
} as const;

export default function SettingsScreen() {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [chatNotifs, setChatNotifs] = useState(true);
  const [showCommunityRules, setShowCommunityRules] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // Know whether the viewer is signed in — Account section (Download
  // my data / Logout / Delete account) only makes sense for logged-in
  // users. Guests previously saw Logout which did nothing useful.
  useEffect(() => {
    getCurrentUser().then(setUser).catch(() => setUser(null));
  }, []);
  const { lang, setLang, t } = useI18n();
  const modal = useModal();

  // Load notification preferences. Push + chat prefs живут на сервере
  // (profiles.notif_push_enabled / notif_chat_enabled) — иначе сервер
  // всё равно бы слал пуши.
  useEffect(() => {
    (async () => {
      try {
        if (isSupabaseConfigured()) {
          const { data: { user: u } } = await supabase.auth.getUser();
          if (u) {
            const { data } = await supabase
              .from('profiles')
              .select('notif_push_enabled, notif_chat_enabled')
              .eq('id', u.id)
              .maybeSingle();
            if (data?.notif_push_enabled !== undefined && data?.notif_push_enabled !== null) {
              setPushEnabled(!!data.notif_push_enabled);
            }
            if (data?.notif_chat_enabled !== undefined && data?.notif_chat_enabled !== null) {
              setChatNotifs(!!data.notif_chat_enabled);
            }
          }
        }
      } catch (e) { console.warn('notif prefs load', e); }
    })();
  }, []);

  const togglePush = async (v: boolean) => {
    setPushEnabled(v); // optimistic
    try {
      if (!isSupabaseConfigured()) return;
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      const { error } = await supabase
        .from('profiles')
        .update({ notif_push_enabled: v })
        .eq('id', u.id);
      if (error) {
        console.warn('togglePush server error', error.message);
        setPushEnabled(!v);
      }
    } catch (e) {
      console.warn('togglePush exception', e);
    }
  };
  const toggleChat = async (v: boolean) => {
    setChatNotifs(v); // optimistic
    try {
      if (!isSupabaseConfigured()) return;
      const { data: { user: u } } = await supabase.auth.getUser();
      if (!u) return;
      const { error } = await supabase
        .from('profiles')
        .update({ notif_chat_enabled: v })
        .eq('id', u.id);
      if (error) {
        console.warn('toggleChat server error', error.message);
        setChatNotifs(!v);
      }
    } catch (e) {
      console.warn('toggleChat exception', e);
    }
  };

  const handleLanguage = () => {
    const check = (code: Lang) => lang === code ? '✓ ' : '   ';
    const pick = (code: Lang) => {
      setLang(code);
      void LanguageChanged(code);
    };
    // Использую native Alert вместо кастомной модалки: Alert.alert
    // в iOS — это UIAlertController, он всегда показывается над всем
    // (включая stack-модалки), не фризится и не требует overFullScreen.
    // Кастомная модалка внутри settings (которая presentation:'modal')
    // имела race при закрытии на iOS и могла вешать UI.
    Alert.alert(
      'Language / Kieli / Язык',
      undefined,
      [
        { text: `${check('ru')}Русский`, onPress: () => pick('ru') },
        { text: `${check('fi')}Suomi`, onPress: () => pick('fi') },
        { text: `${check('en')}English`, onPress: () => pick('en') },
        { text: t('common.cancel'), style: 'cancel' },
      ],
    );
  };

  const handlePaymentHistory = () => {
    router.push('/diamond-history' as any);
  };

  const handleLogout = () => {
    Alert.alert(
      t('profile.logout_title'),
      t('profile.logout_text'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('profile.logout_button'),
          style: 'destructive',
          onPress: async () => {
            void LoggedOut();
            await logout();
            router.replace('/login');
          },
        },
      ],
    );
  };

  // Reset the "first-run" flags so the next launch shows onboarding →
  // location rationale → map-info popup → SafetyGate again. Doesn't log
  // the user out. Useful when TestFlight testers install over an older
  // build and want to re-experience the first-run flow.
  const handleResetFirstRun = () => {
    modal.show({
      title: t('settings.reset_firstrun_title') || 'Сбросить первый запуск?',
      message: t('settings.reset_firstrun_text') ||
        'Ты снова увидишь онбординг, правила и запрос геолокации. Аккаунт не затрагивается. После подтверждения закрой и открой приложение.',
      buttons: [
        { label: t('common.cancel'), style: 'cancel' },
        {
          label: t('common.confirm') || 'Сбросить',
          style: 'destructive',
          onPress: async () => {
            await Promise.all([
              resetOnboarding(),
              resetSafetyAck(),
              import('@react-native-async-storage/async-storage').then(({ default: AS }) =>
                AS.multiRemove([
                  'stobi:map_info_seen',
                  'stobi:premium_trial_seen',
                  'stobi:daily_challenge_seen',
                ]),
              ),
            ]);
            Alert.alert(
              t('settings.reset_firstrun_done_title') || 'Готово',
              t('settings.reset_firstrun_done_text') ||
                'Закрой приложение полностью (свайп вверх) и открой снова.',
            );
          },
        },
      ],
    });
  };

  const handleExportData = async () => {
    try {
      const data = await exportMyData();
      const pretty = JSON.stringify(data, null, 2);
      await Share.share({
        title: 'Stobi — My Data Export',
        message: pretty,
      });
    } catch (e: any) {
      Alert.alert(t('common.error'), e?.message ?? 'Export failed');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t('settings.delete_account'),
      t('settings.delete_confirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              t('settings.delete_final_title'),
              t('settings.delete_final_text'),
              [
                { text: t('common.cancel'), style: 'cancel' },
                {
                  text: t('settings.delete_final_confirm'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      void AccountDeleted();
                      await deleteAccount();
                      router.replace('/onboarding');
                    } catch (e: any) {
                      Alert.alert(t('common.error'), e?.message ?? t('settings.delete_account'));
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('common.back')}
          >
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('settings.title')}</Text>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

        {/* Уведомления */}
        <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Bell size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.push')}</Text>
            <Switch
              value={pushEnabled}
              onValueChange={togglePush}
              trackColor={{ true: Colors.accent, false: Colors.surface2 }}
            />
          </View>
          {/* Email-уведомления убраны — нет email-pipeline в проекте,
              switch был визуальной заглушкой (только AsyncStorage). */}
          <View style={styles.divider} />
          <View style={styles.row}>
            <Bell size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.chat_notifs')}</Text>
            <Switch
              value={chatNotifs}
              onValueChange={toggleChat}
              trackColor={{ true: Colors.accent, false: Colors.surface2 }}
            />
          </View>
        </View>

        {/* Язык */}
        <Text style={styles.sectionTitle}>{t('settings.language')}</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={handleLanguage} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('settings.app_language')}>
            <Globe size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.app_language')}</Text>
            <Text style={styles.rowValue}>{LANGUAGE_NAMES[lang]}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* "Одобрить находки" переехал в Profile (Общее tab) — это
            повседневная функция автора камня, не настройка. */}

        {/* Платежи */}
        <Text style={styles.sectionTitle}>{t('settings.payments')}</Text>
        <View style={styles.card}>
          <TouchableOpacity style={styles.row} onPress={handlePaymentHistory} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('settings.payment_history')}>
            <CreditCard size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.payment_history')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/premium')}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('settings.manage_sub')}
          >
            <CreditCard size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.manage_sub')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* О приложении */}
        <Text style={styles.sectionTitle}>{t('settings.about')}</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Info size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.version')}</Text>
            <Text style={styles.rowValue}>1.0.0</Text>
          </View>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/privacy')} accessibilityRole="button" accessibilityLabel={t('settings.privacy')}>
            <Shield size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.privacy')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/terms')} accessibilityRole="button" accessibilityLabel={t('settings.terms')}>
            <Shield size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.terms')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
          <View style={styles.divider} />
          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.7}
            onPress={() => setShowCommunityRules(true)}
            accessibilityRole="button"
            accessibilityLabel={t('settings.community_rules') || 'Правила сообщества'}
          >
            <Heart size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.community_rules') || 'Правила сообщества'}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
          {/* Reset-firstrun — debug-инструмент для тестов онбординга,
              не для конечных юзеров. В TestFlight и в проде __DEV__ = false,
              так что строка скрыта. Раньше отсутствовала проверка → юзер
              видел raw-ключ "settings.reset_firstrun". */}
          {__DEV__ && (
            <>
              <View style={styles.divider} />
              <TouchableOpacity
                style={styles.row}
                activeOpacity={0.7}
                onPress={handleResetFirstRun}
                accessibilityRole="button"
                accessibilityLabel="Сбросить первый запуск (для теста)"
              >
                <Info size={20} color={Colors.accent} weight="regular" />
                <Text style={styles.rowLabel}>DEV: Сбросить первый запуск</Text>
                <CaretRight size={16} color={Colors.text2} weight="bold" />
              </TouchableOpacity>
            </>
          )}
          <View style={styles.divider} />
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/feedback' as any)} accessibilityRole="button" accessibilityLabel={t('settings.feedback')}>
            <Info size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.feedback')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* Аккаунт — только для авторизованных. Для гостей показываем
            кнопку "Войти" которая ведёт на логин-экран. */}
        {user ? (
          <>
            <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
            <View style={styles.card}>
              <TouchableOpacity style={styles.row} onPress={handleExportData} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Download my data">
                <DownloadSimple size={20} color={Colors.accent} weight="regular" />
                <Text style={styles.rowLabel}>{t('settings.export_data') || 'Download my data'}</Text>
                <CaretRight size={16} color={Colors.text2} weight="bold" />
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.row} onPress={handleLogout} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('settings.logout')}>
                <SignOut size={20} color={Colors.text2} weight="regular" />
                <Text style={styles.rowLabel}>{t('settings.logout')}</Text>
              </TouchableOpacity>
              <View style={styles.divider} />
              <TouchableOpacity style={styles.row} onPress={handleDeleteAccount} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={t('settings.delete_account')} accessibilityHint={t('settings.delete_account_hint')}>
                <Trash size={20} color="#DC2626" weight="regular" />
                <Text style={[styles.rowLabel, { color: '#DC2626' }]}>{t('settings.delete_account')}</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>{t('settings.account')}</Text>
            <View style={styles.card}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push('/login')}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('common.login') || 'Войти'}
              >
                <SignOut size={20} color={Colors.accent} weight="regular" style={{ transform: [{ scaleX: -1 }] }} />
                <Text style={styles.rowLabel}>{t('common.login') || 'Войти'}</Text>
                <CaretRight size={16} color={Colors.text2} weight="bold" />
              </TouchableOpacity>
            </View>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Community rules overlay — read-only view of SafetyGate. User
          has already acknowledged once (that's what unlocked first hide);
          Settings is for re-reading the rules later. Uses the same
          content so rules stay in a single source of truth. */}
      <SafetyGate
        visible={showCommunityRules}
        readOnly
        onClose={() => setShowCommunityRules(false)}
        onAcknowledge={() => setShowCommunityRules(false)}
      />
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
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },

  scroll: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.text2,
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 10,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: Colors.text,
    fontWeight: '600',
  },
  rowValue: {
    fontSize: 14,
    color: Colors.text2,
    fontWeight: '600',
  },

  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginLeft: 48,
  },
});
