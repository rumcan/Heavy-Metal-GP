// The owner's big cliff mountains (assets/new-art/large_cliff_{back,front}N.png, cut by scripts/assets/cliffs.mjs): huge
// rock mountains with waterfalls and castles on a bed of cloud, standing in the sky right behind the back track (the
// owner: only for the very back track; the "back" ones furthest away, the "front" ones in front of them, larger and
// closer to the track). Art only, nothing to collide with. Placed here (pure), drawn by render.ts.
//
// They slide sideways much slower than the back track (they are far away), each layer at its own speed, and they never
// move up or down on the screen (the owner): no hill, slope, descent or speed zoom moves them; your own zoom grows them.
import { artImage, artReady } from '../art';

// Collected by Vite. Outside Vite (node tests) there is no import.meta.glob: the call throws and there are no pictures.
const urls: Record<string, string> = (() => {
  try { return import.meta.glob<string>('../../assets/game/platformer/cliffs/*.webp', { eager: true, import: 'default' }); } catch { return {}; }
})();

export type CliffKind = 'back' | 'front';

/**
 * A layer of cliffs. `p`: its sideways speed over the back track's. `width`: a cliff's width over the larger of the
 * screen's width and 1.3 times its height. `slot`: one cliff or none per this many px of the layer (in screen widths of
 * that same measure). `chance`: how many slots have one. `rise`: how far above the back track its cloud base stands (in
 * screen heights: further away looks higher). `sink`: how much of its height is under that line (its clouds behind the
 * track). `haze`: its own distance haze, on top of the back track's. `zoomPow`: how much of your zoom it takes (far
 * away, a zoom barely changes it: zoom ** zoomPow; the owner: they are big and only get a little smaller zoomed out).
 */
export interface CliffLayer { kind: CliffKind; p: number; width: number; slot: number; chance: number; rise: number; sink: number; haze: number; zoomPow: number }
// (slow, the owner: faster than the painted backdrop behind them, nowhere near as fast as the track; their feet sunk
// in the owner's cloud, never floating)
export const CLIFF_LAYERS: readonly CliffLayer[] = [
  { kind: 'back', p: 0.1, width: 0.55, slot: 1.0, chance: 0.85, rise: 0.02, sink: 0.14, haze: 0.22, zoomPow: 0.12 },
  { kind: 'front', p: 0.17, width: 0.82, slot: 1.45, chance: 0.7, rise: -0.02, sink: 0.18, haze: 0.05, zoomPow: 0.22 },
];

const pictures = new Map<string, HTMLImageElement | null>();
for (const kind of ['back', 'front'] as const) {
  for (let n = 1; n <= 3; n++) {
    const key = Object.keys(urls).find((k) => k.endsWith(`/cliff-${kind}-${n}.webp`));
    pictures.set(`${kind}${n}`, key ? artImage(urls[key], 1) : null);
  }
}
const cloudKey = Object.keys(urls).find((k) => k.endsWith('/cloud.webp'));
const cloud = cloudKey ? artImage(urls[cloudKey], 1) : null;
/** The owner's cloud that hides a cliff's feet (clouds_3.png), once it has loaded. */
export function cliffCloud(): HTMLImageElement | null { return artReady(cloud) ? cloud : null; }

/**
 * The clouds over a cliff's feet (the owner: hide the base with clouds, it looked like it floated): two puffs of the
 * owner's cloud side by side over its lower part, a little wider together than the cliff. Centre x, top, size, and
 * whether the picture is mirrored.
 */
export function cliffClouds(sp: CliffSpot, aspect: number): { x: number; top: number; w: number; h: number; flip: boolean }[] {
  const w = sp.w * 0.72, h = w * aspect, mid = sp.top + sp.h * 0.88;
  return [
    { x: sp.x - sp.w * 0.24, top: mid - h * 0.55, w, h, flip: false },
    { x: sp.x + sp.w * 0.26, top: mid - h * 0.45, w: w * 0.92, h: h * 0.92, flip: true },
  ];
}

/** Cliff `n` (1 to 3) of a kind, once it has loaded (null until then). */
export function cliffPicture(kind: CliffKind, n: number): HTMLImageElement | null {
  const img = pictures.get(`${kind}${n}`);
  return artReady(img) ? img : null;
}

/** A stable 0..1 hash of a layer's slot. */
function hash(kind: CliffKind, k: number, salt: number): number {
  let h = Math.imul(k ^ 0x6d2b79f5, 0x85ebca6b) ^ Math.imul(salt + (kind === 'back' ? 0x1b873593 : 0x7feb352d), 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

export interface CliffSpot {
  /** The picture (1 to 3 of the layer's kind), its centre and size on screen, and the top of it. */
  n: number;
  x: number;
  top: number;
  w: number;
  h: number;
}

/**
 * The cliffs of a layer on screen. `u`: how far the layer has slid (px at zoom 1); `base`: the screen y of the back
 * track at the middle of the screen; `zoom`: your own zoom (they grow and shrink with it about the middle of the
 * screen, as the pines do); `aspect`: a picture's height over its width (null until it has loaded).
 */
export function cliffSpots(layer: CliffLayer, u: number, base: number, cw: number, ch: number, aspect: (n: number) => number | null, zoom = 1): CliffSpot[] {
  const unit = Math.max(cw, ch * 1.3);
  const slot = layer.slot * unit, w = layer.width * unit;
  const half = cw / 2 / zoom; // half the screen, in layer px
  const out: CliffSpot[] = [];
  // slot k's centre is at layer px (k + 0.5 + jitter) * slot; on screen at cw/2 + (that - u) * zoom
  for (let k = Math.floor((u - half - w) / slot) - 1; (k - 0.5) * slot <= u + half + w; k++) {
    if (hash(layer.kind, k, 0) >= layer.chance) continue;
    const n = 1 + ((k % 3) + 3) % 3; // neighbours always differ
    const a = aspect(n);
    if (a === null) continue;
    const cw2 = w * (0.88 + 0.24 * hash(layer.kind, k, 1)) * zoom;
    const x = cw / 2 + ((k + 0.5 + (hash(layer.kind, k, 2) - 0.5) * 0.3) * slot - u) * zoom;
    if (x + cw2 / 2 < 0 || x - cw2 / 2 > cw) continue;
    const h = cw2 * a;
    out.push({ n, x, top: base - layer.rise * ch + h * layer.sink - h, w: cw2, h });
  }
  return out;
}
