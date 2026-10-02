import * as storage from './storage';
import { emptyInventory, ITEM_INFO, ITEM_TYPES, MAX_ITEM_STACK, normalizeInventory } from './types';
import type { HeatResult, Inventory, ItemType } from './types';
import { settle } from './settlement';
import type { PurseMode } from './settlement';

const NO_TALENTS = { prizePct: 0, pegBonusPct: 0, koBountyPct: 0, shamanFeePct: 0 };

export const ACCOUNT_KEY = 'mrr-account-v1';
export const STARTER_CREDITS = 400;
export const RACE_PRIZES = [500, 350, 275, 220, 180, 150, 120, 100, 80, 60] as const;
export const PEG_CREDITS = 5;

export interface RacerAccount {
  version: 1;
  credits: number;
  inventory: Inventory;
  /** Lifetime net pickups brought home, not capped at the nine-charge stack limit. */
  trophies: Inventory;
  /** Separate from payouts: presenting a result must never award trophies twice. */
  trophyRaces: string[];
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
  /** P2-07: credits earned for knocking rivals out (races with health). */
  koBounty?: number;
  /** P2-07: what the Shaman charged to revive a knocked-out ball (a positive amount). */
  shamanFee?: number;
}

export function createAccount(): RacerAccount {
  return { version: 1, credits: STARTER_CREDITS, inventory: emptyInventory(), trophies: emptyInventory(), trophyRaces: [], paidRaces: [], totalWinnings: 0, finishes: 0 };
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
 * MB-08 — a CUSTOM track pays this fraction.
 *
 * A player-built circuit can be made trivially farmable (short, flat, boxed
 * with pegs), so custom heats are intentionally stingy: 30 % of the calendar
 * purse before the online scale is applied. Multiplicative — an online custom
 * heat is 0.30 × 0.60 = 18 % of the offline prize, which is enough to feel
 * rewarded for finishing but not enough to make a 10-second loot loop the
 * fastest way to fill the wallet. Offline custom is 30 %; online custom is
 * 18 %. The value is small, named, and applied in one place so auditable.
 */
export const CUSTOM_PAYOUT_SCALE = 0.3;

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
  mode: PurseMode = 'championship',
): { account: RacerAccount; payout: RacePayout } {
  const alreadyPaid = account.paidRaces.includes(raceId);
  // P2-07: a race with health (result.dnf is set) is paid by the purse rules: KO bounties, and the Shaman's fee for a DNF.
  if (result.dnf !== undefined) {
    const o = { finished: result.time !== null && !result.dnf, rank: result.rank, pegs: result.pegs, kos: result.kos ?? 0, dnf: result.dnf };
    const s = settle(o, mode, account.credits, NO_TALENTS);
    const amount = (kind: string) => s.lines.find((l) => l.kind === kind)?.amount ?? 0;
    const paid: RacePayout = { raceId, placement: amount('placement'), pegBonus: amount('pegs'), koBounty: amount('kos'), shamanFee: Math.abs(amount('shaman')), total: s.total, balance: account.credits, alreadyPaid };
    if (alreadyPaid) return { account, payout: paid };
    const next = {
      ...account, credits: Math.max(0, account.credits + s.total), totalWinnings: account.totalWinnings + Math.max(0, s.total),
      finishes: account.finishes + (paid.placement > 0 ? 1 : 0), paidRaces: [...account.paidRaces, raceId],
    };
    return { account: next, payout: { ...paid, balance: next.credits } };
  }
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

/**
 * MB-08: settle a heat that was on a custom circuit.
 * @param isOnline - when true the online scale is folded in (0.30 × 0.60 = 0.18).
 */
export function settleCustomRace(account: RacerAccount, raceId: string, result: HeatResult, isOnline = false): { account: RacerAccount; payout: RacePayout } {
  const scale = isOnline ? CUSTOM_PAYOUT_SCALE * ONLINE_PAYOUT_SCALE : CUSTOM_PAYOUT_SCALE;
  return settleRace(account, raceId, result, scale);
}

/** Display note for results screens: why a custom purse is reduced. */
export const CUSTOM_PAYOUT_NOTE = 'Custom circuits pay 30% — online custom 18% — to keep farming in check. Calendar races pay full purse.';

/** Net new charges only: bought/unused starting stock is not a race trophy. */
export function keptSkills(startKit?: Inventory | null, endKit?: Inventory | null): Inventory {
  const kept = emptyInventory();
  if (!startKit || !endKit) return kept;
  const start = normalizeInventory(startKit);
  const end = normalizeInventory(endKit);
  for (const item of ITEM_TYPES) kept[item] = Math.max(0, end[item] - start[item]);
  return kept;
}

const safeNumber = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1e9, Math.floor(n))) : 0;
const raceIds = (ids: unknown): string[] => Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 180))] : [];

function normalizeTrophies(value: unknown): Inventory {
  const counts = emptyInventory();
  if (value && typeof value === 'object') {
    for (const item of ITEM_TYPES) counts[item] = safeNumber((value as Record<string, unknown>)[item]);
  }
  return counts;
}

/** Record a race's snapshots once, independently of its payout animation or DNF. */
export function addRaceTrophies(account: RacerAccount, raceId: string, startKit: Inventory, endKit: Inventory): RacerAccount {
  if (!raceId || raceId.length >= 180 || account.trophyRaces.includes(raceId)) return account;
  const kept = keptSkills(startKit, endKit);
  const trophies = { ...account.trophies };
  for (const item of ITEM_TYPES) trophies[item] = safeNumber(trophies[item] + kept[item]);
  return { ...account, trophies, trophyRaces: [...account.trophyRaces, raceId] };
}

/** Results do not own the wallet; update only its additive trophy ledger. */
export function saveRaceTrophies(raceId: string, startKit: Inventory, endKit: Inventory): void {
  const account = loadAccount();
  const next = addRaceTrophies(account, raceId, startKit, endKit);
  if (next !== account) saveAccount(next);
}

export function parseAccount(raw: string | null): RacerAccount {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object') return createAccount();
    const account = value as Partial<RacerAccount>;
    if (account.version !== 1 || typeof account.credits !== 'number' || !Number.isFinite(account.credits) || account.credits < 0) return createAccount();
    return {
      version: 1, credits: safeNumber(account.credits), inventory: normalizeInventory(account.inventory),
      // Additive v1 migration: old saves keep their wallet and start an empty shelf.
      trophies: normalizeTrophies(account.trophies), trophyRaces: raceIds(account.trophyRaces),
      paidRaces: raceIds(account.paidRaces),
      totalWinnings: safeNumber(account.totalWinnings), finishes: safeNumber(account.finishes),
    };
  } catch { return createAccount(); }
}

export function loadAccount(): RacerAccount {
  try { return parseAccount(storage.getItem(ACCOUNT_KEY)); } catch { return createAccount(); }
}

export function saveAccount(account: RacerAccount) {
  try {
    // App can still hold the pre-results account. A shop purchase or the next
    // inventory callback must not overwrite trophies recorded by the results.
    const saved = loadAccount();
    const trophies = normalizeTrophies(account.trophies);
    for (const item of ITEM_TYPES) trophies[item] = Math.max(trophies[item], saved.trophies[item]);
    const trophyRaces = raceIds([...account.trophyRaces, ...saved.trophyRaces]);
    storage.setItem(ACCOUNT_KEY, JSON.stringify({ ...account, trophies, trophyRaces }));
  } catch { /* Play remains available when storage is blocked. */ }
}
