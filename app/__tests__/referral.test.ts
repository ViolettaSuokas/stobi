import AsyncStorage from '@react-native-async-storage/async-storage';

// Мокаем supabase до импорта модуля — чтобы контролировать возвраты rpc/auth
const mockRpc = jest.fn();
const mockGetUser = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    rpc: (...args: any[]) => mockRpc(...args),
  },
  isSupabaseConfigured: () => true,
}));

import {
  getOrCreateReferralCode,
  redeemReferralCode,
  getReferralStats,
  savePendingReferralCode,
  getPendingReferralCode,
  clearPendingReferralCode,
  applyPendingReferralCode,
} from '../lib/referral';

describe('referral — getOrCreateReferralCode', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetUser.mockReset();
  });

  test('returns null когда юзер не залогинен', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const code = await getOrCreateReferralCode();
    expect(code).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('возвращает код для залогиненного юзера', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({ data: 'STOBI-ABC123', error: null });
    const code = await getOrCreateReferralCode();
    expect(code).toBe('STOBI-ABC123');
    expect(mockRpc).toHaveBeenCalledWith('get_or_create_referral_code');
  });

  test('возвращает null при RPC-ошибке', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const code = await getOrCreateReferralCode();
    expect(code).toBeNull();
  });

  test('возвращает null если RPC вернул не-string', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({ data: { foo: 'bar' }, error: null });
    const code = await getOrCreateReferralCode();
    expect(code).toBeNull();
  });
});

describe('referral — redeemReferralCode', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  test('success — возвращает bonus и newBalance', async () => {
    mockRpc.mockResolvedValue({
      data: { bonus_applied: 50, new_balance: 150 },
      error: null,
    });
    const result = await redeemReferralCode('STOBI-XYZ');
    expect(result).toEqual({ ok: true, bonus: 50, newBalance: 150 });
    expect(mockRpc).toHaveBeenCalledWith('redeem_referral_code', { p_code: 'STOBI-XYZ' });
  });

  test('cannot_redeem_own_code — пользователь ввел свой код', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot_redeem_own_code' },
    });
    const result = await redeemReferralCode('STOBI-MINE');
    expect(result).toEqual({ ok: false, reason: 'cannot_redeem_own_code' });
  });

  test('already_redeemed — повторное применение', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'already_redeemed' },
    });
    const result = await redeemReferralCode('STOBI-ABC');
    expect(result).toEqual({ ok: false, reason: 'already_redeemed' });
  });

  test('code_not_found — неверный код', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'code_not_found' },
    });
    const result = await redeemReferralCode('STOBI-WRONG');
    expect(result).toEqual({ ok: false, reason: 'code_not_found' });
  });

  test('not_authenticated — гость', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'not_authenticated' },
    });
    const result = await redeemReferralCode('STOBI-ABC');
    expect(result).toEqual({ ok: false, reason: 'not_authenticated' });
  });

  test('code_expired', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'code_expired' },
    });
    const result = await redeemReferralCode('STOBI-OLD');
    expect(result).toEqual({ ok: false, reason: 'code_expired' });
  });

  test('unknown error — generic fallback', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'some random db failure' },
    });
    const result = await redeemReferralCode('STOBI-ABC');
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });

  test('exception во время запроса', async () => {
    mockRpc.mockRejectedValue(new Error('network fail'));
    const result = await redeemReferralCode('STOBI-ABC');
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('referral — getReferralStats', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetUser.mockReset();
  });

  test('возвращает defaults для гостя', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const stats = await getReferralStats();
    expect(stats).toEqual({ invited: 0, earned: 0 });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('возвращает stats для залогиненного', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({
      data: { invited: 3, earned: 150 },
      error: null,
    });
    const stats = await getReferralStats();
    expect(stats).toEqual({ invited: 3, earned: 150 });
  });

  test('конвертирует строковые числа (на случай если БД вернет text)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({
      data: { invited: '5', earned: '250' },
      error: null,
    });
    const stats = await getReferralStats();
    expect(stats).toEqual({ invited: 5, earned: 250 });
  });

  test('возвращает zero-defaults при RPC-ошибке', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'no stats fn' } });
    const stats = await getReferralStats();
    expect(stats).toEqual({ invited: 0, earned: 0 });
  });
});

describe('referral — pending code (AsyncStorage)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test('save + get цикл', async () => {
    await savePendingReferralCode('stobi-abc');
    const code = await getPendingReferralCode();
    expect(code).toBe('STOBI-ABC'); // auto-uppercased + trimmed
  });

  test('clear удаляет код', async () => {
    await savePendingReferralCode('STOBI-XYZ');
    await clearPendingReferralCode();
    const code = await getPendingReferralCode();
    expect(code).toBeNull();
  });

  test('trim whitespace при save', async () => {
    await savePendingReferralCode('  stobi-spaces  ');
    const code = await getPendingReferralCode();
    expect(code).toBe('STOBI-SPACES');
  });
});

describe('referral — applyPendingReferralCode', () => {
  beforeEach(async () => {
    mockRpc.mockReset();
    await AsyncStorage.clear();
  });

  test('returns null если нет pending code', async () => {
    const result = await applyPendingReferralCode();
    expect(result).toBeNull();
  });

  test('применяет и очищает pending code при успехе', async () => {
    await savePendingReferralCode('STOBI-ABC');
    mockRpc.mockResolvedValue({
      data: { bonus_applied: 50, new_balance: 50 },
      error: null,
    });
    const result = await applyPendingReferralCode();
    expect(result).toEqual({ ok: true, bonus: 50, newBalance: 50 });
    // Pending code должен быть очищен даже при успехе
    const after = await getPendingReferralCode();
    expect(after).toBeNull();
  });

  test('очищает pending code даже при ошибке (чтобы не спамить)', async () => {
    await savePendingReferralCode('STOBI-BAD');
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'cannot_redeem_own_code' },
    });
    const result = await applyPendingReferralCode();
    expect(result?.ok).toBe(false);
    const after = await getPendingReferralCode();
    expect(after).toBeNull();
  });
});
