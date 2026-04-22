// COPPA gate: before the user can hide or find a stone, we need their
// birth_year. The register form doesn't collect it (Apple/Google sign-in
// doesn't either), so the profile starts with NULL birth_year and the
// server RPCs would reject `create_stone` / `record_find_v2` with
// "birth_year_required".
//
// This modal pops once per account to collect it. Uses a year-picker so
// the user doesn't fumble with keyboard. Ages <13 are rejected
// client-side AND by the validate_age_on_signup trigger on UPDATE.

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Heart } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { useI18n } from '../lib/i18n';

type Props = {
  visible: boolean;
  onComplete: () => void;
  onClose: () => void;
};

export async function needsAgeGate(): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data, error } = await supabase
      .from('profiles')
      .select('birth_year')
      .eq('id', user.id)
      .maybeSingle();
    if (error) return false;
    return data?.birth_year == null;
  } catch {
    return false;
  }
}

export function AgeGate({ visible, onComplete, onClose }: Props) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const years = useMemo(() => {
    // Show 1940..currentYear descending. The <13 block happens on
    // submit, but we still show all years so the user doesn't have to
    // guess the cutoff (Apple's age-verification UI pattern).
    const arr: number[] = [];
    for (let y = currentYear; y >= 1940; y--) arr.push(y);
    return arr;
  }, [currentYear]);

  const handleSave = async () => {
    if (!selected) return;
    const age = currentYear - selected;
    if (age < 13) {
      setError(t('agegate.too_young') || 'Приложение для 13+. Извини.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('not_authenticated');
      const { error: updErr } = await supabase
        .from('profiles')
        .update({ birth_year: selected })
        .eq('id', user.id);
      if (updErr) throw new Error(updErr.message);
      onComplete();
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            {t('agegate.title') || 'Сколько тебе лет?'}
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.7}>
            <X size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
        </View>

        <View style={styles.hero}>
          <Heart size={40} color={Colors.accent} weight="duotone" />
          <Text style={styles.heroTitle}>
            {t('agegate.hero') || 'Stobi — для тех, кому 13+'}
          </Text>
          <Text style={styles.heroSub}>
            {t('agegate.subtitle') ||
              'Это нужно для безопасности — некоторые функции включаются только после 13.'}
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={true}
        >
          {years.map((y) => {
            const active = y === selected;
            return (
              <TouchableOpacity
                key={y}
                style={[styles.yearRow, active && styles.yearRowActive]}
                onPress={() => setSelected(y)}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.yearText, active && styles.yearTextActive]}>{y}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {error && <Text style={styles.errorText}>{error}</Text>}

        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <TouchableOpacity
            style={[styles.cta, (!selected || submitting) && styles.ctaDisabled]}
            onPress={handleSave}
            disabled={!selected || submitting}
            activeOpacity={0.85}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaText}>
                {selected
                  ? `${t('common.save') || 'Сохранить'} · ${selected}`
                  : (t('agegate.pick_year') || 'Выбери год')}
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  closeBtn: { padding: 6 },
  hero: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 18,
  },
  listContent: { paddingHorizontal: 20, paddingBottom: 20 },
  yearRow: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 6,
    alignItems: 'center',
  },
  yearRowActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
  yearText: { fontSize: 16, color: Colors.text, fontWeight: '500' },
  yearTextActive: { color: Colors.accent, fontWeight: '700' },
  errorText: { color: '#DC2626', fontSize: 13, paddingHorizontal: 20, paddingBottom: 8 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  cta: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaDisabled: { opacity: 0.4 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
