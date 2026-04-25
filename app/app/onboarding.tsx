import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  StatusBar,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';
import { markOnboardingSeen, hasSeenOnboarding, getCurrentUser } from '../lib/auth';
import { useI18n, type Lang } from '../lib/i18n';
import { OnboardingCompleted, OnboardingSlideViewed, OnboardingSkipped } from '../lib/analytics';
import { StoneMascot, type MascotVariant } from '../components/StoneMascot';
import { Heart } from 'phosphor-react-native';

const { width } = Dimensions.get('window');

const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
  { code: 'fi', label: 'FI' },
];

function LangPicker() {
  const { lang, setLang } = useI18n();
  return (
    <View style={onboardingExtraStyles.langWrap}>
      {LANG_OPTIONS.map((opt) => {
        const active = lang === opt.code;
        return (
          <TouchableOpacity
            key={opt.code}
            onPress={() => setLang(opt.code)}
            activeOpacity={0.7}
            style={[onboardingExtraStyles.langBtn, active && onboardingExtraStyles.langBtnActive]}
            accessibilityRole="button"
            accessibilityLabel={`Language ${opt.label}`}
            accessibilityState={{ selected: active }}
          >
            <Text style={[onboardingExtraStyles.langText, active && onboardingExtraStyles.langTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const onboardingExtraStyles = StyleSheet.create({
  langWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  langBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  langBtnActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  langText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  langTextActive: {
    color: '#1A1A2E',
  },
});

type Slide = {
  titleKey: string;
  descKey: string;
  mascotColor: string;
  mascotVariant: MascotVariant;
};

const SLIDES: Slide[] = [
  { titleKey: 'onboarding.slide1.title', descKey: 'onboarding.slide1.desc', mascotColor: '#F0ABFC', mascotVariant: 'happy' },
  { titleKey: 'onboarding.slide2.title', descKey: 'onboarding.slide2.desc', mascotColor: '#A5B4FC', mascotVariant: 'sparkle' },
  { titleKey: 'onboarding.slide3.title', descKey: 'onboarding.slide3.desc', mascotColor: '#86EFAC', mascotVariant: 'wink' },
];

/** Scene 1: Stobi хитро выглядывает из-за кустов */
function SceneHide() {
  return (
    <View style={{ width: 300, height: 280, alignItems: 'center' }}>
      {/* Stobi ЗА кустами — опущен вниз чтобы кусты закрывали тело */}
      <View style={{ position: 'absolute', top: 90, zIndex: 1 }}>
        <StoneMascot size={170} color="#F0ABFC" variant="happy" showSparkles={false} />
      </View>

      {/* Кусты ПЕРЕД маскотом — закрывают нижнюю часть */}
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 130, zIndex: 2,
      }}>
        {/* Левый куст */}
        <View style={{
          width: 140, height: 110, borderTopLeftRadius: 70, borderTopRightRadius: 55,
          borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
          backgroundColor: '#4ADE80', position: 'absolute', left: 0, bottom: 0,
        }} />
        {/* Правый куст */}
        <View style={{
          width: 150, height: 120, borderTopLeftRadius: 55, borderTopRightRadius: 70,
          borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
          backgroundColor: '#22C55E', position: 'absolute', right: 0, bottom: 0,
        }} />
        {/* Центральный куст (ниже, перекрывает стык) */}
        <View style={{
          width: 120, height: 90, borderTopLeftRadius: 60, borderTopRightRadius: 60,
          borderBottomLeftRadius: 20, borderBottomRightRadius: 20,
          backgroundColor: '#16A34A', position: 'absolute', left: 90, bottom: 0,
        }} />
        {/* Листики */}
        <View style={{
          width: 18, height: 18, borderRadius: 9, backgroundColor: '#15803D',
          position: 'absolute', left: 35, bottom: 80,
        }} />
        <View style={{
          width: 14, height: 14, borderRadius: 7, backgroundColor: '#15803D',
          position: 'absolute', right: 40, bottom: 90,
        }} />
        <View style={{
          width: 12, height: 12, borderRadius: 6, backgroundColor: '#15803D',
          position: 'absolute', left: 130, bottom: 70,
        }} />

        {/* Маленький камушек у куста */}
        <View style={{
          position: 'absolute', bottom: 15, left: 25,
          width: 28, height: 22,
          borderTopLeftRadius: 14, borderTopRightRadius: 16,
          borderBottomLeftRadius: 10, borderBottomRightRadius: 12,
          backgroundColor: '#FCD34D', transform: [{ rotate: '-8deg' }],
          zIndex: 3,
        }} />
      </View>
    </View>
  );
}

/** Scene 2: Stobi-детектив с лупой — ищет камни */
function SceneSearch() {
  return (
    <View style={{ width: 300, height: 280, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Stobi подмигивает как Шерлок */}
      <View style={{ zIndex: 1 }}>
        <StoneMascot size={180} color="#A5B4FC" variant="wink" showSparkles={false} />
      </View>

      {/* Знаки вопроса — что тут спрятано? */}
      <Text style={{
        position: 'absolute', left: 25, top: 30,
        fontSize: 32, color: 'rgba(255,255,255,0.6)',
        fontWeight: '900',
      }}>?</Text>
      <Text style={{
        position: 'absolute', left: 55, top: 10,
        fontSize: 20, color: 'rgba(255,255,255,0.4)',
        fontWeight: '900',
      }}>?</Text>

      {/* Лупа — жёлтая, поверх маскота на уровне глаза */}
      <View style={{
        position: 'absolute', right: 96, top: 130, zIndex: 2,
        alignItems: 'center',
        transform: [{ rotate: '35deg' }],
      }}>
        <View style={{
          width: 70, height: 70, borderRadius: 35,
          borderWidth: 9, borderColor: '#FCD34D',
          backgroundColor: 'rgba(252,211,69,0.1)',
        }}>
          <View style={{
            position: 'absolute', top: 11, left: 13,
            width: 18, height: 8, borderRadius: 6,
            backgroundColor: 'rgba(255,255,255,0.6)',
            transform: [{ rotate: '-20deg' }],
          }} />
        </View>
        <View style={{
          width: 12, height: 42,
          backgroundColor: '#EAB308',
          borderRadius: 6,
          marginTop: -4,
        }} />
      </View>
    </View>
  );
}

/** Scene 3: Три камня обнимаются — сообщество */
function SceneCommunity() {
  return (
    <View style={{ width: 300, height: 280, alignItems: 'center', justifyContent: 'flex-end' }}>
      {/* Сердечки — по одному над каждым маскотом */}
      <View style={{ position: 'absolute', top: 95, left: 42 }}>
        <Heart size={30} color="#EC4899" weight="fill" />
      </View>
      <View style={{ position: 'absolute', top: 70, left: 135 }}>
        <Heart size={34} color="#EC4899" weight="fill" />
      </View>
      <View style={{ position: 'absolute', top: 80, right: 42 }}>
        <Heart size={30} color="#EC4899" weight="fill" />
      </View>

      {/* Три маскота рядом, слегка перекрываются */}
      <View style={{
        flexDirection: 'row', alignItems: 'flex-end',
      }}>
        {/* Левый камень — наклонён к центру */}
        <View style={{ transform: [{ rotate: '8deg' }, { translateX: 12 }], zIndex: 1 }}>
          <StoneMascot size={110} color="#86EFAC" variant="sleeping" shape="round" showSparkles={false} />
        </View>

        {/* Центральный камень — чуть выше */}
        <View style={{ marginBottom: 15, zIndex: 2 }}>
          <StoneMascot size={120} color="#C4B5FD" variant="happy" showSparkles={false} />
        </View>

        {/* Правый камень — наклонён к центру */}
        <View style={{ transform: [{ rotate: '-8deg' }, { translateX: -12 }], zIndex: 1 }}>
          <StoneMascot size={110} color="#FCA5A5" variant="wink" shape="egg" showSparkles={false} />
        </View>
      </View>
    </View>
  );
}

export default function Onboarding() {
  const [page, setPage] = useState(0);
  const [seenBefore, setSeenBefore] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const { t } = useI18n();

  // Skip кнопка справа в углу: показываем только залогиненным юзерам.
  // Раньше — всем кто видел онбординг хоть раз. Теперь жёстче: гость без
  // аккаунта проходит онбординг до конца (там кнопка "Начать" → /map).
  // seenBefore оставляем для аналитики и потенциальных future use-cases.
  useEffect(() => {
    hasSeenOnboarding().then((seen) => setSeenBefore(seen));
    getCurrentUser().then((u) => setIsAuthed(!!u));
  }, []);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const newPage = Math.round(e.nativeEvent.contentOffset.x / width);
    if (newPage !== page) {
      setPage(newPage);
      void OnboardingSlideViewed(newPage);
    }
  };

  const goToPage = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
    setPage(index);
  };

  const finishOnboarding = async () => {
    await markOnboardingSeen();
    void OnboardingCompleted();
    // Guest-first flow: jump straight into the app, no forced login.
    // User can sign up later from the profile screen.
    router.replace('/map');
  };

  const handleNext = () => {
    if (page < SLIDES.length - 1) {
      goToPage(page + 1);
    } else {
      finishOnboarding();
    }
  };

  const handleSkip = () => {
    void OnboardingSkipped(page);
    finishOnboarding();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Soft glow blobs in the background */}
      <View style={[styles.glow, styles.glowTop]} />
      <View style={[styles.glow, styles.glowBottom]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Top bar — language picker (left) + Skip (right). Picker позволяет
            юзеру сразу переключить на свой язык — auto-detect берёт device
            locale, но если он на отельном/чужом телефоне, кнопкой меняет. */}
        <View style={styles.topBar}>
          <LangPicker />
          {isAuthed && (
            <TouchableOpacity onPress={finishOnboarding} activeOpacity={0.7}>
              <Text style={styles.skipText}>{t('onboarding.skip')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Slides */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {SLIDES.map((slide, i) => (
            <View key={i} style={[styles.slide, { width }]}>
              <View style={styles.sceneWrap}>
                {i === 0 && <View style={{ marginTop: -30 }}><SceneHide /></View>}
                {i === 1 && <SceneSearch />}
                {i === 2 && <View style={{ marginTop: -15 }}><SceneCommunity /></View>}
              </View>

              <Text style={styles.title}>{t(slide.titleKey)}</Text>
              <Text style={styles.description}>{t(slide.descKey)}</Text>
            </View>
          ))}
        </ScrollView>

        {/* Bottom bar */}
        <View style={styles.bottomBar}>
          <View style={styles.dots}>
            {SLIDES.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
            ))}
          </View>

          <TouchableOpacity style={styles.cta} onPress={handleNext} activeOpacity={0.85}>
            <Text style={styles.ctaText}>
              {page === SLIDES.length - 1 ? t('onboarding.start') : t('onboarding.next')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bgDeep,
  },

  // Soft background glow blobs
  glow: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: Colors.accent2,
    opacity: 0.35,
  },
  glowTop: {
    top: -160,
    right: -120,
  },
  glowBottom: {
    bottom: -180,
    left: -140,
    backgroundColor: '#7C3AED',
    opacity: 0.3,
  },

  safe: {
    flex: 1,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
    height: 50,
  },
  skipText: {
    color: Colors.textOnDarkMuted,
    fontSize: 14,
    fontWeight: '600',
  },

  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  sceneWrap: {
    marginBottom: 24,
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: Colors.textOnDark,
    textAlign: 'center',
    lineHeight: 38,
    marginBottom: 14,
    letterSpacing: -0.5,
  },
  description: {
    fontSize: 15,
    lineHeight: 23,
    color: Colors.textOnDarkMuted,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  bottomBar: {
    paddingHorizontal: 24,
    paddingBottom: 12,
    paddingTop: 12,
    gap: 22,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  dotActive: {
    width: 28,
    backgroundColor: '#FFFFFF',
  },
  cta: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 8,
  },
  ctaText: {
    color: Colors.bgDeep,
    fontSize: 17,
    fontWeight: '800',
  },
});
