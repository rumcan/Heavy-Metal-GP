import RundotGameAPI from '@series-inc/rundot-game-sdk/api';

// RUN.world sandboxes H5 games, so `localStorage` throws there. Saves go through
// the SDK's device cache instead. It is async, so the known keys are read once at
// boot (see main.tsx) and served synchronously from memory; writes update memory
// immediately and persist in the background.
export const STORAGE_KEYS = [
  'heavy-metal-gp:portrait',
  'heavy-metal-gp:zoom',
  'heavy-metal-gp:muted',
  'mrr-account-v1',
  'mrr-season-v1',
  'heavy-metal-gp:story',
] as const;

const cache = new Map<string, string>();

export async function preloadStorage(): Promise<void> {
  await Promise.all(STORAGE_KEYS.map(async (key) => {
    try {
      const value = await RundotGameAPI.deviceCache.getItem(key);
      if (value !== null) cache.set(key, value);
    } catch { /* storage unavailable: start fresh */ }
  }));
}

export function getItem(key: string): string | null {
  return cache.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  cache.set(key, value);
  try { RundotGameAPI.deviceCache.setItem(key, value).catch(() => {}); } catch { /* storage unavailable */ }
}

export function removeItem(key: string): void {
  cache.delete(key);
  try { RundotGameAPI.deviceCache.removeItem(key).catch(() => {}); } catch { /* storage unavailable */ }
}
