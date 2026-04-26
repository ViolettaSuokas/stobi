import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { Gift, ShareNetwork } from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';
import { getOrCreateReferralCode, getReferralStats } from '../lib/referral';
import { ShareTapped } from '../lib/analytics';
import * as haptics from '../lib/haptics';

/**
 * Реферальная карточка на профиле. Compact-режим — одна строка с
 * gift-иконкой и share-кнопкой, для размещения над feed/grid'ом.
 * Полная карточка — для профайла подробного.
 *
 * Скрыта если юзер не залогинен.
 */
export function ReferralCard({ compact = false }: { compact?: boolean } = {}) {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [stats, setStats] = useState({ invited: 0, earned: 0 });

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([
      getOrCreateReferralCode(),
      getReferralStats(),
    ]);
    setCode(c);
    setStats(s);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!code) return null;

  const handleShare = async () => {
    void haptics.tap();
    void ShareTapped('invite', code);
    const url = `https://stobi.app/invite/${code}`;
    const message = t('referral.share_message').replace('{code}', code);
    try {
      await Share.share({
        message: `${message}\n${url}`,
        url,
        title: t('referral.share_title'),
      });
    } catch (e) {
      console.warn('referral share failed', e);
    }
  };

  // Compact-режим: одна строка с share-tap всем рядом.
  if (compact) {
    return (
      <TouchableOpacity
        style={styles.compactCard}
        onPress={handleShare}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('referral.share_cta') || 'Пригласи друга'}
      >
        <Gift size={20} color={Colors.accent} weight="fill" />
        <View style={{ flex: 1 }}>
          <Text style={styles.compactTitle}>
            {t('referral.title') || 'Пригласи друга'}
          </Text>
          <Text style={styles.compactSub} numberOfLines={1}>
            {t('referral.subtitle')}
          </Text>
        </View>
        <ShareNetwork size={18} color={Colors.accent} weight="bold" />
      </TouchableOpacity>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Gift size={20} color={Colors.accent} weight="fill" />
        <Text style={styles.title}>{t('referral.title')}</Text>
      </View>

      <Text style={styles.subtitle}>
        {t('referral.subtitle')}
      </Text>

      {/* Code display */}
      <View style={styles.codeBox}>
        <Text style={styles.codeLabel}>{t('referral.your_code')}</Text>
        <Text style={styles.codeValue}>{code}</Text>
      </View>

      {/* Stats */}
      {stats.invited > 0 && (
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{stats.invited}</Text>
            <Text style={styles.statLabel}>{t('referral.stat_invited')}</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={[styles.statNum, { color: '#F59E0B' }]}>+{stats.earned} 💎</Text>
            <Text style={styles.statLabel}>{t('referral.stat_earned')}</Text>
          </View>
        </View>
      )}

      <TouchableOpacity
        style={styles.shareBtn}
        onPress={handleShare}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t('referral.share_cta')}
      >
        <ShareNetwork size={18} color="#FFFFFF" weight="bold" />
        <Text style={styles.shareText}>{t('referral.share_cta')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  // Compact — одна строка для размещения над feed/grid'ом.
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  compactTitle: { fontSize: 14, fontWeight: '800', color: Colors.text },
  compactSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 0,
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: Colors.accentLight,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.text2,
    lineHeight: 18,
    marginBottom: 14,
  },
  codeBox: {
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.accent,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  codeValue: {
    fontSize: 22,
    fontWeight: '900',
    color: Colors.accent,
    letterSpacing: 2,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    backgroundColor: Colors.surface2,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  statNum: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.text2,
    marginTop: 2,
    fontWeight: '600',
  },
  shareBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  shareText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
