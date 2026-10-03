// P2-22: a platformer course made in the Workshop is an ordinary TrackDef (`mode: 'platformer'`), so My tracks, drafts,
// undo, groups, templates, share codes and publishing all work on it. This module turns such a def into the CoursePlan
// the race already knows how to build and drive, and keeps the pieces sitting on their floors.
//
// What a piece means on a platformer course (each has a `lane`: 0 back, 1 middle (absent), 2 front):
//   ramp / ice / curve  a floor (a curve is cut into 12 straight slabs)       pad      a spring
//   boost               a boost strip (x is its middle, len its width)        itembox  a power-up box
//   wrecker             a wrecking ball on a chain                            block    a crate to jump
//   bridge              a rope bridge over a chasm                            loop     a loop (x = where the ride starts)
//   gate                a lane gate (ramp or door)                            ledge    a one-way ledge
// The start platform and the finish run-out are not pieces: they are added here, like the classic editor adds its
// start and finish stubs, so the builder only works on the middle of the course.
import type { Piece, TrackDef } from '../trackdef';
import { SPRING_W } from './course';
import type { BoostSpot, Bump, CoursePlan, Floor, ItemBoxSpot, Lane, LaneGate, Ledge, Spring, WreckerSpot } from './course';
import { LOOP_PITCH, LOOP_R, PLANK_H } from './routes';
import type { BridgeSpot, LoopSpot } from './routes';

/** The y of the flat start platform. A platformer def is built downwards from here, with room above it to climb. */
export const PF_START_Y = 800;
/** Where the start platform ends (all three lanes are flat up to here). */
export const PF_START_END = 900;
/** The finish line stands this far from the right end of the course. */
export const PF_FINISH_FROM_END = 500;
/** The run-out floor under the finish starts this far before the line. */
const RUN_OUT_BEFORE = 300;
/** A new course's length, and the Length buttons' step. */
export const PF_DEFAULT_WIDTH = 12000;
export const PF_WIDTH_STEP = 2000;

const LANES: readonly Lane[] = [0, 1, 2];
const laneOf = (p: Piece): Lane => (p.lane ?? 1) as Lane;

/** A fresh, empty platformer course: just the start platform and the finish. */
export function newPlatformerDef(name: string, width = PF_DEFAULT_WIDTH, theme: TrackDef['theme'] = 'classic'): TrackDef {
  return { v: 1, name, theme, height: PF_START_Y + 900, mode: 'platformer', width, pieces: [] };
}

export const isPlatformerDef = (def: Pick<TrackDef, 'mode'> | null | undefined): boolean => def?.mode === 'platformer';

/** A quadratic Bézier cut into straight floor slabs. */
function curveFloors(lane: Lane, a: [number, number], c: [number, number], b: [number, number], n: number): Floor[] {
  const out: Floor[] = [];
  let px = a[0], py = a[1];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    const x = u * u * a[0] + 2 * u * t * c[0] + t * t * b[0];
    const y = u * u * a[1] + 2 * u * t * c[1] + t * t * b[1];
    out.push(...slab(lane, px, py, x, y));
    px = x; py = y;
  }
  return out;
}

/** One floor from (ax, ay) to (bx, by), left to right; a vertical one is no floor at all. */
function slab(lane: Lane, ax: number, ay: number, bx: number, by: number): Floor[] {
  if (Math.abs(bx - ax) < 1) return [];
  return ax < bx ? [{ lane, x0: ax, y0: ay, x1: bx, y1: by }] : [{ lane, x0: bx, y0: by, x1: ax, y1: ay }];
}

/** The floors the def's own pieces make (not the start platform or the run-out). */
export function pieceFloors(def: TrackDef): Floor[] {
  const out: Floor[] = [];
  for (const p of def.pieces) {
    if (p.t === 'ramp' || p.t === 'ice') out.push(...slab(laneOf(p), p.a[0], p.a[1], p.b[0], p.b[1]));
    else if (p.t === 'curve') out.push(...curveFloors(laneOf(p), p.a, p.c, p.b, p.n ?? 12));
  }
  return out;
}

/** The y of a lane's floor at x among `floors`, or null where there is none (a gap). The highest surface wins. */
export function floorYAt(floors: readonly Floor[], lane: Lane, x: number): number | null {
  let best: number | null = null;
  for (const f of floors) {
    if (f.lane !== lane || x < f.x0 || x > f.x1) continue;
    const y = f.y0 + ((x - f.x0) / (f.x1 - f.x0)) * (f.y1 - f.y0);
    if (best === null || y < best) best = y;
  }
  return best;
}

/** The finish line's x for a course of this width. */
export const finishXOf = (width: number): number => width - PF_FINISH_FROM_END;

/** The fixed floors: the flat start platform and the run-out under the finish, on every lane. */
function fixedFloors(def: TrackDef, own: readonly Floor[]): Floor[] {
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const runX = finishXOf(width) - RUN_OUT_BEFORE;
  const runY = floorYAt(own, 1, runX) ?? PF_START_Y;
  const out: Floor[] = [];
  for (const lane of LANES) {
    out.push({ lane, x0: -200, y0: PF_START_Y, x1: PF_START_END, y1: PF_START_Y });
    out.push({ lane, x0: runX, y0: runY, x1: width, y1: runY });
  }
  return out;
}

/**
 * Keeps floor-bound pieces (springs, crates, gates) standing on the floor of their lane. Floating things (item boxes,
 * wreckers, bridges, ledges, loops and boosts) are left where the builder put them. Returns the same def object if
 * nothing moved, so it costs nothing on every edit.
 */
export function settle(def: TrackDef): TrackDef {
  if (!isPlatformerDef(def)) return def;
  const floors = [...pieceFloors(def), ...fixedFloors(def, pieceFloors(def))];
  let changed = false;
  const pieces = def.pieces.map((p): Piece => {
    const lane = laneOf(p);
    const snap = (x: number, y: number): number => floorYAt(floors, lane, x) ?? y;
    if (p.t === 'pad') { const y = snap(p.x, p.y); if (y !== p.y) { changed = true; return { ...p, y }; } }
    else if (p.t === 'gate') { const y = snap(p.x + p.w / 2, p.y); if (y !== p.y) { changed = true; return { ...p, y }; } }
    else if (p.t === 'block') {
      const y = snap(p.x, p.y + p.h / 2) - p.h / 2;
      if (Math.abs(y - p.y) > 0.5) { changed = true; return { ...p, y }; }
    }
    return p;
  });
  return changed ? { ...def, pieces } : def;
}

/** The CoursePlan a platformer def describes: what the race builds, the AI reads and the editor draws. */
export function planFromTrackDef(def: TrackDef): CoursePlan {
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const own = pieceFloors(def);
  const floors: Floor[] = [...fixedFloors(def, own), ...own];
  const bumps: Bump[] = [], gates: LaneGate[] = [], ledges: Ledge[] = [], springs: Spring[] = [];
  const itemBoxes: ItemBoxSpot[] = [], wreckers: WreckerSpot[] = [], boosts: BoostSpot[] = [];
  const loops: LoopSpot[] = [], bridges: BridgeSpot[] = [];
  for (const p of def.pieces) {
    const lane = laneOf(p);
    switch (p.t) {
      case 'pad': springs.push({ lane, x: p.x - SPRING_W / 2, y: p.y }); break;
      case 'boost': boosts.push({ lane, x: p.x - p.len / 2, w: p.len }); break;
      case 'itembox': itemBoxes.push({ lane, x: p.x, y: p.y }); break;
      case 'wrecker': wreckers.push({ lane, x: p.pivot[0], pivotY: p.pivot[1], chain: p.chain, amp: p.amp, speed: p.speed, phase: p.phase ?? 0 }); break;
      case 'block': bumps.push({ lane, x: p.x - p.w / 2, w: p.w, y: p.y - p.h / 2, h: p.h }); break;
      case 'gate': gates.push({ kind: p.kind, lane, to: p.to, x: p.x, w: p.w, y: p.y }); break;
      case 'ledge': ledges.push({ lane, x: p.x, w: p.w, y: p.y }); break;
      case 'loop': loops.push({ lane, x: p.x, y: p.bottom, r: LOOP_R, pitch: LOOP_PITCH }); break;
      case 'bridge': {
        const [ax, ay] = p.a[0] <= p.b[0] ? p.a : p.b, [bx, by] = p.a[0] <= p.b[0] ? p.b : p.a;
        bridges.push({ lane, x0: ax, y0: ay + PLANK_H / 2, x1: bx, y1: by + PLANK_H / 2, planks: Math.max(p.planks, Math.ceil((bx - ax) / 20)), slack: p.slack });
        break;
      }
      default: break;
    }
  }
  // The race line (progress is measured along it): above the middle lane's floor, holding its last height over gaps.
  const path: { x: number; y: number }[] = [];
  let lastY = PF_START_Y;
  for (let x = 0; x <= width; x += 200) {
    lastY = floorYAt(floors, 1, x) ?? lastY;
    path.push({ x, y: lastY - 30 });
  }
  const finishX = finishXOf(width);
  const finishY = floorYAt(floors, 1, finishX) ?? lastY;
  let maxY = PF_START_Y;
  for (const f of floors) maxY = Math.max(maxY, f.y0, f.y1);
  const height = Math.max(def.height, maxY + 900);
  return {
    seed: def.seed ?? 0, style: 'flow', width, height, floors, bumps, gates, path,
    startX: 520, startY: PF_START_Y, finishX, finishY,
    springs, ledges, itemBoxes, wreckers, boosts, loops, bridges,
  };
}

/** Readable problems that stop a course being raced (empty = fine). The headless AI race is the other half of validation. */
export function platformerProblems(def: TrackDef): string[] {
  const out: string[] = [];
  const width = def.width ?? PF_DEFAULT_WIDTH;
  const floors = [...pieceFloors(def), ...fixedFloors(def, pieceFloors(def))];
  const finishX = finishXOf(width);
  for (const [i, p] of def.pieces.entries()) {
    const lane = laneOf(p);
    const name = `${p.t} #${i + 1}`;
    const at = (x: number) => Math.round(x);
    if (p.t === 'gate') {
      if (p.to === lane) out.push(`${name} at x ${at(p.x)} leads to its own lane (back, middle or front): pick another lane to go to.`);
      if (floorYAt(floors, lane, p.x + p.w / 2) === null) out.push(`${name} at x ${at(p.x)} has no floor under it in its lane.`);
      if (floorYAt(floors, p.to, p.x + p.w / 2) === null) out.push(`${name} at x ${at(p.x)} sends you to a lane with no floor there.`);
    }
    if (p.t === 'pad' && floorYAt(floors, lane, p.x) === null) out.push(`${name} at x ${at(p.x)} floats: there is no floor under it in its lane.`);
    if (p.t === 'block' && floorYAt(floors, lane, p.x) === null) out.push(`${name} at x ${at(p.x)} floats: there is no floor under it in its lane.`);
    if (p.t === 'loop' && floorYAt(floors, lane, p.x) === null) out.push(`${name} at x ${at(p.x)} has no floor to start the ride on.`);
    const xs = (() => {
      switch (p.t) {
        case 'ramp': case 'ice': return [p.a[0], p.b[0]];
        case 'curve': return [p.a[0], p.c[0], p.b[0]];
        case 'bridge': return [p.a[0], p.b[0]];
        case 'wrecker': return [p.pivot[0]];
        case 'gate': case 'ledge': return [p.x, p.x + p.w];
        default: return 'x' in p ? [(p as { x: number }).x] : [];
      }
    })();
    if (xs.some((x) => x > finishX + 400)) out.push(`${name} stands beyond the finish line (x ${at(finishX)}): move it back or make the course longer.`);
  }
  // A floor under the middle lane from the start to the finish, except where a bridge or a jump crosses a gap.
  let gap = 0;
  for (let x = PF_START_END; x < finishX; x += 50) {
    const bridged = (def.pieces as Piece[]).some((p) => p.t === 'bridge' && laneOf(p) === 1 && x >= Math.min(p.a[0], p.b[0]) && x <= Math.max(p.a[0], p.b[0]));
    if (floorYAt(floors, 1, x) === null && !bridged) { gap += 50; if (gap > 300) { out.push(`The middle lane has a gap near x ${Math.round(x)} that is too wide to jump (over 300): add a floor, a bridge or another route.`); break; } }
    else gap = 0;
  }
  return out;
}
