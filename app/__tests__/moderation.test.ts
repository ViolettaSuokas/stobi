import { moderateMessage } from '../lib/moderation';

describe('moderation — ok path', () => {
  test('rejects empty string', () => {
    expect(moderateMessage('   ')).toEqual({ ok: false, reason: 'too_short' });
    expect(moderateMessage('')).toEqual({ ok: false, reason: 'too_short' });
  });

  test('accepts normal text in 3 languages', () => {
    expect(moderateMessage('Привет! Спрятал камень у церкви.')).toEqual({ ok: true });
    expect(moderateMessage('Found a beautiful stone today')).toEqual({ ok: true });
    expect(moderateMessage('Löysin kiven puistosta')).toEqual({ ok: true });
  });
});

describe('moderation — profanity', () => {
  test.each([
    ['сука'],
    ['бляд'],
    ['пошёл нахуй'],
    ['fuck off'],
    ['vittu saatana'],
  ])('blocks %s', (text) => {
    const r = moderateMessage(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('profanity');
  });

  test('blocks with capital letters / mixed case', () => {
    expect(moderateMessage('БЛЯТЬ').ok).toBe(false);
    expect(moderateMessage('FuCk').ok).toBe(false);
  });
});

describe('moderation — URLs', () => {
  test.each([
    ['visit https://example.com'],
    ['check www.vk.com'],
    ['go to t.me/channel'],
    ['mydomain.ru'],
  ])('blocks URL: %s', (text) => {
    const r = moderateMessage(text);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('link');
  });
});
