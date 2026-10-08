// The owner's islands (assets/new-art/fireground_island_N.png, cut by scripts/assets/islands.mjs): big rock formations
// standing in the foreground forest, half under the trees (forest.ts places them, render.ts draws them). Art only,
// nothing to collide with. Every picture is made at start-up through art.ts, so the warm-up decodes them all before a
// race needs one.
import { artImage, artReady } from '../art';
import type { IslandPick } from './forest';

// Collected by Vite. Outside Vite (node tests) there is no import.meta.glob: the call throws and there are no pictures.
const urls: Record<string, string> = (() => {
  try { return import.meta.glob<string>('../../assets/game/platformer/islands/*.webp', { eager: true, import: 'default' }); } catch { return {}; }
})();

/**
 * One island picture and how it is sized: `w` sets its width relative to the others (400 is the usual; the long flat
 * ones with waterfalls are wider, the tall spires narrower). `rock` is where its grass and buildings end and the hanging
 * rock begins (a fraction of its height from the top).
 */
export interface IslandArt { n: number; w: number; rock: number }
export const ISLANDS: readonly IslandArt[] = [
  { n: 1, w: 560, rock: 0.42 },
  { n: 2, w: 400, rock: 0.62 },
  { n: 3, w: 400, rock: 0.6 },
  { n: 4, w: 560, rock: 0.42 },
  { n: 5, w: 360, rock: 0.55 },
  { n: 6, w: 420, rock: 0.55 },
  { n: 7, w: 420, rock: 0.55 },
  { n: 8, w: 400, rock: 0.6 },
  { n: 9, w: 400, rock: 0.62 },
  { n: 10, w: 400, rock: 0.62 },
  { n: 11, w: 400, rock: 0.62 },
  { n: 12, w: 400, rock: 0.62 },
  { n: 13, w: 250, rock: 0.62 },
  { n: 14, w: 250, rock: 0.5 },
  { n: 15, w: 420, rock: 0.58 },
];

const pictures = new Map<number, HTMLImageElement | null>(ISLANDS.map((a) => {
  const key = Object.keys(urls).find((k) => k.endsWith(`/island-${a.n}.webp`));
  return [a.n, key ? artImage(urls[key], 1) : null];
}));
/** The picture of island `n`, once it has loaded (null until then). */
export function islandPicture(n: number): HTMLImageElement | null {
  const img = pictures.get(n);
  return artReady(img) ? img : null;
}

/** A stable hash of a slot: which island, where, how big, how deep in the trees. */
export function islandHash(row: string, id: number, k: number): number {
  let h = Math.imul(id ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(k + 0x51ed27, 0x85ebca6b);
  for (let i = 0; i < row.length; i++) h = Math.imul(h ^ row.charCodeAt(i), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * The island in a slot (by its index in ISLANDS), or null for an empty one. Consecutive slots step through all fifteen
 * pictures (7 steps at a time, so neighbours differ), so every one comes round.
 */
export function islandIn(row: string, id: number, chance: number): number | null {
  if (islandHash(row, id, 0) >= chance) return null;
  const start = Math.floor(islandHash(row, 0, 9) * ISLANDS.length);
  return (((start + id * 7) % ISLANDS.length) + ISLANDS.length) % ISLANDS.length;
}

/** What forest slot `slot` holds (forest.ts islandSpots): an island, where in the slot, how big and how deep, or null. */
export function islandPick(slot: number, chance: number): IslandPick | null {
  const art = islandIn('rock', slot, chance);
  if (art === null) return null;
  return { art, at: islandHash('rock', slot, 2), size: islandHash('rock', slot, 1), sink: islandHash('rock', slot, 4) };
}
