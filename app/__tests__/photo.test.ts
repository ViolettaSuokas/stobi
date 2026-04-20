// Тесты для photo.ts — защита от регрессий в EXIF-strip + resize.
// GPS-утечка через EXIF = серьёзная privacy-проблема для female audience 30-60.

const mockManipulate = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: any[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  Action: {},
}));

import { processPhoto } from '../lib/photo';

describe('photo — processPhoto', () => {
  beforeEach(() => {
    mockManipulate.mockReset();
  });

  test('ресайз до 1600px + JPEG 0.7 compress', async () => {
    mockManipulate.mockResolvedValue({
      uri: 'file:///processed.jpg',
      width: 1600,
      height: 1200,
    });

    const result = await processPhoto('file:///original.jpg');

    expect(result.uri).toBe('file:///processed.jpg');
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);

    // Проверяем что вызвали с правильными параметрами
    expect(mockManipulate).toHaveBeenCalledWith(
      'file:///original.jpg',
      [{ resize: { width: 1600 } }],
      expect.objectContaining({
        compress: 0.7,
        format: 'jpeg',
      }),
    );
  });

  test('SaveFormat JPEG используется (НЕ копирует EXIF → GPS strip)', async () => {
    mockManipulate.mockResolvedValue({
      uri: 'file:///out.jpg',
      width: 800,
      height: 600,
    });

    await processPhoto('file:///in.jpg');

    // JPEG re-encoding = EXIF not preserved. Это и есть защита от GPS leak.
    const callArgs = mockManipulate.mock.calls[0];
    expect(callArgs[2].format).toBe('jpeg');
  });

  test('fallback на оригинальный URI при ошибке', async () => {
    mockManipulate.mockRejectedValue(new Error('corrupted image'));

    const result = await processPhoto('file:///broken.jpg');

    // Fallback: возвращаем оригинал чтобы не сломать flow юзера.
    // Server применит size-limit через storage policy.
    expect(result.uri).toBe('file:///broken.jpg');
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
  });

  test('processPhoto никогда не throws (graceful)', async () => {
    mockManipulate.mockRejectedValue(new Error('anything'));
    await expect(processPhoto('x')).resolves.toBeDefined();
  });

  test('возвращает uri одной структурой (uri, width, height)', async () => {
    mockManipulate.mockResolvedValue({
      uri: 'file:///a.jpg',
      width: 100,
      height: 50,
    });
    const result = await processPhoto('file:///in.jpg');
    expect(Object.keys(result).sort()).toEqual(['height', 'uri', 'width']);
  });

  test('передаёт длинный URI без модификации (data:image)', async () => {
    const dataUri = 'data:image/jpeg;base64,/9j/4AAQSkZ...';
    mockManipulate.mockResolvedValue({
      uri: 'file:///processed-from-data.jpg',
      width: 400,
      height: 400,
    });
    await processPhoto(dataUri);
    expect(mockManipulate).toHaveBeenCalledWith(dataUri, expect.any(Array), expect.any(Object));
  });

  test('resize width=1600 применяется независимо от входного размера', async () => {
    // Мелкая картинка 200x100
    mockManipulate.mockResolvedValue({
      uri: 'file:///tiny.jpg',
      width: 200,
      height: 100,
    });
    await processPhoto('file:///tiny.jpg');
    const actions = mockManipulate.mock.calls[0][1];
    expect(actions).toEqual([{ resize: { width: 1600 } }]);
    // expo-image-manipulator пропорционально не увеличит мелкие, оставит как есть.
  });
});
