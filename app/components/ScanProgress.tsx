// Progressive "AI is analyzing..." overlay that rotates through friendly
// messages as seconds tick by. Makes a 2-second scan feel snappy and a
// 15-second retry (Replicate rate limit) feel like a queue wait instead
// of an error.
//
// Usage:
//   <ScanProgress visible={phase === 'scanning' || phase === 'claiming'} />
//
// Sits on top of the existing scan preview / spinner; purely a text ticker.

import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Colors } from '../constants/Colors';
import { useI18n } from '../lib/i18n';

type Props = {
  visible: boolean;
  /** Override the message pipeline with a custom one (optional). */
  customMessages?: string[];
};

// Progressive stages tuned to realistic latency with retry-backoff:
//   0-2s   quick path: NSFW check done, CLIP starting
//   2-5s   CLIP compute + comparison
//   5-10s  if retry kicked in, likely Replicate 429 wait
//   10-18s second retry after longer backoff
//   >18s   final message; if still here, server probably sick
const STAGE_BREAKPOINTS = [0, 2000, 5000, 10000, 18000];

function messagesFor(t: (k: string) => string): string[] {
  return [
    t('scan_progress.looking') || 'Смотрим на твой камень...',
    t('scan_progress.recognizing') || 'Распознаём рисунок...',
    t('scan_progress.matching') || 'Сверяемся с базой...',
    t('scan_progress.queue') || 'Чуть-чуть подождём, сервер занят...',
    t('scan_progress.final') || 'Последняя попытка...',
  ];
}

function tipsFor(t: (k: string) => string): string[] {
  return [
    // Painting tips
    t('scan_progress.tip_paint_1') || '🎨 Акрил лучше всего держится на камнях — быстро сохнет, яркий',
    t('scan_progress.tip_paint_2') || '✨ Покрой готовый камень матовым лаком — защитит от дождя и мороза',
    t('scan_progress.tip_paint_3') || '🖌 Перед росписью промой и высуши камень — краска ляжет ровнее',
    t('scan_progress.tip_paint_4') || '📏 Посеми позерно разная палитра = более узнаваемый узор для AI',
    t('scan_progress.tip_paint_5') || '🌈 Чем отчётливее контур — тем точнее AI распознаёт потом',
    // Hiding tips
    t('scan_progress.tip_hide_1') || '🌳 Прячь рядом со скамейкой или деревом — там смотрят чаще',
    t('scan_progress.tip_hide_2') || '🏞 Парки и набережные = больше шансов что найдут',
    t('scan_progress.tip_hide_3') || '⛲ Детские площадки — популярно, но согласуй с родителями',
    t('scan_progress.tip_hide_4') || '🚶 Не прячь в труднодоступных местах — камни должны находиться',
    t('scan_progress.tip_hide_5') || '🙈 Чуть на виду, но не прямо под ногами — идеальное место',
    // Finding tips
    t('scan_progress.tip_find_1') || '📸 Лучшее фото при сканировании: центр кадра, ровный свет',
    t('scan_progress.tip_find_2') || '🌿 Нашёл — сразу спрячь его в другом месте, пока помнишь',
    t('scan_progress.tip_find_3') || '🔍 AI учится на каждой находке — со временем становится точнее',
    t('scan_progress.tip_find_4') || '🌟 Поделись находкой в соцсетях — получишь +5💎',
    // Fun facts & stories
    t('scan_progress.tip_fact_1') || '💡 Каждый третий камень находят в первые 48 часов',
    t('scan_progress.tip_fact_2') || '🌍 Kindness rocks движение стартовало в 2015 в США',
    t('scan_progress.tip_fact_3') || '🇫🇮 В Финляндии зимой камни лучше держатся под снегом — весной сюрприз',
    t('scan_progress.tip_fact_4') || '🪨 Самые древние painted stones в мире — 73,000 лет, найдены в Южной Африке',
    t('scan_progress.tip_fact_5') || '🎭 В 1970-х художник Miró делал серию камней-скульптур прямо на пляже',
    t('scan_progress.tip_fact_6') || '💎 Diamond — единственный камень, который можно разрезать только другим diamond',
    t('scan_progress.tip_fact_7') || '🌋 Каждый камень — остаток древнего геологического события',
    t('scan_progress.tip_fact_8') || '🧘 Японская традиция "suiseki" — любование камнями 2000 лет подряд',
    t('scan_progress.tip_fact_9') || '🏛 В Древней Греции верили что камни с дырочкой приносят удачу',
    t('scan_progress.tip_fact_10') || '⚖ Stonehenge — 4500-летнее чудо из 13-тонных камней, перенесённых за 300км',
    t('scan_progress.tip_fact_11') || '🧊 Финские гранитные камни — одни из старейших на Земле, 3 млрд лет',
    t('scan_progress.tip_fact_12') || '🌊 Речные камни круглые не из-за рыб — их обкатывает поток сотни лет',
    t('scan_progress.tip_fact_13') || '🌈 Галька бывает 7 основных цветов в зависимости от минералов',
    t('scan_progress.tip_fact_14') || '🎨 В 1950 Pablo Picasso расписывал гальку на пляже Антиб',
    t('scan_progress.tip_fact_15') || '📚 В Корее есть национальный музей 200,000 камней — каждый уникальный',
    // Stobi-specific story
    t('scan_progress.tip_stobi_1') || '🏔 Stobi назван в честь stones — но звучит как маленький лесной дух',
    t('scan_progress.tip_stobi_2') || '🎯 Первый камень Stobi был спрятан в Helsinki — найди его?',
    t('scan_progress.tip_stobi_3') || '🌱 Чем больше людей играет — тем умнее становится AI сканер',
  ];
}

export function ScanProgress({ visible, customMessages }: Props) {
  const { t } = useI18n();
  const [stageIdx, setStageIdx] = useState(0);
  const [tipIdx, setTipIdx] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pulse = useRef(new Animated.Value(0.7)).current;

  const messages = customMessages ?? messagesFor(t);
  const tips = tipsFor(t);

  useEffect(() => {
    if (!visible) {
      startRef.current = null;
      setStageIdx(0);
      return;
    }
    startRef.current = Date.now();
    // Pick a random tip each time the overlay shows so users see variety.
    setTipIdx(Math.floor(Math.random() * tips.length));

    const tick = () => {
      if (startRef.current == null) return;
      const elapsed = Date.now() - startRef.current;
      let s = 0;
      for (let i = STAGE_BREAKPOINTS.length - 1; i >= 0; i--) {
        if (elapsed >= STAGE_BREAKPOINTS[i]) { s = i; break; }
      }
      setStageIdx(Math.min(s, messages.length - 1));
      rafRef.current = requestAnimationFrame(tick) as unknown as number;
    };
    rafRef.current = requestAnimationFrame(tick) as unknown as number;

    // Rotate tip every 4s so the user has something new to read while waiting.
    const tipTimer = setInterval(() => {
      setTipIdx((i) => (i + 1) % tips.length);
    }, 4000);

    // Pulsing dot for "alive" feel.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 600, useNativeDriver: true }),
      ])
    );
    loop.start();

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      clearInterval(tipTimer);
      loop.stop();
    };
  }, [visible, messages.length, tips.length, pulse]);

  if (!visible) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Animated.View style={[styles.dot, { opacity: pulse, transform: [{ scale: pulse }] }]} />
        <Text style={styles.message} numberOfLines={2}>{messages[stageIdx]}</Text>
      </View>
      <Text style={styles.tip} numberOfLines={2}>{tips[tipIdx]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.accent,
  },
  message: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  tip: {
    color: Colors.text2,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 18,
  },
});
