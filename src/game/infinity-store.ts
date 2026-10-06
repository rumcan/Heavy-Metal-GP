// P2-24: what Infinity mode remembers. Only distance: no credits and no XP (there is nothing to farm, and the point is
// calm). One device-cache key through storage.ts, never localStorage.
import * as storage from './storage';

export const INFINITY_KEY = 'heavy-metal-gp:infinity:v1';

/** Where the next run's land comes from. */
export type SeedChoice = 'daily' | 'mine';

export interface InfinityRecords {
  /** The farthest any run got, in km. */
  bestKm: number;
  /** Everything ever rolled, in km. */
  totalKm: number;
  /** How many runs were started. */
  runs: number;
  /** The seed text of the last run. */
  lastSeed: string;
  /** Which seed the Roll button uses, and the text of "My seed". */
  choice: SeedChoice;
  mySeed: string;
  /** P2-25: fewer particles and no drifting motion, for players who prefer a stiller screen. */
  reduceMotion: boolean;
  /**
   * Gold rings not yet counted out: banked while rolling (a closed tab keeps them), counted out arcade-style on the
   * Infinity tab after the run (the owner), then paid as credits. `bonus` is the distance bonus, in rings.
   */
  pending: { rings: number; bonus: number; km: number };
}

/** The distance bonus for a run, in rings: 5 for every full km. */
export function distanceBonus(km: number): number {
  return Math.floor(Math.max(0, km)) * 5;
}

/** Rings collected on the road, kept until they are counted out. */
export function bankRings(rings: number): InfinityRecords {
  const r = loadRecords();
  r.pending.rings += Math.max(0, Math.floor(rings));
  saveRecords(r);
  return r;
}

/** A run is over: its distance bonus joins the rings waiting to be counted out. */
export function bankRunEnd(km: number): InfinityRecords {
  const r = loadRecords();
  if (r.pending.rings > 0 || km >= 1) { r.pending.bonus += distanceBonus(km); r.pending.km += Math.max(0, km); }
  saveRecords(r);
  return r;
}

/** The tally has been paid. */
export function clearPending(): InfinityRecords {
  const r = loadRecords();
  r.pending = { rings: 0, bonus: 0, km: 0 };
  saveRecords(r);
  return r;
}

export function emptyRecords(): InfinityRecords {
  return { bestKm: 0, totalKm: 0, runs: 0, lastSeed: '', choice: 'daily', mySeed: '', reduceMotion: false, pending: { rings: 0, bonus: 0, km: 0 } };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** A stored record, repaired field by field. */
export function normalizeRecords(value: unknown): InfinityRecords {
  const out = emptyRecords();
  if (!value || typeof value !== 'object') return out;
  const r = value as Record<string, unknown>;
  out.bestKm = num(r.bestKm);
  out.totalKm = Math.max(out.bestKm, num(r.totalKm));
  out.runs = Math.floor(num(r.runs));
  if (typeof r.lastSeed === 'string') out.lastSeed = r.lastSeed.slice(0, 40);
  if (r.choice === 'daily' || r.choice === 'mine') out.choice = r.choice;
  if (typeof r.mySeed === 'string') out.mySeed = r.mySeed.slice(0, 40);
  out.reduceMotion = r.reduceMotion === true;
  const p = r.pending as Record<string, unknown> | undefined;
  if (p && typeof p === 'object') out.pending = { rings: Math.floor(num(p.rings)), bonus: Math.floor(num(p.bonus)), km: num(p.km) };
  return out;
}

export function loadRecords(): InfinityRecords {
  try {
    const raw = storage.getItem(INFINITY_KEY);
    return raw ? normalizeRecords(JSON.parse(raw)) : emptyRecords();
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(records: InfinityRecords): void {
  storage.setItem(INFINITY_KEY, JSON.stringify(records));
}

/** P2-25: remember the Reduce motion choice. */
export function setReduceMotion(on: boolean): InfinityRecords {
  const r = loadRecords();
  r.reduceMotion = on;
  saveRecords(r);
  return r;
}

/** A run is starting on this seed. */
export function recordStart(seedText: string): InfinityRecords {
  const r = loadRecords();
  r.runs += 1;
  r.lastSeed = seedText.slice(0, 40);
  saveRecords(r);
  return r;
}

/**
 * Banks the distance rolled so far. Called when the player leaves, and now and then during a run, so the best survives
 * a closed tab. `km` is this run's distance; `alreadyBanked` is what this run has already added to the total.
 */
export function recordDistance(km: number, alreadyBanked = 0): InfinityRecords {
  const r = loadRecords();
  const safe = Math.max(0, km);
  r.bestKm = Math.max(r.bestKm, safe);
  r.totalKm += Math.max(0, safe - alreadyBanked);
  saveRecords(r);
  return r;
}

/** "Seed of the day": the same land for everyone on the same date. */
export function dailySeedText(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `day-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The seed text a run will use. */
export function seedTextFor(records: InfinityRecords, now: Date = new Date()): string {
  const mine = records.mySeed.trim();
  return records.choice === 'mine' && mine ? mine : dailySeedText(now);
}

/** A short text seed as the number the land is made from (FNV-1a). Stable for ever. */
export function seedFromText(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text.trim().toLowerCase()) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Km as the HUD writes them: 0.0 under ten, whole numbers after. */
export function formatKm(km: number): string {
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}
