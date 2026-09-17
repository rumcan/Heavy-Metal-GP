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

type SdkApi = typeof import('@series-inc/rundot-game-sdk/api').default;
let sdk: Promise<SdkApi | null> | null = null;
/**
 * The SDK is loaded on first use rather than at import time. Importing it touches `window` straight away, which
 * crashed every Node test that reaches the engine through this module. Without a browser there is nothing to
 * persist to, so the cache simply stays in memory. In the game `main.tsx` has already loaded the same module.
 */
function api(): Promise<SdkApi | null> {
  if (!sdk) {
    sdk = typeof window === 'undefined'
      ? Promise.resolve(null)
      : import('@series-inc/rundot-game-sdk/api').then((m) => m.default).catch(() => null);
  }
  return sdk;
}

export async function preloadStorage(): Promise<void> {
  const RundotGameAPI = await api();
  if (!RundotGameAPI) return;
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
  api().then((sdkApi) => sdkApi?.deviceCache.setItem(key, value)).catch(() => { /* storage unavailable */ });
}

export function removeItem(key: string): void {
  cache.delete(key);
  api().then((sdkApi) => sdkApi?.deviceCache.removeItem(key)).catch(() => { /* storage unavailable */ });
}
