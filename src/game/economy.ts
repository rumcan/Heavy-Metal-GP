import * as storage from './storage';
import { talentTierLevel, unlockAllOwned } from './premium';

import { emptyInventory, ITEM_INFO, ITEM_TYPES, MAX_ITEM_STACK, normalizeInventory } from './types';
import type { HeatResult, Inventory, ItemType } from './types';
import { settle } from './settlement';
import { awardXp, migrateAccount, newProgress, raceXp } from './progression';
import type { ProgressState } from './progression';
import { talentEffects, validateBuild, pointsSpent, respecCost } from './talents';
import type { Build } from './talents';
import type { PurseMode } from './settlement';
import {
  COSMETICS_STORAGE_KEY, cosmeticOptions, currentBallLook, isUnlocked, parseCosmeticsSave,
  setCurrentBallLook, unlockHint, unlockOf,
} from './cosmetics';
import type { AchievementId, BallLook, Category as CosmeticCategory, CosmeticsSave, Progress as CosmeticProgress } from './cosmetics';

const NO_TALENTS = { prizePct: 0, pegBonusPct: 0, koBountyPct: 0, shamanFeePct: 0 };

/** P2-17: the purse bonuses this account's talent build gives. */
export function purseTalents(account: RacerAccount) {
  const fx = talentEffects(account.talents ?? {});
  return { prizePct: fx.prizePct, pegBonusPct: fx.pegBonusPct, koBountyPct: fx.koBountyPct, shamanFeePct: fx.shamanFeePct };
}

/** P2-17: talent points not yet spent. */
export function freeTalentPoints(account: RacerAccount): number {
  return Math.max(0, progressOf(account).talentPoints - pointsSpent(account.talents ?? {}));
}

/** P2-17: spend a point (the caller has checked it with `canRankUp`). */
export function setTalents(account: RacerAccount, build: Build): RacerAccount {
  const p = progressOf(account);
  return { ...account, talents: validateBuild(build, talentTierLevel(p.level), p.talentPoints) };
}

/** P2-17: take every point back. The first respec is free, later ones cost 500 credits; false when it cannot be paid. */
export function respec(account: RacerAccount): { account: RacerAccount; ok: boolean; cost: number } {
  const cost = respecCost(account.respecs ?? 0);
  if (cost > account.credits) return { account, ok: false, cost };
  return { account: { ...account, talents: {}, credits: account.credits - cost, respecs: (account.respecs ?? 0) + 1 }, ok: true, cost };
}

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
  /** P2-09: XP, level and talent points. Absent on old saves: `progressOf` backfills it from `finishes`. */
  progress?: ProgressState;
  /** P2-09: the campaign has been finished (unlocks every skill online). */
  campaignComplete?: boolean;
  /** P2-17: the talent build (talent id -> rank) and how many respecs have been used (the first is free). */
  talents?: Build;
  respecs?: number;
  /** P2-18: bought ball cosmetics, stored as `category:id` tags. */
  cosmeticOwned?: string[];
  /** P2-18: race achievements that open cosmetic catalogue items. */
  cosmeticAchievements?: AchievementId[];
  /** P2-18: lifetime KOs toward the 10-KO cosmetic achievement. */
  cosmeticKos?: number;
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
  return {
    version: 1, credits: STARTER_CREDITS, inventory: emptyInventory(), trophies: emptyInventory(),
    trophyRaces: [], paidRaces: [], totalWinnings: 0, finishes: 0, progress: newProgress(),
    cosmeticOwned: [], cosmeticAchievements: [], cosmeticKos: 0,
  };
}

/** P2-09: this driver's progress; an old account gets 50 XP per past finish. */
export function progressOf(account: RacerAccount): ProgressState {
  return account.progress ?? migrateAccount(account.finishes);
}

/** P2-18: the level, purchased shelf and earned achievements used by every cosmetic gate. */
export function cosmeticProgressOf(account: RacerAccount): CosmeticProgress {
  const achievements = new Set(account.cosmeticAchievements ?? []);
  // Campaign completion predates the cosmetic shelf and is already persisted on old accounts.
  if (account.campaignComplete) achievements.add('campaign');
  return {
    level: progressOf(account).level,
    owned: [...new Set(account.cosmeticOwned ?? [])],
    achievements: [...achievements],
    ...(unlockAllOwned() ? { unlockAll: true } : {}),
  };
}

/** Load/migrate the global look through device-cache storage (never localStorage). */
export function loadCosmeticSave(): CosmeticsSave {
  const saved = parseCosmeticsSave(storage.getItem(COSMETICS_STORAGE_KEY));
  setCurrentBallLook(saved.look);
  return saved;
}

/** Persist the global look and refresh the renderer's in-memory fast path. */
export function saveCosmeticSave(value: unknown): CosmeticsSave {
  let saved: CosmeticsSave;
  try { saved = parseCosmeticsSave(JSON.stringify(value)); }
  catch { saved = parseCosmeticsSave(null); }
  storage.setItem(COSMETICS_STORAGE_KEY, JSON.stringify(saved));
  setCurrentBallLook(saved.look);
  return saved;
}

/** The active ball look; load once at UI boot and never parse a save in the frame loop. */
export function ballLookOf(): BallLook {
  return currentBallLook();
}

/** P2-09: give XP for one race (once per race id) and say which levels it earned. */
export function awardRaceXp(account: RacerAccount, raceId: string, xp: number): { account: RacerAccount; levelsGained: number[] } {
  const r = awardXp(progressOf(account), raceId, xp);
  return { account: { ...account, progress: r.state }, levelsGained: r.levelsGained };
}

export interface RaceXpAward {
  account: RacerAccount;
  /** The XP this result paid (after the Lucky Goblin), 0 when the race id was already paid. */
  xp: number;
  from: number;
  to: number;
  levelsGained: number[];
}

/**
 * P2-20: XP for one race result — the one path every mode pays through.
 *
 * `raceXp` from the result (finish, place, pegs, KOs), scaled by the account's
 * talent build, awarded ONCE per race id. `from`/`to`/`levelsGained` are what
 * the level-up card on the results screen reads.
 */
export function awardResultXp(account: RacerAccount, raceId: string, result: HeatResult): RaceXpAward {
  const finished = result.time !== null && !result.dnf;
  const xp = Math.round(
    raceXp({ finished, rank: result.rank, pegs: result.pegs, kos: result.kos ?? 0, beatBest: false })
      * (1 + (talentEffects(account.talents ?? {}).xpPct ?? 0) / 100),
  );
  const from = progressOf(account).level;
  const r = awardRaceXp(account, raceId, xp);
  return { account: r.account, xp, from, to: progressOf(r.account).level, levelsGained: r.levelsGained };
}

function readProgress(value: unknown): ProgressState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Partial<ProgressState>;
  if (typeof p.xp !== 'number' || !Number.isFinite(p.xp) || p.xp < 0 || typeof p.level !== 'number' || typeof p.talentPoints !== 'number') return undefined;
  return { xp: p.xp, level: Math.max(1, Math.min(30, Math.floor(p.level))), talentPoints: Math.max(0, Math.floor(p.talentPoints)), awarded: Array.isArray(p.awarded) ? p.awarded.filter((x): x is string => typeof x === 'string').slice(-200) : [] };
}

export function purchaseItem(account: RacerAccount, item: ItemType): { account: RacerAccount; error?: string } {
  const info = ITEM_INFO[item];
  if (!info) return { account, error: 'Unknown item.' };
  if (account.inventory[item] >= MAX_ITEM_STACK) return { account, error: `You already own ${MAX_ITEM_STACK} ${info.name.toLowerCase()} charges.` };
  if (account.credits < info.price) return { account, error: `You need ${info.price - account.credits} more credits.` };
  return { account: { ...account, credits: account.credits - info.price, inventory: { ...account.inventory, [item]: account.inventory[item] + 1 } } };
}

/** P2-18: buy one catalogue item with CR. Non-credit locks cannot be bypassed. */
export function purchaseCosmetic(account: RacerAccount, category: CosmeticCategory, id: string): { account: RacerAccount; error?: string } {
  const unlock = unlockOf(category, id);
  if (!unlock) return { account, error: 'Unknown cosmetic.' };
  const progress = cosmeticProgressOf(account);
  if (isUnlocked(category, id, progress)) return { account, error: 'You already own this cosmetic.' };
  if (unlock.kind !== 'credits') return { account, error: unlockHint(category, id) };
  if (account.credits < unlock.price) return { account, error: `You need ${unlock.price - account.credits} more credits.` };
  const tag = `${category}:${id}`;
  return {
    account: {
      ...account,
      credits: account.credits - unlock.price,
      cosmeticOwned: [...new Set([...(account.cosmeticOwned ?? []), tag])],
    },
  };
}

/** Gate a look's selectable ids against the driver's current account. */
export function unlockedCosmeticLook(look: BallLook, account: RacerAccount): BallLook {
  const progress = cosmeticProgressOf(account);
  const candidate = { ...look };
  const categories: CosmeticCategory[] = ['material', 'pattern', 'trail', 'koBurst', 'finishFx'];
  for (const category of categories) {
    const id = candidate[category];
    if (!isUnlocked(category, id, progress)) {
      const fallback = category === 'material' ? 'steel' : category === 'pattern' ? 'plain' : category === 'trail' ? 'none' : category === 'koBurst' ? 'classic' : 'flag';
      (candidate as unknown as Record<string, string>)[category] = fallback;
    }
  }
  return candidate;
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

/** Achievement ledger for one newly settled race. Caller enforces the race-id guard. */
function awardCosmeticAchievements(account: RacerAccount, result: HeatResult): RacerAccount {
  const achievements = new Set(account.cosmeticAchievements ?? []);
  if (account.campaignComplete) achievements.add('campaign');
  const gainedKos = Number.isFinite(result.kos) ? Math.max(0, Math.floor(result.kos ?? 0)) : 0;
  const cosmeticKos = safeNumber((account.cosmeticKos ?? 0) + gainedKos);
  if (result.time !== null && !result.dnf && result.rank === 1) achievements.add('first-win');
  if (cosmeticKos >= 10) achievements.add('ten-kos');
  if (Number.isFinite(result.pegs) && result.pegs >= 50) achievements.add('pegs-50');
  return { ...account, cosmeticKos, cosmeticAchievements: [...achievements] };
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
    const s = settle(o, mode, account.credits, account.talents ? purseTalents(account) : NO_TALENTS);
    const amount = (kind: string) => s.lines.find((l) => l.kind === kind)?.amount ?? 0;
    const paid: RacePayout = { raceId, placement: amount('placement'), pegBonus: amount('pegs'), koBounty: amount('kos'), shamanFee: Math.abs(amount('shaman')), total: s.total, balance: account.credits, alreadyPaid };
    if (alreadyPaid) return { account, payout: paid };
    const next = awardCosmeticAchievements({
      ...account, credits: Math.max(0, account.credits + s.total), totalWinnings: account.totalWinnings + Math.max(0, s.total),
      finishes: account.finishes + (paid.placement > 0 ? 1 : 0), paidRaces: [...account.paidRaces, raceId],
    }, result);
    return { account: next, payout: { ...paid, balance: next.credits } };
  }
  const prize = prizeFor(result);
  const placement = Math.round(prize.placement * scale);
  const pegBonus = Math.round(prize.pegBonus * scale);
  const total = placement + pegBonus;
  if (alreadyPaid) return { account, payout: { raceId, placement, pegBonus, total, balance: account.credits, alreadyPaid: true } };
  const next = awardCosmeticAchievements({
    ...account, credits: account.credits + total, totalWinnings: account.totalWinnings + total,
    finishes: account.finishes + (placement > 0 ? 1 : 0), paidRaces: [...account.paidRaces, raceId],
  }, result);
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
  // P2-19: online is its own purse mode. The stakes are the same 0.6 scale, but the Shaman does not
  // charge a knocked-out driver on the wire — an online DNF costs the race, not the wallet.
  return settleRace(account, raceId, result, ONLINE_PAYOUT_SCALE, 'online');
}

/**
 * MB-08: settle a heat that was on a custom circuit.
 * @param isOnline - when true the online scale is folded in (0.30 × 0.60 = 0.18).
 */
export function settleCustomRace(account: RacerAccount, raceId: string, result: HeatResult, isOnline = false): { account: RacerAccount; payout: RacePayout } {
  const scale = isOnline ? CUSTOM_PAYOUT_SCALE * ONLINE_PAYOUT_SCALE : CUSTOM_PAYOUT_SCALE;
  // P2-19: an online custom heat pays KO bounties too, and still owes the Shaman nothing.
  return settleRace(account, raceId, result, scale, isOnline ? 'online-custom' : 'championship');
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

const COSMETIC_CATEGORIES: readonly CosmeticCategory[] = ['material', 'pattern', 'trail', 'koBurst', 'finishFx'];
const ACHIEVEMENT_IDS: readonly AchievementId[] = ['first-win', 'ten-kos', 'campaign', 'pegs-50'];

function readCosmeticOwned(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => {
    if (typeof item !== 'string' || item.length > 64) return false;
    const split = item.indexOf(':');
    if (split <= 0) return false;
    const category = item.slice(0, split) as CosmeticCategory;
    const id = item.slice(split + 1);
    return COSMETIC_CATEGORIES.includes(category)
      && cosmeticOptions(category).some((option) => option.id === id)
      && unlockOf(category, id)?.kind === 'credits';
  }))];
}

function readCosmeticAchievements(value: unknown): AchievementId[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is AchievementId => typeof item === 'string' && ACHIEVEMENT_IDS.includes(item as AchievementId)))]
    : [];
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
      cosmeticOwned: readCosmeticOwned(account.cosmeticOwned),
      cosmeticAchievements: readCosmeticAchievements(account.cosmeticAchievements),
      cosmeticKos: safeNumber(account.cosmeticKos),
      ...(readProgress(account.progress) ? { progress: readProgress(account.progress) } : {}), ...(account.campaignComplete === true ? { campaignComplete: true } : {}),
      ...(readProgress(account.progress) && account.talents ? { talents: validateBuild(account.talents, talentTierLevel(readProgress(account.progress)!.level), readProgress(account.progress)!.talentPoints) } : {}),
      ...(typeof account.respecs === 'number' && account.respecs > 0 ? { respecs: Math.floor(account.respecs) } : {}),
    };
  } catch { return createAccount(); }
}

export function loadAccount(): RacerAccount {
  try {
    const account = parseAccount(storage.getItem(ACCOUNT_KEY));
    loadCosmeticSave(); // initialize the cached, global look before any race frame draws
    return account;
  } catch { return createAccount(); }
}

export function saveAccount(account: RacerAccount) {
  try {
    // App can still hold the pre-results account. A shop purchase or the next
    // inventory callback must not overwrite trophies recorded by the results.
    const saved = loadAccount();
    const trophies = normalizeTrophies(account.trophies);
    for (const item of ITEM_TYPES) trophies[item] = Math.max(trophies[item], saved.trophies[item]);
    const trophyRaces = raceIds([...account.trophyRaces, ...saved.trophyRaces]);
    const cosmeticOwned = readCosmeticOwned([...(account.cosmeticOwned ?? []), ...(saved.cosmeticOwned ?? [])]);
    const cosmeticAchievements = readCosmeticAchievements([...(account.cosmeticAchievements ?? []), ...(saved.cosmeticAchievements ?? [])]);
    const cosmeticKos = Math.max(safeNumber(account.cosmeticKos), safeNumber(saved.cosmeticKos));
    storage.setItem(ACCOUNT_KEY, JSON.stringify({ ...account, trophies, trophyRaces, cosmeticOwned, cosmeticAchievements, cosmeticKos }));
  } catch { /* Play remains available when storage is blocked. */ }
}
