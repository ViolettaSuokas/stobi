import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Image,
  Dimensions,
  Alert,
} from 'react-native';

const { width: SCREEN_W } = Dimensions.get('window');
const MAX_BUBBLE_W = SCREEN_W * 0.82;
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChatsCircle,
  CheckCircle,
  ArrowUp,
  Heart,
  PencilSimple,
  Paperclip,
  Globe,
  MapPin,
} from 'phosphor-react-native';
import * as ImagePicker from 'expo-image-picker';
import { processPhoto } from '../../lib/photo';
import * as haptics from '../../lib/haptics';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../../constants/Colors';
import {
  getMessages,
  sendMessage,
  editMessage,
  deleteMessage,
  formatChatTime,
  getLikes,
  toggleLike,
  markChatRead,
  type ChatMessage,
} from '../../lib/chat';
import { STONE_PHOTOS } from '../../lib/stone-photos';
import { getCurrentUser, type User } from '../../lib/auth';
import { requireAuth } from '../../lib/auth-gate';
import { useI18n } from '../../lib/i18n';
import { ChatMessageSent } from '../../lib/analytics';
import { useModal } from '../../lib/modal';
import { StoneMascot } from '../../components/StoneMascot';
import { SkeletonRow } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import { getCurrentLocation } from '../../lib/location';
import { getUserStoneStyle, getMyStyle, type UserStoneStyle } from '../../lib/user-stone-styles';
import { gatherAchievementStats, checkAchievements } from '../../lib/achievements';
import { updateChallengeProgress } from '../../lib/daily-challenge';
import { moderateMessage } from '../../lib/moderation';
import { SafeImage } from '../../components/SafeImage';
import { ReportSheet } from '../../components/ReportSheet';
import { getBlockedUserIds, refreshBlockedUsers } from '../../lib/blocks';

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [likes, setLikes] = useState<Record<string, string[]>>({});
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set());
  const [reportTarget, setReportTarget] = useState<{ type: 'message'; id: string; authorId?: string } | null>(null);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [myStyle, setMyStyle] = useState<UserStoneStyle | null>(null);
  const [memberCount, setMemberCount] = useState<number>(0);
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [channel, setChannel] = useState<string>('FI');
  const lastSendTime = useRef<number>(0);
  const [userCountry, setUserCountry] = useState<string>('FI');
  // Guard: если юзер вручную тапнул channel chip → geo detection
  // больше НЕ переопределяет выбор, даже если резолвится позже.
  const userPickedChannelRef = useRef<boolean>(false);
  const flatListRef = useRef<FlatList<ChatMessage>>(null);
  const { t } = useI18n();
  const modal = useModal();

  const [loadingOlder, setLoadingOlder] = useState(false);
  const [canLoadOlder, setCanLoadOlder] = useState(true);

  const loadMessages = useCallback(async () => {
    const currentChannel = channel; // snapshot для race protection
    const [msgs, likesData] = await Promise.all([getMessages(currentChannel), getLikes()]);
    // Если канал сменился пока мы грузили — отбросить результат
    if (currentChannel !== channel) return;
    setMessages(msgs);
    setLikes(likesData);
    setLoading(false);
    setCanLoadOlder(msgs.length >= 50);
    markChatRead();
  }, [channel]);

  // Отдельный эффект на смену channel — грузит messages для нового канала.
  // Раньше это было через useFocusEffect с dep [loadMessages] — но тот
  // re-fired на каждое изменение channel создавая race с другими
  // async-операциями. Теперь чисто.
  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !canLoadOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[0];
      const older = await getMessages(channel, 50, oldest.createdAt);
      if (older.length === 0) {
        setCanLoadOlder(false);
      } else {
        // Merge — старые перед текущими, дедуп по id
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => m.id));
          const merged = [...older.filter((m) => !ids.has(m.id)), ...prev];
          return merged;
        });
        if (older.length < 50) setCanLoadOlder(false);
      }
    } finally {
      setLoadingOlder(false);
    }
  }, [channel, messages, loadingOlder, canLoadOlder]);

  // Detect user's country ОДИН РАЗ на mount — чтобы не перезатирать
  // ручной выбор юзера в channel switcher. Раньше это было в
  // useFocusEffect с dep на channel → при смене канала geo перезагружалось
  // и setChannel(country) возвращало на FI. Бага фикс.
  useEffect(() => {
    getCurrentLocation()
      .then((loc) => {
        const country = loc?.country;
        if (!country) return;
        setUserCountry(country);
        // Ref-guard + state check: не трогаем channel если юзер уже выбрал
        if (userPickedChannelRef.current) return;
        setChannel((current) => (current === 'FI' ? country : current));
      })
      .catch(() => {});
  }, []);

  // useFocusEffect БЕЗ зависимости от loadMessages/channel —
  // фокус-эффект не должен re-fire при смене channel (это делает
  // отдельный useEffect выше). Здесь только «вещи при фокусе»:
  // презентация (reported list, user, style, member count).
  useFocusEffect(
    useCallback(() => {
      let active = true;
      AsyncStorage.getItem('stobi:reported_messages').then((json) => {
        if (json) setReportedIds(new Set(JSON.parse(json)));
      });
      // Refresh blocked-users list from server (cheap — one table scan).
      // Falls back to AsyncStorage cache if offline.
      refreshBlockedUsers().then((s) => {
        if (active) setBlockedIds(s);
      }).catch(() => {
        getBlockedUserIds().then((s) => active && setBlockedIds(s));
      });
      getCurrentUser().then((u) => {
        if (active) setUser(u);
      });
      getMyStyle().then((s) => {
        if (active) setMyStyle(s);
      });
      (async () => {
        try {
          const { supabase, isSupabaseConfigured } = await import('../../lib/supabase');
          if (!isSupabaseConfigured()) return;
          const { data: { user: authUser } } = await supabase.auth.getUser();
          // Fire-and-forget: не блокируем возврат на таб на UPDATE round-trip.
          if (authUser) {
            supabase
              .from('profiles')
              .update({ last_active_at: new Date().toISOString() })
              .eq('id', authUser.id)
              .then(() => {}, (e) => console.warn('chat: last_active update failed', e));
          }
          const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
          if (active && count !== null) setMemberCount(count);
          const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
          const { count: online } = await supabase
            .from('profiles')
            .select('*', { count: 'exact', head: true })
            .gte('last_active_at', fiveMinAgo);
          if (active && online !== null) setOnlineCount(online);
        } catch (e) {
          console.warn('chat: member counts load failed', e);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const handleAttachPhoto = async () => {
    if (!(await requireAuth('прикрепить фото'))) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      quality: 1,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      const processed = await processPhoto(result.assets[0].uri);
      // Optimistic local preview — юзер сразу видит что фото прикрепилось.
      setPendingPhoto(processed.uri);

      // NSFW модерация в фоне. Если AWS Rekognition сконфигурирован
      // и фото непотреб — отменяем attach + показываем ошибку.
      try {
        const { uploadPhotoToStorage, moderateAndEmbedPhoto } = await import('../../lib/photo');
        const { signedUrl } = await uploadPhotoToStorage(processed.uri, 'find');
        const moderation = await moderateAndEmbedPhoto(signedUrl, 'find');
        if (!moderation.safe) {
          setPendingPhoto(null);
          Alert.alert(
            t('chat.photo_rejected_title') || 'Фото отклонено',
            t('chat.photo_rejected_text') || 'AI не разрешил это фото. Выбери другое.',
          );
        }
      } catch (e) {
        // Moderation failed — remove the optimistic attach and tell the user.
        // Leaving an unmoderated photo in the send queue would let a flaky
        // network/Edge Function bypass NSFW checks.
        console.warn('chat: photo moderation failed', e);
        setPendingPhoto(null);
        Alert.alert(
          t('chat.photo_rejected_title') || 'Фото не прошло проверку',
          t('chat.moderation_failed') || 'Не удалось проверить фото. Попробуй ещё раз или выбери другое.',
        );
      }
    }
  };

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed && !pendingPhoto || sending) return;

    // Rate limit: 1 message per 3 seconds
    const now = Date.now();
    if (now - lastSendTime.current < 3000) {
      Alert.alert(t('chat.mod_title'), t('chat.rate_limit'));
      return;
    }
    lastSendTime.current = now;

    // Content moderation
    if (trimmed) {
      const check = moderateMessage(trimmed);
      if (!check.ok) {
        const msgs: Record<string, string> = {
          profanity: t('chat.mod_profanity'),
          link: t('chat.mod_link'),
          phone: t('chat.mod_phone'),
          email: t('chat.mod_email'),
          social: t('chat.mod_social'),
          grooming: t('chat.mod_grooming'),
          too_short: '',
        };
        if (msgs[check.reason!]) {
          Alert.alert(t('chat.mod_title'), msgs[check.reason!]);
        }
        return;
      }
    }

    if (!(await requireAuth('писать в чат'))) return;

    setSending(true);
    // Сохраняем текст на случай ошибки — чтобы юзер не терял набранное
    const originalText = text;
    const originalPhoto = pendingPhoto;
    const originalReply = replyingTo;
    try {
      if (editingMsg) {
        await editMessage(editingMsg.id, trimmed);
        setEditingMsg(null);
      } else {
        await sendMessage(trimmed, undefined, replyingTo?.id, pendingPhoto ?? undefined, channel);
        void haptics.tap();
        void ChatMessageSent(channel, !!pendingPhoto);
        setReplyingTo(null);
        setPendingPhoto(null);
        await updateChallengeProgress('chat');
        const achStats = await gatherAchievementStats();
        await checkAchievements(achStats);
      }
      setText('');
      await loadMessages();
      if (!editingMsg) {
        setTimeout(() => {
          flatListRef.current?.scrollToEnd({ animated: true });
        }, 100);
      }
    } catch (e) {
      // Ошибку юзеру — haptics + modal с возможностью повторить.
      // Восстанавливаем текст/фото/reply чтобы юзер не потерял набранное.
      void haptics.error();
      setText(originalText);
      if (originalPhoto) setPendingPhoto(originalPhoto);
      if (originalReply) setReplyingTo(originalReply);
      console.warn('sendMessage failed', e);
      Alert.alert(
        t('chat.send_failed_title'),
        t('chat.send_failed_text'),
        [{ text: t('common.ok') }],
      );
    } finally {
      setSending(false);
    }
  };

  const handleLike = async (messageId: string) => {
    if (!(await requireAuth('ставить лайки'))) return;
    // Optimistic flip для моментального отклика
    const prevLikes = likes[messageId] ?? [];
    const liked = prevLikes.includes(user?.id ?? '');
    setLikes((prev) => ({
      ...prev,
      [messageId]: liked
        ? prevLikes.filter((id) => id !== user?.id)
        : [...prevLikes, user?.id ?? ''],
    }));
    void haptics.selection();
    try {
      const result = await toggleLike(messageId);
      // Sync с сервером (на случай рассинхрона)
      setLikes((prev) => ({
        ...prev,
        [messageId]: result.liked
          ? [...(prev[messageId] ?? []).filter((id) => id !== user?.id), user?.id ?? '']
          : (prev[messageId] ?? []).filter((id) => id !== user?.id),
      }));
    } catch (e) {
      // Откат оптимистичного UI
      console.warn('toggleLike failed', e);
      setLikes((prev) => ({ ...prev, [messageId]: prevLikes }));
    }
  };

  const handleReply = async (message: ChatMessage) => {
    if (!(await requireAuth('комментировать'))) return;
    setEditingMsg(null); // cancel editing if active
    setReplyingTo(message);
  };

  const handleEdit = (message: ChatMessage) => {
    setReplyingTo(null);
    setEditingMsg(message);
    setText(message.text);
  };

  const handleDelete = (message: ChatMessage) => {
    modal.show({
      title: t('chat.delete_title'),
      message: t('chat.delete_text'),
      buttons: [
        { label: t('common.cancel'), style: 'cancel' },
        {
          label: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            await deleteMessage(message.id);
            await loadMessages();
          },
        },
      ],
    });
  };

  // Open the universal ReportSheet for this message. When the sheet
  // closes with a result, we hide the message locally and remember it
  // so the reporter doesn't keep seeing bad content while moderation
  // reviews. The actual DB write happens inside the sheet.
  const handleReport = (item: ChatMessage) => {
    setReportTarget({ type: 'message', id: item.id, authorId: item.authorId });
  };

  const handleReportDone = async (messageId: string, result: 'sent' | 'duplicate') => {
    // Track for retro analytics; non-blocking.
    try {
      const { trackEvent } = await import('../../lib/analytics');
      await trackEvent('report_message', { message_id: messageId, result });
    } catch {}
    // Hide locally regardless of sent/duplicate — user already signalled.
    const updated = new Set(reportedIds);
    updated.add(messageId);
    setReportedIds(updated);
    await AsyncStorage.setItem('stobi:reported_messages', JSON.stringify([...updated]));
    Alert.alert(
      t('report.sent_title') || t('chat.report_title'),
      result === 'duplicate'
        ? (t('report.duplicate') || t('chat.report_sent'))
        : (t('report.sent_text') || t('chat.report_sent')),
    );
  };

  const showMessageMenu = async (item: ChatMessage) => {
    if (!(await requireAuth('взаимодействовать с сообщениями'))) return;

    const isMe = item.authorId === user?.id;

    const options: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [
      { text: t('chat.reply_action'), onPress: () => handleReply(item) },
    ];

    if (isMe) {
      options.push({
        text: t('chat.edit_action'),
        onPress: () => handleEdit(item),
      });
      options.push({
        text: t('chat.delete_action'),
        style: 'destructive',
        onPress: () => handleDelete(item),
      });
    } else {
      options.push({
        text: t('chat.report'),
        style: 'destructive',
        onPress: () => handleReport(item),
      });
    }

    options.push({ text: t('common.cancel'), style: 'cancel' });

    modal.show({
      title: t('chat.message'),
      buttons: options.map((o) => ({
        label: o.text ?? '',
        style: o.style === 'destructive' ? 'destructive' : o.style === 'cancel' ? 'cancel' : 'default',
        onPress: o.onPress,
      })),
    });
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.authorId === user?.id;
    const prev = index > 0 ? messages[index - 1] : null;
    const showAuthor = !isMe && (!prev || prev.authorId !== item.authorId);
    const messageLikes = likes[item.id] ?? [];
    const likeCount = messageLikes.length;
    const isLiked = user ? messageLikes.includes(user.id) : false;
    const isReported = reportedIds.has(item.id);
    const isBlockedAuthor = !!item.authorId && blockedIds.has(item.authorId);

    // Blocked-author messages are hidden silently (no placeholder). Block
    // is explicit intent, user shouldn't keep seeing these even collapsed.
    if (isBlockedAuthor) return null;

    const replyParent = item.replyToId
      ? messages.find((m) => m.id === item.replyToId)
      : null;

    if (isReported) {
      return (
        <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
          {!isMe && <View style={styles.avatarSlot} />}
          <View style={styles.hiddenBubble}>
            <Text style={styles.hiddenBubbleText}>{t('chat.message_hidden')}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.messageRow, isMe && styles.messageRowMe]}>
        {!isMe && (
          <View style={styles.avatarSlot}>
            {showAuthor ? (() => {
              if (item.authorPhotoUrl) {
                return (
                  <View style={styles.avatar}>
                    <SafeImage source={{ uri: item.authorPhotoUrl }} style={styles.chatPhoto} fallbackIconSize={16} />
                  </View>
                );
              }
              const s = (myStyle && user && item.authorId === user.id) ? myStyle : getUserStoneStyle(item.authorId);
              return (
                <View style={styles.avatar}>
                  <StoneMascot
                    size={42}
                    color={s.color}
                    shape={s.shape}
                    variant={s.variant}
                    decor={s.decor}
                    showSparkles={false}
                  />
                </View>
              );
            })() : null}
          </View>
        )}
        <View>
          {replyParent && (
            <View
              style={[
                styles.replyContext,
                isMe ? styles.replyContextMe : styles.replyContextOther,
              ]}
            >
              <View style={styles.replyBar} />
              <Text style={styles.replyContextText} numberOfLines={1}>
                {replyParent.authorAvatar}{' '}
                {replyParent.text || (replyParent.photo ? t('chat.photo') : '...')}
              </Text>
            </View>
          )}

          {/* Long-press opens WhatsApp-style action menu */}
          <TouchableOpacity
            activeOpacity={0.85}
            onLongPress={() => showMessageMenu(item)}
            delayLongPress={400}
            style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}
            accessibilityRole="text"
            accessibilityLabel={`${isMe ? t('chat.you') || 'Ты' : item.authorName}: ${item.text}`}
            accessibilityHint={t('chat.long_press_menu') || 'Удерживай для меню сообщения'}
          >
            {!isMe && showAuthor && (
              <View style={styles.authorRow}>
                <Text style={styles.authorName}>{item.authorName}</Text>
                {item.isArtist && (
                  <CheckCircle size={12} color={Colors.accent} weight="fill" />
                )}
              </View>
            )}
            {item.photoUri && (
              <Image source={{ uri: item.photoUri }} style={styles.bubblePhoto} />
            )}
            {!item.photoUri && item.photo && (
              <Image source={STONE_PHOTOS[item.photo]} style={styles.bubblePhoto} />
            )}
            {item.text.length > 0 && (
              <Text style={[styles.messageText, isMe && styles.messageTextMe]}>
                {item.text}
              </Text>
            )}

            {/* Footer: timestamp + like button */}
            <View style={styles.bubbleFooter}>
              <Text
                style={[styles.timestamp, isMe && styles.timestampMe]}
                numberOfLines={1}
              >
                {formatChatTime(item.createdAt)}
                {item.isEdited ? ` (${t('chat.edited')})` : ''}
              </Text>
              <TouchableOpacity
                style={styles.likeBtn}
                onPress={() => handleLike(item.id)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={isLiked ? t('chat.unlike') || 'Убрать лайк' : t('chat.like') || 'Лайк'}
                accessibilityState={{ selected: isLiked }}
              >
                <Heart
                  size={14}
                  color={
                    isLiked
                      ? '#DC2626'
                      : isMe
                        ? 'rgba(255,255,255,0.5)'
                        : Colors.text2
                  }
                  weight={isLiked ? 'fill' : 'regular'}
                />
                {likeCount > 0 && (
                  <Text
                    style={[
                      styles.likeCount,
                      isMe && styles.likeCountMe,
                      isLiked && { color: '#DC2626' },
                    ]}
                  >
                    {likeCount}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <ChatsCircle size={22} color={Colors.accent} weight="fill" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {channel === 'global' ? t('chat.global') : `${t('chat.local')} ${userCountry}`}
          </Text>
          <View style={styles.headerSubRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.headerSub}>
              {`${memberCount} ${t('chat.members')}`}
              {onlineCount > 0 ? ` · ${onlineCount} ${t('chat.online')}` : ''}
            </Text>
          </View>
        </View>
      </View>

      {/* Channel switcher */}
      <View style={styles.channelBar}>
        {([userCountry, 'global'] as const).map((ch) => {
          const active = ch === channel;
          return (
            <TouchableOpacity
              key={ch}
              style={[styles.channelChip, active && styles.channelChipActive]}
              onPress={() => {
                Keyboard.dismiss();
                userPickedChannelRef.current = true;
                setMessages([]);
                setChannel(ch);
              }}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={ch === 'global' ? t('chat.global') : String(userCountry)}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {ch === 'global'
                  ? <Globe size={15} color={active ? '#FFFFFF' : Colors.text2} weight={active ? 'fill' : 'regular'} />
                  : <MapPin size={15} color={active ? '#FFFFFF' : Colors.text2} weight={active ? 'fill' : 'regular'} />
                }
                <Text style={[styles.channelChipText, active && styles.channelChipTextActive]}>
                  {ch === 'global' ? t('chat.global') : userCountry}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1, marginBottom: 110 }}
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 80}
      >
        {loading ? (
          <View style={styles.loaderWrap}>
            <SkeletonRow count={6} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            extraData={messages.length + Object.keys(likes).length}
            contentContainerStyle={[
              styles.messagesList,
              messages.length === 0 && { flexGrow: 1, justifyContent: 'center' },
            ]}
            showsVerticalScrollIndicator={false}
            windowSize={10}
            maxToRenderPerBatch={15}
            removeClippedSubviews
            onRefresh={loadMessages}
            refreshing={false}
            ListEmptyComponent={
              <EmptyState
                title={t('chat.empty_title')}
                subtitle={t('chat.empty_subtitle')}
                mascotVariant="happy"
              />
            }
            ListHeaderComponent={
              canLoadOlder && messages.length >= 50 ? (
                <TouchableOpacity
                  style={styles.loadOlderBtn}
                  onPress={loadOlderMessages}
                  disabled={loadingOlder}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('chat.load_older') || 'Загрузить старые сообщения'}
                >
                  {loadingOlder ? (
                    <ActivityIndicator color={Colors.text2} size="small" />
                  ) : (
                    <Text style={styles.loadOlderText}>{t('chat.load_older')}</Text>
                  )}
                </TouchableOpacity>
              ) : null
            }
            onContentSizeChange={() =>
              // Автоскролл только когда в самом низу — иначе сбросит
              // позицию при загрузке older messages
              !loadingOlder &&
              flatListRef.current?.scrollToEnd({ animated: false })
            }
            onLayout={() =>
              flatListRef.current?.scrollToEnd({ animated: false })
            }
          />
        )}

        {/* Editing indicator — shows which message you're editing */}
        {editingMsg && (
          <View style={styles.editIndicator}>
            <PencilSimple size={16} color={Colors.accent} weight="bold" />
            <View style={{ flex: 1 }}>
              <Text style={styles.editIndicatorLabel}>{t('chat.editing')}</Text>
              <Text style={styles.editIndicatorText} numberOfLines={1}>
                {editingMsg.text}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setEditingMsg(null);
                setText('');
              }}
              activeOpacity={0.7}
              style={{ padding: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.replyIndicatorClose}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Reply indicator — shows which message you're replying to */}
        {replyingTo && !editingMsg && (
          <View style={styles.replyIndicator}>
            <View style={styles.replyIndicatorBar} />
            <View style={{ flex: 1 }}>
              <Text style={styles.replyIndicatorName}>
                {t('chat.reply_to')} {replyingTo.authorAvatar} {replyingTo.authorName}
              </Text>
              <Text style={styles.replyIndicatorText} numberOfLines={1}>
                {replyingTo.text || (replyingTo.photo ? t('chat.photo') : '...')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => setReplyingTo(null)}
              activeOpacity={0.7}
              style={{ padding: 6 }}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={styles.replyIndicatorClose}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Pending photo preview */}
        {pendingPhoto && (
          <View style={styles.pendingPhotoWrap}>
            <Image source={{ uri: pendingPhoto }} style={styles.pendingPhotoImg} />
            <TouchableOpacity
              style={styles.pendingPhotoClose}
              onPress={() => setPendingPhoto(null)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handleAttachPhoto}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('chat.attach_photo') || 'Приложить фото'}
          >
            <Paperclip size={22} color={Colors.text2} weight="regular" />
          </TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={t('chat.placeholder')}
            placeholderTextColor={Colors.text2}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() && !pendingPhoto) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={(!text.trim() && !pendingPhoto) || sending}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('chat.send') || 'Отправить'}
            accessibilityState={{ disabled: (!text.trim() && !pendingPhoto) || sending }}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <ArrowUp size={20} color="#FFFFFF" weight="bold" />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
      {reportTarget && (
        <ReportSheet
          visible={!!reportTarget}
          targetType="message"
          targetId={reportTarget.id}
          authorId={reportTarget.authorId}
          onClose={() => setReportTarget(null)}
          onDone={(result) => {
            const id = reportTarget.id;
            setReportTarget(null);
            handleReportDone(id, result);
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },

  // Header
  channelBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  channelChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface2,
  },
  channelChipActive: {
    backgroundColor: Colors.accent,
  },
  channelChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.text2,
  },
  channelChipTextActive: {
    color: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: Colors.surface,
  },
  headerIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
  headerSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.green,
  },
  headerSub: { fontSize: 12, color: Colors.text2 },

  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Messages
  messagesList: {
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  loadOlderBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginBottom: 12,
    borderRadius: 999,
    backgroundColor: Colors.surface2,
  },
  loadOlderText: {
    fontSize: 13,
    color: Colors.text2,
    fontWeight: '600',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  messageRowMe: {
    justifyContent: 'flex-end',
  },
  avatarSlot: {
    width: 38,
    height: 38,
  },
  chatPhoto: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  hiddenBubble: {
    backgroundColor: Colors.surface2,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    opacity: 0.6,
  },
  hiddenBubbleText: {
    fontSize: 13,
    color: Colors.text2,
    fontStyle: 'italic',
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -4,
  },
  bubble: {
    minWidth: 120,
    maxWidth: MAX_BUBBLE_W,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  bubblePhoto: {
    width: MAX_BUBBLE_W - 28,
    height: (MAX_BUBBLE_W - 28) * 0.75,
    borderRadius: 12,
    marginVertical: 6,
    backgroundColor: Colors.accentLight,
  },
  bubbleOther: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleMe: {
    backgroundColor: Colors.accent,
    borderTopRightRadius: 4,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 3,
  },
  authorName: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  messageText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 21,
  },
  messageTextMe: {
    color: '#fff',
  },
  // Footer row inside bubble (timestamp + like)
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
    gap: 6,
  },
  timestamp: {
    fontSize: 10,
    color: Colors.text2,
    flex: 1,
  },
  timestampMe: {
    color: 'rgba(255,255,255,0.65)',
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  likeCount: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.text2,
  },
  likeCountMe: {
    color: 'rgba(255,255,255,0.65)',
  },

  // Reply context — small bubble above a reply message showing parent
  replyContext: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 3,
    borderRadius: 12,
  },
  replyContextOther: {
    backgroundColor: 'rgba(91,79,240,0.1)',
  },
  replyContextMe: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'flex-end',
  },
  replyBar: {
    width: 3,
    height: '100%',
    backgroundColor: Colors.accent,
    borderRadius: 2,
    marginRight: 10,
    minHeight: 16,
  },
  replyContextText: {
    fontSize: 12,
    color: Colors.text2,
    flex: 1,
  },

  // Reply indicator above input
  replyIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.accentLight,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  replyIndicatorBar: {
    width: 4,
    height: 34,
    backgroundColor: Colors.accent,
    borderRadius: 2,
    marginRight: 10,
  },
  replyIndicatorName: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  replyIndicatorText: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 1,
  },
  replyIndicatorClose: {
    fontSize: 16,
    color: Colors.text2,
    fontWeight: '700',
  },

  // Editing indicator
  editIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.warningBg,
    borderTopWidth: 1,
    borderTopColor: Colors.warningBorder,
  },
  editIndicatorLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.accent,
  },
  editIndicatorText: {
    fontSize: 12,
    color: Colors.text2,
    marginTop: 1,
  },

  // Input bar
  pendingPhotoWrap: {
    paddingHorizontal: 16,
    paddingTop: 8,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  pendingPhotoImg: {
    width: 80,
    height: 80,
    borderRadius: 12,
  },
  pendingPhotoClose: {
    position: 'absolute',
    top: 4,
    left: 68,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 14,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    paddingHorizontal: 16,
    paddingVertical: 11,
    backgroundColor: Colors.surface2,
    borderRadius: 20,
    fontSize: 14,
    color: Colors.text,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 5,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
});
