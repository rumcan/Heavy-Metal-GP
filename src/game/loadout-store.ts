// P2-10: the player's saved loadout: which skill is on each of the eight keys (Q W E R / A S D F).
// One loadout for every mode for now (the ticket wants one per mode; the garage record can take it later).
// Pure rules live in loadout.ts; this file only reads and writes the device cache through storage.ts.
import * as storage from './storage';
import { ITEM_TYPES, LEGACY_ITEMS } from './types';
import type { ItemType } from './types';
import { sanitizeSkillList } from './skills/catalog';

export const LOADOUT_KEY = 'heavy-metal-gp:loadout:v1';
export type Slots = (ItemType | null)[];

/** What everybody has until they choose: the original eight items on the original keys. */
export function defaultSlots(): Slots { return [...LEGACY_ITEMS]; }

export function parseSlots(raw: string | null): Slots {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(value)) return defaultSlots();
    const known = new Set<string>(ITEM_TYPES);
    const used = new Set<string>();
    const out: Slots = [];
    for (let i = 0; i < 8; i++) {
      const id = value[i];
      if (typeof id === 'string' && known.has(id) && !used.has(id)) { out.push(id as ItemType); used.add(id); } else out.push(null);
    }
    return out.some(Boolean) ? out : defaultSlots();
  } catch { return defaultSlots(); }
}

export function loadSlots(): Slots { return parseSlots(storage.getItem(LOADOUT_KEY)); }
export function saveSlots(slots: Slots): void { storage.setItem(LOADOUT_KEY, JSON.stringify(slots)); }

/** The skills on the bar, in slot order (what an item box may drop for this driver). */
export function slotSkills(slots: Slots): ItemType[] { return slots.filter((s): s is ItemType => !!s); }
export { sanitizeSkillList };
