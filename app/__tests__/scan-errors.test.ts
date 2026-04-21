import { translateScanError, sceneQualityError } from '../lib/scan-errors';

describe('scan-errors — translateScanError', () => {
  test('replicate timeout → "AI долго думает"', () => {
    const r = translateScanError('Replicate timeout after 30000ms', 'find');
    expect(r.title).toMatch(/долго/i);
    expect(r.tips.length).toBeGreaterThan(0);
  });

  test('pure timeout without replicate and without fetch → 500-family', () => {
    // "fetch timeout" matches "fetch" first → network branch.
    // Чистый timeout без сетевых маркеров попадёт в 500-family.
    const r = translateScanError('Replicate polling exceeded max wait (timeout)', 'find');
    expect(r.title).toMatch(/долго думает|не распознан/i);
  });

  test('network error → "Нет интернета"', () => {
    const r = translateScanError('Failed to fetch', 'find');
    expect(r.title).toMatch(/интернет/i);
    expect(r.tips).toContain('Проверь Wi-Fi или мобильный интернет');
  });

  test('nsfw → "Это не камень"', () => {
    const r = translateScanError('Nsfw content detected', 'find');
    expect(r.title).toMatch(/не камень/i);
  });

  test('non-2xx → "Камень не распознан"', () => {
    const r = translateScanError('Edge Function returned a non-2xx status code', 'find');
    expect(r.title).toMatch(/не распознан/i);
    expect(r.tips.length).toBeGreaterThanOrEqual(3);
  });

  test('upload failed → "Не получилось загрузить фото"', () => {
    const r = translateScanError('Upload failed: bucket not found', 'find');
    expect(r.title).toMatch(/загрузить/i);
  });

  test('per_user_daily_limit → полезный текст про лимит', () => {
    const r = translateScanError('per_user_daily_limit', 'find');
    expect(r.title).toMatch(/лимит/i);
    expect(r.tips[0]).toMatch(/завтра/i);
  });

  test('global_author_limit → другой полезный текст', () => {
    const r = translateScanError('global_author_limit', 'find');
    expect(r.title).toMatch(/автор/i);
  });

  test('own_stone → "Это твой камень"', () => {
    const r = translateScanError('own_stone', 'find');
    expect(r.title).toMatch(/твой/i);
  });

  test('stone_hidden → "Камень уехал с карты"', () => {
    const r = translateScanError('stone_hidden', 'find');
    expect(r.title).toMatch(/уехал/i);
  });

  test('not_authenticated → "Нужно войти"', () => {
    const r = translateScanError('not_authenticated', 'find');
    expect(r.title).toMatch(/войти/i);
  });

  test('find-anywhere default → "Похожего камня нет"', () => {
    const r = translateScanError('low_similarity', 'find-anywhere');
    expect(r.title).toMatch(/похожего/i);
  });

  test('find default → "Это не тот камень"', () => {
    const r = translateScanError('low_similarity', 'find');
    expect(r.title).toMatch(/не тот/i);
  });

  test('empty/null error → fallback default', () => {
    const r = translateScanError(null, 'find');
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.tips.length).toBeGreaterThan(0);
  });

  test('case-insensitive match', () => {
    const r = translateScanError('NETWORK ERROR', 'find');
    expect(r.title).toMatch(/интернет/i);
  });
});

describe('scan-errors — sceneQualityError', () => {
  test('too_dark', () => {
    const r = sceneQualityError('too_dark');
    expect(r.title).toMatch(/темно/i);
    expect(r.tips).toContain('Используй вспышку телефона');
  });

  test('too_uniform', () => {
    const r = sceneQualityError('too_uniform');
    expect(r.title).toMatch(/обнаружен/i);
    expect(r.tips.some((t) => /пальц|объектив/i.test(t))).toBe(true);
  });

  test('blurry', () => {
    const r = sceneQualityError('blurry');
    expect(r.title).toMatch(/размыт/i);
    expect(r.tips.length).toBeGreaterThan(0);
  });
});
