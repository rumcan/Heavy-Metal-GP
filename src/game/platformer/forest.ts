// The foreground forest's geometry (render.ts draws it): the line the owner's pines stand on, and where the owner's
// islands stand. Pure, so the owner's rules can be tested without a canvas:
//
// - The pines are angled with every hill and never move against the track: the line follows the track you are on as
//   it lies on the screen, column by column (floating floors left out, so no forest stands up under a Workshop curve).
// - The tree line does not move with the camera's own zoom (the owner: "make sure the tree line DOES NOT MOVE DOWN";
//   measured: Infinity's speed zoom swings from about 1.56 to 0.86, and anything measured in it slid the forest 70 to
//   200 px as you sped up and slowed down). The depth of the forest below the track is in your own zoom only (the
//   caller passes it measured with fgScale), so only the track's own shape moves it.
// - The islands stand just behind the front row of pines and slide at its depth. Each stands on the land at its own
//   depth (rigid: it never bobs), which keeps it at the same height in the trees on a steady slope, so it does not sink
//   into them or rise out of them as it passes. And it only shows over a quiet stretch of track (the owner): nothing
//   big on the track it covers on its whole way across the screen.

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

/** The islands' depth: just behind the front row of pines (parallax 1.35), so they slide a touch slower than it. */
export const ISLAND_PARALLAX = 1.32;
/**
 * One island or none per slot of this many world px (at the islands' depth), and the chance a slot has one: every
 * slot over quiet track does (quiet stretches are rare enough: about one every 3 to 4 km of Infinity).
 */
export const ISLAND_SLOT_W = 2200;
export const ISLAND_CHANCE = 1;
/** The camera's widest automatic zoom, relative to your own (Infinity's speed zoom goes down to 0.55): the quiet check covers it. */
const WIDEST = 0.55;

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
  /** The track's height (world px, local coordinates) at a world x, or null: what the island stands on. */
  groundAt: (worldX: number) => number | null;
  /** Screen px from the track (at an island's depth) down to the tops of the front row of pines. */
  treeDrop: number;
  /** Is the track clear of anything going on between two world x's (local coordinates)? */
  quiet: (x0: number, x1: number) => boolean;
  /** Your own zoom (fgScale): the quiet check is done for the widest the camera zooms out to. */
  fs: number;
  pick: (slot: number) => IslandPick | null;
  /** A picture's relative width (400 is the usual) and its height over its width (null until it has loaded). */
  widthOf: (art: number) => number;
  aspect: (art: number) => number | null;
}

/** An island's size on screen: half to two thirds of the screen (they only work very large, the owner), a little smaller than at first. */
export function islandWidth(cw: number, ch: number, size: number, artWidth: number): number {
  return Math.min(Math.max(cw, ch * 1.3) * (0.42 + 0.2 * size) * Math.sqrt(artWidth / 400), cw * 0.9);
}

/**
 * How far either side of an island's own spot (world px) the track it covers lies, on its whole way across the screen
 * at the widest zoom: it slides at ISLAND_PARALLAX while the track slides at 1, so the stretch behind it drifts by
 * (ISLAND_PARALLAX - 1) of the camera's travel; plus the part of it tall enough to stand in front of the track (its
 * lower half is in the trees and its top is narrower: about the middle 70 % of its width), plus a margin.
 */
export function islandReach(cw: number, w: number, fs: number): number {
  const s = fs * WIDEST, P = ISLAND_PARALLAX;
  return ((P - 1) * (cw / 2 + w / 2)) / (s * P) + (w * 0.35) / s + 100;
}

/** The islands on screen this frame (each in a slot of the islands' depth, `pick` decides which), only over quiet track. */
export function islandSpots(view: ForestView, cw: number, ch: number, env: IslandEnv): IslandSpot[] {
  const out: IslandSpot[] = [];
  const ox = view.originX ?? 0, s = view.scale, P = ISLAND_PARALLAX;
  // the islands' depth on screen: x = cw/2 + (wx - view.x) * s * P; an island is at most a screen wide
  const margin = cw / (s * P);
  const left = view.x + ox - margin, right = view.x + ox + margin;
  for (let k = Math.floor(left / ISLAND_SLOT_W) - 1; k * ISLAND_SLOT_W <= right; k++) {
    const p = env.pick(k);
    if (!p) continue;
    const a = env.aspect(p.art);
    if (a === null) continue;
    const w = islandWidth(cw, ch, p.size, env.widthOf(p.art)), h = w * a;
    const wx = (k + 0.35 + 0.3 * p.at) * ISLAND_SLOT_W - ox;
    const x = cw / 2 + (wx - view.x) * s * P;
    if (x + w / 2 < 0 || x - w / 2 > cw) continue;
    const reach = islandReach(cw, w, env.fs);
    if (!env.quiet(wx - reach, wx + reach)) continue;
    const g = env.groundAt(wx);
    if (g === null) continue;
    // rigid at its own depth: its height moves only as the camera does (times its depth), never with the hills it
    // passes; on a steady slope that is exactly how the pines in front of it move
    const ground = ch / 2 + (g - view.y) * s * P + env.treeDrop;
    out.push({ art: p.art, x, top: ground - h * (0.42 + 0.12 * p.sink), w, h });
  }
  return out;
}

/**
 * Where on a course something is going on (the islands only stand where nothing is: the owner), as [x0, x1] stretches
 * of world px: loops, lane ramps and doors, kickers, springs, bridges, death pits (with their run-up) and every gap in a
 * floor, ledges, wrecking balls, item boxes, the start and the finish. Clouds, rings, boost pads, crates and vents are
 * small things in the sky or on the road: an island may stand in front of those.
 */
export function busyStretches(plan: CoursePlan): [number, number][] {
  const busy: [number, number][] = [];
  for (const l of plan.loops ?? []) busy.push([l.x - 250, l.x + (l.pitch ?? 0) + 250]);
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
