export const LOADOUT_SLOTS = 8;
export const SLOT_KEYS = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'] as const;
export const BUDGETS = [0, 200, 500, 1000] as const;

export interface SkillInfo {
  price: number;
  unlockLevel: number;
  starter: boolean;
}

export type Catalog = Record<string, SkillInfo>;

export interface Slot {
  skill: string;
  charges: number;
}

export type Loadout = (Slot | null)[]; // always length 8

export type LoadoutRule =
  | { kind: 'own' }
  | { kind: 'budget'; credits: number }
  | { kind: 'unlimited' };

export interface Driver {
  level: number;
  campaignComplete: boolean;
}

export function emptyLoadout(): Loadout {
  return [null, null, null, null, null, null, null, null];
}

export function setSlot(
  l: Loadout,
  index: number,
  skill: string,
  charges: number = 1
): Loadout {
  if (index < 0 || index >= LOADOUT_SLOTS) {
    return l;
  }
  const result: Loadout = Array.from({ length: LOADOUT_SLOTS }, () => null) as Loadout;
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    if (i === index) {
      result[i] = { skill, charges };
    } else if (l[i] && l[i]!.skill === skill) {
      result[i] = null;
    } else {
      result[i] = l[i] ? { ...l[i]! } : null;
    }
  }
  return result;
}

export function clearSlot(l: Loadout, index: number): Loadout {
  if (index < 0 || index >= LOADOUT_SLOTS) {
    return l;
  }
  const result: Loadout = Array.from({ length: LOADOUT_SLOTS }, () => null) as Loadout;
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    result[i] = i === index ? null : l[i] ? { ...l[i]! } : null;
  }
  return result;
}

export function loadoutCost(l: Loadout, cat: Catalog): number {
  let cost = 0;
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const slot = l[i];
    if (slot) {
      const info = cat[slot.skill];
      const price = info ? info.price : 0;
      cost += price * slot.charges;
    }
  }
  return cost;
}

export function lockReason(
  skill: string,
  cat: Catalog,
  d: Driver,
  online: boolean
): 'unknown' | 'level' | 'campaign' | null {
  const info = cat[skill];
  if (!info) {
    return 'unknown';
  }
  if (info.starter) {
    return null;
  }
  if (d.level < info.unlockLevel) {
    return 'level';
  }
  if (online && !d.campaignComplete) {
    return 'campaign';
  }
  return null;
}

export function validateLoadout(
  raw: unknown,
  cat: Catalog,
  d: Driver,
  rule: LoadoutRule,
  online: boolean,
  maxStack = 9
): { loadout: Loadout; trimmed: string[] } {
  const trimmed: string[] = [];
  if (!Array.isArray(raw)) {
    return { loadout: emptyLoadout(), trimmed: [] };
  }

  const loadout: Loadout = Array.from({ length: LOADOUT_SLOTS }, () => null) as Loadout;
  const keptSkills = new Set<string>();
  let remainingBudget = rule.kind === 'budget' ? rule.credits : Infinity;

  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const entry = raw[i];

    // Not an object with a string `skill`
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      !('skill' in entry) ||
      typeof (entry as Record<string, unknown>).skill !== 'string'
    ) {
      loadout[i] = null;
      continue;
    }

    const skill = (entry as Record<string, unknown>).skill as string;

    // lockReason not null
    const reason = lockReason(skill, cat, d, online);
    if (reason !== null) {
      loadout[i] = null;
      trimmed.push(`${skill}:${reason}`);
      continue;
    }

    // Same skill already kept earlier
    if (keptSkills.has(skill)) {
      loadout[i] = null;
      trimmed.push(`${skill}:duplicate`);
      continue;
    }

    // Charges: finite number -> floor, clamp 1..maxStack; anything else -> 1
    let charges = 1;
    const chargesRaw = (entry as Record<string, unknown>).charges;
    if (typeof chargesRaw === 'number' && Number.isFinite(chargesRaw)) {
      charges = Math.floor(chargesRaw);
      if (charges < 1) {
        charges = 1;
      } else if (charges > maxStack) {
        charges = maxStack;
      }
    }

    // Rule budget
    if (rule.kind === 'budget') {
      const info = cat[skill];
      const price = info ? info.price : 0;
      if (price > 0) {
        const totalCost = price * charges;
        if (totalCost > remainingBudget) {
          trimmed.push(`${skill}:budget`);
          const affordableCharges = Math.floor(remainingBudget / price);
          if (affordableCharges > 0) {
            const affordableChargesClamped =
              affordableCharges > maxStack ? maxStack : affordableCharges;
            charges = affordableChargesClamped < 1 ? 1 : affordableChargesClamped;
            if (charges < 1) {
              charges = 1;
            }
            loadout[i] = { skill, charges };
            keptSkills.add(skill);
            remainingBudget -= price * charges;
          } else {
            loadout[i] = null;
          }
          continue;
        }
      }
      // Fits within budget
      loadout[i] = { skill, charges };
      keptSkills.add(skill);
      remainingBudget -= price * charges;
    } else {
      // 'own' and 'unlimited' have no cost limit
      loadout[i] = { skill, charges };
      keptSkills.add(skill);
    }
  }

  return { loadout, trimmed };
}

export function dropPool(l: Loadout): string[] {
  const result: string[] = [];
  for (let i = 0; i < LOADOUT_SLOTS; i++) {
    const slot = l[i];
    if (slot) {
      result.push(slot.skill);
    }
  }
  return result;
}
