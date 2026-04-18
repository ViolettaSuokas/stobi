// Тесты для purchases.ts. Мокаем react-native-purchases + supabase.
// Фокус: fallback-путь через Supabase profile когда RC недоступен
// (это критичный path — Expo Go, и до init RC в production)

const mockConfigure = jest.fn();
const mockGetCustomerInfo = jest.fn();
const mockGetOfferings = jest.fn();
const mockPurchasePackage = jest.fn();
const mockRestorePurchases = jest.fn();

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    configure: mockConfigure,
    getCustomerInfo: mockGetCustomerInfo,
    getOfferings: mockGetOfferings,
    purchasePackage: mockPurchasePackage,
    restorePurchases: mockRestorePurchases,
  },
}));

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: (...args: any[]) => mockSingle(...args),
    })),
  },
  isSupabaseConfigured: () => true,
}));

import {
  isPurchasesConfigured,
  checkPremiumStatus,
  purchasePackage,
  getOfferings,
  restorePurchases,
} from '../lib/purchases';

describe('purchases — isPurchasesConfigured', () => {
  test('true при sandbox key (test_...)', () => {
    // Sandbox fallback всегда truthy в тестах
    expect(isPurchasesConfigured()).toBe(true);
  });
});

describe('purchases — checkPremiumStatus Supabase fallback', () => {
  beforeEach(() => {
    mockGetUser.mockReset();
    mockSingle.mockReset();
    mockGetCustomerInfo.mockReset();
  });

  test('returns false для guest (no user)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const result = await checkPremiumStatus();
    expect(result).toBe(false);
  });

  test('returns false если profile не найден', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({ data: null, error: null });
    const result = await checkPremiumStatus();
    expect(result).toBe(false);
  });

  test('returns false если is_premium = false', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({
      data: { is_premium: false, premium_expires_at: null },
      error: null,
    });
    const result = await checkPremiumStatus();
    expect(result).toBe(false);
  });

  test('returns true если is_premium + expires_at в будущем', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({
      data: { is_premium: true, premium_expires_at: future },
      error: null,
    });
    const result = await checkPremiumStatus();
    expect(result).toBe(true);
  });

  test('returns false если is_premium но expires_at в прошлом (истёкшая подписка)', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({
      data: { is_premium: true, premium_expires_at: past },
      error: null,
    });
    const result = await checkPremiumStatus();
    expect(result).toBe(false);
  });

  test('returns true если is_premium без expires_at (lifetime)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockSingle.mockResolvedValue({
      data: { is_premium: true, premium_expires_at: null },
      error: null,
    });
    const result = await checkPremiumStatus();
    expect(result).toBe(true);
  });

  test('returns false при exception в Supabase-запросе', async () => {
    mockGetUser.mockRejectedValue(new Error('network'));
    const result = await checkPremiumStatus();
    expect(result).toBe(false);
  });
});

describe('purchases — purchasePackage/getOfferings/restore когда RC не инициализирован', () => {
  // По умолчанию в тестах RC не инициализирован (initPurchases не вызван),
  // поэтому все методы должны безопасно возвращать null/false.

  test('purchasePackage возвращает false когда Purchases=null', async () => {
    const result = await purchasePackage({ identifier: 'monthly' });
    expect(result).toBe(false);
  });

  test('getOfferings возвращает null когда Purchases=null', async () => {
    const result = await getOfferings();
    expect(result).toBeNull();
  });

  test('restorePurchases возвращает false когда Purchases=null', async () => {
    const result = await restorePurchases();
    expect(result).toBe(false);
  });
});
