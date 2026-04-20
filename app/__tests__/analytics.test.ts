// Тесты для analytics.ts — главный фокус: silent fail при сбое Supabase,
// корректный shape payload, типизированные helpers не падают без args.

const mockInsert: jest.Mock = jest.fn();
const mockGetUser: jest.Mock = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (arg?: unknown) => mockGetUser(arg) },
    from: jest.fn(() => ({
      insert: (arg?: unknown) => mockInsert(arg),
    })),
  },
  isSupabaseConfigured: () => true,
}));

import {
  trackEvent,
  AppOpened,
  OnboardingCompleted,
  OnboardingSlideViewed,
  OnboardingSkipped,
  Registered,
  LoggedIn,
  StoneFound,
  StoneHidden,
  LocationGranted,
  LocationDenied,
  LocationPermissionSkipped,
  PaywallShown,
  SubscriptionPurchased,
  BoosterPackPurchased,
  WelcomeQuestTaskCompleted,
  WelcomeQuestFullyCompleted,
  FirstFindCelebrated,
  FirstHideCompleted,
  AuthGatePrompted,
  AuthGateConverted,
  ShareTapped,
  LanguageChanged,
} from '../lib/analytics';

describe('analytics — trackEvent core', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  test('отправляет event + user_id=null для guest', async () => {
    await trackEvent('test_event', { foo: 'bar' });
    expect(mockInsert).toHaveBeenCalledWith({
      event: 'test_event',
      user_id: null,
      metadata: { foo: 'bar' },
    });
  });

  test('отправляет event + user_id для logged-in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-123' } as any } });
    await trackEvent('test_event', { n: 5 });
    expect(mockInsert).toHaveBeenCalledWith({
      event: 'test_event',
      user_id: 'u-123',
      metadata: { n: 5 },
    });
  });

  test('default metadata = {} когда не передано', async () => {
    await trackEvent('ping');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: {},
    }));
  });

  test('не падает при exception в supabase', async () => {
    mockInsert.mockRejectedValue(new Error('network fail'));
    // warn должен вызваться но не throw
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(trackEvent('crash')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('analytics — typed helpers (не падают, передают правильный shape)', () => {
  beforeEach(() => {
    mockInsert.mockReset();
    mockInsert.mockResolvedValue({ data: null, error: null });
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: null } });
  });

  test('AppOpened', async () => {
    await AppOpened();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'app_open',
    }));
  });

  test('OnboardingSlideViewed передаёт slide_index', async () => {
    await OnboardingSlideViewed(2);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'onboarding_slide_viewed',
      metadata: { slide_index: 2 },
    }));
  });

  test('OnboardingSkipped with from_slide', async () => {
    await OnboardingSkipped(1);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'onboarding_skipped',
      metadata: { from_slide: 1 },
    }));
  });

  test('Registered принимает source: email|google|apple', async () => {
    await Registered('google');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'register',
      metadata: { source: 'google' },
    }));
  });

  test('LoggedIn принимает source: email|google|apple|demo', async () => {
    await LoggedIn('demo');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'login',
      metadata: { source: 'demo' },
    }));
  });

  test('StoneFound с stone_id + reward', async () => {
    await StoneFound('stone-abc', 5);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'stone_find',
      metadata: { stone_id: 'stone-abc', reward: 5 },
    }));
  });

  test('StoneHidden с stone_id', async () => {
    await StoneHidden('stone-xyz');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'stone_hide',
      metadata: { stone_id: 'stone-xyz' },
    }));
  });

  test('LocationGranted / LocationDenied / LocationPermissionSkipped без args', async () => {
    await LocationGranted();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event: 'location_granted' }));
    await LocationDenied();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event: 'location_denied' }));
    await LocationPermissionSkipped();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ event: 'location_permission_skipped' }));
  });

  test('PaywallShown с source', async () => {
    await PaywallShown('stone_reveal');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'paywall_shown',
      metadata: { source: 'stone_reveal' },
    }));
  });

  test('SubscriptionPurchased с plan + price', async () => {
    await SubscriptionPurchased('annual', 35);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'subscription_purchased',
      metadata: { plan: 'annual', price_eur: 35 },
    }));
  });

  test('BoosterPackPurchased с id + amount + price', async () => {
    await BoosterPackPurchased('pack_small', 100, 0.99);
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'booster_purchased',
      metadata: { pack_id: 'pack_small', amount: 100, price_eur: 0.99 },
    }));
  });

  test('Welcome Quest events', async () => {
    await WelcomeQuestTaskCompleted('hide-first');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'welcome_quest_task_completed',
      metadata: { task_id: 'hide-first' },
    }));
    await WelcomeQuestFullyCompleted();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'welcome_quest_completed',
    }));
  });

  test('First-moment events', async () => {
    await FirstFindCelebrated();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'first_find_celebrated',
    }));
    await FirstHideCompleted();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'first_hide_completed',
    }));
  });

  test('Auth-gate funnel events', async () => {
    await AuthGatePrompted('find_stone');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'auth_gate_prompted',
      metadata: { action: 'find_stone' },
    }));
    await AuthGateConverted('find_stone');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'auth_gate_converted',
      metadata: { action: 'find_stone' },
    }));
  });

  test('ShareTapped с type и опциональным refId', async () => {
    await ShareTapped('stone', 'stone-id-123');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'share_tapped',
      metadata: { type: 'stone', ref_id: 'stone-id-123' },
    }));
  });

  test('LanguageChanged с lang', async () => {
    await LanguageChanged('fi');
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'language_changed',
      metadata: { lang: 'fi' },
    }));
  });

  test('OnboardingCompleted без metadata', async () => {
    await OnboardingCompleted();
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      event: 'onboarding_completed',
      metadata: {},
    }));
  });
});
