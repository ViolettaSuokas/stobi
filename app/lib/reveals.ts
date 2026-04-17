import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'stobi:revealed_stones';

async function read(): Promise<string[]> {
  try {
    const json = await AsyncStorage.getItem(STORAGE_KEY);
    return json ? JSON.parse(json) : [];
  } catch {
    return [];
  }
}

async function write(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export async function isStoneRevealed(stoneId: string): Promise<boolean> {
  const ids = await read();
  return ids.includes(stoneId);
}

export async function revealStone(stoneId: string): Promise<void> {
  const ids = await read();
  if (!ids.includes(stoneId)) {
    ids.push(stoneId);
    await write(ids);
  }
}

export async function getRevealedStoneIds(): Promise<string[]> {
  return read();
}
