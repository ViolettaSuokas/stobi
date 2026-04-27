import { useCallback, useEffect, useState } from 'react';
import { Tabs, useFocusEffect } from 'expo-router';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgeGate, needsAgeGate } from '../../components/AgeGate';
import {
  MapPin,
  SquaresFour,
  ChatsCircle,
  User,
  Plus,
  type IconProps,
} from 'phosphor-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import type { ComponentType } from 'react';
import { Colors } from '../../constants/Colors';
import { getUnreadCount } from '../../lib/chat';
import { useI18n } from '../../lib/i18n';
import * as haptics from '../../lib/haptics';
import { useTabBarVisible } from '../../lib/tab-bar-visibility';

type TabConfig = {
  labelKey: string;
  Icon: ComponentType<IconProps>;
};

const TAB_CONFIG: Record<string, TabConfig> = {
  map: { labelKey: 'tab.map', Icon: MapPin },
  feed: { labelKey: 'tab.feed', Icon: SquaresFour },
  chat: { labelKey: 'tab.chat', Icon: ChatsCircle },
  profile: { labelKey: 'tab.profile', Icon: User },
};

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [chatBadge, setChatBadge] = useState(0);
  const { t } = useI18n();
  // Скрытие при разговоре со Stobi и других fullscreen-сценариях.
  const visible = useTabBarVisible();

  useFocusEffect(
    useCallback(() => {
      getUnreadCount().then(setChatBadge);
    }, []),
  );

  if (!visible) return null;

  return (
    <View
      style={[
        styles.barContainer,
        { paddingBottom: Math.max(insets.bottom, 14) },
      ]}
    >
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const isFocused = state.index === index;
          const isAdd = route.name === 'add';

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!isFocused && !event.defaultPrevented) {
              void haptics.selection();
              navigation.navigate(route.name as never);
            }
          };

          // The center "+" button — purple square with a small white stone
          // shape inside that has a + icon, so it visually means "add a stone"
          if (isAdd) {
            return (
              <View key={route.key} style={styles.addSlot}>
                <TouchableOpacity
                  onPress={onPress}
                  activeOpacity={0.85}
                  style={styles.addBtn}
                  accessibilityRole="button"
                  accessibilityLabel={t('tab.add_stone')}
                  accessibilityHint={t('tab.add_stone_hint')}
                >
                  <View style={styles.addStone}>
                    <Plus size={16} color={Colors.accent} weight="bold" />
                  </View>
                </TouchableOpacity>
              </View>
            );
          }

          const config = TAB_CONFIG[route.name];
          if (!config) return null;
          const { Icon } = config;
          const badge = route.name === 'chat' ? chatBadge : 0;

          return (
            <TouchableOpacity
              key={route.key}
              onPress={onPress}
              activeOpacity={0.7}
              style={styles.tabItem}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={`${t(config.labelKey)}${badge > 0 ? `, ${badge} ${t('tab.unread')}` : ''}`}
            >
              <View
                style={[
                  styles.iconWrap,
                  isFocused && styles.iconWrapActive,
                ]}
              >
                <Icon
                  size={22}
                  color={isFocused ? Colors.accent : Colors.text2}
                  weight={isFocused ? 'fill' : 'regular'}
                />
                {badge > 0 && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>
                      {badge > 99 ? '99+' : badge}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[styles.label, isFocused && styles.labelActive]}>
                {t(config.labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default function TabLayout() {
  // Auto-показ AgeGate если у юзера нет birth_year. Apple/Google sign-in
  // не запрашивают год → server RPC's (create_stone, record_find_v2,
  // отправка сообщения) reject'ят с 'birth_year_required'. Пока юзер
  // не введёт год — он не может ничего делать в приложении.
  // Проверка на маунте tabs (юзер уже логинен) и при возврате на таб.
  const [showAgeGate, setShowAgeGate] = useState(false);
  useEffect(() => {
    let cancelled = false;
    needsAgeGate().then((needs) => {
      if (!cancelled && needs) setShowAgeGate(true);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="map" />
        <Tabs.Screen name="feed" />
        <Tabs.Screen name="add" />
        <Tabs.Screen name="chat" />
        <Tabs.Screen name="profile" />
      </Tabs>
      <AgeGate
        visible={showAgeGate}
        onComplete={() => setShowAgeGate(false)}
        onClose={() => setShowAgeGate(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  // Outer container — gives the bar floating padding from screen edges
  barContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: 'transparent',
  },

  // The pill-shaped bar itself
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    paddingHorizontal: 6,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: '#1A1A2E',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 14,
  },

  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    gap: 2,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: Colors.accentLight,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    color: Colors.text2,
  },
  labelActive: {
    color: Colors.accent,
    fontWeight: '700',
  },

  // Unread badge
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },

  // Center add button — now sits inside the bar, not raised above it
  addSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  // Small white stone shape inside the + button
  addStone: {
    width: 30,
    height: 24,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-4deg' }],
  },
});
