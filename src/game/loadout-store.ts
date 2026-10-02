// P2-10: the player's saved loadout: which skill is on each of the eight keys (Q W E R / A S D F).
// P2-20: one loadout per mode (quick, championship, story, online). A mode that has never been
// saved falls back to the old shared loadout, so every pre-P2-20 bar keeps working unchanged.
// Pure rules live in loadout.ts; this file only reads and writes the device cache through storage.ts.
import * as storage from './storage';
import { ITEM_TYPES, LEGACY_ITEMS } from './types';
import type { ItemType } from './types';
import { sanitizeSkillList } from './skills/catalog';

export const LOADOUT_KEY = 'heavy-metal-gp:loadout:v1';
/** P2-20: one record holding every mode's bar — the shared key above stays as the fallback. */
export const MODED_LOADOUT_KEY = 'heavy-metal-gp:loadout:v2';
export type Slots = (ItemType | null)[];

/** P2-20: the four modes a bar is saved for (each race reads its own). */
export type LoadoutMode = 'quick' | 'championship' | 'story' | 'online';
export const LOADOUT_MODES: readonly LoadoutMode[] = ['quick', 'championship', 'story', 'online'];

/** What everybody has until they choose: the original eight items on the original keys. */
export function defaultSlots(): Slots { return [...LEGACY_ITEMS]; }

export function slotsOf(value: unknown): Slots {
  if (!Array.isArray(value)) return defaultSlots();
  const known = new Set<string>(ITEM_TYPES);
  const used = new Set<string>();
  const out: Slots = [];
  for (let i = 0; i < 8; i++) {
    const id = value[i];
    if (typeof id === 'string' && known.has(id) && !used.has(id)) { out.push(id as ItemType); used.add(id); } else out.push(null);
  }
  return out.some(Boolean) ? out : defaultSlots();
}

export function parseSlots(raw: string | null): Slots {
  try {
    return slotsOf(raw ? JSON.parse(raw) : null);
  } catch { return defaultSlots(); }
}

/** The per-mode record; anything unrecognised reads as "no mode saved yet". */
function parseModed(raw: string | null): Partial<Record<LoadoutMode, Slots>> {
  try {
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Partial<Record<LoadoutMode, Slots>> = {};
    for (const mode of LOADOUT_MODES) {
      const entry = (value as Record<string, unknown>)[mode];
      if (Array.isArray(entry)) out[mode] = slotsOf(entry);
    }
    return out;
  } catch { return {}; }
}

/**
 * P2-20: the bar a race arms. With a mode: that mode's own bar, falling back to
 * the old shared bar (migration — an old save still loads), then the defaults.
 * Without a mode the shared bar, exactly as before.
 */
export function loadSlots(mode?: LoadoutMode): Slots {
  if (!mode) return parseSlots(storage.getItem(LOADOUT_KEY));
  const saved = parseModed(storage.getItem(MODED_LOADOUT_KEY))[mode];
  if (saved) return saved;
  return parseSlots(storage.getItem(LOADOUT_KEY));
}

export function saveSlots(slots: Slots, mode?: LoadoutMode): void {
  if (!mode) { storage.setItem(LOADOUT_KEY, JSON.stringify(slots)); return; }
  const all = parseModed(storage.getItem(MODED_LOADOUT_KEY));
  all[mode] = slotsOf(slots);
  storage.setItem(MODED_LOADOUT_KEY, JSON.stringify(all));
}

/** The skills on the bar, in slot order (what an item box may drop for this driver). */
export function slotSkills(slots: Slots): ItemType[] { return slots.filter((s): s is ItemType => !!s); }
export { sanitizeSkillList };
