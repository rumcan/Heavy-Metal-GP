// P2-07 (#113) health rules for Heavy Metal GP.
// Pure module. No imports.

export const MAX_HP = 100;
export const REGEN_PER_SEC = 3;
export const REGEN_DELAY_MS = 5000;
export const KO_WINDOW_MS = 4000;
export const BUMP_WINDOW_MS = 2000;
export const CHARM_INVULN_MS = 1500;

export type DamageKind =
  | 'blade'
  | 'saw'
  | 'mace'
  | 'wrecker'
  | 'boulder'
  | 'crusher'
  | 'bolt'
  | 'bomb'
  | 'lightning'
  | 'spikes'
  | 'shock'
  | 'ram';

export const DAMAGE: Record<DamageKind, number> = {
  blade: 20,
  saw: 25,
  mace: 20,
  wrecker: 25,
  boulder: 30,
  crusher: 60,
  bolt: 25,
  bomb: 35,
  lightning: 30,
  spikes: 8,
  shock: 10,
  ram: 10,
};

export const KO_BOUNTY = 75;
export const KO_XP = 50;
export const KO_POINTS = 2;

export interface Health {
  hp: number;
  lastHitAt: number;
  lastHitBy: number | null;
  lastBumpAt: number;
  lastBumpedBy: number | null;
  invulnUntil: number;
  dnf: boolean;
}

export function newHealth(): Health {
  return {
    hp: MAX_HP,
    lastHitAt: -Infinity,
    lastHitBy: null,
    lastBumpAt: -Infinity,
    lastBumpedBy: null,
    invulnUntil: -Infinity,
    dnf: false,
  };
}

export interface ApplyDamageResult {
  health: Health;
  died: boolean;
  saved: boolean;
}

export function applyDamage(
  h: Health,
  amount: number,
  now: number,
  by: number | null,
  opts?: { charm?: boolean },
): ApplyDamageResult {
  // Already out of the race: nothing happens.
  if (h.dnf) {
    return { health: h, died: false, saved: false };
  }
  // Invulnerability window (e.g. Shaman's Charm just saved you).
  if (now < h.invulnUntil) {
    return { health: h, died: false, saved: false };
  }

  const nextLastHitBy = by !== null ? by : h.lastHitBy;
  let next: Health = {
    ...h,
    hp: h.hp - amount,
    lastHitAt: now,
    lastHitBy: nextLastHitBy,
  };

  if (next.hp <= 0) {
    if (opts && opts.charm) {
      next = {
        ...next,
        hp: 1,
        invulnUntil: now + CHARM_INVULN_MS,
        dnf: false,
      };
      return { health: next, died: false, saved: true };
    }
    next = { ...next, hp: 0, dnf: true };
    return { health: next, died: true, saved: false };
  }

  return { health: next, died: false, saved: false };
}

export function recordBump(h: Health, by: number, now: number): Health {
  return {
    ...h,
    lastBumpedBy: by,
    lastBumpAt: now,
  };
}

export function regen(h: Health, now: number, dtMs: number): Health {
  if (h.dnf) return h;
  if (now - h.lastHitAt < REGEN_DELAY_MS) return h;
  const healed = h.hp + (REGEN_PER_SEC * dtMs) / 1000;
  const nextHp = healed > MAX_HP ? MAX_HP : healed;
  return { ...h, hp: nextHp };
}

export function koCredit(h: Health, now: number): number | null {
  if (h.lastHitBy !== null && now - h.lastHitAt <= KO_WINDOW_MS) {
    return h.lastHitBy;
  }
  if (h.lastBumpedBy !== null && now - h.lastBumpAt <= BUMP_WINDOW_MS) {
    return h.lastBumpedBy;
  }
  return null;
}

export type FeeMode = 'championship' | 'story' | 'quick' | 'online';

export interface ShamanFee {
  due: number;
  fee: number;
  short: boolean;
  takeCharges: number;
}

export function shamanFee(mode: FeeMode, credits: number): ShamanFee {
  let due = 0;
  if (mode === 'championship' || mode === 'story') {
    due = Math.max(250, Math.round(credits * 0.3));
  } else if (mode === 'quick') {
    due = Math.max(50, Math.round(credits * 0.1));
  } else {
    due = 0;
  }
  const fee = Math.min(due, credits);
  const short = due > credits;
  const takeCharges =
    short && (mode === 'championship' || mode === 'story') ? 2 : 0;
  return { due, fee, short, takeCharges };
}