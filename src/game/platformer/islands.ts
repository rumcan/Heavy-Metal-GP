// The owner's floating islands (assets/new-art/fireground_island_N.png, cut by scripts/assets/islands.mjs) in the
// platformer's foreground: some rise out of the rows of pines in front of the track and bob there, others float high in
// the sky, now and then on a bank of cloud. Art only, nothing to collide with. Each picture is loaded the first time an
// island needs it.

const urls = import.meta.glob<string>('../../assets/game/platformer/islands/*.webp', { eager: true, import: 'default' });

/**
 * One island picture and how it is sized: `w` is its width in world px at the depth of the front pine row (a near
 * island is scaled from it like the pines are), picked per picture so each looks its size beside the trees: the long
 * flat ones with waterfalls are the widest, the tall spires the narrowest. `rock` is where its grass and buildings end
 * and the hanging rock begins (a fraction of its height from the top): what pokes out of the trees is the part above.
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

const pictures = new Map<number, HTMLImageElement | null>();
/** The picture of island `n`, once it has loaded (null until then; asking starts the load). */
export function islandPicture(n: number): HTMLImageElement | null {
  let img = pictures.get(n);
  if (img === undefined) {
    const key = Object.keys(urls).find((k) => new RegExp(`island-${n}\\.webp$`).test(k));
    img = key && typeof Image !== 'undefined' ? Object.assign(new Image(), { src: urls[key] }) : null;
    pictures.set(n, img);
  }
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

/** A stable hash of a slot (its row and its id along the row): which island, where, how big, and whether it has a cloud. */
export function islandHash(row: string, id: number, k: number): number {
  let h = Math.imul(id ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(k + 0x51ed27, 0x85ebca6b);
  for (let i = 0; i < row.length; i++) h = Math.imul(h ^ row.charCodeAt(i), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * The island in a slot, or null for an empty one. Consecutive islands along a row step through all fifteen pictures
 * (7 steps at a time, so neighbours differ), each row starting somewhere else.
 */
export function islandIn(row: string, id: number, chance: number): IslandArt | null {
  if (islandHash(row, id, 0) >= chance) return null;
  const start = Math.floor(islandHash(row, 0, 9) * ISLANDS.length);
  return ISLANDS[(((start + id * 7) % ISLANDS.length) + ISLANDS.length) % ISLANDS.length];
}
