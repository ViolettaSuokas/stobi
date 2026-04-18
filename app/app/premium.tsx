import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CaretLeft,
  CheckCircle,
  Bell,
  Star,
  ShieldCheck,
} from 'phosphor-react-native';
import { router } from 'expo-router';
import { Colors } from '../constants/Colors';
import { getCurrentUser } from '../lib/auth';
import { useI18n } from '../lib/i18n';
import { useModal } from '../lib/modal';
import {
  PaywallShown,
  SubscriptionPurchased,
  BoosterPackPurchased,
  SubscriptionRestored,
} from '../lib/analytics';
import * as haptics from '../lib/haptics';

type PlanId = 'free-trial' | 'monthly' | 'annual';

const PLAN_CONFIGS = [
  { id: 'free-trial' as PlanId, labelKey: 'premium.plan_free', subKey: 'premium.plan_free_sub', price: '0,00€', badgeKey: undefined },
  { id: 'monthly' as PlanId, labelKey: 'premium.plan_monthly', subKey: 'premium.plan_monthly_sub', price: '3,99€', badgeKey: undefined },
  { id: 'annual' as PlanId, labelKey: 'premium.plan_annual', subKey: 'premium.plan_annual_sub', price: '35,00€', badgeKey: 'premium.save_badge' },
];

type BoosterId = 'pack_small' | 'pack_medium' | 'pack_large';

const BOOSTER_PACKS: { id: BoosterId; productId: string; diamonds: number; price: string; badgeKey?: string }[] = [
  { id: 'pack_small',  productId: 'stobi_pack_small',  diamonds: 100,  price: '0,99€' },
  { id: 'pack_medium', productId: 'stobi_pack_medium', diamonds: 500,  price: '3,99€', badgeKey: 'premium.popular_badge' },
  { id: 'pack_large',  productId: 'stobi_pack_large',  diamonds: 1500, price: '9,99€', badgeKey: 'premium.best_value_badge' },
];

export default function PremiumScreen() {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('free-trial');
  const { t } = useI18n();
  const modal = useModal();
  const plans = PLAN_CONFIGS.map(p => ({ ...p, label: t(p.labelKey), sub: t(p.subKey) }));

  // Трекаем paywall_shown один раз на mount — для funnel-анализа
  useEffect(() => {
    void PaywallShown('other');
  }, []);

  const handleRedeem = async () => {
    const user = await getCurrentUser();
    if (!user) {
      router.push('/register');
      return;
    }

    // Try real purchase via RevenueCat
    const { isPurchasesConfigured, getOfferings, purchasePackage } = await import('../lib/purchases');
    if (isPurchasesConfigured()) {
      try {
        const offerings = await getOfferings();
        // Map selectedPlan → RC package identifier
        const wantedId = selectedPlan === 'annual'
          ? 'stobi_annual'
          : selectedPlan === 'monthly'
            ? 'stobi_monthly'
            : 'stobi_free_trial';
        const pkg = offerings?.availablePackages?.find(
          (p: any) => p.product?.identifier === wantedId,
        ) ?? offerings?.availablePackages?.[0];
        if (pkg) {
          const success = await purchasePackage(pkg);
          if (success) {
            void haptics.success();
            // Track subscription event
            if (selectedPlan === 'monthly') void SubscriptionPurchased('monthly', 3.99);
            else if (selectedPlan === 'annual') void SubscriptionPurchased('annual', 35);
            modal.show({
              title: t('premium.success'),
              message: t('premium.success_message'),
              buttons: [{ label: t('premium.nice'), onPress: () => router.back() }],
            });
          }
          return;
        }
      } catch (e) {
        console.warn('premium purchase failed', e);
      }
    }

    // Demo mode — RevenueCat not configured yet
    const plan = plans.find((p) => p.id === selectedPlan)!;
    modal.show({
      title: t('premium.success'),
      message: t('premium.demo_message')
        .replace('{plan}', plan.label)
        .replace('{price}', plan.price),
      buttons: [{ label: t('premium.nice'), onPress: () => router.back() }],
    });
  };

  const handleBuyBooster = async (pack: typeof BOOSTER_PACKS[number]) => {
    const user = await getCurrentUser();
    if (!user) {
      router.push('/register');
      return;
    }
    const { isPurchasesConfigured, getOfferings, purchasePackage } = await import('../lib/purchases');
    if (isPurchasesConfigured()) {
      try {
        const offerings = await getOfferings();
        const pkg = offerings?.availablePackages?.find(
          (p: any) => p.product?.identifier === pack.productId,
        );
        if (pkg) {
          const success = await purchasePackage(pkg);
          if (success) {
            void haptics.success();
            const priceEur = parseFloat(pack.price.replace(',', '.').replace('€', ''));
            void BoosterPackPurchased(pack.productId, pack.diamonds, priceEur);
            modal.show({
              title: t('premium.booster_success_title'),
              message: t('premium.booster_success_message').replace('{amount}', String(pack.diamonds)),
              buttons: [{ label: t('premium.nice') }],
            });
          }
          return;
        }
      } catch (e) {
        console.warn('booster purchase failed', e);
      }
    }
    // Demo mode fallback
    modal.show({
      title: t('premium.success'),
      message: t('premium.demo_message')
        .replace('{plan}', `${pack.diamonds} 💎`)
        .replace('{price}', pack.price),
      buttons: [{ label: t('premium.nice') }],
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#4F46E5', '#5B4FF0', '#7C3AED']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.glow, styles.glowTop]} />
      <View style={[styles.glow, styles.glowBottom]} />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <CaretLeft size={22} color="#FFFFFF" weight="bold" />
          </TouchableOpacity>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {/* Title */}
          <Text style={styles.title}>{t('premium.title')}</Text>
          <Text style={styles.subtitle}>
            {t('premium.subtitle')}
          </Text>

          {/* Timeline — what happens when */}
          <View style={styles.timeline}>
            {/* Step 1: Today */}
            <View style={styles.timelineStep}>
              <View style={styles.timelineDotWrap}>
                <View style={[styles.timelineDot, styles.timelineDotActive]}>
                  <CheckCircle size={16} color="#FFFFFF" weight="fill" />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>
                  {t('premium.today')}
                </Text>
                <Text style={styles.timelineSub}>
                  {t('premium.today_sub')}
                </Text>
              </View>
            </View>

            {/* Step 2: Day 5 */}
            <View style={styles.timelineStep}>
              <View style={styles.timelineDotWrap}>
                <View style={styles.timelineDot}>
                  <Bell size={14} color="rgba(255,255,255,0.7)" weight="regular" />
                </View>
                <View style={styles.timelineLine} />
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>
                  {t('premium.day5')}
                </Text>
                <Text style={styles.timelineSub}>
                  {t('premium.day5_sub')}
                </Text>
              </View>
            </View>

            {/* Step 3: Day 7 */}
            <View style={styles.timelineStep}>
              <View style={styles.timelineDotWrap}>
                <View style={styles.timelineDot}>
                  <Star size={14} color="rgba(255,255,255,0.7)" weight="regular" />
                </View>
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineTitle}>
                  {t('premium.day7')}
                </Text>
                <Text style={styles.timelineSub}>
                  {t('premium.day7_sub')}
                </Text>
              </View>
            </View>
          </View>

          {/* Plan selector */}
          <View style={styles.plans}>
            {plans.map((plan) => {
              const active = plan.id === selectedPlan;
              return (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.planCard, active && styles.planCardActive]}
                  onPress={() => setSelectedPlan(plan.id)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${plan.label}, ${plan.price}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planLabel}>{plan.label}</Text>
                    <Text style={styles.planSub}>{plan.sub}</Text>
                  </View>
                  {plan.badgeKey && (
                    <View style={styles.planBadge}>
                      <Text style={styles.planBadgeText}>{t(plan.badgeKey)}</Text>
                    </View>
                  )}
                  <Text style={styles.planPrice}>{plan.price}</Text>
                  {active && (
                    <View style={styles.planCheck}>
                      <CheckCircle size={20} color="#FFFFFF" weight="fill" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Booster packs — instant 💎 top-up */}
          <View style={styles.boosterSection}>
            <Text style={styles.boosterHeader}>{t('premium.booster_title')}</Text>
            <Text style={styles.boosterSub}>{t('premium.booster_sub')}</Text>
            <View style={styles.boosterGrid}>
              {BOOSTER_PACKS.map((pack) => (
                <TouchableOpacity
                  key={pack.id}
                  style={styles.boosterCard}
                  onPress={() => handleBuyBooster(pack)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${pack.diamonds} diamonds for ${pack.price}`}
                >
                  {pack.badgeKey && (
                    <View style={styles.boosterBadge}>
                      <Text style={styles.boosterBadgeText}>{t(pack.badgeKey)}</Text>
                    </View>
                  )}
                  <Text style={styles.boosterDiamonds}>{pack.diamonds}</Text>
                  <Text style={styles.boosterLabel}>💎</Text>
                  <Text style={styles.boosterPrice}>{pack.price}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.ctaWrap}>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={handleRedeem}
            activeOpacity={0.85}
          >
            <Text style={styles.ctaText}>
              {selectedPlan === 'free-trial'
                ? t('premium.cta_trial')
                : selectedPlan === 'annual'
                  ? t('premium.cta_annual')
                  : t('premium.cta_monthly')}
            </Text>
          </TouchableOpacity>

          <Text style={styles.finePrint}>
            {selectedPlan === 'free-trial'
              ? t('premium.fine_trial')
              : selectedPlan === 'annual'
                ? t('premium.fine_annual')
                : t('premium.fine_monthly')}
          </Text>

          <TouchableOpacity activeOpacity={0.7} onPress={async () => {
            const { restorePurchases } = await import('../lib/purchases');
            const restored = await restorePurchases();
            if (restored) void SubscriptionRestored();
            modal.show({
              title: restored ? t('premium.success') : t('premium.restore'),
              message: restored ? t('premium.restored_message') : t('premium.no_purchases'),
              buttons: [{ label: t('common.ok') }],
            });
          }}>
            <Text style={styles.restoreLink}>{t('premium.restore')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#4F46E5' },

  glow: {
    position: 'absolute',
    width: 380,
    height: 380,
    borderRadius: 190,
    backgroundColor: '#A78BFA',
    opacity: 0.32,
  },
  glowTop: { top: -160, right: -120 },
  glowBottom: { bottom: -180, left: -140, backgroundColor: '#7C3AED', opacity: 0.28 },

  safe: { flex: 1 },

  header: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: 24, paddingBottom: 20 },

  title: {
    fontSize: 34,
    fontWeight: '900',
    color: '#FFFFFF',
    lineHeight: 40,
    letterSpacing: -0.5,
    marginTop: 20,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.78)',
    lineHeight: 20,
    marginTop: 12,
    marginBottom: 32,
  },

  // Timeline
  timeline: {
    marginBottom: 32,
  },
  timelineStep: {
    flexDirection: 'row',
    gap: 14,
  },
  timelineDotWrap: {
    alignItems: 'center',
    width: 32,
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDotActive: {
    backgroundColor: '#16A34A',
    borderColor: '#16A34A',
  },
  timelineLine: {
    width: 2,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 20,
  },
  timelineTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  timelineSub: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 18,
    marginTop: 3,
  },

  // Plans
  plans: {
    gap: 10,
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  planCardActive: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderColor: '#FFFFFF',
  },
  planLabel: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  planSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  planPrice: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    marginRight: 10,
  },
  planCheck: {
    width: 24,
    height: 24,
  },
  planBadge: {
    backgroundColor: '#FCD34D',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginRight: 8,
  },
  planBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4F46E5',
    letterSpacing: 0.3,
  },

  // Booster packs
  boosterSection: {
    marginTop: 24,
    marginBottom: 8,
  },
  boosterHeader: {
    fontSize: 14,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  boosterSub: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.65)',
    marginBottom: 12,
  },
  boosterGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  boosterCard: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    position: 'relative',
  },
  boosterBadge: {
    position: 'absolute',
    top: -6,
    backgroundColor: '#FCD34D',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    zIndex: 1,
  },
  boosterBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#4F46E5',
    letterSpacing: 0.3,
  },
  boosterDiamonds: {
    fontSize: 24,
    fontWeight: '900',
    color: '#FFFFFF',
  },
  boosterLabel: {
    fontSize: 18,
    marginTop: -2,
    marginBottom: 6,
  },
  boosterPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.85)',
  },

  // CTA
  ctaWrap: {
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 6,
    gap: 10,
  },
  ctaBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 8,
  },
  ctaText: {
    color: '#4F46E5',
    fontSize: 16,
    fontWeight: '800',
  },
  finePrint: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    lineHeight: 16,
  },
  restoreLink: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    fontWeight: '600',
    paddingVertical: 6,
    textDecorationLine: 'underline',
  },
});
