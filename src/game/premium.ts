// "Unlock everything" (the owner): one purchase of about a dollar's worth of RUN Bits opens every skill, every ball
// cosmetic, every talent tier and every story chapter, now, without the levels, credits or chapters that normally
// open them.
//
// RUN is the ledger of record. The item is a Shop item (rundot/shop.config.json, `unlock_all`, a permanent
// non-consumable entitlement of the same id): `RundotGameAPI.shop.purchase` charges the Bits (the host shows its own
// confirmation and, when the player is short, its top-up), and the server grants the entitlement. On every start the
// game asks RUN again (`entitlements.getQuantity`), so a refund takes it away and a new device gets it back; between
// starts the answer is cached in storage.ts so the unlock works offline.
//
// Every lock check in the game consults `unlockAllOwned()`: loadout.lockReason (skills, online too), cosmetics.isUnlocked,
// talents' tier gate, story chapterUnlocked. Pure functions read a module flag that is false unless RUN said otherwise.
import * as storage from './storage';

/** The Shop item id AND the entitlement id on RUN: one string, never renamed (receipts are keyed by it). */
export const UNLOCK_ALL_ID = 'unlock_all';
/** The price in RUN Bits (about one US dollar). RUN's shop config is the authority; keep the two the same. */
export const UNLOCK_ALL_PRICE_BITS = 100;
export const UNLOCK_ALL_STORAGE_KEY = 'heavy-metal-gp:unlock-all';

const listeners = new Set<(owned: boolean) => void>();

/** Has this player unlocked everything? (cached in storage; `refreshUnlockAll` re-asks RUN) */
export function unlockAllOwned(): boolean {
  return storage.getItem(UNLOCK_ALL_STORAGE_KEY) === '1';
}

/** The level the talent tiers are opened by: every tier when everything is unlocked (talents.ts stays pure). */
export const ALL_TIERS_LEVEL = 999;
export function talentTierLevel(level: number): number {
  return unlockAllOwned() ? Math.max(level, ALL_TIERS_LEVEL) : level;
}

/** Record the answer (from RUN, or a test). */
export function setUnlockAll(value: boolean): void {
  if (unlockAllOwned() === value) return;
  storage.setItem(UNLOCK_ALL_STORAGE_KEY, value ? '1' : '0');
  for (const fn of listeners) { try { fn(value); } catch { /* a dead listener */ } }
}

export function onUnlockAll(fn: (owned: boolean) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

interface ShopLike {
  purchase(itemId: string, idempotencyKey: string): Promise<{ success: boolean; cancelled?: boolean }>;
}
interface EntitlementsLike { getQuantity(entitlementId: string): Promise<number> }
interface IapLike { getHardCurrencyBalance?(): Promise<number>; openStore?(): Promise<{ purchased: boolean; newBalance: number }> }
interface SdkLike { shop?: ShopLike; entitlements?: EntitlementsLike; iap?: IapLike }

let sdk: Promise<SdkLike | null> | null = null;
/** The SDK, loaded on first use (importing it touches `window`; node tests have none). */
function api(): Promise<SdkLike | null> {
  if (!sdk) {
    sdk = typeof window === 'undefined'
      ? Promise.resolve(null)
      : import('@series-inc/rundot-game-sdk/api').then((m) => m.default as unknown as SdkLike).catch(() => null);
  }
  return sdk;
}

/** Ask RUN whether this player owns the unlock (at start, and after a purchase). Unknown (offline) keeps the cache. */
export async function refreshUnlockAll(): Promise<boolean> {
  try {
    const ent = (await api())?.entitlements;
    if (!ent || typeof ent.getQuantity !== 'function') return unlockAllOwned();
    const q = await ent.getQuantity(UNLOCK_ALL_ID);
    if (typeof q === 'number' && Number.isFinite(q)) setUnlockAll(q > 0);
  } catch { /* offline or no platform: keep what we knew */ }
  return unlockAllOwned();
}

export type UnlockResult = 'unlocked' | 'cancelled' | 'unavailable' | 'error';

/**
 * Buy the unlock. RUN shows its own confirmation (and a top-up when the player is short of Bits). One idempotency key
 * per press, so a retry inside RUN's own flow never charges twice.
 */
export async function buyUnlockAll(): Promise<UnlockResult> {
  if (unlockAllOwned()) return 'unlocked';
  const sdkApi = await api();
  const shop = sdkApi?.shop;
  if (!shop || typeof shop.purchase !== 'function') return 'unavailable';
  const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  try {
    const result = await shop.purchase(UNLOCK_ALL_ID, key);
    if (!result?.success) return 'cancelled';
    setUnlockAll(true);
    void refreshUnlockAll(); // confirm with the ledger (it is the authority)
    return 'unlocked';
  } catch (error) {
    const code = String((error as { code?: string; message?: string })?.code ?? (error as Error)?.message ?? '');
    if (/USER_CANCELLED/i.test(code)) return 'cancelled';
    if (/not.?found|unknown item|404|stale/i.test(code)) return 'unavailable';
    return 'error';
  }
}
