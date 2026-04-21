// Экран для автора: pending находки, ожидающие его подтверждения.
//
// Когда кто-то сканирует камень автора и AI-similarity = 0.60–0.82
// (не auto-verified, не auto-rejected), находка уходит в pending-очередь.
// Автор заходит сюда, смотрит фото находящего + photo of his stone,
// и решает: одобрить (юзер получает +1💎) или оставить ждать.
//
// Source of truth:
//   select * from find_proofs
//   where status = 'pending'
//     and stone_id in (select id from stones where author_id = auth.uid())

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  CaretLeft,
  CheckCircle,
  Sparkle,
  Clock,
} from 'phosphor-react-native';
import { Colors } from '../constants/Colors';
import { StoneMascot } from '../components/StoneMascot';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { authorApprovePendingFind } from '../lib/finds';
import { useModal } from '../lib/modal';
import { useI18n } from '../lib/i18n';
import * as haptics from '../lib/haptics';

type PendingProof = {
  id: string;
  stone_id: string;
  user_id: string;
  photo_url: string;
  similarity_score: number | null;
  alt_similarity_score: number | null;
  created_at: string;
  stone_name?: string;
  stone_photo_url?: string;
  finder_username?: string;
  finder_avatar?: string;
};

export default function PendingApprovalsScreen() {
  const { t } = useI18n();
  const modal = useModal();

  const [proofs, setProofs] = useState<PendingProof[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [approving, setApproving] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProofs([]);
        return;
      }

      // Pending proofs на камни автора. Join через stones в двух шагах,
      // т.к. клиент не может сделать join через RLS на другие таблицы.
      const { data: ownStones } = await supabase
        .from('stones')
        .select('id, name, photo_url')
        .eq('author_id', user.id);

      if (!ownStones || ownStones.length === 0) {
        setProofs([]);
        return;
      }

      const stoneIds = ownStones.map((s) => s.id);
      const { data: proofRows } = await supabase
        .from('find_proofs')
        .select('id, stone_id, user_id, photo_url, similarity_score, alt_similarity_score, created_at')
        .eq('status', 'pending')
        .in('stone_id', stoneIds)
        .order('created_at', { ascending: false });

      if (!proofRows) {
        setProofs([]);
        return;
      }

      // Загружаем finder usernames одним запросом
      const finderIds = Array.from(new Set(proofRows.map((p) => p.user_id)));
      const { data: finders } = finderIds.length
        ? await supabase.from('profiles').select('id, username, avatar').in('id', finderIds)
        : { data: [] };

      const stoneMap = new Map(ownStones.map((s) => [s.id, s]));
      const finderMap = new Map((finders ?? []).map((f: any) => [f.id, f]));

      const enriched: PendingProof[] = proofRows.map((p) => {
        const st = stoneMap.get(p.stone_id);
        const fr = finderMap.get(p.user_id) as any;
        return {
          id: p.id,
          stone_id: p.stone_id,
          user_id: p.user_id,
          photo_url: p.photo_url,
          similarity_score: p.similarity_score,
          alt_similarity_score: p.alt_similarity_score,
          created_at: p.created_at,
          stone_name: st?.name,
          stone_photo_url: st?.photo_url,
          finder_username: fr?.username,
          finder_avatar: fr?.avatar,
        };
      });

      setProofs(enriched);
    } catch (e) {
      console.warn('load pending approvals failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleApprove = async (proof: PendingProof) => {
    setApproving(proof.id);
    try {
      const res = await authorApprovePendingFind(proof.id);
      if (!res.ok) {
        modal.show({
          title: t('common.error') || 'Ошибка',
          message: res.error ?? 'Не получилось одобрить',
          buttons: [{ label: t('common.understood') || 'OK', style: 'cancel' }],
        });
        return;
      }
      void haptics.success();
      // Убираем из списка
      setProofs((prev) => prev.filter((p) => p.id !== proof.id));
    } finally {
      setApproving(null);
    }
  };

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <CaretLeft size={22} color={Colors.text} weight="bold" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {t('pending.title') || 'Одобрить находки'}
          </Text>
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} size="large" />
          </View>
        ) : proofs.length === 0 ? (
          <View style={styles.center}>
            <StoneMascot size={120} color={Colors.mascot} variant="happy" showSparkles={false} />
            <Text style={styles.emptyTitle}>
              {t('pending.empty_title') || 'Нет находок ожидающих одобрения'}
            </Text>
            <Text style={styles.emptySub}>
              {t('pending.empty_sub') ||
                'Когда кто-то найдёт твой камень и AI не будет уверен на 100% — запрос придёт сюда.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.introCard}>
              <Sparkle size={20} color={Colors.accent} weight="fill" />
              <Text style={styles.introText}>
                {t('pending.intro') ||
                  'AI не уверен на 100% что это твои камни. Посмотри фото и реши — одобрить или оставить ждать.'}
              </Text>
            </View>

            {proofs.map((p) => (
              <ProofCard
                key={p.id}
                proof={p}
                approving={approving === p.id}
                onApprove={() => handleApprove(p)}
                t={t}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ProofCard({
  proof,
  approving,
  onApprove,
  t,
}: {
  proof: PendingProof;
  approving: boolean;
  onApprove: () => void;
  t: (k: string) => string;
}) {
  const similarity = Math.round((proof.similarity_score ?? proof.alt_similarity_score ?? 0) * 100);
  const hoursAgo = Math.floor((Date.now() - new Date(proof.created_at).getTime()) / 3600000);

  return (
    <View style={styles.card}>
      {/* Две фотки рядом — твой камень vs то что прислали */}
      <View style={styles.photoCompare}>
        <View style={styles.photoWrap}>
          <Text style={styles.photoLabel}>{t('pending.yours') || 'Твой камень'}</Text>
          {proof.stone_photo_url ? (
            <Image source={{ uri: proof.stone_photo_url }} style={styles.photoBox} />
          ) : (
            <View style={[styles.photoBox, styles.photoPlaceholder]}>
              <Text style={{ fontSize: 28 }}>🪨</Text>
            </View>
          )}
        </View>
        <View style={styles.photoWrap}>
          <Text style={styles.photoLabel}>{t('pending.theirs') || 'Что прислали'}</Text>
          <Image source={{ uri: proof.photo_url }} style={styles.photoBox} />
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.finderRow}>
          <Text style={{ fontSize: 20 }}>{proof.finder_avatar ?? '🪨'}</Text>
          <Text style={styles.finderName}>{proof.finder_username ?? 'Юзер'}</Text>
        </View>
        <View style={styles.similarityBadge}>
          <Sparkle size={12} color={Colors.accent} weight="fill" />
          <Text style={styles.similarityText}>{similarity}%</Text>
        </View>
      </View>

      <View style={styles.timeRow}>
        <Clock size={12} color={Colors.text2} weight="regular" />
        <Text style={styles.timeText}>
          {hoursAgo < 1 ? 'Только что' : hoursAgo < 48 ? `${hoursAgo} ч назад` : `${Math.floor(hoursAgo / 24)} дн назад`}
          {' · '}
          {proof.stone_name}
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.approveBtn, approving && styles.approveBtnBusy]}
        onPress={onApprove}
        disabled={approving}
        activeOpacity={0.85}
      >
        {approving ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <CheckCircle size={18} color="#FFFFFF" weight="fill" />
            <Text style={styles.approveBtnText}>
              {t('pending.approve') || 'Одобрить находку'}
            </Text>
          </>
        )}
      </TouchableOpacity>
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
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },

  scroll: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },

  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 20,
    gap: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: Colors.text2,
    textAlign: 'center',
    lineHeight: 18,
  },

  introCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.accentLight,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.accent,
    marginTop: 4,
    marginBottom: 8,
  },
  introText: {
    flex: 1,
    fontSize: 13,
    color: Colors.text,
    lineHeight: 18,
  },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  photoCompare: {
    flexDirection: 'row',
    gap: 10,
  },
  photoWrap: {
    flex: 1,
    gap: 6,
  },
  photoLabel: {
    fontSize: 11,
    color: Colors.text2,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  photoBox: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: Colors.surface2,
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  finderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  finderName: {
    fontSize: 14,
    color: Colors.text,
    fontWeight: '700',
  },
  similarityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: Colors.accentLight,
  },
  similarityText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.accent,
  },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    fontSize: 12,
    color: Colors.text2,
  },

  approveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    borderRadius: 12,
  },
  approveBtnBusy: { opacity: 0.5 },
  approveBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});
