import * as storage from './storage';
import { emptyInventory, ITEM_INFO, MAX_ITEM_STACK, normalizeInventory } from './types';
import type { HeatResult, Inventory, ItemType } from './types';

export const ACCOUNT_KEY = 'mrr-account-v1';
export const STARTER_CREDITS = 400;
export const RACE_PRIZES = [500, 350, 275, 220, 180, 150, 120, 100, 80, 60] as const;
export const PEG_CREDITS = 5;

export interface RacerAccount {
  version: 1;
  credits: number;
  inventory: Inventory;
  paidRaces: string[];
  totalWinnings: number;
  finishes: number;
}

export interface RacePayout {
  raceId: string;
  placement: number;
  pegBonus: number;
  total: number;
  balance: number;
  alreadyPaid: boolean;
}

export function createAccount(): RacerAccount {
  return { version: 1, credits: STARTER_CREDITS, inventory: emptyInventory(), paidRaces: [], totalWinnings: 0, finishes: 0 };
}

export function purchaseItem(account: RacerAccount, item: ItemType): { account: RacerAccount; error?: string } {
  const info = ITEM_INFO[item];
  if (!info) return { account, error: 'Unknown item.' };
  if (account.inventory[item] >= MAX_ITEM_STACK) return { account, error: `You already own ${MAX_ITEM_STACK} ${info.name.toLowerCase()} charges.` };
  if (account.credits < info.price) return { account, error: `You need ${info.price - account.credits} more credits.` };
  return { account: { ...account, credits: account.credits - info.price, inventory: { ...account.inventory, [item]: account.inventory[item] + 1 } } };
}

/**
 * An ONLINE heat pays this fraction of a championship round (MP-09).
 *
 * Two reasons, and both are about the wallet being a real thing: a network race
 * costs nothing to enter (no season on the line, no qualifying, no calendar to
 * work through), and it is the easiest race in the game to repeat — one button
 * and you are on another grid. Paying a full round's purse for each one would
 * make the shop a formality by the end of an evening.
 */
export const ONLINE_PAYOUT_SCALE = 0.6;

/**
 * MP-09: the ID an online race is paid under.
 *
 * Every screen pays ITSELF (there is no host banker: a host that could pay its
 * guests could also not pay them), so what has to be identical on both ends is
 * not the wallet but the race — and `countdownAt` is the instant the lobby
 * published, which IS the race's identity on the wire.
 */
export function onlineRaceId(roomCode: string, countdownAt: number): string {
  return `online:${roomCode}:${Math.round(countdownAt)}`;
}

export function prizeFor(result: HeatResult): { placement: number; pegBonus: number } {
  if (result.time === null || !Number.isFinite(result.time) || result.time < 0 || !Number.isInteger(result.rank) || result.rank < 1 || result.rank > 10) {
    return { placement: 0, pegBonus: 0 };
  }
  const pegCount = Number.isFinite(result.pegs) ? Math.max(0, Math.min(5000, Math.floor(result.pegs))) : 0;
  return { placement: RACE_PRIZES[result.rank - 1], pegBonus: pegCount * PEG_CREDITS };
}

/**
 * Settle one race into the wallet, once.
 *
 * `scale` is the MP-09 hook: it is applied to both halves of the purse so the
 * payout the results screen shows still adds up (a panel that says 500 + 25 =
 * 315 is a panel nobody will believe). One is the championship, unchanged.
 */
export function settleRace(
  account: RacerAccount,
  raceId: string,
  result: HeatResult,
  scale = 1,
): { account: RacerAccount; payout: RacePayout } {
  const alreadyPaid = account.paidRaces.includes(raceId);
  const prize = prizeFor(result);
  const placement = Math.round(prize.placement * scale);
  const pegBonus = Math.round(prize.pegBonus * scale);
  const total = placement + pegBonus;
  if (alreadyPaid) return { account, payout: { raceId, placement, pegBonus, total, balance: account.credits, alreadyPaid: true } };
  const next = {
    ...account, credits: account.credits + total, totalWinnings: account.totalWinnings + total,
    finishes: account.finishes + (placement > 0 ? 1 : 0), paidRaces: [...account.paidRaces, raceId],
  };
  return { account: next, payout: { raceId, placement, pegBonus, total, balance: next.credits, alreadyPaid: false } };
}

/**
 * MP-09: an online race, paid by the screen that raced it.
 *
 * Every client settles ITSELF from the host's classification — its own seat, its
 * own wallet — at the online scale. A client that pays for a race it did not
 * finish (the host left, the results never came) pays nothing at all, which is
 * the other half of this rule.
 */
export function settleOnlineRace(account: RacerAccount, raceId: string, result: HeatResult): { account: RacerAccount; payout: RacePayout } {
  return settleRace(account, raceId, result, ONLINE_PAYOUT_SCALE);
}

export function parseAccount(raw: string | null): RacerAccount {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return createAccount();
    const account = value as Partial<RacerAccount>;
    if (account.version !== 1 || typeof account.credits !== 'number' || !Number.isFinite(account.credits) || account.credits < 0) return createAccount();
    const safeNumber = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.floor(n))) : 0;
    return {
      version: 1, credits: safeNumber(account.credits), inventory: normalizeInventory(account.inventory),
      paidRaces: Array.isArray(account.paidRaces) ? [...new Set(account.paidRaces.filter((id) => typeof id === 'string' && id.length < 180))] : [],
      totalWinnings: safeNumber(account.totalWinnings), finishes: safeNumber(account.finishes),
    };
  } catch { return createAccount(); }
}

export function loadAccount(): RacerAccount {
  try { return parseAccount(storage.getItem(ACCOUNT_KEY)); } catch { return createAccount(); }
}

export function saveAccount(account: RacerAccount) {
  try { storage.setItem(ACCOUNT_KEY, JSON.stringify(account)); } catch { /* Play remains available when storage is blocked. */ }
}