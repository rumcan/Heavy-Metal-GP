// The foreground forest's geometry (render.ts draws it): the line the owner's pines stand on, and where the owner's
// islands stand. Pure, so the owner's rules can be tested without a canvas:
//
// - The pines are angled with every hill and never move against the track: the line follows the track you are on as
//   it lies on the screen, column by column (floating floors left out, so no forest stands up under a Workshop curve).
// - The tree line does not move with the camera's own zoom (the owner: "make sure the tree line DOES NOT MOVE DOWN";
//   measured: Infinity's speed zoom swings from about 1.56 to 0.86, and anything measured in it slid the forest 70 to
//   200 px as you sped up and slowed down). The depth of the forest below the track is in your own zoom only (the
//   caller passes it measured with fgScale), so only the track's own shape moves it.
// - On a slope the pines (and the islands) move with the track, not faster than it (the owner: tilted trees on a slope
//   moved up and down as the ball passed). The camera holds the track still on screen, and a row standing on a sloped
//   line that slides sideways faster than the track (its depth) has to climb or drop along the line as it goes: up
//   and down against the track. On level ground that sideways slide is harmless, so there the rows keep their depth.
//   slopeParallax caps how fast a row may slide against the track by the slope it stands on.
// - The islands stand just behind the front row of pines, on the trees (a fixed height in them where they stand, so
//   they never sink into them or rise out of them), sliding at their own depth on level ground and with the track on a
//   slope. And one only shows over a quiet stretch of track (the owner): nothing big on the track it stands in front of.

import type { CoursePlan } from './course';
import { SPRING_W } from './course';

/** How the forest is looked at: render.ts passes its camera. */
export interface ForestView {
  /** The camera's centre in world px, and its zoom (world px to screen px). */
  x: number;
  y: number;
  scale: number;
  /** Infinity's floating origin: absolute world x = local x + originX. */
  originX?: number;
}

/** The line is sampled every COL screen px, from BEYOND of a screen width past each edge. */
const COL = 24;
const BEYOND = 0.6;
/** Never steeper than a hillside on screen (px up per px along): a step in the track is eased over, so the trees never stand up in a tower. */
const MAX_SLOPE = 0.6;

/**
 * The line the pines stand on, as a function of screen x: the track (`groundAt`, world px at a world x, or null where
 * there is none standing on the ground) where it lies on the screen, plus `depth` screen px. Over a gap it holds the
 * height to its left, left of the first track it takes that track's height, and it is eased so it is never steeper than
 * MAX_SLOPE. Sampled half a screen past each edge, so a step just off screen is already eased when it scrolls in.
 * `fallback`: the line when there is no track near at all.
 */
export function forestLine(groundAt: (worldX: number) => number | null, view: ForestView, cw: number, ch: number, depth: number, fallback: number): (sx: number) => number {
  const x0 = -Math.ceil((cw * BEYOND) / COL) * COL;
  const cols = Math.ceil((cw * (1 + 2 * BEYOND)) / COL) + 2;
  const line = new Float32Array(cols);
  let held = fallback, first = -1;
  for (let c = 0; c < cols; c++) {
    const y = groundAt(view.x + (x0 + c * COL - cw / 2) / view.scale);
    if (y !== null) { held = ch / 2 + (y - view.y) * view.scale + depth; if (first < 0) first = c; }
    line[c] = held;
  }
  if (first > 0) for (let c = 0; c < first; c++) line[c] = line[first];
  const rise = COL * MAX_SLOPE;
  for (let c = 1; c < cols; c++) line[c] = Math.max(line[c - 1] - rise, Math.min(line[c - 1] + rise, line[c]));
  for (let c = cols - 2; c >= 0; c--) line[c] = Math.max(line[c + 1] - rise, Math.min(line[c + 1] + rise, line[c]));
  return (sx: number) => {
    const f = Math.max(0, Math.min(cols - 1.001, (sx - x0) / COL));
    const c = Math.floor(f);
    return line[c] + (line[c + 1] - line[c]) * (f - c);
  };
}

/**
 * The most a row of pines (or an island) may slide up or down against the track, in screen px per screen px the track
 * scrolls by: a tree crossing the whole screen on a slope moves at most about 5 px against the track (unseen).
 */
export const PARALLAX_DRIFT = 0.004;

/** The steepest the line is (px up or down per px along) from a third of a screen left of the screen to a third right of it (a slope coming on is seen early). */
export function lineSlope(line: (sx: number) => number, cw: number): number {
  let worst = 0;
  for (let sx = -cw * 0.3; sx < cw * 1.3; sx += COL) worst = Math.max(worst, Math.abs(line(sx + COL) - line(sx)) / COL);
  return worst;
}

/**
 * How fast a row at depth `p` (its sideways speed over the track's) slides on a line `slope` steep: its full depth on
 * level ground, and on a slope no faster against the track than PARALLAX_DRIFT lets it climb or drop along the line.
 */
export function slopeParallax(p: number, slope: number): number {
  const d = p - 1;
  return 1 + Math.sign(d) * Math.min(Math.abs(d), PARALLAX_DRIFT / Math.max(slope, 1e-6));
}

/** The slope the rows go by this frame: a slope coming on takes effect within a few frames, level ground comes back slowly. */
export function easeSlope(eased: number, now: number): number {
  return eased + (now - eased) * (now > eased ? 0.35 : 0.03);
}

/** The islands' depth: just behind the front row of pines (parallax 1.35), so on level ground they slide a touch slower than it. */
export const ISLAND_PARALLAX = 1.32;
/**
 * One island or none per slot of this many px of the islands' layer (track px on a slope): a km (the owner: one per km,
 * never two right next to each other), and the chance a slot has one. In its slot an island stands at the first of
 * ISLAND_SPOTS (fractions of the slot, 0.2 to 0.8, from the middle out) where the track is quiet, so two are never
 * nearer than 0.4 km.
 */
export const ISLAND_SLOT_W = 10_000;
export const ISLAND_CHANCE = 1;
export const ISLAND_SPOTS: readonly number[] = [0.5, ...Array.from({ length: 10 }, (_, i) => [0.5 - 0.03 * (i + 1), 0.5 + 0.03 * (i + 1)]).flat()];
/**
 * How far either side of an island's spot (world px) the track must be quiet: the stretch it stands in front of while it
 * crosses the middle of the screen, the same on every screen. (It used to cover its whole way across the screen at the
 * widest zoom, which grows with the screen: on a 1900 px window it asked for 2.3 km of empty track, and in 10 km of
 * Infinity not one island came, the owner.)
 */
export const ISLAND_QUIET_REACH = 400;

/** What a slot holds: which picture (by its index in the caller's list), where in the slot, how big, how deep in the trees. */
export interface IslandPick { art: number; at: number; size: number; sink: number }

export interface IslandSpot {
  /** The picture's index (the caller's list), its centre and top on screen, and its size on screen. */
  art: number;
  x: number;
  top: number;
  w: number;
  h: number;
}

export interface IslandEnv {
  /** The tops of the front row of pines on screen (screen y at a screen x): what an island stands in. */
  treesAt: (sx: number) => number;
  /** Is the track clear of anything going on between two world x's (local coordinates)? */
  quiet: (x0: number, x1: number) => boolean;
  pick: (slot: number) => IslandPick | null;
  /** A picture's relative width (400 is the usual) and its height over its width (null until it has loaded). */
  widthOf: (art: number) => number;
  aspect: (art: number) => number | null;
  /** Each slot's spot (a fraction of the slot) or none, decided once when it first comes near (so an island never pops in or out on screen). */
  memo?: Map<number, number | null>;
  /** Your own zoom (1 = as framed): an island grows and shrinks with it, as the pines do. */
  zoom?: number;
}

/**
 * Where the islands' layer is: `u` layer px along (it moves by the camera's movement times `pe`, the islands' depth
 * for the slope they stand on: slopeParallax of ISLAND_PARALLAX), so an island's slot at layer x `wx` is on screen at
 * cw/2 + (wx - u) * px. `px`: screen px per layer px (default the camera's scale); `world`: track px per layer px
 * (default 1). render.ts measures the layer in your own zoom (fgScale), so the camera's speed zoom never slides an
 * island sideways (on a slope, up and down) and your zoom grows the gaps between them with the islands themselves.
 */
export interface IslandLayer { u: number; pe: number; px?: number; world?: number }

/** An island's size on screen: half to two thirds of the screen (they only work very large, the owner), a little smaller than at first. */
export function islandWidth(cw: number, ch: number, size: number, artWidth: number): number {
  return Math.min(Math.max(cw, ch * 1.3) * (0.42 + 0.2 * size) * Math.sqrt(artWidth / 400), cw * 0.9);
}

/** The islands on screen this frame (each in a slot of the islands' layer, `pick` decides which), only over quiet track. */
export function islandSpots(view: ForestView, layer: IslandLayer, cw: number, ch: number, env: IslandEnv): IslandSpot[] {
  const out: IslandSpot[] = [];
  const s = layer.px ?? view.scale, zoom = env.zoom ?? 1, world = layer.world ?? 1;
  // an island is at most a screen wide (times your zoom)
  const margin = (cw * Math.max(1, zoom)) / s;
  for (let k = Math.floor((layer.u - margin) / ISLAND_SLOT_W) - 1; k * ISLAND_SLOT_W <= layer.u + margin; k++) {
    const p = env.pick(k);
    if (!p) continue;
    // its spot: the first quiet one in the slot, judged by the track it will stand in front of as it crosses the
    // middle of the screen, decided once
    let at = env.memo?.get(k);
    if (at === undefined) {
      at = islandSpotIn(k, (wx) => view.x + ((wx - layer.u) * world) / Math.max(1, layer.pe), env.quiet);
      env.memo?.set(k, at);
    }
    if (at === null) continue;
    const a = env.aspect(p.art);
    if (a === null) continue;
    const w = islandWidth(cw, ch, p.size, env.widthOf(p.art)) * zoom, h = w * a;
    const x = cw / 2 + ((k + at) * ISLAND_SLOT_W - layer.u) * s;
    if (x + w / 2 < 0 || x - w / 2 > cw) continue;
    // standing in the trees where it is (the tops of the trees across its middle, averaged: one sampled point of the
    // tree line wobbled a pixel or two and the whole island jittered), so it never sinks into them or rises out of them
    let trees = 0;
    for (let i = -2; i <= 2; i++) trees += env.treesAt(x + (i * w) / 10);
    out.push({ art: p.art, x, top: trees / 5 - h * (0.42 + 0.12 * p.sink), w, h });
  }
  return out;
}

/** Slot k's island spot (a fraction of the slot: the first of ISLAND_SPOTS over quiet track), or null. `toTrack`: a layer x to the track x it stands in front of. */
export function islandSpotIn(k: number, toTrack: (wx: number) => number, quiet: (x0: number, x1: number) => boolean): number | null {
  for (const f of ISLAND_SPOTS) {
    const x = toTrack((k + f) * ISLAND_SLOT_W);
    if (quiet(x - ISLAND_QUIET_REACH, x + ISLAND_QUIET_REACH)) return f;
  }
  return null;
}

/**
 * Where on a course something is going on (the islands only stand where nothing is: the owner), as [x0, x1] stretches
 * of world px: loops (and Workshop rails), lane ramps and doors, kickers, springs, bridges, death pits (with their run-up) and every gap in a
 * floor, ledges, wrecking balls, item boxes, the start and the finish. Clouds, rings, boost pads, crates and vents are
 * small things in the sky or on the road: an island may stand in front of those.
 */
export function busyStretches(plan: CoursePlan): [number, number][] {
  const busy: [number, number][] = [];
  for (const l of plan.loops ?? []) busy.push([l.x - 250, l.x + (l.pitch ?? 0) + 250]);
  (plan.tracks ?? []).forEach((t) => busy.push([t.box.x0 - 250, t.box.x1 + 250])); // Workshop loops and rails (Infinity's loops), a sparse list
  for (const g of plan.gates) busy.push([g.x - 60, g.x + g.w + 260]);
  for (const k of plan.kickers ?? []) busy.push([k.x - 60, k.x + k.w + 260]);
  for (const sp of plan.springs ?? []) busy.push([sp.x - 60, sp.x + SPRING_W + 260]);
  for (const b of plan.bridges ?? []) busy.push([b.x0 - 100, b.x1 + 100]);
  for (const p of plan.pits ?? []) busy.push([p.x0 - 900, p.x1 + 300]);
  for (const l of plan.ledges ?? []) if (l.cloud === undefined) busy.push([l.x - 60, l.x + l.w + 60]);
  for (const w of plan.wreckers ?? []) busy.push([w.x - w.chain - 60, w.x + w.chain + 60]);
  for (const b of plan.itemBoxes ?? []) busy.push([b.x - 80, b.x + 80]);
  busy.push([plan.startX - 900, plan.startX + 700], [plan.finishX - 700, plan.finishX + 700]);
  // every gap in a lane's floor (a chasm to jump)
  for (const lane of [0, 1, 2]) {
    const fl = plan.floors.filter((f) => f.lane === lane).sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < fl.length; i++) if (fl[i].x0 - fl[i - 1].x1 > 2) busy.push([fl[i - 1].x1 - 150, fl[i].x0 + 150]);
  }
  return busy;
}

/** A quick test that a stretch [x0, x1] is clear of every busy stretch (sorted and merged once). */
export function quietTest(busy: [number, number][]): (x0: number, x1: number) => boolean {
  const sorted = busy.filter(([a, b]) => b >= a).sort((p, q) => p[0] - q[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  return (x0: number, x1: number) => {
    // the first busy stretch ending after x0: is it starting before x1?
    let lo = 0, hi = merged.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (merged[mid][1] < x0) lo = mid + 1; else hi = mid; }
    return lo >= merged.length || merged[lo][0] > x1;
  };
}
