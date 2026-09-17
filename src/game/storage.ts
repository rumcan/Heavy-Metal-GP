// RUN.world sandboxes H5 games, so `localStorage` throws there. Saves go through
// the SDK's device cache instead. It is async, so the known keys are read once at
// boot (see main.tsx) and served synchronously from memory; writes update memory
// immediately and persist in the background.
//
// The cache is BOUND, not imported. This module is imported by `season.ts`,
// which is imported by the championship — and, until MP-04, by `engine.ts`. A
// static SDK import here meant that constructing a `Game` in node (every
// physics regression check, every simulation test) died on
// `window is not defined` before a single line of test ran: the SDK builds its
// API object at module scope and reads `window.innerWidth` doing it. One
// `bindStorage` call at boot, and the simulation's import tree is its own.
export const STORAGE_KEYS = [
  'heavy-metal-gp:portrait',
  'heavy-metal-gp:zoom',
  'heavy-metal-gp:muted',
  'mrr-account-v1',
  'mrr-season-v1',
  'heavy-metal-gp:story',
] as const;

/** The slice of the SDK this module needs — small enough to fake in a test. */
export interface DeviceCache {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}

let deviceCache: DeviceCache | null = null;
const cache = new Map<string, string>();

/** Hand the SDK's device cache to the game. Called once at boot, from `main.tsx`. */
export function bindStorage(cache: DeviceCache): void {
  deviceCache = cache;
}

export async function preloadStorage(): Promise<void> {
  const sdk = deviceCache;
  if (!sdk) return; // nothing bound (a node test): the in-memory cache still serves
  await Promise.all(STORAGE_KEYS.map(async (key) => {
    try {
      const value = await sdk.getItem(key);
      if (value !== null) cache.set(key, value);
    } catch { /* storage unavailable: start fresh */ }
  }));
}

export function getItem(key: string): string | null {
  return cache.get(key) ?? null;
}

export function setItem(key: string, value: string): void {
  cache.set(key, value);
  try { void deviceCache?.setItem(key, value); } catch { /* storage unavailable */ }
}

export function removeItem(key: string): void {
  cache.delete(key);
  try { void deviceCache?.removeItem(key); } catch { /* storage unavailable */ }
}
