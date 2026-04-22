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
} from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';
import { getCurrentUser, logout, deleteAccount, exportMyData } from '../lib/auth';
import { useI18n, LANGUAGE_NAMES, type Lang } from '../lib/i18n';
import { useModal } from '../lib/modal';
import { LanguageChanged, LoggedOut, AccountDeleted } from '../lib/analytics';

const NOTIF_KEYS = {
  push: 'stobi:notif:push',
  email: 'stobi:notif:email',
  chat: 'stobi:notif:chat',
} as const;

export default function SettingsScreen() {
  const [pushEnabled, setPushEnabled] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [chatNotifs, setChatNotifs] = useState(true);
  const { lang, setLang, t } = useI18n();
  const modal = useModal();

  // Load persisted notification preferences
  useEffect(() => {
    (async () => {
      const [push, email, chat] = await Promise.all([
        AsyncStorage.getItem(NOTIF_KEYS.push),
        AsyncStorage.getItem(NOTIF_KEYS.email),
        AsyncStorage.getItem(NOTIF_KEYS.chat),
      ]);
      if (push !== null) setPushEnabled(push === 'true');
      if (email !== null) setEmailEnabled(email === 'true');
      if (chat !== null) setChatNotifs(chat === 'true');
    })();
  }, []);

  const togglePush = (v: boolean) => {
    setPushEnabled(v);
    AsyncStorage.setItem(NOTIF_KEYS.push, String(v));
  };
  const toggleEmail = (v: boolean) => {
    setEmailEnabled(v);
    AsyncStorage.setItem(NOTIF_KEYS.email, String(v));
  };
  const toggleChat = (v: boolean) => {
    setChatNotifs(v);
    AsyncStorage.setItem(NOTIF_KEYS.chat, String(v));
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
    modal.show({
      title: t('settings.payment_history'),
      message: t('settings.payment_history_empty'),
      buttons: [{ label: t('common.ok'), style: 'cancel' }],
    });
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
          <View style={styles.divider} />
          <View style={styles.row}>
            <Bell size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.email')}</Text>
            <Switch
              value={emailEnabled}
              onValueChange={toggleEmail}
              trackColor={{ true: Colors.accent, false: Colors.surface2 }}
            />
          </View>
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

        {/* Мои камни — author management */}
        <Text style={styles.sectionTitle}>{t('settings.my_stones') || 'МОИ КАМНИ'}</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/pending-approvals' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('pending.title') || 'Одобрить находки'}
          >
            <Info size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('pending.title') || 'Одобрить находки'}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
        </View>

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
          <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => router.push('/feedback' as any)} accessibilityRole="button" accessibilityLabel={t('settings.feedback')}>
            <Info size={20} color={Colors.accent} weight="regular" />
            <Text style={styles.rowLabel}>{t('settings.feedback')}</Text>
            <CaretRight size={16} color={Colors.text2} weight="bold" />
          </TouchableOpacity>
        </View>

        {/* Аккаунт */}
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

        <View style={{ height: 40 }} />
      </ScrollView>
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
