// DM thread screen — 1-on-1 разговор. URL param `id` — это либо
// conversation_id (если открыли из inbox), либо other_user_id (если
// открыли через "Написать автору" с stone-detail / public profile).
//
// При открытии:
//   1. Если id выглядит как conv-id — fetch list_my_conversations и
//      найти этот conversation
//   2. Если не нашли как conv — считаем что это other_user_id, без
//      conversation пока (создастся при первом sendDm)
//   3. Render messages list (если есть conv) + input + send button
//
// Mark-read автоматом при mount и при viewing scroll bottom.

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { CaretLeft, PaperPlaneRight } from 'phosphor-react-native';
import { Colors } from '../../constants/Colors';
import { useI18n } from '../../lib/i18n';
import {
  getConversationMessages,
  listMyConversations,
  sendDm,
  markThreadRead,
  type DmMessage,
  type DmConversation,
} from '../../lib/dm';
import { getPublicProfile, type PublicProfile } from '../../lib/public-profile';
import { getCurrentUser } from '../../lib/auth';

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export default function DmThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();

  const [me, setMe] = useState<{ id: string } | null>(null);
  const [conversation, setConversation] = useState<DmConversation | null>(null);
  const [otherProfile, setOtherProfile] = useState<PublicProfile | null>(null);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const flatRef = useRef<FlatList<DmMessage>>(null);

  const loadAll = useCallback(async () => {
    if (!id || !isUuid(id)) return;
    const u = await getCurrentUser();
    setMe(u ? { id: u.id } : null);

    // Try to resolve `id` as conversation first (find in my conversations).
    const convs = await listMyConversations();
    const conv = convs.find((c) => c.conversationId === id);

    if (conv) {
      setConversation(conv);
      setOtherUserId(conv.otherId);
      const profile = await getPublicProfile(conv.otherId);
      setOtherProfile(profile);
      const msgs = await getConversationMessages(conv.conversationId);
      setMessages(msgs);
      void markThreadRead(conv.conversationId);
    } else {
      // id треба being другой юзер id (открыли из profile/stone-detail).
      setOtherUserId(id);
      const profile = await getPublicProfile(id);
      setOtherProfile(profile);
      // Maybe the conversation already exists by content but list returned
      // first, double-check by resolving the pair.
      const matchByOther = convs.find((c) => c.otherId === id);
      if (matchByOther) {
        setConversation(matchByOther);
        const msgs = await getConversationMessages(matchByOther.conversationId);
        setMessages(msgs);
        void markThreadRead(matchByOther.conversationId);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const handleSend = async () => {
    const body = input.trim();
    if (!body || sending) return;
    if (!otherUserId) {
      Alert.alert(t('dm.error_title') || 'Ошибка', t('dm.no_recipient') || 'Не выбран получатель.');
      return;
    }
    setSending(true);
    const result = await sendDm(otherUserId, body);
    if (result.ok) {
      setInput('');
      // Re-fetch messages to show the new one + sync conv state.
      await loadAll();
      // Scroll to bottom
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    } else {
      const msg =
        result.reason === 'rate_limit' ? (t('dm.rate_limit') || 'Слишком много сообщений за сегодня. Попробуй завтра.')
        : result.reason === 'too_long' ? (t('dm.too_long') || 'Сообщение слишком длинное (макс 1000 символов).')
        : (t('dm.send_failed') || 'Не удалось отправить.');
      Alert.alert(t('dm.error_title') || 'Ошибка', msg);
    }
    setSending(false);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
          <CaretLeft size={22} color={Colors.text} weight="bold" />
        </TouchableOpacity>
        <TouchableOpacity
          style={{ flex: 1, alignItems: 'center' }}
          onPress={() => otherUserId && router.push(`/user/${otherUserId}` as any)}
          activeOpacity={0.7}
        >
          <Text style={styles.headerTitle} numberOfLines={1}>
            {otherProfile?.username || (t('dm.title') || 'Сообщения')}
          </Text>
        </TouchableOpacity>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.accent} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>
              {t('dm.empty_title') || 'Напиши первое сообщение'}
            </Text>
            <Text style={styles.emptyText}>
              {t('dm.empty_text') || 'Скажи спасибо за камень или познакомься 💜'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const mine = !!me && item.authorId === me.id;
              return (
                <View style={[styles.bubbleRow, mine ? styles.bubbleRowMine : styles.bubbleRowOther]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {item.body}
                    </Text>
                  </View>
                </View>
              );
            }}
            contentContainerStyle={styles.listContent}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('dm.input_placeholder') || 'Сообщение…'}
            placeholderTextColor={Colors.text2}
            multiline
            maxLength={1000}
            editable={!sending}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
            activeOpacity={0.85}
          >
            {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <PaperPlaneRight size={18} color="#FFFFFF" weight="fill" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text, textAlign: 'center' },
  emptyText: { fontSize: 13, color: Colors.text2, textAlign: 'center' },
  listContent: { padding: 12, gap: 6 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMine: { backgroundColor: Colors.accent, borderBottomRightRadius: 6 },
  bubbleOther: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 14, color: Colors.text, lineHeight: 19 },
  bubbleTextMine: { color: '#FFFFFF' },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxHeight: 120,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
});
